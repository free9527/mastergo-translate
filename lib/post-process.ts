/**
 * 语言特定后处理规则
 * 针对每种目标语言应用排版、语法和本地化后处理
 * 在翻译完成后自动调用，修正 LLM 常见输出错误
 */

// ============================================================
// 商标符号还原
// 将原文中的 ® ™ © 符号还原到译文中
// 策略：找到符号前紧邻的单词，在译文中定位该单词并补回符号
// ============================================================
export function restoreTrademarkSymbols(sourceTexts: string[], translatedTexts: string[]): string[] {
  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source) return translated

    // 提取原文中所有商标符号及其前导词
    // 使用 [^\s®™©]+ 排除符号字符，避免贪婪匹配吞噬相邻符号（如 "Lexar®™" 中 ® 被 \S+ 吃掉）
    const symbolPattern = /([^\s®™©]+)\s*([®™©]+)/g
    const symbols: Array<{ word: string; symbol: string }> = []
    let match: RegExpExecArray | null
    while ((match = symbolPattern.exec(source)) !== null) {
      // 去掉该词上已有的商标符号（避免重复匹配）
      const cleanWord = match[1].replace(/[®™©]/g, '')
      if (cleanWord) {
        // 支持连续多个符号（如 Lexar®™），逐个记录
        for (const symbolChar of match[2]) {
          symbols.push({ word: cleanWord, symbol: symbolChar })
        }
      }
    }

    if (symbols.length === 0) return translated

    let result = translated

    for (const { word, symbol } of symbols) {
      // 检查译文是否已有该符号，如果已有则跳过插入
      // 但需要先检查符号位置是否正确（前面不应有空格）
      if (result.includes(symbol)) {
        // 符号已存在，验证其位置：符号前不应有空格
        const symbolIdx = result.indexOf(symbol)
        if (symbolIdx > 0 && result[symbolIdx - 1] === ' ') {
          // 符号前有空格，去掉空格使符号紧跟前一个词
          result = result.slice(0, symbolIdx - 1) + result.slice(symbolIdx)
        }
        continue
      }

      // 在译文中查找该词（不区分大小写）
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const wordRegex = new RegExp(escapedWord, 'i')
      const wordMatch = wordRegex.exec(result)

      if (wordMatch) {
        // 找到该词，在它后面插入符号
        const insertPos = wordMatch.index + wordMatch[0].length
        // 如果后面紧跟标点，符号放在标点后
        const after = result.slice(insertPos)
        const punctMatch = after.match(/^(\s*[.,;:!?)]?)/)
        const punctLen = punctMatch ? punctMatch[0].length : 0
        result = result.slice(0, insertPos + punctLen) + symbol + result.slice(insertPos + punctLen)
      } else {
        // 找不到该词，追加到译文末尾
        result = result + symbol
      }
    }

    // 商标符号间距规范化：去掉符号前的空格，符号后紧跟字母/数字时补空格
    result = result.replace(/\s+([®™©])/g, '$1')
    result = result.replace(/([®™©])([a-zA-Z0-9À-ɏЀ-ӿ])/g, '$1 $2')

    return result
  })
}

