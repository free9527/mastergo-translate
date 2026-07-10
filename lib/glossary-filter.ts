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
 * 检查术语是否在源文本中出现
 * 支持精确匹配、子串匹配和词形还原匹配
 */
function termMatches(term: string, sourceTexts: string[]): boolean {
  const termLower = term.toLowerCase().trim()
  if (termLower.length < 2) return false

  // 规范化：去 ®™© + 空白归一化（合并多余空格），解决 CSV 数据中 "CFexpress  4.0" 双空格问题
  const normalize = (s: string) => s.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim()
  const termNorm = normalize(termLower)

  for (const text of sourceTexts) {
    const textLower = text.toLowerCase()
    const textNorm = normalize(textLower)

    // 1. 精确子串匹配（优先用规范化后的文本）
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

    // 3. 词形还原匹配（仅对英文术语）
    if (/[a-z]/.test(termLower)) {
      const stemmedTerm = termWords.map(stemEnglish).join(' ')
      const stemmedText = textWords.map(stemEnglish).join(' ')
      if (stemmedText.includes(stemmedTerm)) return true
      // 宽松前缀匹配：处理 write/writing → writ/write 这类变形
      if (termWords.length === 1 && stemmedTerm.length > 2) {
        for (const tw of textWords) {
          const stw = stemEnglish(tw)
          if (stw.length > 2 && (stemmedTerm.startsWith(stw) || stw.startsWith(stemmedTerm))) return true
        }
      }
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

  for (const [source, target] of Object.entries(glossaryMap)) {
    // 跳过 source === target 的条目：产品名在目标语言中保持英文原样，
    // 注入 prompt 无翻译价值，反而挤占 token、给 LLM 混淆信号。
    // 依据：Lexar 产品命名规则 — 硬件参数/系列名/型号全语种保留英文。
    if (source === target) continue

    // 如果源文本包含产品型号，跳过品类词术语（避免与产品名冲突）
    // 例如 "NM790 PCIe 4.0 SSD" 是产品名，不应注入 "SSD → 固态硬盘"
    if (hasModelNumber && isCategoryWord(source)) continue

    if (termMatches(source, sourceTexts)) {
      filtered[source] = target
    }
    if (Object.keys(filtered).length >= maxTerms) break
  }

  if (Object.keys(filtered).length === 0) {
    return { filteredMap: {}, glossaryHint: '' }
  }

  const lines = Object.entries(filtered).map(([k, v]) => `${k} → ${v}`)
  const glossaryHint = `\n术语库（最高优先级，仅列出当前文本中出现的术语，必须严格使用）：
⛔ 仅当源文与左列完全一致（含大小写、空格）时才执行替换。部分匹配一律不替换，也不得基于术语库模式推断补全。
${lines.join('\n')}`

  return { filteredMap: filtered, glossaryHint }
}

