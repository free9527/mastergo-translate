// ═══════════════════════════════════════════════════════════════
// 文件: post-process.ts — 翻译后处理（代码层兜底、不依赖 LLM）
// ═══════════════════════════════════════════════════════════════
//
// 职责: 翻译完成后对 LLM 输出做确定性修正。全部由代码执行，零出错。
//
// 分为三类:
//
// [修正类] — 修复 LLM 常见错误（确定性规则，不会改错）
//   postProcessTranslation      — 入口，按语种分发
//     postProcessFrench         — 标点空格/千位分隔/Mo替代MB/引号规范
//     postProcessGerman         — ß规范/Sie大写/千位分隔
//     postProcessJapanese       — 片假名长音/外来语规范/全角标点
//     postProcessKorean         — 助词拼写
//     postProcessArabic         — 单位翻译/Hamza规范
//     postProcessThai           — 字符间多余空格移除
//     postProcessRussian        — 引号/容量单位本地化
//     postProcessZhTw           — 全角标点
//     postProcessZhCn           — 全角标点
//     capitalizeFirstLetter     — 拉丁/西里尔首字母大写（排除iPhone等专有名词）
//     restoreStorageUnitFormatting — 数字单位连写修复（900 MB/s → 900MB/s）
//     restoreTrademarkSymbols   — ®™© 还原到译文中
//
// [校准类] — 术语/格式强制对齐（安全网，即使 LLM 做对了也要确认）
//   enforceGlossaryTerms        — 术语库强制替换（精确匹配 + 子串匹配 + 短标签硬守卫）
//
// [检测类] — 异常输出标记（只检测不修复，返回异常索引供上层决策）
//   detectBrandInjection        — 品牌/规格注入检测（命中回退源文）
//   detectTranslationExpansion  — 译文异常扩展检测（命中截断）
//   sanitizeLineBreaks          — 换行保护
//
// 边界:
//   ⛔ 不依赖 LLM — 全部是代码逻辑，确定性执行
//   ⛔ 不处理"不确定"的修正 — 不确定的交给 AI 校对
//   ⛔ 不在翻译中间调用 — 翻译管道中作为末尾步骤执行
// ═══════════════════════════════════════════════════════════════

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
        // 找不到该词，跳过（不插入）。
        // 原因：原文词汇可能在译文中被重组/复合（如德语 Water+Resistance→Wasserfestigkeit），
        // 此时不应追加符号到末尾——会导致 ™ 堆积，触发校对 LLM 逐字符复制，产生乱码。
        // 符号丢失的风险远小于全文 ™ 泛滥。
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

/**
 * 文本归一化：去除商标符号 + 空白归一化。
 * 用于术语匹配时忽略 ®™© 和多余空格的干扰。
 */
export function cleanKey(s: string): string {
  return s.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim()
}