// ============================================================
// 存储单位格式还原
// 原文中数字和存储单位连写时（如 900MB/s），AI 经常误加空格变成 900 MB/s
// 需要恢复原文的连写格式，保持技术规格一致
// 覆盖: MB/s, GB/s, TB/s, KB/s, MB, GB, TB, KB, GByte, MByte 等
// ============================================================
export function restoreStorageUnitFormatting(sourceTexts: string[], translatedTexts: string[]): string[] {
  // 常见存储单位模式 - 这些单位在技术规格中通常保持连写
  // 匹配: 数字 + (可选空格) + 单位
  const unitPatterns = [
    /(\d+)\s+(MB|GB|TB|KB|GByte|MByte|TByte|KByte)(\/s)\b/gi,    // 900 MB/s → 900MB/s
    /(\d+)\s+(MB|GB|TB|KB|GByte|MByte|TByte|KByte)\b(?!\/)/gi,  // 900 GB → 900GB (但仅当原文连写时)
  ]

  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source) return translated

    let result = translated

    // 仅当原文中数字和单位是连写时，才在译文中恢复连写
    // 检查原文是否存在连写模式 (\d+[A-Z]{2})
    const hasConnectedUnits = /\d+[A-Z]{2}/.test(source)

    if (hasConnectedUnits) {
      for (const pattern of unitPatterns) {
        result = result.replace(pattern, '$1$2$3')
      }
    }

    // 特殊处理星号后缀：900MB/s* → 保持 900MB/s* 不要变成 900 MB/s*
    // 使用更激进的正则直接修复所有情况
    result = result.replace(/(\d+)\s+([KMGT][B])(\/s\*)/g, '$1$2$3')
    result = result.replace(/(\d+)\s+([KMGT][B]\/s)\*/g, '$1$2*')

    return result
  })
}

// ============================================================
// 术语库强制校准
// 翻译完成后，将术语库中的固定译法强制替换到译文中
// 优先精确匹配，其次子串匹配
// ============================================================

// ============================================================
// 术语库强制校准
// 翻译完成后，将术语库中的固定译法强制替换到译文中
// 优先精确匹配，其次子串匹配
// ============================================================
export function enforceGlossaryTerms(
  sourceTexts: string[],
  translatedTexts: string[],
  glossaryMap: Map<string, string>,
): string[] {
  // 构建去商标符号的归一化查找表（一次构建，避免 O(n*m) 循环）
  // 解决术语库条目带 ®™© 而设计稿文本不带（或反之）导致的精确匹配失效
  const normalizedGlossaryMap = new Map<string, string>()
  for (const [key, value] of glossaryMap.entries()) {
    const normalizedKey = key.replace(/[®™©]/g, '').trim()
    if (!normalizedGlossaryMap.has(normalizedKey)) {
      normalizedGlossaryMap.set(normalizedKey, value)
    }
  }

  function stripTrademark(s: string): string {
    return s.replace(/[®™©]/g, '').trim()
  }

  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source) return translated

    const normalizedSource = stripTrademark(source)

    // 1. 精确匹配（三层：原文 → 去商标原文 → 术语库去商标 key）
    if (glossaryMap.has(source)) {
      const target = glossaryMap.get(source)!
      if (target !== translated) return target
    }
    if (glossaryMap.has(normalizedSource)) {
      const target = glossaryMap.get(normalizedSource)!
      if (target !== translated) return target
    }
    if (normalizedGlossaryMap.has(normalizedSource)) {
      const target = normalizedGlossaryMap.get(normalizedSource)!
      if (target !== translated) return target
    }

    // 2. 子串匹配：源文本包含术语库条目（产品名/软件名嵌入在长句中）
    // 阈值从 85% 降至 40%，使嵌入术语的句子也能触发替换
    for (const [glossarySource, glossaryTarget] of glossaryMap.entries()) {
      const normalizedGlossarySource = stripTrademark(glossarySource)
      // 至少 3 个字符（降低下限，覆盖短术语）
      if (normalizedGlossarySource.length < 3) continue
      if (normalizedSource.includes(normalizedGlossarySource)) {
        // 检查译文是否已包含正确的术语译法
        if (!translated.includes(glossaryTarget)) {
          // 策略 A：术语占据源文本 40% 以上 → 直接用术语译法替换整个译文
          if (normalizedGlossarySource.length / normalizedSource.length > 0.4) {
            return glossaryTarget
          }
          // 策略 B：术语占比较低但在译文中能找到 LLM 翻译的术语变体 → 局部替换
          // 用术语源文在译文中搜索（LLM 可能保留了英文原名），找到后替换为术语目标译法
          const escapedSource = normalizedGlossarySource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const termInTranslation = new RegExp(escapedSource, 'i').exec(translated)
          if (termInTranslation) {
            const before = translated.slice(0, termInTranslation.index)
            const after = translated.slice(termInTranslation.index + termInTranslation[0].length)
            return before + glossaryTarget + after
          }
        }
      }
    }

    return translated
  })
}

