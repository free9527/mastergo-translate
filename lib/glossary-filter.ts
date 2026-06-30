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
 * 检查术语是否在源文本中出现
 * 支持精确匹配、子串匹配和词形还原匹配
 */
function termMatches(term: string, sourceTexts: string[]): boolean {
  const termLower = term.toLowerCase().trim()
  if (termLower.length < 2) return false

  // 规范化：去掉 ® ™ © 等特殊符号，使 "Lexar®" 能匹配 "Lexar"
  const normalize = (s: string) => s.replace(/[®™©]/g, '').trim()
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

  for (const [source, target] of Object.entries(glossaryMap)) {
    if (termMatches(source, sourceTexts)) {
      filtered[source] = target
    }
    if (Object.keys(filtered).length >= maxTerms) break
  }

  if (Object.keys(filtered).length === 0) {
    return { filteredMap: {}, glossaryHint: '' }
  }

  const lines = Object.entries(filtered).map(([k, v]) => `${k} → ${v}`)
  const glossaryHint = `\n术语库（最高优先级，仅列出当前文本中出现的术语，必须严格使用）：\n${lines.join('\n')}`

  return { filteredMap: filtered, glossaryHint }
}