export function enforceGlossaryTerms(
  sourceTexts: string[],
  translatedTexts: string[],
  glossaryMap: Map<string, string>,
): string[] {
  // 构建去商标符号 + 空白归一化的查找表
  // 空白归一化解决 CSV 数据中可能存在的多余空格（如 "CFexpress  4.0" → "CFexpress 4.0"）
  const normalizedGlossaryMap = new Map<string, string>()
  for (const [key, value] of glossaryMap.entries()) {
    const normalizedKey = cleanKey(key)
    if (!normalizedGlossaryMap.has(normalizedKey)) {
      normalizedGlossaryMap.set(normalizedKey, value)
    }
  }

  function isCJK(ch: string): boolean {
    const c = ch.charCodeAt(0)
    return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
           (c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff) ||
           (c >= 0xac00 && c <= 0xd7af) || (c >= 0x0e00 && c <= 0x0e7f)
  }

  function truncateAtBoundary(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    if (isCJK(text[0])) return text.slice(0, maxLen)
    const truncated = text.slice(0, maxLen)
    const lastSpace = truncated.lastIndexOf(' ')
    if (lastSpace > maxLen * 0.6) return truncated.slice(0, lastSpace)
    return truncated
  }

  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source) return translated

    const normalizedSource = cleanKey(source)
    let result = translated

    // 1. 精确匹配（三层：原文 → 去商标原文 → 术语库去商标key）
    if (glossaryMap.has(source)) {
      const target = glossaryMap.get(source)!
      if (target !== result) {
        console.info('[enforceGlossaryTerms] exact match (raw):', source.slice(0, 60), '→', target.slice(0, 60))
        result = target
      }
    }
    if (glossaryMap.has(normalizedSource)) {
      const target = glossaryMap.get(normalizedSource)!
      if (target !== result) {
        console.info('[enforceGlossaryTerms] exact match (cleanKey):', normalizedSource.slice(0, 60), '→', target.slice(0, 60))
        result = target
      }
    }
    if (normalizedGlossaryMap.has(normalizedSource)) {
      const target = normalizedGlossaryMap.get(normalizedSource)!
      if (target !== result) {
        console.info('[enforceGlossaryTerms] exact match (normalizedMap):', normalizedSource.slice(0, 60), '→', target.slice(0, 60))
        result = target
      }
    }

    // 2. 子串匹配：源文本包含术语库条目
    if (result === translated) {
      for (const [glossarySource, glossaryTarget] of glossaryMap.entries()) {
        const normalizedGlossarySource = cleanKey(glossarySource)
        if (normalizedGlossarySource.length < 3) continue
        if (normalizedSource.includes(normalizedGlossarySource)) {
          if (!result.includes(glossaryTarget)) {
            const escapedSource = normalizedGlossarySource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const termInTranslation = new RegExp(escapedSource, 'i').exec(result)
            if (termInTranslation) {
              result = result.slice(0, termInTranslation.index) + glossaryTarget + result.slice(termInTranslation.index + termInTranslation[0].length)
            } else if (normalizedGlossarySource === cleanKey(glossaryTarget)) {
              // CJK fallback: 模型翻译了"保持原文"的术语（source==target），正则搜不到。
              // 用源文中术语位置比例推算译文插入点。仅 CJK→CJK（1:1 字符映射）启用。
              if (/[一-鿿]/.test(normalizedSource)) {
                const srcIdx = normalizedSource.indexOf(normalizedGlossarySource)
                if (srcIdx >= 0) {
                  const srcRatio = srcIdx / Math.max(normalizedSource.length, 1)
                  const estIdx = Math.min(Math.floor(srcRatio * result.length), result.length)
                  // 用术语前后的源文字符作为锚点，在译文中定位
                  const ctxBefore = normalizedSource.slice(Math.max(0, srcIdx - 2), srcIdx)
                  const ctxAfter = normalizedSource.slice(
                    srcIdx + normalizedGlossarySource.length,
                    srcIdx + normalizedGlossarySource.length + 2,
                  )
                  let insPos = estIdx
                  let endPos = estIdx
                  if (ctxBefore) {
                    const ctxIdx = result.indexOf(ctxBefore, Math.max(0, estIdx - 10))
                    if (ctxIdx >= 0) insPos = ctxIdx + ctxBefore.length
                  }
                  if (ctxAfter) {
                    const afterIdx = result.indexOf(ctxAfter, insPos)
                    if (afterIdx > insPos) endPos = afterIdx
                  }
                  if (endPos > insPos) {
                    // 有明确边界：替换模型翻译的文本
                    result = result.slice(0, insPos) + glossaryTarget + result.slice(endPos)
                  } else if (insPos < result.length) {
                    // 无法确定边界：在推定位置插入术语目标
                    const prefix = insPos > 0 && !/[ \s]$/.test(result.slice(0, insPos)) ? ' ' : ''
                    const suffix = insPos < result.length && !/^[ \s]/.test(result.slice(insPos)) ? ' ' : ''
                    result = result.slice(0, insPos) + prefix + glossaryTarget + suffix + result.slice(insPos)
                  }
                }
              }
            }
          }
        }
      }
    }

    // 3. 短标签硬守卫：源文<15字符 且 译文长度>3x源文长度 时硬截断
    if (source.length < 15 && result.length > source.length * 3) {
      // 再次尝试术语匹配（更低阈值）
      let bestMatch: { target: string; len: number } | null = null
      for (const [gs, gt] of normalizedGlossaryMap.entries()) {
        const gsClean = cleanKey(gs)
        if (gsClean.length < 3) continue
        if (normalizedSource.includes(gsClean)) {
          if (!bestMatch || gsClean.length > bestMatch.len) {
            bestMatch = { target: gt, len: gsClean.length }
          }
        }
      }
      if (bestMatch && bestMatch.len / normalizedSource.length > 0.4) {
        result = bestMatch.target
      } else {
        const maxLen = Math.max(Math.ceil(source.length * 1.5), 3)
        result = truncateAtBoundary(result, maxLen)
      }
    }

    return result
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

  // 还原 ※ → *（译前转义避免 Qwen 将其解析为 markdown 列表标记）
  result = result.replace(/※\s*/g, '* ')

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