// ============================================================
// 短标签扩写硬守卫
// 源文 < 15 字符且译文 > 1.5x 源文长度时，做两件事：
// 1. 降低阈值（3 字符起）重新匹配术语库 — 解决 enforceGlossaryTerms 的 8 字符下限问题
// 2. 仍不匹配时做词边界截断，防止 UI 文本溢出
// ============================================================
export function enforceShortLabelLength(
  sourceTexts: string[],
  translatedTexts: string[],
  glossaryMap: Map<string, string>,
): string[] {
  const SHORT_LABEL_MAX = 15
  const LENGTH_RATIO = 1.5

  // 构建去商标符号的归一化查找表
  const normalizedGlossaryMap = new Map<string, string>()
  for (const [key, value] of glossaryMap.entries()) {
    const nk = key.replace(/[®™©]/g, '').trim()
    if (!normalizedGlossaryMap.has(nk)) {
      normalizedGlossaryMap.set(nk, value)
    }
  }

  function stripTrademark(s: string): string {
    return s.replace(/[®™©]/g, '').trim()
  }

  function isCJK(ch: string): boolean {
    const c = ch.charCodeAt(0)
    return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
           (c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff) || // 日文假名
           (c >= 0xac00 && c <= 0xd7af) || // 韩文
           (c >= 0x0e00 && c <= 0x0e7f)    // 泰文
  }

  // 在词/字符边界截断到目标长度
  function truncateAtBoundary(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    // CJK 文本：直接按字符截断
    if (isCJK(text[0])) {
      return text.slice(0, maxLen)
    }
    // 拉丁文本：在词边界截断，避免断词
    const truncated = text.slice(0, maxLen)
    const lastSpace = truncated.lastIndexOf(' ')
    if (lastSpace > maxLen * 0.6) {
      return truncated.slice(0, lastSpace)
    }
    return truncated
  }

  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source || source.length >= SHORT_LABEL_MAX) return translated
    if (translated.length <= source.length * LENGTH_RATIO) return translated

    const normalizedSource = stripTrademark(source)

    // 第一道：精确匹配（与 enforceGlossaryTerms 相同，但这里只做短标签兜底）
    if (normalizedGlossaryMap.has(normalizedSource)) {
      return normalizedGlossaryMap.get(normalizedSource)!
    }

    // 第二道：降低阈值到 3 字符的子串匹配
    let bestMatch: { source: string; target: string; len: number } | null = null
    for (const [glossarySource, glossaryTarget] of normalizedGlossaryMap.entries()) {
      const gs = stripTrademark(glossarySource)
      if (gs.length < 3) continue
      if (normalizedSource.includes(gs)) {
        if (!bestMatch || gs.length > bestMatch.len) {
          bestMatch = { source: gs, target: glossaryTarget, len: gs.length }
        }
      }
    }
    if (bestMatch) {
      // 术语占比 > 70% 才替换，避免误伤
      if (bestMatch.len / normalizedSource.length > 0.7) {
        return bestMatch.target
      }
    }

    // 第三道：硬截断兜底 — 译文字符数不超过源文 1.5x
    // 这是最后手段，只在译文明显过长时触发
    if (translated.length > source.length * 2) {
      const maxLen = Math.max(Math.ceil(source.length * 1.3), 3)
      return truncateAtBoundary(translated, maxLen)
    }

    return translated
  })
}

