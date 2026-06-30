/**
 * 翻译前实体遮蔽
 *
 * 在文本送入 LLM 之前，将不应被翻译或修改的实体（产品型号、URL、Email、
 * 纯测量值、术语库中不应翻译的软件名/品牌名等）替换为占位符，翻译完成后再还原。
 * 避免 LLM 对这些实体产生幻觉。
 *
 * 占位符使用 __XXX_N__ 格式（纯 ASCII 双下划线定界），确保所有 tokenizer
 * 都能正确识别为连续 token 而非文本边界。
 *
 * 历史：曾使用  (U+E000) PUA 字符作为定界符，但该字符不在 Qwen BPE
 * tokenizer 词汇表中，被当作 token 边界处理，导致文本在占位符处被拆分。
 * 详见 2026-06-29 根因分析。
 *
 * 占位符格式（不同前缀避免冲突）：
 *   HTML: __HTML_N__
 *   PRD (产品型号): __PRD_N__
 *   URL: __URL_N__
 *   EML (Email): __EML_N__
 *   MSR (测量值): __MSR_N__
 *   TRM (术语/软件名): __TRM_N__
 */

interface EntityMaskResult {
  texts: string[]
  entityMap: Map<string, string>
}

// ============================================================
// 实体匹配正则（保守策略，从确定性高的模式开始）
// ============================================================

/**
 * 产品型号匹配
 *
 * Lexar 产品型号模式：2-4个大写字母 + 2-5位数字 + 可选后缀
 * 示例: NM790, SL500, NM1090 PRO, ARES RGB DDR5, EQ520 SSD, NS100
 *
 * 使用单词边界 + 数字要求避免误匹配普通单词（如 "THE", "AND"）
 */
const PRODUCT_CODE_RE = /\b([A-Z]{2,4}\d{2,5}[A-Z]*\s*(?:PRO|PLUS|MAX|OC|RGB|SSD|DDR[45]|PCIe\s*[345]\.0)?)\b/gi

/**
 * URL 匹配
 */
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"')\\]+)/gi

/**
 * Email 匹配
 */
const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g

/**
 * 纯测量值匹配 — 仅匹配整个文本就是测量值的情况
 * 测量值通常以 "数字 + 可选空格 + 单位" 的形式出现
 * 示例: 6.5cm, 100W, 12V, 2.4GHz, 85°C
 *
 * 注意：不匹配 MB/s, GB/s 等存储速度单位（这些由 restoreStorageUnitFormatting 处理）
 * 不匹配 mm 作为单独单位时的情况（太短易误匹配）
 */
const MEASUREMENT_RE = /\b(\d+(?:\.\d+)?\s*(?:[cm]m|m|g|kg|W|V|A|(?:k|M|G)?Hz|°[CF]|℃|℉))\b/gi

// ============================================================
// 遮蔽与还原
// ============================================================

/**
 * 将术语库中「不应翻译」的术语替换为占位符。
 *
 * 仅遮蔽 glossaryTarget === glossarySource 的术语（即当前目标语言下
 * 应保持原样的术语，如软件名 "Lexar Recovery Tool" 在非中文语言中）。
 *
 * 按术语长度降序排列，优先匹配长术语，避免短术语先匹配导致长术语部分被遮蔽。
 */
export function maskTerms(texts: string[], protectedTerms: string[]): EntityMaskResult {
  const entityMap = new Map<string, string>()
  let counter = 0

  // 去重并按长度降序排列（长术语优先匹配，避免 "Lexar" 先于 "Lexar Recovery Tool" 匹配）
  const uniqueTerms = [...new Set(protectedTerms)]
    .filter(t => t.length >= 3)
    .sort((a, b) => b.length - a.length)

  if (uniqueTerms.length === 0) {
    return { texts: [...texts], entityMap }
  }

  const masked = texts.map((text) => {
    if (!text) return text
    let result = text

    for (const term of uniqueTerms) {
      // 转义正则特殊字符
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped, 'gi')

      result = result.replace(regex, (match) => {
        // 跳过已遮蔽的内容（__XXX_N__ 格式）
        if (/__[A-Z]+_\d+__/.test(match)) return match
        const key = `__TRM_${counter}__`
        entityMap.set(key, match)
        counter++
        return key
      })
    }

    return result
  })

  return { texts: masked, entityMap }
}

/**
 * 将文本中的实体替换为占位符
 */
export function maskEntities(texts: string[], protectedTerms?: string[]): EntityMaskResult {
  // 0. 先遮蔽不应翻译的术语（软件名等）
  let currentTexts = [...texts]
  const allEntityMap = new Map<string, string>()

  if (protectedTerms && protectedTerms.length > 0) {
    const termResult = maskTerms(currentTexts, protectedTerms)
    currentTexts = termResult.texts
    for (const [k, v] of termResult.entityMap) {
      allEntityMap.set(k, v)
    }
  }

  let counter = allEntityMap.size

  const masked = currentTexts.map((text) => {
    if (!text) return text

    let result = text

    // 1. URL（优先级最高，避免被其他模式部分匹配）
    result = result.replace(URL_RE, (match) => {
      const key = `__URL_${counter}__`
      allEntityMap.set(key, match)
      counter++
      return key
    })

    // 2. Email
    result = result.replace(EMAIL_RE, (match) => {
      const key = `__EML_${counter}__`
      allEntityMap.set(key, match)
      counter++
      return key
    })

    // 3. 产品型号
    result = result.replace(PRODUCT_CODE_RE, (match) => {
      // 跳过已遮蔽的内容（__XXX_N__ 格式）
      if (/__[A-Z]+_\d+__/.test(match)) return match
      const key = `__PRD_${counter}__`
      allEntityMap.set(key, match)
      counter++
      return key
    })

    // 4. 纯测量值
    result = result.replace(MEASUREMENT_RE, (match) => {
      // 跳过已遮蔽的内容（__XXX_N__ 格式）
      if (/__[A-Z]+_\d+__/.test(match)) return match
      const key = `__MSR_${counter}__`
      allEntityMap.set(key, match)
      counter++
      return key
    })

    return result
  })

  return { texts: masked, entityMap: allEntityMap }
}

/**
 * 将占位符还原为原始实体
 */
export function unmaskEntities(texts: string[], entityMap: Map<string, string>): string[] {
  return texts.map((text) => {
    if (!text) return text
    let result = text
    for (const [key, value] of entityMap) {
      // 使用全局替换，因为同一个测量值可能在多处出现
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(escapedKey, 'g'), value)
    }
    return result
  })
}
