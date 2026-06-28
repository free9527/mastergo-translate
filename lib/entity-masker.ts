/**
 * 翻译前实体遮蔽
 *
 * 在文本送入 LLM 之前，将不应被翻译或修改的实体（产品型号、URL、Email、
 * 纯测量值等）替换为占位符，翻译完成后再还原。避免 LLM 对这些实体产生幻觉。
 *
 * 模式与 protectHtmlTags/restoreHtmlTags 一致，使用 \x00 前缀占位符。
 * 占位符与 HTML 保护使用不同的前缀以避免冲突：
 *   HTML: \x00HTML{N}\x00
 *   PRD (产品型号): \x00PRD{N}\x00
 *   URL: \x00URL{N}\x00
 *   EML (Email): \x00EML{N}\x00
 *   MSR (测量值): \x00MSR{N}\x00
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
 * 将文本中的实体替换为占位符
 */
export function maskEntities(texts: string[]): EntityMaskResult {
  const entityMap = new Map<string, string>()
  let counter = 0

  const masked = texts.map((text) => {
    if (!text) return text

    let result = text

    // 1. URL（优先级最高，避免被其他模式部分匹配）
    result = result.replace(URL_RE, (match) => {
      const key = `\x00URL${counter}\x00`
      entityMap.set(key, match)
      counter++
      return key
    })

    // 2. Email
    result = result.replace(EMAIL_RE, (match) => {
      const key = `\x00EML${counter}\x00`
      entityMap.set(key, match)
      counter++
      return key
    })

    // 3. 产品型号
    result = result.replace(PRODUCT_CODE_RE, (match) => {
      // 跳过已遮蔽的内容（URL/Email 占位符）
      if (match.includes('\x00')) return match
      const key = `\x00PRD${counter}\x00`
      entityMap.set(key, match)
      counter++
      return key
    })

    // 4. 纯测量值
    result = result.replace(MEASUREMENT_RE, (match) => {
      // 跳过已遮蔽的内容
      if (match.includes('\x00')) return match
      // 仅遮蔽文本整体就是测量值的情况（保守策略）
      const key = `\x00MSR${counter}\x00`
      entityMap.set(key, match)
      counter++
      return key
    })

    return result
  })

  return { texts: masked, entityMap }
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
