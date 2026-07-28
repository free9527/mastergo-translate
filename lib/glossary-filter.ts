/**
 * 智能术语库过滤：仅提取源文本中实际出现或相关的术语
 * 替代之前的全量注入，减少 prompt token 浪费并提高术语命中精度
 */

export interface GlossaryMap {
  [source: string]: string
}

/**
 * 简单的英文词形还原（stemming）
 */
function stemEnglish(word: string): string {
  const w = word.toLowerCase()
  // 复数
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('ves') && w.length > 4) return w.slice(0, -3) + 'f'
  if (w.endsWith('ses') && w.length > 4) return w.slice(0, -2)
  if (w.endsWith('es') && w.length > 3) {
    const stem = w.slice(0, -2)
    if (stem.endsWith('sh') || stem.endsWith('ch') || stem.endsWith('ss') || stem.endsWith('x') || stem.endsWith('z') || stem.endsWith('o')) {
      return stem
    }
    // s结尾的普通词 → 去s
    if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
    return w
  }
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  // -ing
  if (w.endsWith('ing') && w.length > 5) {
    const stem = w.slice(0, -3)
    if (stem.endsWith('nn')) return stem.slice(0, -1)
    return stem
  }
  // -ed
  if (w.endsWith('ed') && w.length > 4) {
    const stem = w.slice(0, -2)
    if (stem.endsWith('nn')) return stem.slice(0, -1)
    return stem
  }
  return w
}

/**
 * 判断术语是否为品类词（产品品类名称）
 * 品类词在产品名文本中不应被翻译，因为产品名整体保留英文
 * v8.6: 品类词已在 [LANG_RULES] 的品类词对照表中注入，跳过以避免重复
 */
function isCategoryWord(term: string): boolean {
  const CATEGORY_WORDS = new Set([
    'SSD', 'Portable SSD', 'Flash Drive', 'Dual Drive', 'Card',
    'SDXC Card', 'microSDXC Card', 'CFexpress Card', 'CompactFlash Card',
    'Desktop Memory', 'Laptop Memory', 'Reader', 'Card Reader',
    'Enclosure', 'Hub', 'Solid State Dual Drive',
    'Solid State Drive', 'Memory Card', 'USB Stick',
  ])
  return CATEGORY_WORDS.has(term.trim())
}

/**
 * 检测文本是否包含 Lexar 产品型号
 * 存储卡：速度代号 + 颜色等级（如 2000x GOLD, CFexpress Type A SILVER）
 * SSD/内存/U盘：字母数字代码 + 可选后缀（如 NM790, D40E, F35 PRO）
 * 型号属于产品标识符，不触发术语库匹配
 */
function containsModelNumber(text: string): boolean {
  // 存储卡型号：速度代号 + 颜色等级
  // 2000x GOLD, 633x BLUE, 1066x SILVER, CFexpress Type A GOLD
  const CARD_MODEL_RE = /\b(?:\d+x\s+(?:GOLD|SILVER|BLUE|DIAMOND|PLATINUM)|CFexpress\s+Type\s+[AB]\s*(?:GOLD|SILVER|BLUE|DIAMOND|PLATINUM)?)\b/i
  // SSD/内存/U盘型号：NM790, NQ790, D40E, F35 PRO, ARES DDR5, PLAY PRO
  const SSD_MODEL_RE = /\b(?:(?:NM|NQ|NS|EQ)\d+[A-Z]?(?:\s+PRO)?|[A-Z]\d{2}[A-Z]?(?:\s+PRO)?)\b/i
  return CARD_MODEL_RE.test(text) || SSD_MODEL_RE.test(text)
}

/**
 * 术语匹配归一化：处理大小写/连字符/空格/商标符号变体
 * 解决源文与术语库录入格式不一致的问题（如 "Up To Read" vs "read speed up to"）
 */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[®™©]/g, '')           // 去商标符号
    .replace(/[-_]/g, ' ')           // 连字符/下划线 → 空格
    .replace(/\s+/g, ' ')            // 空白归一化
    .trim()
}