// ============================================================
// 主入口
// ============================================================
export function postProcessTranslation(text: string, lang: string): string {
  let result = text

  // 还原换行符占位符 ↵（U+21B5）→ 实际换行
  // 由 text-normalizer 在预处理时替换，此处还原以保留源文断行
  result = result.replace(/\s*↵\s*/g, '\n')

  switch (lang) {
    case 'fr':
      result = postProcessFrench(result)
      break
    case 'de':
      result = postProcessGerman(result)
      break
    case 'ja':
      result = postProcessJapanese(result)
      break
    case 'ko':
      result = postProcessKorean(result)
      break
    case 'ar':
      result = postProcessArabic(result)
      break
    case 'th':
      result = postProcessThai(result)
      break
    case 'ru':
      result = postProcessRussian(result)
      break
    case 'zh-TW':
      result = postProcessZhTw(result)
      break
    case 'zh-CN':
      result = postProcessZhCn(result)
      break
  }

  // 所有欧洲语言的通用后处理
  if (['de', 'fr', 'es', 'it', 'pt', 'pt-BR', 'nl', 'pl', 'sv', 'tr'].includes(lang)) {
    result = postProcessEuropeanNumbers(result, lang)
  }

  return result
}

// ============================================================
// 首字母大写（拉丁/西里尔字母语言）
// 安全策略：仅当首字符为小写字母且第二个字符也是小写字母时才转换
// 避免误伤 "iPhone"、"eBay" 等专有名词
// ============================================================
export function capitalizeFirstLetter(text: string): string {
  if (!text || text.length === 0) return text
  const first = text[0]
  const second = text.length > 1 ? text[1] : ''

  // 拉丁小写字母 a-z
  if (first >= 'a' && first <= 'z') {
    // 仅当第二个字符也是小写字母时才大写（排除 iPhone、eBay 等）
    if (second && (second < 'a' || second > 'z')) return text
    return first.toUpperCase() + text.slice(1)
  }

  // 西里尔小写字母 а-я (Unicode: 0430-044F), ё (0451)
  if ((first >= 'а' && first <= 'я') || first === 'ё') {
    if (second && (second < 'а' || second > 'я') && second !== 'ё') return text
    return first.toUpperCase() + text.slice(1)
  }

  return text
}

// ============================================================
// 德语 (de)
// ============================================================
function postProcessGerman(text: string): string {
  let result = text

  // ß vs SS 规范：sz 不能写成 ss（Maße ≠ Masse）
  // 常见错误修复
  result = result.replace(/\bStrasse\b/g, 'Straße')
  result = result.replace(/\bSpass\b/g, 'Spaß')
  result = result.replace(/\bgross\b/g, 'groß')
  result = result.replace(/\bschliess\b/g, 'schließ')
  result = result.replace(/\banschliess\b/g, 'anschließ')
  result = result.replace(/\bausser\b/g, 'außer')
  result = result.replace(/\bFuss\b/g, 'Fuß')
  result = result.replace(/\bmuss\b/g, 'muss')
  result = result.replace(/\bgeniess\b/g, 'genieß')

  // Sie 敬语大写（在正式产品文案中）
  // 检测小写的 sie（代指读者时）→ 大写 Sie
  result = result.replace(/([.!?]\s+)sie\b/g, '$1Sie')
  result = result.replace(/([.!?]\s+)ihre\b/g, '$1Ihre')

  // GB → GByte（德文习惯）
  // MB → MByte 不强制，但保留一致性

  return result
}

// ============================================================
// 法语 (fr)
// ============================================================
function postProcessFrench(text: string): string {
  let result = text

  // 法语标点前应加窄空格 (espace fine insécable)
  // : ; ! ? « »
  const PUNCT_WITH_SPACE = /([a-zA-Z0-9%]) *([:;!?])/g
  result = result.replace(PUNCT_WITH_SPACE, '$1 $2')

  // 引号两侧空格
  result = result.replace(/« */g, '« ')
  result = result.replace(/ *»/g, ' »')

  // 数字千位分隔 → 法语用空格（仅5位以上）
  result = result.replace(/\b\d{5,}\b/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ' '))

  // Mo 而非 MB（法语习惯）
  // 保留 MB/s 不处理，仅处理单独出现的 MB
  result = result.replace(/(\d+)\s*MB\b(?!\/)/gi, '$1 Mo')
  result = result.replace(/(\d+)\s*GB\b(?!\/)/gi, '$1 Go')
  result = result.replace(/(\d+)\s*TB\b(?!\/)/gi, '$1 To')

  // 引号规范：确保使用 « » 而非 " "
  // 仅在已有英文引号时替换
  if (result.includes('"')) {
    // 只替换成对的引号，不处理英寸符号
    result = result.replace(/"([^"]{3,})"/g, '« $1 »')
  }

  return result
}

