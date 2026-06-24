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
      // 检查译文是否已有该符号
      if (result.includes(symbol)) continue

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

    return result
  })
}

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
  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source) return translated

    const normalizedSource = source.replace(/[®™©]/g, '').trim()

    // 1. 精确匹配：源文本本身就是术语库条目
    if (glossaryMap.has(source)) {
      const target = glossaryMap.get(source)!
      if (target !== translated) return target
    }
    if (glossaryMap.has(normalizedSource)) {
      const target = glossaryMap.get(normalizedSource)!
      if (target !== translated) return target
    }

    // 2. 子串匹配：源文本包含术语库条目（产品名嵌入在长句中）
    for (const [glossarySource, glossaryTarget] of glossaryMap.entries()) {
      const normalizedGlossarySource = glossarySource.replace(/[®™©]/g, '').trim()
      // 至少 8 个字符避免短词误匹配
      if (normalizedGlossarySource.length < 8) continue
      if (normalizedSource.includes(normalizedGlossarySource)) {
        // 检查译文是否已包含正确的术语译法
        if (!translated.includes(glossaryTarget)) {
          // 尝试用规范化方式找到译文中的对应部分并替换
          // 简单策略：如果源文本就是术语+少量后缀，直接替换
          const before = normalizedSource.indexOf(normalizedGlossarySource)
          const after = normalizedSource.length - before - normalizedGlossarySource.length
          // 如果术语占据了源文本 85% 以上，直接用术语译法
          if (normalizedGlossarySource.length / normalizedSource.length > 0.85) {
            return glossaryTarget
          }
        }
      }
    }

    return translated
  })
}

// ============================================================
// 主入口
// ============================================================
export function postProcessTranslation(text: string, lang: string): string {
  let result = text

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