/**
 * 检查术语是否在源文本中出现
 * 支持精确匹配、子串匹配和词形还原匹配
 */
function termMatches(term: string, sourceTexts: string[]): boolean {
  const termNorm = normalizeForMatch(term)
  if (termNorm.length < 2) return false

  for (const text of sourceTexts) {
    const textNorm = normalizeForMatch(text)

    // 1. 精确子串匹配（优先用归一化后的文本）
    if (termNorm.length <= 3) {
      const escaped = termNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(textNorm)) return true
    } else {
      if (textNorm.includes(termNorm)) return true
    }

    // 2. 单词级别匹配（术语作为独立单词出现）
    const termWords = termNorm.split(/\s+/)
    const textWords = textNorm.split(/[\s,.;:!?()\[\]{}]+/)
    if (termWords.every(tw => textWords.some(tw2 => tw2 === tw))) return true

    // 3. 词形还原匹配（仅对英文术语）— 只保留精确词形还原，删除前缀匹配
    // v8.2: 删除前缀匹配（stemmedTerm.startsWith(stw)），避免 write 匹配到 writing 等不相关术语
    if (/[a-z]/.test(termNorm)) {
      const stemmedTerm = termWords.map(stemEnglish).join(' ')
      const stemmedText = textWords.map(stemEnglish).join(' ')
      if (stemmedText.includes(stemmedTerm)) return true
    }
  }
  return false
}

/**
 * 从完整术语库中筛选当前批次相关的术语
 * @param glossaryMap 完整术语库（source → targetLang翻译）
 * @param sourceTexts 当前批次待翻译的源文本
 * @param maxTerms 最大术语数（控制 prompt 长度）
 * @returns 筛选后的术语映射 + 格式化的 prompt 提示文本
 */
export function filterRelevantGlossary(
  glossaryMap: GlossaryMap,
  sourceTexts: string[],
  maxTerms = 50,
): { filteredMap: GlossaryMap; glossaryHint: string } {
  const filtered: GlossaryMap = {}

  // 检测当前批次是否包含产品型号（产品名/型号文本）
  // 如果包含，说明是产品名相关文本，应更保守地注入术语库
  const hasModelNumber = sourceTexts.some(t => containsModelNumber(t))

  // v8.5: 按翻译值去重，避免冗余条目（如 "Up To Read" / "Read Speed Up To"）重复注入prompt
  // 相同翻译值只保留最先匹配的源文（通常是最长的/最完整的）
  const injectedTargets = new Set<string>()

  // 先按源文长度降序排序，确保长术语优先匹配
  const sortedEntries = Object.entries(glossaryMap).sort((a, b) => b[0].length - a[0].length)

  for (const [source, target] of sortedEntries) {
    // 跳过 source === target 的条目：产品名在目标语言中保持英文原样，
    // 注入 prompt 无翻译价值，反而挤占 token、给 LLM 混淆信号。
    // 依据：Lexar 产品命名规则 — 硬件参数/系列名/型号全语种保留英文。
    if (source === target) continue

    // v8.6: 品类词已在 [LANG_RULES] 的品类词对照表中注入，跳过以避免重复
    if (isCategoryWord(source)) continue

    // 如果源文本包含产品型号，跳过品类词术语（避免与产品名冲突）
    // 例如 "NM790 PCIe 4.0 SSD" 是产品名，不应注入 "SSD → 固态硬盘"
    if (hasModelNumber && isCategoryWord(source)) continue

    // v8.5: 按翻译值去重 — 相同翻译值只注入一次
    if (injectedTargets.has(target)) continue

    if (termMatches(source, sourceTexts)) {
      filtered[source] = target
      injectedTargets.add(target)
    }
    if (Object.keys(filtered).length >= maxTerms) break
  }

  if (Object.keys(filtered).length === 0) {
    return { filteredMap: {}, glossaryHint: '' }
  }

  const lines = Object.entries(filtered).map(([k, v]) => `${k} → ${v}`)
  const glossaryHint = `\n[GLOSSARY]\n${lines.join('\n')}`

  return { filteredMap: filtered, glossaryHint }
}