// 各语言相对英语的自然膨胀率（翻译行业经验值）
// 用于 detectTranslationExpansion 按语言设置动态阈值
const LANG_EXPANSION_RATIO: Record<string, number> = {
  // CJK — 翻译后通常比英语短
  'zh-CN': 1.2, 'zh-TW': 1.2, 'ja': 1.3, 'ko': 1.3,
  // 欧洲语言 — 天然比英语长 20-40%
  'pt': 1.8, 'pt-BR': 1.8, 'es': 1.7, 'fr': 1.8,
  'de': 1.9, 'it': 1.7, 'nl': 1.6, 'pl': 1.7,
  'sv': 1.6, 'tr': 1.5, 'ru': 1.5,
  // 东南亚
  'vi': 1.5, 'th': 1.4, 'id': 1.5, 'ms': 1.5,
  // 中东
  'ar': 1.6,
}

/**
 * 检测并修复译文异常扩展。
 *
 * 规则：
 * - 按目标语言设置动态阈值（CJK 1.2-1.3x，欧洲语言 1.5-1.9x）
 * - 短源文（<10字符）使用 2x 安全余量，常规文本用 1.4x 安全余量
 * - 安全检查：如果译文包含源文中的数字或连续大写字母（品牌名），跳过截断
 * - 检测到异常扩展时：尝试从译文中提取核心信息，在词/句边界截断
 */