// ============================================================
// 日语 (ja)
// ============================================================
function postProcessJapanese(text: string): string {
  let result = text

  // 确保片假名长音使用「ー」而非「−」或「-」
  result = result.replace(/([ァ-ヶ])−/g, '$1ー')
  result = result.replace(/([ァ-ヶ])-(?!\d)/g, '$1ー')

  // 常见外来语规范
  result = result.replace(/ケーブル/g, 'ケーブル')
  result = result.replace(/ファームウェア/g, 'ファームウェア')
  result = result.replace(/インターフェイス/g, 'インターフェース')
  result = result.replace(/パーフェクト/g, 'パーフェクト')
  result = result.replace(/クリエーター/g, 'クリエイター')

  // 确保使用全角标点
  result = result.replace(/(?<![0-9]), /g, '、')
  result = result.replace(/\. /g, '。')

  return result
}

// ============================================================
// 韩语 (ko)
// ============================================================
function postProcessKorean(text: string): string {
  let result = text

  // 助词拼写：은/는 和 이/가
  // 有终声 → 은/이, 无终声 → 는/가
  // 这里主要做已知常见错误修正
  result = result.replace(/\b(SSD|HMB|ECC|TBW)는\b/gi, '$1은')
  result = result.replace(/\b(SSD|HMB|ECC|TBW)가\b/gi, '$1이')

  return result
}

// ============================================================
// 阿拉伯语 (ar) — 最小处理，避免破坏复杂 RTL 逻辑
// ============================================================
function postProcessArabic(text: string): string {
  let result = text

  // 确保数字使用阿拉伯语数字上下文
  // 常见：MB/s → ميجابايت/ثانية
  result = result.replace(/MB\/s/gi, 'ميجابايت/ثانية')
  result = result.replace(/GB/gi, 'جيجابايت')
  result = result.replace(/(\d+)\s*TB/g, '$1 تيرابايت')

  // Hamza 规范：确保 أ/إ/ؤ/ئ 正确
  // 仅做最常见的修正
  result = result.replace(/\bاسرع\b/g, 'أسرع')
  result = result.replace(/\bاقصى\b/g, 'أقصى')
  result = result.replace(/\bاداء\b/g, 'أداء')

  return result
}

// ============================================================
// 泰语 (th)
// ============================================================
function postProcessThai(text: string): string {
  let result = text

  // 泰语不应在词之间有空格的常见英文错误
  // 移除泰文字符之间的多余空格
  // 但保留句子/短语边界空格和数字/英文周围的空格
  // 保守处理：只移除两个泰文字符间的空格

  // 泰文Unicode范围: ฀-๿
  result = result.replace(/([฀-๿])\s+([฀-๿])/g, '$1$2')

  // 确保泰文标点规范
  result = result.replace(/\.([฀-๿])/g, '。$1')

  return result
}

// ============================================================
// 俄语 (ru)
// ============================================================
function postProcessRussian(text: string): string {
  let result = text

  // 确保引号使用 « » 格式
  if (result.includes('"')) {
    result = result.replace(/"([^"]{3,})"/g, '«$1»')
  }

  // GB → ГБ (容量单位)
  result = result.replace(/(\d+)\s*GB\b(?!\/)/gi, '$1 ГБ')
  result = result.replace(/(\d+)\s*MB\b(?!\/)/gi, '$1 МБ')
  result = result.replace(/(\d+)\s*TB\b(?!\/)/gi, '$1 ТБ')

  return result
}

