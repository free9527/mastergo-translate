/**
 * 翻译前实体遮蔽
 *
 * 将不应被 LLM 翻译或修改的实体（产品型号、URL、Email、术语库中不应翻译的
 * 软件名/品牌名）替换为 __XXX_N__ 占位符，翻译完成后还原。
 *
 * 占位符格式：
 *   PRD (产品型号): __PRD_N__
 *   URL: __URL_N__
 *   EML (Email): __EML_N__
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

    return result
  })

  return { texts: masked, entityMap: allEntityMap }
}

/**
 * 对源文和译文联合做实体遮蔽，保证两边占位符一致。
 */
export function maskEntitiesForProofread(
  sources: string[],
  translations: string[],
  protectedTerms?: string[]
): {
  maskedSources: string[]
  maskedTranslations: string[]
  entityMap: Map<string, string>
} {
  const combined = [...sources, ...translations]
  const { texts: maskedCombined, entityMap } = maskEntities(combined, protectedTerms)
  const n = sources.length
  return {
    maskedSources: maskedCombined.slice(0, n),
    maskedTranslations: maskedCombined.slice(n),
    entityMap,
  }
}

// ============================================================
// 术语遮蔽（译前）：将术语替换为 ZZ{N}ZZ 占位符
// LLM 只看到占位符无法扩展为营销文案，译后还原为术语库译文
// ============================================================

export interface GlossaryMaskResult {
  texts: string[]
  termMap: Map<string, string>   // ZZ0ZZ → 术语库目标语言译文
}

/** 去除商标符号 + 空白归一化（与 post-process.ts:cleanKey 一致） */
function cleanKeyForMask(s: string): string {
  return s.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * 将文本中匹配术语库的子串替换为 ZZ{N}ZZ 占位符。
 *
 * - 按术语长度降序替换，避免短术语先匹配导致长术语部分被遮蔽
 * - 用 cleanKey 归一化后匹配（忽略 ®™© 和多余空格）
 * - 占位符格式 ZZ{N}ZZ，全大写+数字，外观类似硬件型号，LLM 会保留
 */
export function maskGlossaryTerms(
  texts: string[],
  glossaryMap: Map<string, string>,
): GlossaryMaskResult {
  // 预扫描：源文中天然存在 ZZ\d+ZZ → 换用 YY\d+YY
  let prefix = 'ZZ'
  for (const t of texts) {
    if (/ZZ\d+ZZ/i.test(t)) { prefix = 'YY'; break }
  }

  const termMap = new Map<string, string>()
  let counter = 0

  // 构建排序术语列表：cleanKey 版本用于匹配，保留原始 source 用于在原文中定位
  const terms = [...glossaryMap.entries()]
    .filter(([source]) => source.length >= 3)
    .map(([source, target]) => ({ ck: cleanKeyForMask(source), source, target }))
    .filter(t => t.ck.length >= 3)
    .sort((a, b) => b.ck.length - a.ck.length)

  if (terms.length === 0) {
    return { texts: [...texts], termMap }
  }

  const masked = texts.map((text) => {
    if (!text) return text

    const textClean = cleanKeyForMask(text)
    // 记录原始文本中已被替换的区间，避免重叠
    const replacedRanges: Array<[number, number]> = []

    // 在 cleanKey 空间中查找术语，按位置排序后从后往前替换原始文本
    interface MatchPos { start: number; end: number; source: string; target: string }
    const matches: MatchPos[] = []

    for (const { ck, source, target } of terms) {
      let searchPos = 0
      while (searchPos < textClean.length) {
        const idx = textClean.indexOf(ck, searchPos)
        if (idx === -1) break

        // 检查是否与已有区间重叠
        const overlaps = replacedRanges.some(([s, e]) => idx < e && idx + ck.length > s)
        if (overlaps) { searchPos = idx + 1; continue }

        matches.push({ start: idx, end: idx + ck.length, source, target })
        replacedRanges.push([idx, idx + ck.length])
        searchPos = idx + ck.length
      }
    }

    if (matches.length === 0) return text

    // 按 cleanKey 空间的位置升序排列
    matches.sort((a, b) => a.start - b.start)

    // 在原始文本中定位并替换
    // 策略：用原始 source 构建宽松正则（允许 ®™© 和灵活空格），按序替换
    let result = text
    // 记录每次替换后的偏移量变化
    let offset = 0

    for (const m of matches) {
      // 构建宽松正则：将原始 source 中的空格替换为 [®™©]*\s* 模式
      const escaped = m.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const flexible = escaped.replace(/ /g, '[®™©]*\\s*')
      const regex = new RegExp(flexible, 'gi')

      let found = false
      let searchIdx = 0
      let execResult: RegExpExecArray | null
      // 重置 regex（每次使用前需要新实例或重置 lastIndex）
      const freshRegex = new RegExp(flexible, 'gi')
      while ((execResult = freshRegex.exec(result)) !== null) {
        // 验证这个匹配对应到 cleanKey 空间中的正确位置
        const matchClean = cleanKeyForMask(execResult[0])
        const estimatedCleanPos = cleanKeyForMask(result.slice(0, execResult.index)).length
        // 用 start+offset 估算在原始文本 cleanKey 中的位置
        const expectedPos = m.start + offset

        if (Math.abs(estimatedCleanPos - expectedPos) <= 5) {  // 5 字符容差
          const placeholder = `${prefix}${counter}${prefix}`
          termMap.set(placeholder, m.target)
          result = result.slice(0, execResult.index) + placeholder + result.slice(execResult.index + execResult[0].length)
          offset += placeholder.length - execResult[0].length
          counter++
          found = true
          break
        }
      }

      if (!found) {
        console.warn('[maskGlossaryTerms] could not locate term in original text:', m.source.slice(0, 50))
      }
    }

    return result
  })

  return { texts: masked, termMap }
}

/**
 * 将译文中 ZZ{N}ZZ 占位符还原为术语库译文。
 *
 * 使用模糊正则匹配，容忍 LLM 的大小写变化和空格插入（如 ZZ 0 ZZ, zz0zz）。
 * 如果占位符找不到，标记该条索引。
 */
export function unmaskGlossaryTerms(
  texts: string[],
  termMap: Map<string, string>,
): { texts: string[]; missingIndices: Set<number> } {
  const missingIndices = new Set<number>()

  if (termMap.size === 0) {
    return { texts: [...texts], missingIndices }
  }

  const result = texts.map((text, i) => {
    if (!text) return text
    let result = text
    let allFound = true

    for (const [placeholder, target] of termMap) {
      // 提取数字部分构建模糊正则：ZZ 任意空格 数字 任意空格 ZZ
      const numMatch = placeholder.match(/\d+/)
      if (!numMatch) continue
      const num = numMatch[0]
      const prefix = placeholder[0] + placeholder[1] // "ZZ" or "YY"
      const fuzzyRegex = new RegExp(`${prefix}\\s*${num}\\s*${prefix}`, 'gi')

      if (fuzzyRegex.test(result)) {
        fuzzyRegex.lastIndex = 0
        result = result.replace(fuzzyRegex, target)
      } else if (result.includes(placeholder)) {
        // 严格匹配兜底
        result = result.split(placeholder).join(target)
      } else {
        allFound = false
      }
    }

    if (!allFound) {
      missingIndices.add(i)
    }
    return result
  })

  return { texts: result, missingIndices }
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