export function detectTranslationExpansion(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang?: string,
): ExpansionResult {
  const expandedIndices = new Set<number>()

  const result = translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source || !translated) return translated

    const sourceLen = source.length
    const translatedLen = translated.length

    // 按语言动态计算阈值
    const ratio = targetLang ? (LANG_EXPANSION_RATIO[targetLang] ?? 1.5) : 1.5
    // 短源文使用更宽松阈值（2x），常规文本用 1.4x 安全余量
    const threshold = sourceLen < 10 ? ratio * 2.0 : ratio * 1.4

    if (translatedLen > sourceLen * threshold) {
      // 安全检查：如果译文包含源文中的数字，说明是合法翻译（如技术参数），不应截断
      // 品牌注入由 detectBrandInjection 负责，此处不检查
      const sourceNumbers = source.match(/\d+/g) || []
      const hasSourceNumbers = sourceNumbers.some(n => translated.includes(n))

      if (hasSourceNumbers) {
        // 合法翻译（包含源文数字），不截断
        return translated
      }

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

// ============================================================
// 品牌注入检测：检查译文是否添加了源文中不存在的品牌名或技术规格标识。
// 三层检测：
//   1. 品牌标记：Lexar®、pexar 等源文没有的品牌名
//   2. 规格注入：M.2、NVMe、PCIe代数、外形尺寸等源文没有的技术参数
//   3. 数值注入：译文有带单位的数字（5200MB/s、128GB等）但源文没有
// 检测到注入 → 回退到源文（避免显示错误译文）
// ============================================================
export interface InjectionResult {
  texts: string[]
  injectedIndices: Set<number>
}

export function detectBrandInjection(
  sourceTexts: string[],
  translatedTexts: string[],
  glossaryMap?: Map<string, string>,
): InjectionResult {
  // 品牌标记（Lexar 生态系统中已知的品牌/系列名）
  // 注意：不含 "雷克沙" — 这是 Lexar 在中文里的合法翻译，术语库会正确处理
  const brandTokens = new Set([
    'lexar', 'lexar®', 'pexar',
    'ares', 'thor', 'armor', 'play',
    'silver', 'gold', 'diamond',
  ])

  // 从术语库提取合法的品牌词翻译
  // 只要术语库译文中包含品牌词，该品牌词在译文中就是合法的（术语库是权威参考）
  const glossaryBrandTokens = new Set<string>()
  if (glossaryMap) {
    for (const [, target] of glossaryMap.entries()) {
      const targetLower = target.toLowerCase()
      for (const token of brandTokens) {
        if (targetLower.includes(token)) {
          glossaryBrandTokens.add(token)
        }
      }
    }
  }

  // 从术语库额外提取品牌 token：所有首字母大写的专有名词
  if (glossaryMap) {
    for (const key of glossaryMap.keys()) {
      const firstWord = key.split(/\s+/)[0]
      if (firstWord && /^[A-Z][a-zA-Z]{2,}$/.test(firstWord)) {
        brandTokens.add(firstWord.toLowerCase())
      }
    }
  }

  // 规格注入模式（不在源文中的技术参数标识）
  const specPatterns: Array<{ re: RegExp; name: string }> = [
    { re: /\bM\.2\b/i, name: 'M.2 form factor' },
    { re: /\bNVMe\b/i, name: 'NVMe protocol' },
    { re: /\bPCIe\s*[345]\.0\b/i, name: 'PCIe generation' },
    { re: /\bGen\s*[345]\s*x?\s*4\b/i, name: 'PCIe Gen x4' },
    { re: /\b(2230|2242|2280)\b/, name: 'M.2 form factor size' },
    { re: /®/, name: 'registered trademark symbol' },
  ]

  // 数值规格注入模式（LLM 编造的带单位的数字：5200MB/s、128GB等）
  const measurePatterns: Array<{ re: RegExp; name: string }> = [
    { re: /\d[\d,]*\s*(?:MB\/s|GB\/s|TB\/s|MBps|GBps)\b/i, name: 'speed value' },
    { re: /\d[\d,]*\s*(?:GB|TB|PB)\b(?!\/s)/i, name: 'capacity value' },
    { re: /\d[\d,]*\s*(?:MHz|GHz)\b/i, name: 'frequency value' },
    { re: /\d[\d,]*\s*(?:MB|KB)\b(?!\/s)/i, name: 'size value' },
  ]

  const injectedIndices = new Set<number>()

  const result = translatedTexts.map((trans, i) => {
    const src = sourceTexts[i] || ''
    if (!src || !trans) return trans

    const srcLower = src.toLowerCase()
    const transLower = trans.toLowerCase()

    // 1. 品牌标记注入检测：译文有但源文没有的品牌词
    // 使用词边界检测，避免子串误匹配（如越南语 "play" 被误判为品牌注入）
    for (const token of brandTokens) {
      // 如果该品牌词在术语库中是合法的（源文和译文都包含），跳过检测
      if (glossaryBrandTokens.has(token)) {
        continue
      }

      // 对于短词（< 4 字符），要求更严格的匹配：必须是独立单词
      // 对于长词，使用词边界 \b 检测
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const wordBoundaryRe = new RegExp(`\\b${escapedToken}\\b`, 'i')

      const transHasBrand = wordBoundaryRe.test(trans)
      const srcHasBrand = wordBoundaryRe.test(src)

      if (transHasBrand && !srcHasBrand) {
        injectedIndices.add(i)
        return src // 回退到源文
      }
    }

    // 2. 规格注入检测：译文匹配但源文不匹配的规格模式
    for (const { re } of specPatterns) {
      const transMatch = re.test(trans)
      const srcMatch = re.test(src)
      if (transMatch && !srcMatch) {
        injectedIndices.add(i)
        return src // 回退到源文
      }
    }

    // 3. 数值规格注入检测：译文有带单位的数字但源文没有
    for (const { re, name } of measurePatterns) {
      const transMatch = re.test(trans)
      const srcMatch = re.test(src)
      if (transMatch && !srcMatch) {
        injectedIndices.add(i)
        return src // 回退到源文
      }
    }

    return trans
  })

  return { texts: result, injectedIndices }
}

// ============================================================
// 换行保护：校对/翻译后如有多余换行，按原文断行方式还原
// 日语/韩语/英语按词断行，不在词中间插入换行
// ============================================================
export function sanitizeLineBreaks(
  sourceTexts: string[],
  translatedTexts: string[],
): string[] {
  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source || !translated) return translated

    const sourceBreaks = (source.match(/\n/g) || []).length
    const translatedBreaks = (translated.match(/\n/g) || []).length

    // 原文没有换行但译文有 → 去掉译文中的多余换行
    if (sourceBreaks === 0 && translatedBreaks > 0) {
      return translated.replace(/\n+/g, ' ')
    }

    // 原文有换行但译文换行过多 → 保留与原文数量一致的换行
    if (translatedBreaks > sourceBreaks * 2) {
      const parts = translated.split('\n')
      // 按原文换行数合并：尽可能保留前面的分段
      const targetParts = Math.max(1, sourceBreaks + 1)
      const merged: string[] = []
      const chunkSize = Math.ceil(parts.length / targetParts)
      for (let j = 0; j < targetParts; j++) {
        const chunk = parts.slice(j * chunkSize, (j + 1) * chunkSize).filter(p => p.trim())
        if (chunk.length > 0) merged.push(chunk.join(' '))
      }
      return merged.join('\n')
    }

    return translated
  })
}