// ============================================================
// 繁体中文 (zh-TW)
// ============================================================
function postProcessZhTw(text: string): string {
  let result = text

  // 确保使用全角标点
  result = result.replace(/(?<![0-9a-zA-Z]), /g, '，')
  // 不替换引号内的英文句号

  return result
}

// ============================================================
// 简体中文 (zh-CN)
// ============================================================
function postProcessZhCn(text: string): string {
  let result = text

  // 确保使用全角标点
  result = result.replace(/(?<![0-9a-zA-Z]), /g, '，')

  return result
}

// ============================================================
// 欧洲语言数字格式化
// ============================================================
function postProcessEuropeanNumbers(text: string, lang: string): string {
  let result = text

  // 各语言数字千位分隔（仅对5位数以上应用，避免 7400 → 7.400）
  const separator: Record<string, string> = {
    de: '.',  // 10.000 MB/s
    fr: ' ',  // 10 000 Mo/s (窄空格)
    es: '.',  // 10.000 MB/s
    it: '.',  // 10.000 MB/s
    pt: '.',  // 10.000 MB/s
    'pt-BR': '.',  // 10.000 MB/s
    nl: '.',  // 10.000 MB/s
    pl: ' ',  // 10 000 MB/s
    sv: ' ',  // 10 000 MB/s
    tr: '.',  // 10.000 MB/s
  }

  const sep = separator[lang]
  if (sep && sep !== ',') {
    // 仅对5位数及以上添加千位分隔，避免 7400 → 7.400
    result = result.replace(/\b\d{5,}\b/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, sep))
  }

  return result
}

/**
 * 批量后处理
 */
export function postProcessBatch(texts: string[], lang: string): string[] {
  return texts.map(t => postProcessTranslation(t, lang))
}

// ============================================================
// 译文扩展检测
// 检测 LLM 是否在译文中添加了原文没有的内容（异常扩展）
// 返回标记了异常扩展的译文数组 + 异常索引集合
// ============================================================
export interface ExpansionResult {
  texts: string[]
  expandedIndices: Set<number>
}

/**
 * 检测并修复译文异常扩展。
 *
 * 规则：
 * - 译文长度 > 源文长度 × 3 时视为异常扩展
 * - 短源文（<10字符）使用更宽松的阈值（5x），因为短文本翻译后变长是正常的
 * - 检测到异常扩展时：
 *   1. 尝试从译文中提取核心信息（取前 ~源文长度×2 的字符，在词边界截断）
 *   2. 如果无法修复，标记该索引
 */
export function detectTranslationExpansion(
  sourceTexts: string[],
  translatedTexts: string[],
): ExpansionResult {
  const expandedIndices = new Set<number>()

  const result = translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source || !translated) return translated

    const sourceLen = source.length
    const translatedLen = translated.length

    // 短源文使用更宽松的阈值
    const threshold = sourceLen < 10 ? 3 : 2

    if (translatedLen > sourceLen * threshold) {
      expandedIndices.add(i)

      // 尝试修复：提取译文的核心部分
      // 策略：取译文的开头部分（约源文长度 × 2），在词/句边界截断
      const maxLen = Math.max(Math.ceil(sourceLen * 2), 10)

      // 尝试在句号处截断
      const firstSentence = translated.slice(0, maxLen)
      const sentenceEnd = Math.max(
        firstSentence.lastIndexOf('。'),
        firstSentence.lastIndexOf('. '),
        firstSentence.lastIndexOf('！'),
        firstSentence.lastIndexOf('？'),
      )

      if (sentenceEnd > maxLen * 0.5) {
        return translated.slice(0, sentenceEnd + 1)
      }

      // 尝试在逗号/空格处截断
      const wordBoundary = Math.max(
        firstSentence.lastIndexOf('，'),
        firstSentence.lastIndexOf(', '),
        firstSentence.lastIndexOf(' '),
      )

      if (wordBoundary > maxLen * 0.5) {
        return translated.slice(0, wordBoundary)
      }

      // 硬截断
      return translated.slice(0, maxLen)
    }

    return translated
  })

  return { texts: result, expandedIndices }
}