// ============================================================
// 数字校验：检测译文中数字是否与源文一致
// 提取源文和译文中的"数字+单位"组合，如果不一致则标记
// ============================================================

/**
 * 检测译文中数字是否与源文一致
 * 规则：提取源文和译文中的"数字+存储单位"组合，如果不一致则标记
 * 支持所有20种语言的存储单位格式
 * 返回：修复后的译文数组 + 异常索引集合
 */
export function validateNumbers(
  sourceTexts: string[],
  translatedTexts: string[],
): { texts: string[]; mismatchedIndices: Set<number> } {
  const mismatchedIndices = new Set<number>()

  // 提取"数字+存储单位"组合（支持所有语言的存储单位格式）
  const extractStorageNumbers = (text: string): number[] => {
    // 匹配所有语言的存储单位：
    // - 英文/大多数语言: TB, GB, MB, KB, PB (及其带/s的形式)
    // - 法语: To, Go, Mo, Ko, Po
    // - 俄语: ТБ, ГБ, МБ, КБ
    // - 日语/韩语/中文: 太字节, 吉字节, etc. (但通常用英文缩写)
    const pattern = /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|PB|To|Go|Mo|Ko|Po|ТБ|ГБ|МБ|КБ)(?:\/s)?/gi
    const matches = text.match(pattern) || []
    // 提取数字部分（去除千位分隔符）
    return matches.map(m => {
      const numMatch = m.match(/^(\d+(?:[.,]\d+)?)/)
      if (!numMatch) return 0
      // 去除千位分隔符（逗号或点）
      return parseFloat(numMatch[1].replace(/[.,]/g, ''))
    })
  }

  const result = translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source || !translated) return translated

    const sourceNumbers = extractStorageNumbers(source)
    const transNumbers = extractStorageNumbers(translated)

    // 如果数量不一致 → 数字错误
    if (sourceNumbers.length !== transNumbers.length) {
      mismatchedIndices.add(i)
      return source // 回退到源文
    }

    // 如果数值不一致 → 数字错误
    for (let j = 0; j < sourceNumbers.length; j++) {
      if (Math.abs(sourceNumbers[j] - transNumbers[j]) > 0.01) {
        mismatchedIndices.add(i)
        return source // 回退到源文
      }
    }

    return translated
  })

  return { texts: result, mismatchedIndices }
}
