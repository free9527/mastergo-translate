import { LLMConfig, LANGUAGES, isMarketingTerm, isComplianceTerm } from '@messages/types'
import { API_MAX_RETRIES, API_RETRY_DELAY_MS, API_TIMEOUT_MS, DEBUG_MODE, MIN_DUP_LEN, PRODUCT_LINE_CACHE_SIZE } from '@lib/constants'
import { filterRelevantGlossary } from '@lib/glossary-filter'
import { normalizeTextForLLM, protectCjkSpaces } from '@lib/text-normalizer'
import { maskEntities, unmaskEntities, maskEntitiesForProofread, maskGlossaryTerms, unmaskGlossaryTerms } from '@lib/entity-masker'
import { postProcessTranslation, restoreTrademarkSymbols, restoreStorageUnitFormatting, enforceGlossaryTerms, capitalizeFirstLetter, detectTranslationExpansion, detectBrandInjection, validateNumbers } from '@lib/post-process'
import {
  IDENTITY_MISSION,
  CORE_PRINCIPLES,
  CORE_PRINCIPLES_ZH,
  QUALITY_STANDARD,
  QUALITY_STANDARD_ZH,
  getStyleCard,
  renderLangForTranslate,
  renderLangForProofread,
  PROOFREAD_SYSTEM_PROMPT,
  PROOFREAD_SYSTEM_PROMPT_ZH,
  isCJKTarget,
} from '@lib/prompt-constants'
import { getFewShotExamples } from '@lib/few-shot-examples'

// DEBUG 日志辅助函数
const debugWarn = (...args: unknown[]) => DEBUG_MODE && console.warn(...args)

interface XhrResponse {
  ok: boolean
  status: number
  text: string
  json: unknown
}

function xhrRequest(method: string, url: string, headers: Record<string, string>, body?: string, timeout = API_TIMEOUT_MS): Promise<XhrResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url, true)
    for (const key of Object.keys(headers)) {
      xhr.setRequestHeader(key, headers[key])
    }
    xhr.onload = () => {
      let parsed: unknown = undefined
      try { parsed = JSON.parse(xhr.responseText) } catch { parsed = {} }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: xhr.responseText,
        json: parsed,
      })
    }
    xhr.onerror = () => reject(new Error('网络请求失败，请检查 API 地址是否可访问'))
    xhr.ontimeout = () => reject(new Error(`请求超时（${(timeout / 1000).toFixed(0)}秒）`))
    xhr.timeout = timeout
    xhr.send(body || null)
  })
}

export async function fetchWithRetry(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
  maxRetries = API_MAX_RETRIES,
  baseDelay = API_RETRY_DELAY_MS,
  baseTimeout = API_TIMEOUT_MS,
): Promise<XhrResponse> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 每次重试超时递增 50%，避免同样的超时导致重试全部失败
    const timeout = baseTimeout * Math.pow(1.5, attempt)
    try {
      const res = await xhrRequest(options.method, url, options.headers, options.body, timeout)
      if (res.ok) return res
      // 频率限制(429)和服务器错误(5xx)需要重试，4xx 不重试
      if (attempt < maxRetries && (res.status >= 500 || res.status === 429)) {
        debugWarn('[translate] API ' + res.status + ', retry', attempt + 1, '/', maxRetries)
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)))
        continue
      }
      return res
    } catch (e) {
      lastError = e as Error
      // 网络错误和超时都应该重试，不要直接抛
      if (attempt < maxRetries) {
        debugWarn('[translate] request error, retry', attempt + 1, '/', maxRetries, e)
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)))
        continue
      }
    }
  }
  throw lastError || new Error('请求失败，已达最大重试次数')
}

// ============================================================
// 源语言检测
// ============================================================

/**
 * 拉丁语区分词表 — 只收互相不重叠的高频词，用于批次级拉丁语判定。
 * 与 LANG_FUNCTION_WORDS 不同：那里的词表为"确认目标语言身份"设计，
 * es/pt 共享 17+ 词（que/para/por/de/a/se/como…），直接投票会把 es 误判成 pt。
 * 这里的词表只收各语言独占词，平局/弱信号一律回退 'en'（保守方向 = 维持现状行为）。
 * 注意：pt 投票无法区分 pt 与 pt-BR（两变体共享几乎全部词汇），统一返回 'pt'。
 */
const LATIN_DISTINCTIVE_WORDS: Record<string, Set<string>> = {
  en: new Set(['the', 'of', 'and', 'to', 'in', 'is', 'are', 'for', 'with', 'on', 'at', 'by', 'be', 'has', 'have', 'it', 'its', 'not', 'can', 'will', 'from', 'this', 'that', 'your', 'you', 'an', 'or', 'as', 'up', 'our', 'we']),
  pt: new Set(['é', 'são', 'tem', 'têm', 'sem', 'até', 'não', 'muito', 'um', 'uma', 'ao', 'à', 'do', 'da', 'na', 'no', 'estão', 'isso', 'contra', 'baixas', 'resistente', 'proteção']),
  es: new Set(['el', 'la', 'los', 'las', 'es', 'son', 'está', 'están', 'y', 'pero', 'muy', 'tiene', 'tienen', 'al', 'del', 'un', 'una', 'con', 'sin', 'hasta', 'ñandú']),
  de: new Set(['und', 'oder', 'mit', 'für', 'von', 'zu', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'nicht', 'auch', 'auf', 'bei', 'nach', 'über', 'wird', 'werden', 'kann', 'sich']),
  fr: new Set(['et', 'ou', 'mais', 'que', 'qui', 'dans', 'sur', 'avec', 'sans', 'pour', 'par', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'est', 'sont', 'ne', 'pas', 'plus', 'ce', 'cette']),
  it: new Set(['che', 'per', 'con', 'da', 'fra', 'tra', 'senza', 'su', 'il', 'lo', 'gli', 'le', 'un', 'uno', 'è', 'sono', 'ha', 'hanno', 'di', 'del', 'della', 'nel', 'alla', 'anche', 'più']),
  nl: new Set(['en', 'of', 'maar', 'met', 'voor', 'van', 'tot', 'op', 'bij', 'het', 'een', 'zijn', 'heeft', 'niet', 'aan', 'uit', 'om', 'ook', 'deze', 'dit', 'dat', 'wordt', 'tegen']),
}

/** 各语言独占特征字符（一票顶十票的强信号） */
const LATIN_DISTINCTIVE_CHARS: Record<string, RegExp> = {
  pt: /[ãõÃÕ]/,       // 葡语几乎独占（西语无 ãõ，除借词）
  es: /[ñÑ¿¡]/,       // 西语独占
  de: /[ßẞ]/,         // 德语独占（äöü 与瑞典语等共享，不作信号）
}

export function detectSourceLanguage(texts: string[]): string {
  let cjkChars = 0, latinChars = 0, hiragana = 0, katakana = 0, hangul = 0, thai = 0, arabic = 0, cyrillic = 0
  for (const t of texts) {
    for (const ch of t) {
      const code = ch.charCodeAt(0)
      if (code >= 0x4E00 && code <= 0x9FFF) cjkChars++           // CJK统一汉字
      else if (code >= 0x3040 && code <= 0x309F) hiragana++       // 平假名
      else if (code >= 0x30A0 && code <= 0x30FF) katakana++       // 片假名
      else if (code >= 0xAC00 && code <= 0xD7AF) hangul++         // 韩文
      else if (code >= 0x0E00 && code <= 0x0E7F) thai++           // 泰文
      else if (code >= 0x0600 && code <= 0x06FF) arabic++         // 阿拉伯文
      else if (code >= 0x0400 && code <= 0x04FF) cyrillic++       // 西里尔
      else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latinChars++
    }
  }
  // 日文：假名占比显著（混有汉字）
  if (hiragana + katakana > 0 && (hiragana + katakana) >= cjkChars * 0.15) return 'ja'
  // 韩文：谚文占比显著
  if (hangul > 0 && hangul >= (cjkChars + hangul) * 0.1) return 'ko'
  // 泰文
  if (thai > latinChars * 0.5) return 'th'
  // 阿拉伯文
  if (arabic > latinChars * 0.5) return 'ar'
  // 西里尔（俄语等）
  if (cyrillic > latinChars * 0.5) return 'ru'
  // 中文 vs 拉丁文本
  if (cjkChars > latinChars) return 'zh-CN'

  // v9.3: 拉丁文本细分判定（en/es/pt/de/fr/it/nl）
  // 背景：此前所有拉丁文本一律返回 'en'，导致 pt→pt-BR 同语系豁免成为死代码
  // （detectUntranslatedText 的 ['pt','pt-BR'] 配对永远配不上），且 de→de 等同语言
  // 校对场景的"源==目标跳过"防线对拉丁语全部失效。
  // 判定策略：独占区分词投票 + 独占特征字符强信号，保守裁决——
  // 平局/弱信号一律回退 'en'（=维持现状行为），宁可误判为 en 也不可误判为其他拉丁语。
  const joined = texts.join(' ').toLowerCase()

  // 特征字符强信号：某语言独占字符出现 ≥2 次 → 直接判定（一票顶十票）
  for (const [lang, pattern] of Object.entries(LATIN_DISTINCTIVE_CHARS)) {
    const charMatches = joined.match(new RegExp(pattern.source, 'g'))
    if (charMatches && charMatches.length >= 2) return lang
  }

  // 区分词投票
  const words = joined.split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/).filter(w => w.length >= 2)
  const votes: Record<string, number> = {}
  for (const w of words) {
    for (const [lang, dict] of Object.entries(LATIN_DISTINCTIVE_WORDS)) {
      if (dict.has(w)) votes[lang] = (votes[lang] || 0) + 1
    }
  }

  // 保守裁决：最高票 ≥3 且严格大于第二名 ≥2 倍才采纳，否则回退 'en'
  let topLang = 'en'
  let topVotes = 0
  let secondVotes = 0
  for (const [lang, count] of Object.entries(votes)) {
    if (count > topVotes) { secondVotes = topVotes; topVotes = count; topLang = lang }
    else if (count > secondVotes) { secondVotes = count }
  }
  if (topVotes >= 3 && topVotes >= secondVotes * 2 && topLang !== 'en') return topLang
  return 'en'
}

/**
 * 单条文本源语言检测。
 * 与 detectSourceLanguage 逻辑一致，但仅对单条文本做字符统计。
 * 用于逐条标注源语言，解决批次内混合语种导致 LLM 漏翻的问题。
 * 带缓存：避免同一条文本在翻译/校对/检测中被重复计算。
 */
const langDetectionCache = new Map<string, string>()
export function detectSingleTextLanguage(text: string): string {
  const cached = langDetectionCache.get(text)
  if (cached !== undefined) return cached

  if (!text) {
    langDetectionCache.set(text, 'en')
    return 'en'
  }
  let cjkChars = 0, latinChars = 0, hiragana = 0, katakana = 0, hangul = 0, thai = 0, arabic = 0, cyrillic = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 0x4E00 && code <= 0x9FFF) cjkChars++
    else if (code >= 0x3040 && code <= 0x309F) hiragana++
    else if (code >= 0x30A0 && code <= 0x30FF) katakana++
    else if (code >= 0xAC00 && code <= 0xD7AF) hangul++
    else if (code >= 0x0E00 && code <= 0x0E7F) thai++
    else if (code >= 0x0600 && code <= 0x06FF) arabic++
    else if (code >= 0x0400 && code <= 0x04FF) cyrillic++
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latinChars++
  }
  let result: string
  if (hiragana + katakana > 0 && (hiragana + katakana) >= cjkChars * 0.15) result = 'ja'
  else if (hangul > 0 && hangul >= (cjkChars + hangul) * 0.1) result = 'ko'
  else if (thai > latinChars * 0.5) result = 'th'
  else if (arabic > latinChars * 0.5) result = 'ar'
  else if (cyrillic > latinChars * 0.5) result = 'ru'
  else result = cjkChars > latinChars ? 'zh-CN' : 'en'

  langDetectionCache.set(text, result)
  // 缓存上限，避免内存泄漏
  if (langDetectionCache.size > 10000) {
    const firstKey = langDetectionCache.keys().next().value
    if (firstKey !== undefined) langDetectionCache.delete(firstKey)
  }
  return result
}

// ============================================================
// 语言名称映射（英文名，用于英文指令中避免中英混杂）
// ============================================================
const EN_LANG_NAMES: Record<string, string> = {
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', 'en': 'English',
  'ja': 'Japanese', 'ko': 'Korean', 'fr': 'French', 'de': 'German',
  'es': 'Spanish', 'pt': 'Portuguese', 'pt-BR': 'Brazilian Portuguese',
  'ru': 'Russian', 'it': 'Italian', 'vi': 'Vietnamese', 'th': 'Thai',
  'id': 'Indonesian', 'ar': 'Arabic', 'nl': 'Dutch', 'pl': 'Polish',
  'sv': 'Swedish', 'tr': 'Turkish',
}

function getLangDisplayName(code: string, useEn: boolean): string {
  if (useEn) return EN_LANG_NAMES[code] || code
  // 中文指令：取 LANGUAGES 中的中文名，去掉代码前缀（"FR 法文" → "法文"）
  const raw = LANGUAGES.find(l => l.code === code)?.name || code
  return raw.replace(/^[A-Za-z-]+\s+/, '')
}

// ============================================================
// 产品线检测（自动识别，匹配产品线专属翻译策略）
// 带缓存：同一任务内相同输入只检测一次
// v8.2: 添加缓存上限，防止内存泄漏
const productLineCache = new Map<string, string | null>()
const PRODUCT_LINE_CACHE_LIMIT = PRODUCT_LINE_CACHE_SIZE || 5000

function addToProductLineCache(key: string, value: string | null): void {
  if (productLineCache.size >= PRODUCT_LINE_CACHE_LIMIT) {
    // LRU淘汰：删除第一个（最旧的）
    const firstKey = productLineCache.keys().next().value
    if (firstKey !== undefined) productLineCache.delete(firstKey)
  }
  productLineCache.set(key, value)
}

export function detectProductLine(texts: string[], pageName?: string, fileName?: string): string | null {
  // 缓存键：文件名+页面名+文本摘要
  const cacheKey = (fileName || '') + '\x00' + (pageName || '') + '\x00' + texts.length + '\x00' + texts.join('').slice(0, 200)
  const cached = productLineCache.get(cacheKey)
  if (cached !== undefined) return cached

  // 优先级：文件名 > 页面名 > 文本内容
  // 文件名/页面名通常用产品型号命名，比文本内容更可靠
  const nameResult = detectProductLineFromName(fileName, pageName)
  if (nameResult) {
    addToProductLineCache(cacheKey, nameResult)
    return nameResult
  }

  const joined = texts.join(' ')

  // 1. 电竞内存：ARES/THOR + DDR/DIMM
  if (/(ARES|THOR).*(DDR|DIMM|内存|記憶體|メモリ|메모리)/i.test(joined) ||
      /(DDR|DIMM).*(ARES|THOR)/i.test(joined)) {
    addToProductLineCache(cacheKey, 'gaming_dimm')
    return 'gaming_dimm'
  }

  // 卡片上下文检测（SD Express 存储卡文案常提 NVMe/PCIe，需排除）
  // 注意：不包含读卡器上下文——读卡器必然提及卡片类型
  const isCardContext = /(microSD|SDXC|SDHC|\bSD\b|記憶卡|存储卡|卡|card|SD\s*カード|SD\s*카드|SD\s*Karte)/i.test(joined) &&
    !/(Reader|读卡器|讀卡機|カードリーダー|Workflow|RW\d+)/i.test(joined)

  // 2. 电竞 SSD：PLAY/ARES/THOR + SSD/NVMe（排除 microSD 卡片上下文）
  if (!isCardContext && (
    /(PLAY|ARES|THOR).*(SSD|NVMe|固态|固態)/i.test(joined) ||
    /(SSD|NVMe).*(PLAY|ARES|THOR)/i.test(joined)
  )) {
    addToProductLineCache(cacheKey, 'gaming_ssd')
    return 'gaming_ssd'
  }

  // 3. 游戏存储卡：PLAY + card/microSD/SD
  if (/PLAY.*(卡|card|microSD|SD|記憶卡|存储卡)/i.test(joined) ||
      /(卡|card|microSD|SD).*PLAY/i.test(joined)) {
    addToProductLineCache(cacheKey, 'gaming_card')
    return 'gaming_card'
  }

  // 读卡器上下文（Workflow Reader / RW 系列读卡器）
  const isReaderContext = /(Reader|读卡器|讀卡機|カードリーダー|Workflow\s*(CF|Go|Reader)|RW\d+)/i.test(joined)

  // 4. 专业影像：GOLD/DIAMOND/ARMOR GOLD/Professional/CFe/1667x/2000x + SD/CFe/card
  //    排除读卡器上下文（Professional Workflow CFexpress Reader 不是卡）
  //    SD 用 \b 边界避免匹配到 SSD
  if (!isReaderContext && (
    /(GOLD|DIAMOND|ARMOR).*(CFexpress|CFe|microSD|\bSD\b|卡|card)/i.test(joined) ||
    /Professional.*(CFexpress|CFe|microSD|\bSD\b|卡|card)/i.test(joined) ||
    /(CFexpress|CFe).*(GOLD|DIAMOND|SILVER)/i.test(joined) ||
    /1667x|2000x|800x\s*PRO/i.test(joined) ||
    /\bCFe\b/i.test(joined)
  )) {
    addToProductLineCache(cacheKey, 'professional_imaging')
    return 'professional_imaging'
  }

  // 5. PC/AI 生产力：NM/NQ/NS/EQ 系列 SSD
  if (/[NMNQ]\d+|NS\d+|EQ\d+/i.test(joined)) {
    addToProductLineCache(cacheKey, 'pc_productivity')
    return 'pc_productivity'
  }

  // 6. 创新生活：pexar
  if (/pexar|数字相框|數字相框|digital\s*photo\s*frame/i.test(joined)) {
    addToProductLineCache(cacheKey, 'innovation_lifestyle')
    return 'innovation_lifestyle'
  }

  // 7. 消费存储卡：SILVER/BLUE（含 PLUS/PRO）+ microSD/SD/card
  if (/\b(BLUE|SILVER)\b.*(microSD|\bSD\b|卡|card|記憶卡|存储卡)/i.test(joined) ||
      /(microSD|\bSD\b|卡|card).*\b(BLUE|SILVER)\b/i.test(joined)) {
    addToProductLineCache(cacheKey, 'consumer_cards')
    return 'consumer_cards'
  }

  // 8. 移动存储：PSSD/Portable SSD/USB Flash/读卡器/Workflow/Dual Drive/Enclosure/Hub
  //    排除卡片上下文（已由 consumer_cards 或 higher 接管）
  if (!isCardContext && (
    /(PSSD|移动固态|行動固態|Portable\s*SSD|便携式?\s*SSD|Tragbare\s*SSD|Draagbare\s*SSD|bärbar\s*SSD|Przenośny\s*SSD|Taşınabilir\s*SSD|휴대용\s*SSD|ポータブル\s*SSD)/i.test(joined) ||
    /(Flash\s*Drive|Dual\s*Drive|Solid\s*State\s*Dual\s*Drive|闪存盘|隨身碟|U盘|USB\s*闪存|USB\s*memo|USB\s*stick|pendrive|chiavetta|clé\s*USB)/i.test(joined) ||
    /(读卡器|讀卡機|Reader|カードリーダー|Kartenleser|lecteur\s*de\s*cartes|lector\s*de\s*tarjetas|lettore\s*di\s*schede|kaartlezer|czytnik\s*kart|kortläsare|kart\s*okuyucu|đầu\s*đọc\s*thẻ|портативный|портативный)/i.test(joined) ||
    /(Hub|扩展坞|擴充埠|Enclosure|硬盘盒|硬碟盒|Workflow|SL\d+|ES\d+|RW\d+|D\d+[A-Za-z]?E?|F\d+\s*PRO|Go\s*PSSD|ARMOR\s*700)/i.test(joined)
  )) {
    addToProductLineCache(cacheKey, 'portable_storage')
    return 'portable_storage'
  }

  addToProductLineCache(cacheKey, null)
  return null
}

/**
 * 从文件名/页面名检测产品线（与 merge_glossary.py classify_product 逻辑一致）
 * 文件名和页面名通常用产品型号命名，如 "NM790"、"ARES DDR5"、"SILVER PLUS SD"
 * 优先级：fileName > pageName
 */
function detectProductLineFromName(fileName?: string, pageName?: string): string | null {
  const name = [fileName, pageName].filter(Boolean).join(' ')
  if (!name) return null

  // 1. 电竞内存：ARES/THOR + DDR/DIMM
  if (/(ARES|THOR).*(DDR|DIMM)/i.test(name) || /(DDR|DIMM).*(ARES|THOR)/i.test(name)) {
    return 'gaming_dimm'
  }

  const isCardCtx = /(microSD|SDXC|SDHC|\bSD\b|卡|card)/i.test(name) &&
    !/(Reader|读卡器|讀卡機)/i.test(name)

  // 2. 电竞 SSD：PLAY/ARES/THOR + SSD/NVMe（排除卡片上下文）
  if (!isCardCtx && (
    /(PLAY|ARES|THOR).*(SSD|NVMe)/i.test(name) ||
    /(SSD|NVMe).*(PLAY|ARES|THOR)/i.test(name)
  )) {
    return 'gaming_ssd'
  }

  // 3. 游戏存储卡：PLAY + card
  if (/PLAY.*(卡|card|microSD|SD)/i.test(name)) {
    return 'gaming_card'
  }

  // 4. 专业影像：GOLD/DIAMOND/ARMOR/Professional/CFexpress/1667x/2000x
  const isReader = /(Reader|读卡器|讀卡機|Workflow|RW\d+)/i.test(name)
  if (!isReader && (
    /(GOLD|DIAMOND|ARMOR)/i.test(name) ||
    /CFexpress|CFe/i.test(name) ||
    /1667x|2000x|800x\s*PRO|1066x|1800x/i.test(name)
  )) {
    return 'professional_imaging'
  }

  // 5. PC 生产力：NM/NQ/NS/EQ 系列（单词边界）
  if (/\bNM\d+|\bNQ\d+|\bNS\d+|\bEQ\d+/i.test(name)) {
    return 'pc_productivity'
  }

  // 6. 创新生活
  if (/pexar|digital\s*photo\s*frame/i.test(name)) {
    return 'innovation_lifestyle'
  }

  // 7. 消费存储卡：SILVER/BLUE
  if (/\b(BLUE|SILVER)\b/i.test(name)) {
    return 'consumer_cards'
  }

  // 7b. 通用 DDR4/DDR5 内存 → pc_productivity
  if (/\bDDR[45]\b/i.test(name)) {
    return 'pc_productivity'
  }

  // 7c. High-Endurance / E-series
  if (/High[- ]?Endurance|\bE[- ]?[Ss]eries\b/i.test(name)) {
    return 'consumer_cards'
  }

  // 8. 移动存储
  if (!isCardCtx && (
    /PSSD|Portable\s*SSD|Flash\s*Drive|Dual\s*Drive/i.test(name) ||
    /读卡器|讀卡機|Reader|Enclosure|硬盘盒|Workflow|SL\d+|ES\d+|RW\d+|Hub/i.test(name) ||
    /ARMOR\s*700|Go\s*PSSD/i.test(name)
  )) {
    return 'portable_storage'
  }

  return null
}

// 获取实际生效的产品线（手动覆盖优先于自动检测）
function getEffectiveProductLine(config: LLMConfig, texts: string[], pageName?: string, fileName?: string): string | null {
  const manual = config.manualProductLine
  if (manual !== undefined) {
    return manual === 'none' ? null : (manual || null)
  }
  return detectProductLine(texts, pageName, fileName)
}

// 产品线 → 风格自动映射
// 用户手动指定优先，否则根据产品线自动选择
const PRODUCT_LINE_STYLE_MAP: Record<string, string> = {
  'gaming_dimm': 'marketing',        // 热血、冲击力、年轻化
  'gaming_ssd': 'marketing',         // 爽快直白、年轻潮流
  'gaming_card': 'marketing',        // 活泼轻松、玩家向
  'professional_imaging': 'professional',  // 沉稳克制、高级质感
  'pc_productivity': 'standard',     // 务实温和、简约中性
  'consumer_cards': 'standard',      // 亲民通俗、简单易懂
  'portable_storage': 'standard',    // 轻便现代、安心可靠
  'innovation_lifestyle': 'marketing',  // 潮流年轻化、有设计感
}

// ============================================================
// 术语库按场景过滤（仅保留两处硬编码规则：营销过滤 + 合规强制）
// ============================================================

function filterGlossaryByScene(
  glossaryObj: Record<string, string>,
  scenePreset: string,
): Record<string, string> {
  // 电商/包装场景不过滤，全量注入（包装正面营销文案需匹配营销类术语）
  if (scenePreset === 'ecommerce' || scenePreset === 'packaging' || !scenePreset) return glossaryObj

  const filtered: Record<string, string> = {}
  for (const [source, target] of Object.entries(glossaryObj)) {
    // 合规声明：强制注入，不受场景过滤影响
    if (isComplianceTerm(source)) {
      filtered[source] = target
      continue
    }
    // 营销文案：非电商场景过滤掉
    if (isMarketingTerm(source)) {
      continue
    }
    filtered[source] = target
  }
  return filtered
}

// ============================================================
// 预计算任务级术语提示词 — 用全部源文本一次性过滤术语库，
// 将相同的 glossaryHint 注入每个批次，确保 system prompt 100% 一致 → API 缓存命中
// ============================================================
export function buildTaskGlossaryHint(
  glossaryMap: Map<string, string>,
  scenePreset: string,
  allSourceTexts?: string[],
): string {
  const glossaryObj: Record<string, string> = {}
  for (const [k, v] of glossaryMap.entries()) { glossaryObj[k] = v }
  const sceneFiltered = filterGlossaryByScene(glossaryObj, scenePreset)
  const { glossaryHint } = filterRelevantGlossary(sceneFiltered, allSourceTexts || [], 100)
  return glossaryHint
}

// ============================================================
// HTML 标签保护
// ============================================================
function protectHtmlTags(texts: string[]): { texts: string[]; tags: Map<string, string> } {
  const tagMap = new Map<string, string>()
  let counter = 0
  const result = texts.map(t => {
    return t.replace(/<[^>]+>/g, match => {
      const key = `__HTML_${counter}__`
      tagMap.set(key, match)
      counter++
      return key
    })
  })
  return { texts: result, tags: tagMap }
}

function restoreHtmlTags(texts: string[], tags: Map<string, string>): string[] {
  return texts.map(t => {
    let result = t
    for (const [key, value] of tags) {
      result = result.replace(key, value)
    }
    return result
  })
}

// ═══════════════════════════════════════════════════════════════
// 文件: llm-api.ts — 翻译与校对 API 调用
// ═══════════════════════════════════════════════════════════════
//
// 翻译管道（translateBatch）:
//   输入 → 遮蔽 → LLM 翻译 → 还原 → 后处理 → 检测 → retry → 输出
//
//   各步骤职责:
//     protectHtmlTags          — HTML 标签暂时替换，翻译后还原
//     normalizeTextForLLM      — NFC/全角→半角/零宽字符移除（text-normalizer.ts）
//     maskEntities             — 遮蔽在产品型号/URL/Email/纯技术缩略语（entity-masker.ts）
//     maskGlossaryTerms        — 术语库遮蔽（entity-masker.ts，__GLOSSARY_N__ → 目标语译文）
//     protectCjkSpaces         — CJK 空格保护（text-normalizer.ts）
//     buildSystemPrompt        — 组装 system prompt（prompt-constants.ts）
//     LLM API 调用
//
//   译后管道（按顺序，不能乱）:
//     1. unmaskEntities           — 还原实体占位符（先还原原样）
//     2. unmaskGlossaryTerms      — 还原术语占位符（替换为目标语）
//     3. restoreHtmlTags
//     4. postProcessTranslation   — 各语种后处理（de/fr/ja/ar...）
//     5. detectBrandInjection     — 品牌注入检测（校验，命中回退源文）
//     6. enforceGlossaryTerms     — 术语库强制校准（安全网，二次确认）
//     7. restoreTrademarkSymbols  — ®™© 还原
//     8. restoreStorageUnitFormatting — 单位格式修复
//     9. capitalizeFirstLetter    — 首字母大写
//    10. detectTranslationExpansion   — 扩展检测（校验）
//    11. 批次内交叉污染检测
//    12. detectUntranslatedText   — 漏翻检测（校验，命中触发 retry）
//    13. detectTruncatedTexts     — 截断检测（校验，命中触发 retry）
//
//   漏翻 retry: _isRetry=false 且有漏翻时，最多重试 2 次（独立小批次）
//   截断 retry: _isRetry=false 且有截断时，最多重试 2 次（独立小批次）
//
// 校对管道（proofreadBatch）:
//   翻译结果 → 遮蔽 → 校对 LLM → 还原 → 后处理 → 检测 → 输出
//
// 检测函数（独立于管道，可被调用方自行使用）:
//   detectSourceLanguage      — 批次级源语言检测
//   detectSingleTextLanguage  — 单条文本源语言检测
//   detectUntranslatedText    — 漏翻检测（译文==源文）
//   detectTruncatedTexts      — 截断检测（译文长度 < 源文 15%）
//   isProofreadScriptMismatch — 校对脚本不匹配检测（拉丁语出现汉字）
// ═══════════════════════════════════════════════════════════════

// ============================================================
// v7.0: 5-Module Mixed Architecture
// Logic & Rules → English | Tone & Style → Target Language | Dynamic Pruning
// ============================================================

// STYLE_PRESETS 仅用于 UI 预览面板
export const STYLE_PRESETS: Record<string, string> = {
  standard: `【语气】平实自然，通顺易读。`,
  professional: `【语气】严谨正式，技术表述精准客观。句式简洁，避免冗余修饰。`,
  marketing: `【语气】有说服力，突出卖点。保持高端品牌调性，不虚构不夸大。`,
}

// 保留旧版场景预设用于 UI 显示
export const SCENE_PRESETS: Record<string, string> = {
  technical_params: `【技术参数】行项1:1不合并/拆分。保留"-"、"N/A"、"TBD"原样。`,
  ecommerce: `【商品详情页】卖点前置，短句为主。源语言特有表达找目标语言等效说法，不直译。`,
  packaging: `【包装文案】禁止断词换行（DE/NL等长复合词语言尤其注意）。避免生僻词。`,
  ui: `【软件UI】报错action-first。预留文本膨胀空间(DE/NL/PL优先最短表达)。RTL确保方向正确。`,
  after_sales: `【售后/保修】零营销语言。法律免责条款逐字直译不可改写。敬语体系见语言专属提示。`,
  manual: `【说明书】操作步骤1:1严格对应。安全警告逐字直译。指令式语气，简短明确。`,
  spec_sheet: `【规格书】表格1:1。参数名用行业标准译法。保留"Typ."/"Max."/"Min."标注。`,
}

// ═══════════════════════════════════════════════════════════════
// v8.0: buildSystemPrompt — 翻译 System Prompt 组装（8 模块）
// ═══════════════════════════════════════════════════════════════
// ── 职责边界 ──
// 【做什么】组装翻译 LLM 的完整 system prompt。包含角色、原则、使命、风格、示例、规则、术语、输出格式。
// 【不做什么】不注入校对模块（校对有独立的 PROOFREAD_SYSTEM_PROMPT）。
//            不包含 IRON_RULES/BRAND_ASSET_RULES — 已由 CORE_PRINCIPLES 替代。
//            不重复注入 tone/style/compliance — 已由 getStyleCard 统一注入。
//
// ── 组装顺序（8 模块）──
//   IDENTITY       → CORE_PRINCIPLES → MISSION → STYLE → FEWSHOT
//   → LANG_RULES   → CONTEXT → GLOSSARY → OUTPUT
//
// ── 指令语言策略 ──
//   CJK 目标(zh-CN/zh-TW/ja/ko) → 中文指令（更精准的语义对齐）
//   非 CJK 目标(16语种)           → 英文指令（LLM 对英文指令忠实度最高）
// ═══════════════════════════════════════════════════════════════
export function buildSystemPrompt(params: {
  targetLang: string
  langBlock: string       // renderLangForTranslate output (rules + compliance, no category words)
  styleCard: string       // getStyleCard output
  fewShotBlock: string    // getFewShotExamples output
  glossaryHint?: string
}): string {
  const { targetLang, langBlock, styleCard, fewShotBlock, glossaryHint } = params

  // CJK 目标使用中文指令，其余使用英文指令
  const isZhInstruction = isCJKTarget(targetLang)

  // ── IDENTITY (instruction language) ──
  const role = isZhInstruction
    ? `[身份]\n你是 Lexar（雷克沙）存储产品的本地化专家。你产出自然、精准的译文，读起来像母语者写的一样。`
    : `[IDENTITY]\nYou translate Lexar storage product content. Your translations read as if originally written in the target language by a native speaker.`

  // ── QUALITY STANDARD (instruction language) — v9.4 六维质量标准，先于规则 ──
  const qualityStandard = isZhInstruction ? QUALITY_STANDARD_ZH : QUALITY_STANDARD

  // ── CORE PRINCIPLES (instruction language) ──
  const principles = isZhInstruction ? CORE_PRINCIPLES_ZH : CORE_PRINCIPLES

  // ── MISSION (target language) ──
  const mission = IDENTITY_MISSION[targetLang] || IDENTITY_MISSION['en'] || ''

  // ── GLOSSARY ──
  const glossaryBlock = glossaryHint ? `\n\n${glossaryHint}` : ''

  // ── LANG RULES (target language) ──
  const langBlock_str = langBlock ? `\n\n${langBlock}` : ''

  // ── CONTEXT ──
  const contextHint = isZhInstruction
    ? '\n[上下文] 同一设计文件中的独立 UI 字符串。逐条独立翻译。相同源文术语在条目间保持译文一致。遇到多义词（如 Drive=硬盘/驱动）时，优先采用存储行业的默认术语。'
    : '\n[CONTEXT] Independent UI strings from the same design file. Translate each entry independently. When the same source term appears across entries, use the same target term. If a term is ambiguous without context (e.g., "Drive" = storage device vs. vehicle motion), default to the storage-industry interpretation.'

  // ── OUTPUT (instruction language) ──
  const outputFormat = isZhInstruction
    ? `\n[输出格式]\n格式："[N] 译文" — 每行一条。纯文本，无 markdown，无解释。\n⛔ ↵ 是字面字符标记，不是换行指令 — 输出字符 "↵"，不要转为真实换行。\n→ 开始翻译：`
    : `\n[OUTPUT]\nFormat: "[N] translated text" — one line per item. Plain text only.\n⛔ The ↵ symbol is a LITERAL CHARACTER, NOT a line break — output it as the characters "↵".\nDo not wrap translations in quotation marks unless the source text itself is quoted.\n→ Output translations now:`

  // ── Assembly: IDENTITY → QUALITY_STANDARD → PRINCIPLES → MISSION → STYLE → FEWSHOT → LANG_RULES → CONTEXT → GLOSSARY → OUTPUT ──
  return `${role}\n\n${qualityStandard}\n\n${principles}\n\n[MISSION·${targetLang}]\n${mission}${styleCard}${fewShotBlock}${langBlock_str}${contextHint}${glossaryBlock}${outputFormat}`
}

// ============================================================
// v8.2: 统一技术术语豁免列表（全球统一的英文缩写，不应计入"英文残留"）
// 合并原 TECH_TERM_EXEMPT（extractNonTargetWords）和 TECH_ABBREVS（isUntranslatable）
// ============================================================
const TECH_TERM_EXEMPT = new Set([
  // 存储行业通用
  'ssd', 'nvme', 'pcie', 'dram', 'nand', 'slc', 'tlc', 'qlc', 'mlc',
  'iops', 'mb', 'gb', 'tb', 'kb', 'mbps', 'gbps', 'mhz', 'ghz',
  'gen', 'nm', 'uhd', 'os', 'cpu', 'gpu', 'rgb', 'pmic',
  'm.2', 'sata', 'cfexpress', 'cfe', 'sdxc', 'sdhc', 'microsd',
  'ddr', 'ddr2', 'ddr3', 'ddr4', 'ddr5', 'dimm', 'sodimm',
  'hdd', 'sd', 'lcd', 'led', 'oled', 'hdr', 'wifi', 'bt', 'nfc', 'gps',
  'ecc', 'xmp', 'expo', 'uhs', 'vpg',
  '2230', '2242', '2280',
  'mtbf', 'tbw', 'dw pd', 'ncq', 'trim', 'smart', 'raid', 'ahci',
  'sas', 'scsi', 'fc', 'san', 'nas', 'das', 'jbod', 'zns', 'mriov', 'sriov',
  'vmd', 'vroc', 'rst', 'oprom', 'uefi', 'bios', 'post', 'pxe', 'wol',
  'wowlan', 'wi-fi', 'wigig', 'thunderbolt', 'usb-c', 'usb4', 'pd', 'qc',
  'afc', 'pe', 'pps',
  // 产品/品牌相关
  'lexar', 'amd', 'intel', 'ryzen', 'microsoft', 'directstorage',
  'aipc', 'smart', 'bit', 'workflow',
  // 通用技术
  'pro', 'max', 'plus', 'mini', 'ultra', 'elite',
  'fw', 'hw', 'sw', 'usb', 'hdmi', 'dp', 'lan', 'wan',
])

// 向后兼容：TECH_ABBREVS 指向同一个集合
const TECH_ABBREVS = TECH_TERM_EXEMPT

/**
 * 提取译文中的非目标语言词（用于英文占比检测）
 * 修复 v8.1 的 bug：\b[a-zA-Z]+\b 在重音符号处断裂，导致西班牙语等语言误判
 *
 * @param text 待检测文本
 * @param glossaryLower 术语库小写集合（可选）
 * @returns 非目标语言词数组（已排除术语库和技术术语）
 */
function extractNonTargetWords(text: string, glossaryLower?: Set<string> | null): string[] {
  // 按空白和标点分词（不在重音符号处断裂）
  const allTokens = text.split(/[\s,.;:!?()\[\]{}\-\/\\]+/).filter(w => w.length >= 2)

  // 只匹配纯 ASCII 词（不含重音符号）
  const asciiWords = allTokens.filter(w => /^[a-zA-Z]+$/.test(w))

  // 排除术语库和技术术语
  return asciiWords.filter(w => {
    const lower = w.toLowerCase()
    if (glossaryLower?.has(lower)) return false
    if (TECH_TERM_EXEMPT.has(lower)) return false
    return true
  })
}

// ═══════════════════════════════════════════════════════════════
// translateBatch — 翻译主函数（翻译 LLM 入口）
// ═══════════════════════════════════════════════════════════════
// ── 职责边界 ──
// 【做什么】将一批源文翻译为目标语言。含预处理→术语遮蔽→LLM调用→后处理11项兜底。
// 【不做什么】不做校对（校对由 proofreadBatch 独立完成）。
//            不直接操作 UI（通过 messages 层收发数据）。
//            不处理®符号渲染（main.ts 负责字体替换）。
//
// ── 数据流 ──
//   texts → 预处理 → 实体遮蔽 → 术语遮蔽 → CJK空格保护 → ™保护
//   → buildSystemPrompt → LLM调用 → unmask还原
//   → 后处理11项（restoreTrademarkSymbols/restoreStorageUnitFormatting/
//      enforceGlossaryTerms/capitalizeFirstLetter/detectBrandInjection/
//      validateNumbers/detectUntranslatedText等）
//   → 漏翻检测 → forceTranslate重试（最多1轮）
//
// ── 注：参数详情见函数签名下方 JSDoc ──
// ═══════════════════════════════════════════════════════════════
export async function translateBatch(
  texts: string[],
  targetLang: string,
  glossaryMap: Map<string, string>,
  config: LLMConfig,
  sourceLang?: string,
  pageName?: string,
  fileName?: string,
  crossBatchTerms?: string[],
  taskGlossaryHint?: string,
  normalizedGlossaryMap?: Map<string, string>,
  _isRetry = false,
  forceTranslate = false,
): Promise<string[]> {
  const detectedSource = sourceLang || detectSourceLanguage(texts)
  const isEnSource = detectedSource === 'en'
  // 指令语言选择：只由目标语言决定，不受源语言影响
  // CJK目标（zh-CN/zh-TW/ja/ko）→ 中文指令（与目标语言共享字符系统 + 语法接近，LLM 对 CJK 语言指令理解更稳定）
  // 其余目标 → 英文指令（通用拉丁脚本，不会干扰西里尔/阿拉伯/泰文等输出）
  const useEnInstruction = !isCJKTarget(targetLang)

  // 语言名称按指令语言适配，避免英文句子里出现"法语"、中文句子里出现"French"
  const targetDisplayName = getLangDisplayName(targetLang, useEnInstruction)

  const { texts: cleanTexts, tags: htmlTags } = protectHtmlTags(texts)

  // 源文本预标准化（Unicode NFC + 全角→半角 + 零宽字符移除 + 兼容字符规范化）
  const normalizedTexts = normalizeTextForLLM(cleanTexts)

  // 术语预处理：检查是否有完全匹配的术语条目，直接替换
  // 这样LLM收到的都是需要翻译的条目，减少漏翻风险
  // 优化：构建查找表 O(n) 替代嵌套循环 O(n*m)
  const glossaryMatchedIndices = new Set<number>()
  const glossaryLookup = new Map<string, string>()
  for (const [key, value] of glossaryMap.entries()) {
    glossaryLookup.set(key.toLowerCase().replace(/[®™©]/g, '').trim(), value)
  }
  const preprocessedTexts = normalizedTexts.map((text, i) => {
    const lookupKey = text.toLowerCase().replace(/[®™©]/g, '').trim()
    const matchedValue = glossaryLookup.get(lookupKey)
    if (matchedValue) {
      glossaryMatchedIndices.add(i)
      // v7.5.3: 保留原文中所有商标符号位置，不限于末尾
      // 提取原文中所有 (词, 商标符号) 对，应用到术语库目标值
      let result = matchedValue
      const allSymbols = [...text.matchAll(/([^\s®™©]+)\s*([®™©]+)/g)]
      for (const m of allSymbols) {
        const word = m[1].replace(/[®™©]/g, '')
        const symbol = m[2]
        if (word && !result.includes(symbol)) {
          const wordRegex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          const wordMatch = wordRegex.exec(result)
          if (wordMatch) {
            const pos = wordMatch.index + wordMatch[0].length
            result = result.slice(0, pos) + symbol + result.slice(pos)
          }
        }
      }
      return result
    }
    return text
  })

  // ⚠️ 遮蔽顺序（v9.2 修正）：术语遮蔽必须先于实体遮蔽！
  // 术语优先级最高（用户术语库是最高事实源），先占位后实体正则不会再触碰已遮蔽区域。
  // 若顺序反转（实体在前），"Lexar Recovery Tool" 等术语可能被实体正则误判为产品名/型号，
  // 抢先替换为 __PRD_N__/__TRM_N__，导致术语遮蔽匹配不到、术语库失效（如 ja 译文漏掉术语库对应译法）。
  //
  // v8.2: 术语遮蔽 — 用 __GLOSSARY_N__ 占位符替换术语库中的英文术语
  // LLM 只看到占位符，消除"保留偏置"。译后 unmaskGlossaryTerms 还原为目标语。
  // v8.2: 统一占位符格式为 __GLOSSARY_N__，与 __PRD_N__、__TRM_N__ 一致，提高 LLM 保留率
  const { texts: glossaryMaskedTexts, termMap } = maskGlossaryTerms(preprocessedTexts, glossaryMap)

  // ⚠️ 实体遮蔽必须在 CJK 空格保护之前执行！
  // 仅遮蔽正则匹配的实体（产品型号/URL/Email/测量值），不遮蔽术语（术语已在上一步遮蔽）。
  const { texts: maskedTexts, entityMap } = maskEntities(glossaryMaskedTexts)

  // CJK 空格保护：直接删除 CJK 主导文本中的空格，防止 LLM 误判为条目分隔符
  const spaceProtectedTexts = protectCjkSpaces(maskedTexts)

  // ™®©符号保护：翻译前移除源文中的商标符号，防止 LLM 乱加符号到其他位置
  // restoreTrademarkSymbols 会在翻译后用原始源文（texts）把符号加回来
  const tmStrippedTexts = spaceProtectedTexts.map(t => t.replace(/[™®©]/g, ''))

  // 产品线检测（提前到术语过滤之前）
  const productLine = getEffectiveProductLine(config, texts, pageName, fileName)

  // 自动风格：用户手动指定优先，否则根据产品线自动选择
  let effectiveStyle = config.translationStyle
  if (!effectiveStyle && productLine) {
    effectiveStyle = PRODUCT_LINE_STYLE_MAP[productLine] || 'standard'
  }

  // 术语注入：优先使用任务级预计算提示词（跨批次 system prompt 一致 → API 缓存命中）
  // 无预计算时回退到逐批次术语过滤（兼容旧调用路径）
  let glossaryHint: string
  if (taskGlossaryHint !== undefined) {
    glossaryHint = taskGlossaryHint
  } else {
    let glossaryObj: Record<string, string> = {}
    for (const [k, v] of glossaryMap.entries()) { glossaryObj[k] = v }
    glossaryObj = filterGlossaryByScene(glossaryObj, config.scenePreset)
    // 注入精简术语表（最多 20 条），让 LLM 直接看到术语对照表
    const filtered = filterRelevantGlossary(glossaryObj, texts, 20)
    glossaryHint = filtered.glossaryHint

    // 跨批次术语注入：将其他批次中也会出现的术语及其标准译法提前注入本批次
    // 仅在逐批次模式下执行——任务级预计算已包含所有跨批次术语
    if (crossBatchTerms && crossBatchTerms.length > 0) {
      const extraLines: string[] = []
      for (const term of crossBatchTerms) {
        const termTarget = glossaryMap.get(term) || glossaryObj[term]
        if (termTarget && !glossaryObj[term]) {
          extraLines.push(`"${term}" → "${termTarget}"`)
        }
      }
      if (extraLines.length > 0) {
        const label = isEnSource
          ? '\n[Cross-batch terms — also use these standardized translations]:'
          : '\n【跨批次术语 — 以下术语译文也需统一使用】：'
        glossaryHint += label + '\n' + extraLines.join('\n')
      }
    }
  }

  // 使用 [N] 格式包裹每条文本，防止 LLM 将文本内部空格误判为条目分隔符
  // 含空格的文本加引号包裹，LLM 识别为单个实体
  // v7.1: 逐条标注 (源语言→目标语言)，解决批次内混合语种导致漏翻的问题
  const quotedIndices = new Set<number>()
  const textList = tmStrippedTexts.map((t, i) => {
    const srcLang = detectSingleTextLanguage(t)
    // 行首 * 替换为 ※，避免 LLM 将其解析为 markdown 列表标记导致漏翻
    const escaped = t.replace(/^\*\s*/, '※ ')
    if (/\s/.test(escaped)) {
      quotedIndices.add(i)
      return `[${i + 1}] (${srcLang}→${targetLang}) "${escaped}"`
    }
    return `[${i + 1}] (${srcLang}→${targetLang}) ${escaped}`
  }).join('\n')

  // v8.0: 语言专属提示词（仅 品类词 + rules，tone/style/compliance/scene 由 getStyleCard 统一注入）
  const langBlock = renderLangForTranslate(targetLang, productLine)

  // v8.0: 统一风格卡片（替代分散的 productTone + styleGuide + sceneConstraints）
  const styleCard = getStyleCard(targetLang, productLine, effectiveStyle || 'standard', config.scenePreset)

  // v8.0: 目标语言 Few-Shot 示例（按场景+风格动态选择类型）
  // v8.6: 使用实际检测到的源语言，而非硬编码 'en'
  const fewShot = getFewShotExamples(detectedSource, targetLang, 2, config.scenePreset, effectiveStyle)
  const fewShotBlock = fewShot ? `\n[EXAMPLES]\n${fewShot}` : ''

  // System Prompt: IDENTITY → CORE_PRINCIPLES → MISSION → STYLE → FEWSHOT → LANG_RULES → GLOSSARY → OUTPUT
  let systemPrompt = buildSystemPrompt({ targetLang, langBlock, styleCard, fewShotBlock, glossaryHint })

  // v8.0: 精简重试指令（去掉咆哮体和矛盾策略）
  if (forceTranslate) {
    const forceRule = `\n\n[RETRY]
These items were returned unchanged — translate them now:
${texts.map((t, i) => `${i + 1}. "${t.slice(0, 100)}"`).join('\n')}

- If the text has verbs, adjectives, or descriptive meaning → translate it fully
- If it is truly only a product code → add the category word in ${targetDisplayName}
- When in doubt → translate. Better to translate than to leave English.`
    systemPrompt += forceRule
  }

  const temperature = 0.2

  const res = await fetchWithRetry(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: textList },
      ],
      temperature,
    }),
  })

  if (!res.ok) {
    throw new Error(`API 请求失败 (${res.status}): ${res.text.slice(0, 200)}`)
  }

  const data = res.json as Record<string, unknown>
  const content: string = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || ''

  let result: string[] = []

  // 尝试 JSON 解析（优先，模型可能以 JSON 格式返回）
  const jsonMatch = content.match(/\{[\s\S]*"translations"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { translations?: Array<{ i?: number; text?: string }> }
      if (parsed.translations && Array.isArray(parsed.translations)) {
        for (const entry of parsed.translations) {
          if (entry.text) result.push(entry.text.trim())
        }
      }
    } catch { /* fall through to line parsing */ }
  }

  // 后备：逐行解析 "[N] 译文" 或 "N. 译文" 格式
  // 支持多行译文：LLM 可能输出真正的换行而非 ↵ 标记，导致单条译文跨多行
  if (result.length === 0) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // 支持 [N] 和 N. 两种格式
      let match = line.match(/^\s*\[(\d+)\]\s*(.*)/)
      if (!match) match = line.match(/^\s*(\d+)\.\s*(.*)/)
      if (match) {
        let translation = match[2].trim()
        // 收集后续行直到遇到下一个 [N] 或 N. 标记
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1]
          if (/^\s*\[\d+\]/.test(nextLine) || /^\s*\d+\./.test(nextLine)) break
          const continuation = nextLine.trim()
          if (continuation) {
            translation += '\n' + continuation
          }
          i++
        }
        result.push(translation)
      }
    }
  }

  // 最终后备：取非空行
  if (result.length === 0) {
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('{')) {
        result.push(trimmed)
      }
    }
  }

  while (result.length < texts.length) result.push('')
  result = result.slice(0, texts.length)

  // v3：含空格源文本用 "[N] \"text\"" 包裹发送，LLM 可能将引号一同输出。
  // v8.8: 增加语言特有引号回显剥离，带源文对照避免误剥源文本来的引号。
  // 仅剥高回显率+低源文风险的引号对（„" «» “” 「」 『』），ASCII 引号由下方 v3 逻辑处理。
  const ECHO_QUOTE_PAIRS: Record<string, string> = {
    '„': '"',   // 德语/波兰语/荷兰语/捷克语等
    '«': '»',   // 法语/俄语/瑞士德语/西班牙语（本土）
    '“': '”',   // 中文 curly quotes
    '「': '」', // 日语/繁体中文/韩语
    '『': '』', // 日语/繁体中文（书名/二层引用）
  }
  const stripEchoQuotes = (source: string, translation: string): string => {
    if (translation.length < 2) return translation
    const open = translation[0]
    const close = ECHO_QUOTE_PAIRS[open]
    if (!close || !translation.endsWith(close)) return translation
    // 源文首尾本来就是这个引号对 → 不是回显 → 保留
    if (source.startsWith(open) && source.endsWith(close)) return translation
    // 内部还有同种开引号 → 可能是嵌套结构 → 保守保留
    const inner = translation.slice(1, -1)
    if (inner.includes(open)) return translation
    return inner
  }

  if (quotedIndices.size > 0) {
    result = result.map((t, i) => {
      if (!quotedIndices.has(i)) return t
      // v3: 仅当首尾是配对 ASCII 双引号时才剥离（避免剥离译文本身包含的引号）
      if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
        const inner = t.slice(1, -1)
        // 防止过度剥离：如果内部还有引号（嵌套），保留原样
        if (!inner.includes('"')) t = inner
      }
      // v8.8: 再剥语言特有回显引号（带源文对照）
      return stripEchoQuotes(texts[i], t)
    })
  }

  // 还原实体占位符（必须在 restoreHtmlTags 之前）
  if (entityMap.size > 0) {
    // v7.5.6 诊断：追踪 __PRD_N__ 占位符还原失败
    const prdBefore = result.filter(t => /__[A-Z]+_\d+__/.test(t)).length
    debugWarn(`[translateBatch] unmaskEntities: entityMap.size=${entityMap.size}, result中__XXX_N__数量=${prdBefore}`,
      prdBefore > 0 ? [...entityMap.entries()].slice(0, 10).map(([k, v]) => `${k}→${v}`) : [])
    result = unmaskEntities(result, entityMap)
    const prdAfter = result.filter(t => /__[A-Z]+_\d+__/.test(t)).length
    if (prdAfter > 0) {
      debugWarn(`[translateBatch] ⛔ unmaskEntities后仍有${prdAfter}条__XXX_N__未还原!`,
        result.map((t, i) => /__[A-Z]+_\d+__/.test(t) ? `[${i}] ${t.slice(0, 80)}` : null).filter(Boolean))
    }
  }

  // v8.2: 还原术语占位符 __GLOSSARY_N__ → 目标语译文（译前 maskGlossaryTerms 的逆操作）
  // 必须在 enforceGlossaryTerms 之前执行，确保 LLM 输出的占位符被正确替换
  if (termMap.size > 0) {
    const { texts: unmaskedGlossary, missingIndices } = unmaskGlossaryTerms(result, termMap)
    result = unmaskedGlossary
    if (missingIndices.size > 0) {
      debugWarn(`[translateBatch] ${missingIndices.size} 条术语占位符未找到，兜底 enforceGlossaryTerms`,
        [...missingIndices].map(j => ({ idx: j, text: result[j]?.slice(0, 80) })))
    }
  }

  // 恢复 HTML 标签
  if (htmlTags.size > 0) {
    result = restoreHtmlTags(result, htmlTags)
  }

  // 语言特定后处理
  result = result.map(t => postProcessTranslation(t, targetLang))

  // 收集被检测函数回退到源文的索引（避免误判为"漏翻"）
  const revertedIndices = new Set<number>()

  // 品牌注入检测：在术语库校准之前检测 LLM 是否添加了源文中不存在的品牌名/规格
  // 必须在校准之前运行，避免术语库正确应用的跨语言品牌名（如 雷克沙）被误判
  const injectionResult = detectBrandInjection(texts, result, glossaryMap)
  if (injectionResult.injectedIndices.size > 0) {
    debugWarn(
      `[translateBatch] 检测到 ${injectionResult.injectedIndices.size} 条品牌/规格注入，已回退到源文`,
      [...injectionResult.injectedIndices].map(j => ({
        source: texts[j].slice(0, 50),
        injected: result[j].slice(0, 80),
        fallback: injectionResult.texts[j].slice(0, 50),
      })),
    )
    result = injectionResult.texts
    for (const idx of injectionResult.injectedIndices) revertedIndices.add(idx)
  }

  // 术语库强制校准（翻译后直接替换，零 token 开销）
  // 跳过被回退到源文的条目（避免在源文上做术语校准）
  result = enforceGlossaryTerms(texts, result, glossaryMap, revertedIndices, normalizedGlossaryMap)

  // 商标符号还原（兜底：原文有则译文必有，原文无则不添加）
  result = restoreTrademarkSymbols(texts, result)

  // 数字校验：检测译文中数字是否与源文一致（防止 LLM 幻觉，如 4TB→8TB）
  // v7.3: validateNumbers 只警告不回退，不加入 revertedIndices（避免阻止重试）
  const numberValidation = validateNumbers(texts, result)
  if (numberValidation.mismatchedIndices.size > 0) {
    debugWarn(
      `[translateBatch] 检测到 ${numberValidation.mismatchedIndices.size} 条数字格式差异（保留译文，不回退）`,
      [...numberValidation.mismatchedIndices].map(j => ({
        idx: j,
        source: texts[j].slice(0, 50),
        translated: result[j].slice(0, 50),
      })),
    )
    // ⛔ 不加入 revertedIndices — validateNumbers 不回退，只是警告
    // 如果加入 revertedIndices 会导致这些条目被排除在重试之外，漏翻无法修复
  }

  // 存储单位格式还原：原文数字和单位连写时，恢复译文的连写格式
  // 修复 AI 常见错误：900MB/s → 900 MB/s 还原为 900MB/s
  result = restoreStorageUnitFormatting(texts, result)

  // 首字母大写
  result = result.map(t => capitalizeFirstLetter(t))

  // 译文扩展检测：检测 LLM 是否异常扩展了译文（最后一道防线）
  const expansionResult = detectTranslationExpansion(texts, result, targetLang)
  if (expansionResult.expandedIndices.size > 0) {
    debugWarn(
      `[translateBatch] 检测到 ${expansionResult.expandedIndices.size} 条异常扩展译文，已自动截断`,
      [...expansionResult.expandedIndices].map(j => ({
        source: texts[j].slice(0, 50),
        original: result[j].slice(0, 80),
        fixed: expansionResult.texts[j].slice(0, 80),
      })),
    )
    result = expansionResult.texts
  }

  // v7.5.5: 批次内重复译文检测 — 仅警告，不回退源文！
  // 回退源文 = 丢弃LLM翻译成果 = 漏翻事故
  // 相同译文可能是术语库校准后相似文本的正常收敛，也可能是真正交叉污染
  // 歧义项交由校对 CHECK 3 兜底（校对能发现张冠李戴并修正）
  const dupGroups = new Map<string, number[]>()
  for (let i = 0; i < result.length; i++) {
    if (result[i].length < MIN_DUP_LEN) continue
    const key = result[i]
    if (!dupGroups.has(key)) dupGroups.set(key, [])
    dupGroups.get(key)!.push(i)
  }
  for (const [translation, indices] of dupGroups) {
    if (indices.length > 1) {
      const uniqueSources = new Set(indices.map(j => texts[j]))
      if (uniqueSources.size > 1) {
        debugWarn(
          `[translateBatch] ⚠️ ${indices.length}条不同源文→相同译文（保留译文，交由校对审查）`,
          indices.map(j => ({ idx: j, src: texts[j].slice(0, 50), tgt: translation.slice(0, 50) })),
        )
        // ⛔ 不再回退源文！
      }
    }
  }

  // 异常检测 + 统一重试：截断 + 漏翻合并为一次重试
  // 优化：从最多4次额外API调用降为1次
  if (!_isRetry) {
    // 首次检测：收集所有异常条目
    // 排除品牌注入/扩展检测回退的索引（这些是LLM输出了错误内容，重试无意义）
    // v7.3: validateNumbers 不再回退，revertedIndices 仅含品牌注入+扩展检测
    let truncatedIndices = detectTruncatedTexts(texts, result)
    let untranslatedIndices = detectUntranslatedText(texts, result, targetLang, glossaryMap, detectedSource)
    for (const idx of revertedIndices) {
      truncatedIndices.delete(idx)
      untranslatedIndices.delete(idx)
    }
    const hasAnomaly = truncatedIndices.size > 0 || untranslatedIndices.size > 0

    if (hasAnomaly) {
      // 合并异常条目（去重）
      const anomalyIndices = new Set<number>()
      for (const idx of truncatedIndices) anomalyIndices.add(idx)
      for (const idx of untranslatedIndices) anomalyIndices.add(idx)

      debugWarn(
        `[translateBatch] 检测到 ${anomalyIndices.size} 条异常（截断${truncatedIndices.size}条，漏翻${untranslatedIndices.size}条），执行统一重试`,
        [...anomalyIndices].map(j => ({
          idx: j,
          type: truncatedIndices.has(j) ? '截断' : '漏翻',
          source: texts[j].slice(0, 80),
        })),
      )

      // 一次API调用处理所有异常条目
      // 修复根因#1：不再在源文中拼指令前缀，而是通过 forceTranslate 参数在 system prompt 中强调
      const retryTexts = [...anomalyIndices].map(j => texts[j])

      const retryResults = await translateBatch(
        retryTexts, targetLang, glossaryMap, config,
        sourceLang, pageName, fileName,
        crossBatchTerms, taskGlossaryHint, normalizedGlossaryMap, true,  // _isRetry = true
        true,  // forceTranslate = true，在 system prompt 中追加强制翻译规则
      )

      // 更新结果
      let k = 0
      for (const j of anomalyIndices) {
        result[j] = retryResults[k] || ''
        // 清理可能残留的强制翻译指令前缀（防止指令污染最终译文）
        // 匹配所有实际使用的指令前缀：[MANDATORY]、[MANDATORY TRANSLATION]、[PARTIAL TRANSLATION DETECTED]、[TRANSLATE REQUIRED]
        result[j] = result[j].replace(/\[(MANDATORY|MANDATORY TRANSLATION|PARTIAL TRANSLATION DETECTED|TRANSLATE REQUIRED)\][\s\S]*?\n\n/g, '').trim()
        k++
      }

      // 重试后再次检测，标记仍失败的条目
      // 优化：并行化重试后检测（与首次检测一致）
      const retriedTruncated = detectTruncatedTexts(texts, result)
      const retriedUntranslated = detectUntranslatedText(texts, result, targetLang, glossaryMap, detectedSource)

      if (retriedTruncated.size > 0) {
        debugWarn(
          `[translateBatch] ${retriedTruncated.size} 条译文重试后仍截断，标记为翻译失败`,
          [...retriedTruncated].map(j => ({ idx: j, source: texts[j].slice(0, 80) })),
        )
        for (const j of retriedTruncated) {
          result[j] = ''
        }
      }

      if (retriedUntranslated.size > 0) {
        debugWarn(
          `[translateBatch] ${retriedUntranslated.size} 条漏翻重试后仍未翻译，执行激进逐条翻译`,
          [...retriedUntranslated].map(j => ({ idx: j, text: texts[j].slice(0, 80) })),
        )

        // ═══════════════════════════════════════════════════════════
        // v7.4 三层兜底：LLM 重试失败后，不再回退到英文源文
        // Layer 1: 激进逐条翻译 — 极简 prompt，单条发送，逼 LLM 翻
        // Layer 2: 术语库组合 — enforceGlossaryTerms 替换已知术语
        // Layer 3: 标记失败 — ⚠️[UNTRANSLATED] 比显示英文源文更明确
        // ═══════════════════════════════════════════════════════════

        // Layer 1: 激进逐条翻译
        const aggressiveTargetDisplayName = getLangDisplayName(targetLang, !isCJKTarget(targetLang))
        // v8.5: 同语系变体（CN→TW、PT→PT-BR）增加变体转换提示
        // v9.3: 并集判定——批次级（detectedSource，治 pt→pt-BR 死代码：逐条检测对拉丁文本恒返回 'en'）
        // ∪ 逐条级（保 zh 等现有行为）。中文 prompt 的简繁措辞保持原样（能工作的不碰）。
        const perTextSrcLang = detectSingleTextLanguage(texts[0] || '')
        const isSameScript = isSameScriptLanguagePair(perTextSrcLang, targetLang)
          || isSameScriptLanguagePair(detectedSource, targetLang)
        const aggressiveSystemPrompt = isCJKTarget(targetLang)
          ? `你是翻译专家。将以下文本翻译成${aggressiveTargetDisplayName}。
保留专有名词、产品型号和数字 — 其他所有内容必须翻译。
关键：Title Case、全大写或带项目符号的文本不是跳过翻译的理由 — 必须翻译。
${isSameScript ? `重要：源文是简体中文，译文必须转换为繁体中文。即使某些字在简繁中写法相同，也必须确认并完成转换。不要只加引号或做最小改动。` : ''}
禁止返回源文原文。只输出译文，不要解释。`
          : `You are a translator. Translate the given text to ${aggressiveTargetDisplayName}.
Keep proper nouns, product codes, and numbers in their original form — translate EVERYTHING else.
CRITICAL: Title Case, ALL CAPS, or text with bullet points is NOT an excuse to skip — translate it.
${isSameScript ? `IMPORTANT: The source text is in a different variant of the language. You MUST convert it to the target variant, not just copy it. However, if a sentence is written identically in both variants, keeping it unchanged is CORRECT — do not change it just to look different.` : ''}
DO NOT return the source text unchanged. Output ONLY the translation, no explanations.`

        const stillUntranslatedAfterAggressive = new Set<number>()

        // v7.5.5: 预构建术语遮蔽函数 — 激进重试发送 masked 文本，消除 LLM "保留偏置"
        const maskForRetry = (text: string): { masked: string; termMap: Map<string, string> } => {
          const { texts: maskedTexts, termMap } = maskGlossaryTerms([text], glossaryMap)
          return { masked: maskedTexts[0] || text, termMap }
        }
        const unmaskForRetry = (text: string, termMap: Map<string, string>): string => {
          if (termMap.size === 0) return text
          const { texts: unmasked } = unmaskGlossaryTerms([text], termMap)
          return unmasked[0] || text
        }

        // v8.4: 激进重试上限保护 — 防止性能黑洞
        // 如果漏翻条目过多（>3条），只尝试前3条，剩余标记失败
        const MAX_AGGRESSIVE_RETRIES = 3
        const aggressiveRetryIndices = [...retriedUntranslated].slice(0, MAX_AGGRESSIVE_RETRIES)
        const skippedIndices = [...retriedUntranslated].slice(MAX_AGGRESSIVE_RETRIES)

        if (skippedIndices.length > 0) {
          debugWarn(
            `[translateBatch] 漏翻条目过多 (${retriedUntranslated.size}条)，只尝试前${MAX_AGGRESSIVE_RETRIES}条激进重试，剩余${skippedIndices.length}条标记失败`,
          )
          for (const j of skippedIndices) {
            stillUntranslatedAfterAggressive.add(j)
          }
        }

        for (const j of aggressiveRetryIndices) {
          const srcText = texts[j]
          if (!srcText) { stillUntranslatedAfterAggressive.add(j); continue }

          // v7.5.5: 遮蔽术语后再送 LLM，消除 "品牌名→保留英文" 偏见
          const { masked: maskedSrcText, termMap: retryTermMap } = maskForRetry(srcText)

          try {
            const agRes = await fetchWithRetry(config.apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                model: config.model,
                messages: [
                  { role: 'system', content: aggressiveSystemPrompt },
                  // v7.5.3: 强化用户消息 — 消除 LLM "产品名保留偏置"
                  { role: 'user', content: [
                    `[MANDATORY] Translate the following text to ${aggressiveTargetDisplayName}.`,
                    `This is marketing/descriptive content — do NOT skip any part or keep it in the source language.`,
                    ``,
                    `"${maskedSrcText}"`,
                  ].join('\n') },
                ],
                temperature: 0.3,
              }),
            })

            if (agRes.ok) {
              const agData = agRes.json as Record<string, unknown>
              const agContent: string = (agData.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || ''
              let agTranslated = agContent.trim()
                .replace(/^"+|"+$/g, '')           // 去掉首尾引号
                .replace(/^\[?\d+\]?\s*\.?\s*/, '') // 去掉 [N] 或 N. 前缀
                .trim()

              // v7.5.5: 还原术语占位符 → 目标语译文
              agTranslated = unmaskForRetry(agTranslated, retryTermMap)

              // v7.5.3: 验证激进翻译结果是否真正被翻译（防止只改标点/空格但实质仍是英文）
              // v9.3: 同语系变体对豁免"与源文相同=失败"——两变体写法相同的句子，原样保留是正确答案
              if (agTranslated && (agTranslated !== srcText || isSameScript)) {
                const agCheck = detectUntranslatedText([srcText], [agTranslated], targetLang, glossaryMap, detectedSource)
                if (agCheck.size === 0) {
                  result[j] = agTranslated
                  debugWarn(`[translateBatch] 激进翻译成功: "${srcText.slice(0, 50)}" → "${agTranslated.slice(0, 50)}"`)
                  continue
                }
                debugWarn(`[translateBatch] 激进翻译结果仍判定为漏翻: "${srcText.slice(0, 50)}" → "${agTranslated.slice(0, 50)}"`)
              }
            }
          } catch (e) {
            debugWarn(`[translateBatch] 激进翻译请求失败:`, e)
          }

          // ═══════════════════════════════════════════════════════════
          // v7.5.3: 激进单条失败后的子兜底 — 绝不能留英文
          // 子兜底 1: 逐句拆分翻译（长文本拆短 → 降低保留偏置）
          // 子兜底 2: 大小写归一化（Title Case → sentence case → 不再像产品名）
          // v7.5.5: 子兜底也使用 masked 文本，消除 LLM "品牌名→保留英文" 偏见
          // ═══════════════════════════════════════════════════════════
          let rescued = false

          // v7.5.5: 使用 masked 文本做子兜底，避免 LLM 看到品牌名
          const { masked: maskedForFallback, termMap: fallbackTermMap } = maskForRetry(srcText)

          // v7.5.6: 分段前先做大小写归一化，避免 Title Case / ALL CAPS 片段
          // LLM 抗拒翻译 Title Case 文本（误判为标题/产品名）
          // 归一化后 "BIT Running for 30 Minutes" → "bit running for 30 minutes" → LLM 愿意翻译
          const needsCaseNorm = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,}/.test(srcText)
            || (/\b[A-Z]{2,}\b/.test(srcText) && srcText.split(/\s+/).length >= 3)
          const textForSubFallback = needsCaseNorm
            ? maskedForFallback
                .replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase())
                .replace(/\b([A-Z])([a-z]+)\b/g, (_, a: string, b: string) => a.toLowerCase() + b)
            : maskedForFallback

          // 子兜底 1: 拆句翻译（多级回退：句号 → 逗号/分号 → 固定长度分段，按词边界）
          let sentences = textForSubFallback.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.trim().length > 3)
          // v7.5.4: 如果无句尾标点（如标题文本），尝试按逗号/分号/破折号拆分
          if (sentences.length <= 1) {
            sentences = textForSubFallback.split(/(?<=[,;—–-])\s+/).filter(s => s.trim().length > 3)
          }
          // v7.5.5: 如果仍然无法拆分且文本 > 60 字符，按 ~60 字符分段（词边界对齐）
          if (sentences.length <= 1 && textForSubFallback.length > 60) {
            const words = textForSubFallback.split(/\s+/)
            sentences = []
            let chunk = ''
            for (const w of words) {
              if (chunk && (chunk + ' ' + w).length > 60) {
                sentences.push(chunk.trim())
                chunk = w
              } else {
                chunk = chunk ? chunk + ' ' + w : w
              }
            }
            if (chunk.trim()) sentences.push(chunk.trim())
            sentences = sentences.filter(s => s.length > 3)
          }
          if (sentences.length > 1) {
            debugWarn(`[translateBatch] 激进翻译失败，尝试逐句拆分翻译 (${sentences.length}句, masked)`)
            const sentenceResults: string[] = []
            for (const sent of sentences) {
              try {
                const sRes = await fetchWithRetry(config.apiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
                  body: JSON.stringify({
                    model: config.model,
                    messages: [
                      { role: 'system', content: aggressiveSystemPrompt },
                      { role: 'user', content: `[MANDATORY] Translate this sentence to ${aggressiveTargetDisplayName}:\n\n"${sent.trim()}"` },
                    ],
                    temperature: 0.3,
                  }),
                })
                if (sRes.ok) {
                  const sData = sRes.json as Record<string, unknown>
                  const sContent: string = (sData.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || ''
                  const sTrans = sContent.trim().replace(/^"+|"+$/g, '').trim()
                  if (sTrans && sTrans !== sent.trim()) {
                    sentenceResults.push(sTrans)
                  } else {
                    sentenceResults.push(sent.trim())  // 这句没翻成，保留原文
                  }
                } else {
                  sentenceResults.push(sent.trim())
                }
              } catch {
                sentenceResults.push(sent.trim())
              }
            }
            // v7.5.5: 还原术语占位符后再检测
            const combined = unmaskForRetry(sentenceResults.join(' '), fallbackTermMap)
            const combinedCheck = detectUntranslatedText([srcText], [combined], targetLang, glossaryMap, detectedSource)
            if (combinedCheck.size === 0) {
              result[j] = combined
              debugWarn(`[translateBatch] 逐句拆分翻译成功: ${sentences.length}句 → "${combined.slice(0, 80)}"`)
              rescued = true
            }
          }

          // 子兜底 2: 大小写归一化（Title Case / ALL CAPS → sentence case）
          // v7.5.4: 扩展匹配 ALL CAPS 词（如 "BIT Running..." 中的 "BIT"）
          const isTitleCase = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,}/.test(srcText)
          const hasAllCapsWord = /\b[A-Z]{2,}\b/.test(srcText) && srcText.split(/\s+/).length >= 3
          if (!rescued && (isTitleCase || hasAllCapsWord)) {
            // v7.5.5: 对 masked 文本做大小写归一化（而非原始 srcText）
            const normalizedSrc = maskedForFallback.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase())
              .replace(/\b([A-Z])([a-z]+)\b/g, (_, a: string, b: string) => a.toLowerCase() + b)
            if (normalizedSrc !== maskedForFallback) {
              debugWarn(`[translateBatch] 尝试大小写归一化翻译: "${normalizedSrc.slice(0, 80)}"`)
              try {
                const ncRes = await fetchWithRetry(config.apiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
                  body: JSON.stringify({
                    model: config.model,
                    messages: [
                      { role: 'system', content: aggressiveSystemPrompt },
                      { role: 'user', content: `[MANDATORY] Translate to ${aggressiveTargetDisplayName}:\n\n"${normalizedSrc}"` },
                    ],
                    temperature: 0.3,
                  }),
                })
                if (ncRes.ok) {
                  const ncData = ncRes.json as Record<string, unknown>
                  const ncContent: string = (ncData.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || ''
                  let ncTrans = ncContent.trim().replace(/^"+|"+$/g, '').trim()
                  if (ncTrans) {
                    // v7.5.5: 还原术语占位符
                    ncTrans = unmaskForRetry(ncTrans, fallbackTermMap)
                    const ncCheck = detectUntranslatedText([srcText], [ncTrans], targetLang, glossaryMap, detectedSource)
                    if (ncCheck.size === 0) {
                      result[j] = ncTrans
                      debugWarn(`[translateBatch] 大小写归一化翻译成功: "${srcText.slice(0, 50)}" → "${ncTrans.slice(0, 50)}"`)
                      rescued = true
                    }
                  }
                }
              } catch { /* fall through */ }
            }
          }

          // v7.5.5: 子兜底后英文残留二次检测
          // 子兜底可能产生混合语言输出（部分翻译+部分保留英文），
          // detectUntranslatedText 的 60% 英文阈值可能放过 50/50 混合文本
          if (rescued && targetLang !== 'en') {
            const rescuedText = result[j]
            const rescuedWords = rescuedText.split(/\s+/).filter(w => w.length > 1)
            if (rescuedWords.length >= 3) {
              // 第一步：检测译文是否已有目标语言特征
              // 如果已有足够的变音符号/特征字符，说明确实翻译了，不拦截
              const hasTargetFeatures = (() => {
                if (targetLang === 'vi') {
                  // 越南语：计算含变音符号的词占比
                  const viDiacriticWords = rescuedWords.filter(w => /[ăâêôơưđÀÁẢÃẠàáảãạÂẤẦẨẪẬâấầẩẫậÊẾỀỄỆêếềễệÔỐỒỔỖỘôốồổỗộƠỚỜỞỠỢơớờởỡợƯỨỪỬỮưửữựĐđ]/.test(w))
                  return viDiacriticWords.length >= 2 || viDiacriticWords.length / rescuedWords.length > 0.2
                }
                // 其他非英语言：检查特征字符
                return /[^\x00-\x7F]/.test(rescuedText)
              })()
              // 已有目标语言特征 → 阈值 50%（有特征字符但仍可能大量英文残留）
              const engThreshold = hasTargetFeatures ? 0.50 : 0.35

              const exemptLower = new Set(['lexar', 'ssd', 'nvme', 'pcie', 'dram', 'nand', 'slc', 'tlc',
                'amd', 'intel', 'ryzen', 'microsoft', 'directstorage', 'gen', 'pro', 'max', 'plus'])
              for (const k of glossaryMap.keys()) {
                for (const w of k.split(/\s+/)) { if (w.length >= 2) exemptLower.add(w.toLowerCase()) }
              }
              const englishWordCount = rescuedWords.filter(w => {
                // 含非ASCII字符 → 是目标语言词（越南语变音符号、西里尔、泰文等），不算英文
                if (/[^\x00-\x7F]/.test(w)) return false
                const clean = w.replace(/[^a-zA-Z]/g, '')
                return /^[a-zA-Z]{2,}$/.test(clean) && !exemptLower.has(clean.toLowerCase())
              }).length
              const engRatio = englishWordCount / rescuedWords.length
              if (engRatio > engThreshold) {
                debugWarn(
                  `[translateBatch] 子兜底结果仍含 ${englishWordCount}/${rescuedWords.length} 英文词（${(engRatio*100).toFixed(0)}% > ${(engThreshold*100).toFixed(0)}%），回退到标记`,
                  { idx: j, text: rescuedText.slice(0, 80), hasTargetFeatures }
                )
                rescued = false
                stillUntranslatedAfterAggressive.add(j)
              }
            }
          }

          if (!rescued) {
            stillUntranslatedAfterAggressive.add(j)
          }
        }

        // Layer 2 + 3: 术语库组合兜底 + 标记失败
        if (stillUntranslatedAfterAggressive.size > 0) {
          debugWarn(
            `[translateBatch] ${stillUntranslatedAfterAggressive.size} 条激进翻译后仍漏翻，使用术语库组合兜底`,
            [...stillUntranslatedAfterAggressive].map(j => ({ idx: j, text: texts[j].slice(0, 80) })),
          )

          const fallbackSources = [...stillUntranslatedAfterAggressive].map(j => texts[j])
          const fallbackTranslations = [...stillUntranslatedAfterAggressive].map(j => result[j] || texts[j])
          let composedResults = enforceGlossaryTerms(
            fallbackSources,
            fallbackTranslations,
            glossaryMap,
            new Set(),
          )
          // v7.5.5: enforceGlossaryTerms 可能用无®的术语值覆盖，立即还原商标符号
          composedResults = restoreTrademarkSymbols(fallbackSources, composedResults)
          let k = 0
          for (const j of stillUntranslatedAfterAggressive) {
            const composed = composedResults[k] || ''
            k++
            if (composed && composed !== texts[j]) {
              result[j] = composed
              debugWarn(`[translateBatch] 术语库组合兜底: "${texts[j].slice(0, 50)}" → "${composed.slice(0, 50)}"`)
            } else {
              // Layer 3: 术语库也无法帮助，保留英文原文
              // v8.7: 不再标记 ⚠️[UNTRANSLATED]，避免用户看到错误标记
              // 保留原文，由校对 LLM 或人工最终判断是否为正确同形词
              result[j] = texts[j]
              debugWarn(
                `[translateBatch] 术语库兜底失败，保留原文: "${texts[j].slice(0, 50)}"`,
              )
            }
          }
        }
      }
    }
  }

  // v7.5.4: 最终商标符号兜底 — 确保管道中任何步骤都不会丢失 ®™©
  result = restoreTrademarkSymbols(texts, result)

  // v7.5.6: 最终实体占位符兜底 — 扫描并还原任何残留的 __XXX_N__
  // unmaskEntities 可能在中间步骤被意外覆盖，此处做最终清理
  const residualPrd = result.filter(t => /__[A-Z]+_\d+__/.test(t)).length
  if (residualPrd > 0) {
    debugWarn(`[translateBatch] ⛔ 最终兜底: ${residualPrd}条仍有__XXX_N__占位符，重新执行maskEntities→unmaskEntities`,
      result.map((t, i) => /__[A-Z]+_\d+__/.test(t) ? `[${i}] ${t.slice(0, 80)}` : null).filter(Boolean))
    // 用原始 texts 重新构建 entityMap（maskEntities 函数需要原始英文文本，texts 参数即是）
    const { entityMap: fallbackEntityMap } = maskEntities(texts)
    if (fallbackEntityMap.size > 0) {
      result = unmaskEntities(result, fallbackEntityMap)
      const afterFallback = result.filter(t => /__[A-Z]+_\d+__/.test(t)).length
      if (afterFallback > 0) {
        debugWarn(`[translateBatch] ⛔ 最终兜底后仍有${afterFallback}条未还原，可能不是来自当前批次的占位符`,
          result.map((t, i) => /__[A-Z]+_\d+__/.test(t) ? `[${i}] ${t.slice(0, 80)}` : null).filter(Boolean))
      } else {
        debugWarn(`[translateBatch] ✅ 最终兜底成功还原所有占位符`)
      }
    }
  }

  return result
}

interface ProofreadInput {
  sourceText: string
  translatedText: string
}

interface ProofreadResult {
  text: string
  reason: string
  /** 源文中应加入术语库固定译法的词汇（校对 LLM 标记的歧义词） */
  ambiguous: string[]
}

// ═══════════════════════════════════════════════════════════════
// proofreadBatch — AI 校对函数（校对 LLM 入口，独立于翻译）
// ═══════════════════════════════════════════════════════════════
// ── 职责边界 ──
// 【做什么】以独立 QA 视角审查翻译质量。检查完整性、语义准确性、漏翻、商标符号。
// 【不做什么】不重复翻译逻辑（翻译用 buildSystemPrompt，校对用 PROOFREAD_SYSTEM_PROMPT）。
//            不注入 IRON_RULES/CORE_PRINCIPLES（校对只看结果，不管翻译策略）。
//            不注入 tone/style/scene — 翻译已负责风格，校对聚焦正确性。
//            不做术语替换（代码 enforceGlossaryTerms 已在译后兜底）。
//
// ── 数据流 ──
//   ProofreadInput[] → 实体遮蔽(maskEntitiesForProofread) → CJK空格保护 → ™保护
//   → PROOFREAD_SYSTEM_PROMPT + glossaryHint(反补全指令) + renderLangForProofread
//   → LLM调用 → JSON解析 → unmaskEntities还原 → 逐条返回 ProofreadResult
//
// ── 校对闭环 ──
//   翻译LLM → 代码后处理11项 → AI校对(CHECK 1-4) → 代码兜底 → 用户
//   ⛔ 校对是最后一道防线：翻译做了的事校对不重复，只补代码做不了的判断
//
// ── 注：参数详情见函数签名下方 JSDoc ──
// ═══════════════════════════════════════════════════════════════
export async function proofreadBatch(
  items: ProofreadInput[],
  targetLang: string,
  glossaryMap: Map<string, string>,
  config: LLMConfig,
  pageName?: string,
  fileName?: string,
  taskGlossaryHint?: string,
): Promise<ProofreadResult[]> {
  const sourceTexts = items.map(it => it.sourceText)
  // v9.3: 批次级源语言判定（校对后漏翻检测用，治 pt→pt-BR 拉丁源文恒判 'en' 的死代码）
  const detectedProofreadSource = detectSourceLanguage(sourceTexts)
  // 指令语言选择：只由目标语言决定
  // CJK目标→中文指令，其余→英文指令
  const useEnInstruction = !isCJKTarget(targetLang)

  // 校对也做产品线检测，补全闭环
  const productLine = getEffectiveProductLine(config, sourceTexts, pageName, fileName)

  // 术语注入：优先使用任务级预计算提示词（跨批次 system prompt 一致 → API 缓存命中）
  let glossaryHint: string
  if (taskGlossaryHint !== undefined) {
    glossaryHint = taskGlossaryHint
  } else {
    let glossaryObjProof: Record<string, string> = {}
    for (const [k, v] of glossaryMap.entries()) { glossaryObjProof[k] = v }
    glossaryObjProof = filterGlossaryByScene(glossaryObjProof, config.scenePreset)
    const result = filterRelevantGlossary(glossaryObjProof, sourceTexts, 100)
    glossaryHint = result.glossaryHint
  }

  // 源文本预标准化（\n → ↵，供 LLM 识别换行位置）
  const normalizedSourceTexts = normalizeTextForLLM(sourceTexts)
  // 译文中的实际 \n 也统一转为 ↵，确保源/译格式一致，避免校对模型误删换行
  const normalizedTranslatedTexts = items.map(it => it.translatedText.replace(/[\n\r]+/g, ' ↵ '))

  // ⚠️ 实体遮蔽：校对前仅遮蔽正则匹配的实体（产品型号/URL/Email/测量值）。
  // 不再遮蔽术语——双向术语遮蔽会使校对 LLM 对翻译阶段的截断错误失明
  // （两边占位符对称 → 校对确认错误结果）。术语保护由 glossary hint + enforceGlossaryTerms 兜底。
  const { maskedSources, maskedTranslations, entityMap: proofreadEntityMap } = maskEntitiesForProofread(normalizedSourceTexts, normalizedTranslatedTexts)
  // 校对时对源文本做 CJK 空格保护
  const proofreadSpaceProtected = protectCjkSpaces(maskedSources)

  // ™®©符号保护：校对前移除源文中的商标符号，防止校对 LLM 乱加符号
  // restoreTrademarkSymbols 会在校对后用原始源文把符号加回来
  const proofTmStrippedSources = proofreadSpaceProtected.map(t => t.replace(/[™®©]/g, ''))

  const transLabel = useEnInstruction ? 'Trans' : '译'
  // v7.1: 逐条标注源语言，校对 LLM 需检查每条是否确实翻译到了目标语言
  const textList = items.map((it, i) => {
    const srcLang = detectSingleTextLanguage(it.sourceText)
    // 行首 * 替换为 ※，避免 LLM 将其解析为 markdown 列表标记
    const escapedSource = proofTmStrippedSources[i].replace(/^\*\s*/, '※ ')
    return `[${i + 1}] (${srcLang}→${targetLang}) ${escapedSource}\n${transLabel}：${maskedTranslations[i]}`
  }).join('\n\n')

  // ⛔ 校对环节术语反补全闭环：术语 hint 的 label 不含反补全指令，
  // 需在注入前追加以防校对模型参照术语格式"纠正"译文（添加原文没有的品牌/规格）
  if (glossaryHint) {
    glossaryHint += useEnInstruction
      ? '\n⛔ Above glossary: exact match only. Do NOT "correct" translations by completing partial product names (e.g., do not change "PLAY X PCIe 4.0 SSD" to "Lexar PLAY X M.2 PCIe 4.0 NVMe SSD" based on glossary patterns).'
      : '\n⛔ 以上术语仅当完全一致时才套用。严禁参照术语格式"纠正"译文，将部分产品名补全为全称。'
  }

  // ═══════════════════════════════════════════════════════════
  // 校对 system prompt 组装
  // ═══════════════════════════════════════════════════════════
  // ROLE+CHECKLIST (PROOFREAD_SYSTEM_PROMPT) — 独立 QA 视角
  // GLOSSARY (glossaryHint)                 — 术语参照
  // LANG_SPECIFIC (renderLangForProofread)  — 品类词+rules+quality+compliance
  //
  // ⛔ 校对用独立的 PROOFREAD_SYSTEM_PROMPT（CORE DIRECTIVE + CHECK 1-4），不共享翻译规则
  // ⛔ 不注入 scene/tone/style — 翻译已负责风格，校对不重复
  // ═══════════════════════════════════════════════════════════
  const langBlock = renderLangForProofread(targetLang, productLine)
  // v8.1: CJK 目标使用中文校对指令（与翻译指令语言策略一致）
  const proofreadPrompt = isCJKTarget(targetLang) ? PROOFREAD_SYSTEM_PROMPT_ZH : PROOFREAD_SYSTEM_PROMPT

  // v8.6: 校对prompt增加目标语言使命宣言，激活目标语义空间
  const mission = IDENTITY_MISSION[targetLang] || IDENTITY_MISSION['en'] || ''
  const missionBlock = mission ? `\n[MISSION·${targetLang}]\n${mission}\n` : ''

  const systemPrompt = missionBlock + proofreadPrompt + glossaryHint + langBlock

  const apiKey = config.proofreadApiKey || config.apiKey
  const apiUrl = config.proofreadApiUrl || config.apiUrl
  const model = config.proofreadModel || config.model

  const res = await fetchWithRetry(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: textList },
      ],
      temperature: 0.1,
    }),
  })

  if (!res.ok) {
    throw new Error(`校对 API 请求失败 (${res.status}): ${res.text.slice(0, 200)}`)
  }

  const data = res.json as Record<string, unknown>
  const content: string = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || ''

  const results: ProofreadResult[] = items.map(() => ({ text: '', reason: '', ambiguous: [] }))
  let jsonParsed = false

  // 尝试 JSON 解析
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ i: number; text?: string; reason?: string; ambiguous?: string[] }>
      for (const entry of parsed) {
        if (entry.i >= 1 && entry.i <= results.length) {
          // 清洗 [N] 前缀（LLM 可能在 text 字段中带入了索引标记）
          let entryText = (entry.text || '').trim()
          entryText = entryText.replace(/^\[\d+\]\s*/, '')
          // 新格式：只输出有修改的条目，不再输出 "OK"
          // 空字符串表示无需修改，保留原译文
          results[entry.i - 1] = {
            text: entryText,
            reason: (entry.reason || '').trim(),
            ambiguous: Array.isArray(entry.ambiguous) ? entry.ambiguous.filter(a => a && a.trim()) : [],
          }
        }
      }
      jsonParsed = true
    } catch { /* fall through to line parsing */ }
  }

  if (!jsonParsed) {
    // 后备：逐行解析（支持 [N] 和 N. 两种格式）
    const lines = content.split('\n')
    for (const line of lines) {
      let match = line.match(/^\s*\[(\d+)\]\s*(.+)/)
      if (!match) match = line.match(/^\s*(\d+)\.\s*(.+)/)
      if (match) {
        const idx = parseInt(match[1], 10) - 1
        if (idx >= 0 && idx < results.length) {
          const parts = match[2].split(' ||| ')
          results[idx] = {
            text: parts[0].trim(),
            reason: (parts[1] || '').trim(),
            ambiguous: [],
          }
        }
      }
    }
  }

  // 还原实体占位符
  let resultTexts = results.map(r => r.text)
  if (proofreadEntityMap.size > 0) {
    resultTexts = unmaskEntities(resultTexts, proofreadEntityMap)
  }

  // ⚠️ 校对后重新跑语言特定后处理（de/fr/ar 等排版修正）
  resultTexts = resultTexts.map((t, i) => {
    // 仅对校对修改过的文本重跑后处理，通过的（text为空）保留原译文
    if (t && t !== items[i].translatedText) {
      return postProcessTranslation(t, targetLang)
    }
    // 防御性兜底：如果 text 为空（"OK" 或解析失败），保留原译文
    return t || items[i].translatedText
  })

  // ✅ 术语库强制校准：校对 LLM 可能修改了术语
  // 只对校对修改过的文本做校准，避免重复处理
  // ⚠️ 必须在 restoreTrademarkSymbols 之前执行！
  // 原因：enforceGlossaryTerms 的精确匹配会用不含 ®™© 的术语库目标值替换译文，
  // 如果先还原符号再校准，符号会被覆盖丢失。
  const proofreadSourceTexts = items.map(it => it.sourceText)
  const proofreadGlossaryMap = new Map<string, string>()
  for (const [k, v] of glossaryMap.entries()) {
    proofreadGlossaryMap.set(k, v)
  }
  resultTexts = enforceGlossaryTerms(proofreadSourceTexts, resultTexts, proofreadGlossaryMap, new Set())

  // ✅ 商标符号还原：校对 LLM 可能丢失或错放 ™®© 符号
  // 必须在 enforceGlossaryTerms 之后执行，确保符号不会被术语库校准覆盖
  resultTexts = restoreTrademarkSymbols(proofreadSourceTexts, resultTexts)

  // ✅ 脚本检测：防止校对 LLM 输出了与目标语言不符的文字
  for (let i = 0; i < resultTexts.length; i++) {
    if (isProofreadScriptMismatch(resultTexts[i], targetLang)) {
      debugWarn(
        `[proofreadBatch] 校对后脚本不匹配：译文包含非目标语言字符，回退到翻译结果`,
        { idx: i, targetLang, translation: resultTexts[i].slice(0, 50) },
      )
      resultTexts[i] = items[i].translatedText
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 校对后检测：只保留校对特有的问题
  // ═══════════════════════════════════════════════════════════
  // ⛔ 品牌注入/扩展检测/数字校验 — 翻译管道已做，校对只做检查不重复检测
  // ✅ 交叉污染检测 — 校对 LLM 可能让不同源文→相同译文，这是校对特有的问题
  // ═══════════════════════════════════════════════════════════

  // 校对后批次内重复检测（交叉污染）
  const dupGroups = new Map<string, number[]>()
  for (let i = 0; i < resultTexts.length; i++) {
    if (resultTexts[i].length < MIN_DUP_LEN) continue
    const key = resultTexts[i]
    if (!dupGroups.has(key)) dupGroups.set(key, [])
    dupGroups.get(key)!.push(i)
  }
  for (const [, indices] of dupGroups) {
    if (indices.length > 1) {
      const uniqueSources = new Set(indices.map(j => items[j].sourceText))
      if (uniqueSources.size > 1) {
        debugWarn(
          `[proofreadBatch] 校对后交叉污染：${indices.length} 条不同源文 → 相同译文，回退到翻译结果`,
          indices.map(j => ({ idx: j, src: items[j].sourceText.slice(0, 50) })),
        )
        // ✅ 回退到翻译结果（不是源文），避免漏翻
        for (const j of indices) {
          resultTexts[j] = items[j].translatedText
        }
      }
    }
  }

  for (let i = 0; i < results.length; i++) {
    results[i].text = resultTexts[i]
  }

  // v7.5.1: 校对后漏翻检测 — 防止校对 LLM 将译文改回英文
  const proofreadSources = items.map(it => it.sourceText)
  const proofreadFinals = resultTexts.map(t => t || '')
  const proofreadUntranslated = detectUntranslatedText(proofreadSources, proofreadFinals, targetLang, glossaryMap, detectedProofreadSource)
  if (proofreadUntranslated.size > 0) {
    debugWarn(
      `[proofreadBatch] 校对后检测到 ${proofreadUntranslated.size} 条漏翻，回退到校对前译文`,
      [...proofreadUntranslated].map(j => ({
        idx: j,
        source: proofreadSources[j].slice(0, 60),
        proofreadResult: proofreadFinals[j].slice(0, 60),
        fallback: items[j].translatedText.slice(0, 60),
      })),
    )
    for (const j of proofreadUntranslated) {
      results[j].text = items[j].translatedText  // 回退到翻译管道的输出
    }
  }

  return results
}

// ============================================================
// 校对结果脚本校验：防止 LLM 输出了与目标语言完全不符的文字
// ============================================================
const LATIN_SCRIPT_LANGS = new Set(['en', 'es', 'fr', 'de', 'pt', 'pt-BR', 'it', 'nl', 'pl', 'sv', 'tr', 'vi', 'id', 'ms', 'fi', 'da', 'no', 'hu', 'cs', 'ro', 'sk', 'hr', 'sl', 'lt', 'lv', 'et'])

export function isProofreadScriptMismatch(text: string, targetLang: string): boolean {
  if (!text) return false
  if (LATIN_SCRIPT_LANGS.has(targetLang)) {
    return /[一-鿿㐀-䶿]/.test(text)
  }
  return false
}

// ============================================================
// 截断检测：检查译文长度是否远小于源文（LLM 输出提前终止）
// 与 detectUntranslatedText 互补：一个检"完全没翻"，一个检"翻了但没翻完"
// ============================================================

/**
 * 检测翻译结果是否被截断（LLM 开始翻译但输出过早终止）或为空（LLM 未输出）。
 * 规则：
 *   1. 译文为空 → 视为截断（无论源文长度）
 *   2. 源文 > 30 字符 && 译文长度 < 源文长度 × 0.25 → 视为截断
 * 返回截断条目的索引集合，由调用方决定重试或标记失败。
 */
export function detectTruncatedTexts(
  sourceTexts: string[],
  translatedTexts: string[],
): Set<number> {
  const truncatedIndices = new Set<number>()
  const MIN_SOURCE_LEN = 30
  const TRUNC_RATIO = 0.25

  for (let i = 0; i < sourceTexts.length; i++) {
    const src = sourceTexts[i] || ''
    const trans = translatedTexts[i] || ''
    if (!src) continue
    // 译文为空 → 视为截断（无论源文长度）
    if (!trans) {
      truncatedIndices.add(i)
      continue
    }
    // 短源文跳过长度比例检测（但空结果已在上面捕获）
    if (src.length < MIN_SOURCE_LEN) continue
    // 译文过短 → 视为截断
    if (trans.length < src.length * TRUNC_RATIO) {
      truncatedIndices.add(i)
    }
  }

  return truncatedIndices
}

// ============================================================
// v7.3 新增：拉丁语系功能词检测（解决德语等语言误判问题）
// 背景：德语等拉丁语系语言与英文共用字母表，技术文案可能不含变音符号
// 此时 detectTargetLanguageFeatures 返回 hasFeatures=false，导致误判漏翻
// ============================================================

const LANG_FUNCTION_WORDS: Record<string, Set<string>> = {
  'de': new Set(['und', 'oder', 'mit', 'für', 'von', 'zu', 'auf', 'bei', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'hat', 'haben', 'wird', 'werden', 'kann', 'muss', 'soll', 'nicht', 'auch', 'nach', 'über', 'unter', 'zwischen', 'durch', 'ohne', 'gegen', 'seit', 'während', 'weil', 'dass', 'wenn', 'als', 'dann', 'noch', 'schon', 'nur', 'mehr', 'sehr', 'hier', 'dort', 'in', 'im', 'am', 'zum', 'zur', 'aus', 'ab', 'an', 'um', 'ins', 'vom', 'beim', 'des', 'dem', 'den', 'einen', 'einem', 'einer', 'sich', 'wie', 'so', 'auch', 'aber', 'doch', 'denn', 'vor', 'hinter', 'neben', 'über', 'bis', 'ab', 'seit', 'vor']),
  'fr': new Set(['et', 'ou', 'mais', 'donc', 'car', 'que', 'qui', 'dans', 'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'entre', 'vers', 'chez', 'contre', 'depuis', 'pendant', 'avant', 'après', 'selon', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'est', 'sont', 'a', 'ont', 'être', 'avoir', 'en', 'ne', 'pas', 'plus', 'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'tout', 'toute', 'tous', 'fait', 'faire', 'peut', 'peuvent', 'doit', 'aussi', 'très', 'bien', 'comme', 'plus', 'moins', 'alors', 'donc', 'si', 'ans', 'service']),
  'nl': new Set(['en', 'of', 'maar', 'dus', 'met', 'voor', 'van', 'tot', 'op', 'bij', 'door', 'over', 'onder', 'tussen', 'zonder', 'tegen', 'sinds', 'tijdens', 'na', 'omdat', 'als', 'wanneer', 'dan', 'nog', 'ook', 'zeer', 'hier', 'daar', 'de', 'het', 'een', 'is', 'zijn', 'heeft', 'hebben', 'in', 'te', 'niet', 'aan', 'uit', 'om', 'er', 'al', 'wel', 'geen', 'moet', 'kan', 'wordt', 'zou', 'deze', 'dit', 'dat', 'wie', 'wat', 'waar', 'hoe', 'toch', 'eens', 'weer']),
  'sv': new Set(['och', 'eller', 'men', 'så', 'för', 'med', 'till', 'på', 'i', 'av', 'från', 'om', 'vid', 'hos', 'genom', 'mellan', 'utan', 'mot', 'sedan', 'under', 'efter', 'innan', 'eftersom', 'när', 'som', 'då', 'än', 'också', 'mycket', 'här', 'där', 'den', 'det', 'en', 'ett', 'är', 'har', 'blir']),
  'es': new Set(['y', 'o', 'pero', 'que', 'porque', 'con', 'para', 'por', 'desde', 'hasta', 'entre', 'sin', 'sobre', 'según', 'durante', 'antes', 'después', 'mientras', 'cuando', 'como', 'si', 'aunque', 'sino', 'también', 'muy', 'más', 'menos', 'aquí', 'ahí', 'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'tiene', 'tienen', 'de', 'a', 'en', 'al', 'del', 'se', 'le', 'les', 'lo', 'no', 'sí', 'ya', 'todo', 'toda', 'todos', 'todas', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas']),
  'pt': new Set(['e', 'ou', 'mas', 'que', 'porque', 'com', 'para', 'por', 'desde', 'até', 'entre', 'sem', 'sobre', 'durante', 'antes', 'depois', 'enquanto', 'quando', 'como', 'se', 'embora', 'também', 'muito', 'mais', 'menos', 'aqui', 'aí', 'o', 'a', 'os', 'as', 'um', 'uma', 'é', 'são', 'tem', 'têm']),
  'pt-BR': new Set(['e', 'ou', 'mas', 'que', 'porque', 'com', 'para', 'por', 'desde', 'até', 'entre', 'sem', 'sobre', 'durante', 'antes', 'depois', 'enquanto', 'quando', 'como', 'se', 'embora', 'também', 'muito', 'mais', 'menos', 'aqui', 'aí', 'o', 'a', 'os', 'as', 'um', 'uma', 'é', 'são', 'tem', 'têm']),
  'it': new Set(['e', 'o', 'ma', 'che', 'perché', 'con', 'per', 'da', 'fra', 'tra', 'senza', 'su', 'secondo', 'durante', 'prima', 'dopo', 'mentre', 'quando', 'come', 'se', 'anche', 'molto', 'più', 'meno', 'qui', 'là', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'è', 'sono', 'ha', 'hanno', 'di', 'del', 'dello', 'dei', 'degli', 'della', 'delle', 'l', 'in', 'nel', 'nello', 'nei', 'negli', 'nella', 'nelle']),
  'pl': new Set(['i', 'lub', 'ale', 'że', 'bo', 'z', 'na', 'do', 'od', 'w', 'przy', 'przez', 'między', 'bez', 'przeciw', 'gdy', 'kiedy', 'jak', 'czy', 'też', 'bardzo', 'tu', 'tam', 'ten', 'ta', 'to', 'jest', 'są', 'ma', 'mieć', 'być']),
  'tr': new Set(['ve', 'ile', 'için', 'gibi', 'kadar', 'ama', 'fakat', 'çünkü', 'eğer', 'ise', 'ancak', 'bile', 'daha', 'en', 'çok', 'az', 'şu', 'bu', 'bir', 'var', 'olan', 'olarak', 'üzere', 'doğru', 'göre', 'rağmen']),
  'vi': new Set(['và', 'của', 'là', 'có', 'được', 'trong', 'với', 'cho', 'từ', 'đến', 'khi', 'nếu', 'như', 'tại', 'bởi', 'về', 'để', 'theo', 'giữa', 'không', 'cũng', 'rất', 'này', 'kia', 'đây', 'đó']),
  'id': new Set(['dan', 'atau', 'dengan', 'untuk', 'dari', 'pada', 'dalam', 'ke', 'yang', 'adalah', 'akan', 'telah', 'sudah', 'belum', 'jika', 'ketika', 'karena', 'oleh', 'antara', 'tanpa', 'terhadap', 'menurut', 'selama', 'setelah', 'sebelum']),
  'ms': new Set(['dan', 'atau', 'dengan', 'untuk', 'dari', 'pada', 'dalam', 'ke', 'yang', 'ialah', 'akan', 'telah', 'sudah', 'belum', 'jika', 'apabila', 'kerana', 'oleh', 'antara', 'tanpa']),
  'fi': new Set(['ja', 'tai', 'mutta', 'että', 'koska', 'kun', 'jos', 'niin', 'myös', 'vain', 'hyvin', 'tässä', 'tässä', 'tämä', 'tuo', 'on', 'ovat', 'ei', 'oli', 'tulee']),
  'da': new Set(['og', 'eller', 'men', 'for', 'at', 'med', 'til', 'på', 'i', 'af', 'fra', 'om', 'ved', 'hos', 'gennem', 'mellem', 'uden', 'mod', 'siden', 'under', 'efter', 'før', 'fordi', 'når', 'som', 'da', 'også', 'meget', 'her', 'der', 'den', 'det', 'en', 'et', 'er', 'har', 'bliver']),
  'no': new Set(['og', 'eller', 'men', 'for', 'at', 'med', 'til', 'på', 'i', 'av', 'fra', 'om', 'ved', 'hos', 'gjennom', 'mellom', 'uten', 'mot', 'siden', 'under', 'etter', 'før', 'fordi', 'når', 'som', 'da', 'også', 'veldig', 'her', 'der', 'den', 'det', 'en', 'et', 'er', 'har', 'blir']),
  'hu': new Set(['és', 'vagy', 'de', 'hogy', 'mert', 'ha', 'amikor', 'mint', 'akkor', 'is', 'nagyon', 'itt', 'ott', 'ez', 'az', 'egy', 'van', 'nincs', 'lesz', 'volt']),
  'cs': new Set(['a', 'nebo', 'ale', 'že', 'protože', 'když', 'pokud', 'jako', 'tak', 'také', 'velmi', 'zde', 'tam', 'tento', 'tato', 'toto', 'je', 'jsou', 'není', 'být']),
  'ro': new Set(['și', 'sau', 'dar', 'că', 'pentru', 'cu', 'de', 'la', 'în', 'pe', 'cu', 'fără', 'între', 'pentru', 'după', 'înainte', 'când', 'dacă', 'cum', 'și', 'foarte', 'aici', 'acolo', 'acest', 'această', 'aceasta', 'este', 'sunt', 'are']),
  'sk': new Set(['a', 'alebo', 'ale', 'že', 'pretože', 'keď', 'ak', 'ako', 'tak', 'tiež', 'veľmi', 'tu', 'tam', 'tento', 'tá', 'toto', 'je', 'sú', 'nie', 'byť']),
  'hr': new Set(['i', 'ili', 'ali', 'da', 'jer', 'kada', 'ako', 'kao', 'tada', 'također', 'vrlo', 'ovdje', 'tamo', 'ovaj', 'ova', 'ovo', 'je', 'su', 'nije', 'biti']),
  'sl': new Set(['in', 'ali', 'ampak', 'da', 'ker', 'ko', 'če', 'kot', 'tudi', 'zelo', 'tukaj', 'tam', 'ta', 'ta', 'to', 'je', 'so', 'ni', 'biti']),
  'lt': new Set(['ir', 'ar', 'bet', 'kad', 'nes', 'kai', 'jei', 'kaip', 'taip', 'labai', 'čia', 'ten', 'šis', 'ši', 'tai', 'yra', 'nėra', 'būti']),
  'lv': new Set(['un', 'vai', 'bet', 'ka', 'jo', 'kad', 'ja', 'kā', 'arī', 'ļoti', 'šeit', 'tur', 'šis', 'šī', 'tas', 'ir', 'nav', 'būt']),
  'et': new Set(['ja', 'või', 'aga', 'et', 'sest', 'kui', 'nii', 'ka', 'väga', 'siin', 'seal', 'see', 'too', 'üks', 'on', 'ei', 'olema']),
}

/**
 * v7.3: 检测文本是否包含目标语言的高频功能词（介词、连词、冠词等）。
 * 用于拉丁语系语言的第二层语言身份证明。
 */
function containsLanguageFunctionWords(text: string, targetLang: string): boolean {
  const words = LANG_FUNCTION_WORDS[targetLang]
  if (!words) return false

  const textWords = text.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/]+/).filter(w => w.length >= 2)
  let matchCount = 0
  for (const w of textWords) {
    if (words.has(w)) matchCount++
  }
  // v7.5.1: 至少1个功能词匹配，且占比 >= 3% → 确认是目标语言
  // 降低阈值防止短文本漏检（如荷兰语 1/20=5% 恰好被 >0.05 拒绝）
  return matchCount >= 1 && matchCount / textWords.length >= 0.03
}

// ============================================================
// 漏翻检测：检查译文是否与源文实质相同（即 LLM 没翻译）
// 正常化比较（去 ®™© + 合并空格 + 小写），排除商标/空格差异
// ============================================================

/**
 * 检测文本是否不需要翻译（品牌名/技术缩写/存储容量等全球统一表达）。
 * 核心原则：纯产品名（无上下文）→ 不翻译是正确的；有上下文（动词、介词、描述性文本）→ 必须翻译
 */
// ═══════════════════════════════════════════════════════════════
// isUntranslatable 预编译正则（模块顶层，避免每次调用重复编译）
// ═══════════════════════════════════════════════════════════════

const TITLE_CASE_RE = /^[A-Z][a-zA-Z\s®™©]*$/
const FUNCTION_WORDS_RE = /\b(the|a|an|for|your|our|their|this|that|these|those|with|from|have|been|will|would|could|should|may|might|can|must|are|were|was|has|had|its|and|but|or|not|also|very|more|most|some|any|each|every|all|both|few|many|much|such|just|only|than|then|now|when|where|which|who|whom|whose|why|how|about|above|after|again|against|along|among|around|before|behind|below|beside|between|beyond|during|except|inside|into|near|onto|outside|over|past|since|through|toward|under|until|upon|within|without)\b/i
const BRAND_GRADE_RE = /\b(Lexar|ARES|THOR|PLAY|ARMOR|SILVER|GOLD|DIAMOND|BLUE|PRO|PLUS|MAX|NM\d+|NQ\d+|NS\d+|EQ\d+|PSSD|CFexpress|microSD|SDXC|SDHC|UHS)\b/i
const TRAILING_STAR_RE = /\*+$/g
const NUM_UNIT_RE = /^[\d,.]+\s*(GB|MB|TB|KB|MB\/s|GB\/s|TB\/s|MHz|GHz)\b/i
const PERCENT_RE = /^[\d,.]+%$/i
const TEMP_RE = /^[\d,.]+\s*[°][CF]$/i
const MULTIPLIER_RE = /^[\d,.]+[xX]$/
const PURE_NUM_RE = /^[\d,.]+$/
const CURRENCY_CODE_RE = /^[\d,.]+\s*(€|¥|£|USD|EUR|JPY|CNY)\b/i
const DOLLAR_PREFIX_RE = /^\$\s*[\d,.]+$/i
const DOLLAR_SUFFIX_RE = /^[\d,.]+\s*[$]$/i
const K_SUFFIX_RE = /^[\d,]+\s*K\s*(IOPS|iops)?$/i
const TBW_RE = /^[\d,]+\s*TBW\*?$/i
const MODEL_CAPACITY_RE = /^[A-Z]+\d{2,4}[A-Z]*(\s+(PRO|MAX|PLUS|ELITE|ULTRA|PREMIUM|EVO|EXTREME))?(\s+\d+[TGMK]B\*?)?$/i

// TECH_ABBREVS 已合并到 TECH_TERM_EXEMPT（见上方）

const BRAND_KEYWORDS_RE_SOURCE = ['Lexar', 'ARMOR', 'GOLD', 'DIAMOND', 'PLAY', 'PRO', 'ARES', 'THOR',
  'SILVER', 'BLUE', 'NM\\d+', 'NQ\\d+', 'NS\\d+', 'EQ\\d+',
  'PSSD', 'CFexpress', 'microSD', 'SDXC', 'SDHC', 'UHS', 'VPG',
].join('|')
const BRAND_KEYWORDS_RE = new RegExp(`\\b(${BRAND_KEYWORDS_RE_SOURCE})\\b`, 'gi')

const CONTEXT_PATTERNS: RegExp[] = [
  // 动词（常见动作词）
  /\b(paired|compatible|achieve|ensure|support|work|connect|use|design|build|run|operate|perform|deliver|provide|offer|feature|include|contain|come|base|make|create|develop|manufacture|produce|supply|present|introduce|launch|release|announce|reveal|showcase|demonstrate|display|exhibit|compare|test|measure|check|verify|validate|optimize|enhance|improve|upgrade|install|configure|setup|manage|control|monitor|protect|secure|backup|restore|recover|transfer|sync|share|access|read|write|store|save|load|open|close|delete|remove|add|edit|modify|change|update|refresh|reload|restart|reset|format|partition|clone|image|burn|erase|wipe|clean|scan|detect|identify|recognize|analyze|evaluate|assess|review|audit|inspect|examine|investigate|explore|search|find|locate|track|trace|follow|observe|watch|view|see|look|show|represent|illustrate|depict|describe|explain|clarify|define|specify|indicate|state|declare|proclaim|assert|affirm|confirm|prove|highlight|emphasize|stress|underline|underscore|point|note|mention|remark|comment)\b/i,
  // 介词（表示关系）
  /\b(with|for|to|from|by|in|on|at|of|and|or|but|if|when|while|because|since|although|though|unless|until|before|after|during|through|throughout|across|against|among|around|about|above|below|between|beside|beyond|except|into|onto|out|over|past|toward|towards|under|up|upon|within|without|along|amid|aside|barring|besides|circa|despite|down|ere|excepting|excluding|failing|following|given|granted|including|inside|lest|mid|midst|minus|modulo|near|next|notwithstanding|off|onto|outside|pending|per|plus|pro|qua|re|round|sans|save|sub|than|thru|till|times|touching|underneath|unlike|unto|versus|via|vice)\b/i,
  // 描述性形容词（表示特征）
  /\b(high|low|fast|slow|large|small|big|tiny|huge|massive|compact|light|heavy|thin|thick|wide|narrow|long|short|tall|deep|shallow|bright|dark|clear|opaque|smooth|rough|soft|hard|firm|flexible|rigid|stiff|elastic|plastic|ductile|brittle|strong|weak|durable|reliable|stable|unstable|consistent|variable|uniform|diverse|varied|complex|simple|easy|difficult|challenging|demanding|efficient|effective|optimal|ideal|perfect|excellent|superior|inferior|advanced|basic|fundamental|essential|critical|crucial|vital|important|significant|notable|remarkable|outstanding|exceptional|extraordinary|impressive|striking|noteworthy|memorable|unforgettable|distinctive|unique|special|particular|specific|general|common|ordinary|typical|usual|normal|regular|standard|conventional|traditional|classic|modern|contemporary|current|recent|latest|new|old|ancient|historical|future|upcoming|forthcoming|pending|imminent|impending|approaching|looming|delayed|postponed|deferred|suspended|paused|interrupted|discontinued|terminated|ended|finished|completed|done|over|gone|lost|missing|absent|present|available|accessible|ready|prepared|set|active|inactive|enabled|disabled|closed|locked|unlocked|secured|unsecured|protected|unprotected|safe|dangerous|risky|hazardous|perilous|treacherous)\b/i,
  // 技术规格（需要翻译的技术参数）
  /\b(PCIe|NVMe|M\.2|2230|2242|2280|Gen\s*\d|x\d+)\b/i,
  // 版本号模式（如 4.0, 3.0）
  /\d+\.\d+/,
]

// ============================================================
// isUntranslatable 术语库预索引（WeakMap 按 Map 实例缓存，避免每次调用全库遍历）
// ============================================================
interface UntranslatableIndex {
  /** 归一化源词 → 归一化目标值 */
  norm: Map<string, string>
  /** 词形还原后的源词 → 归一化目标值 */
  lemma: Map<string, string>
}
const untranslatableIndexCache = new WeakMap<Map<string, string>, UntranslatableIndex>()

/** 归一化：小写 + 去 ®™© + trim */
function normalizeGlossaryKey(s: string): string {
  return s.toLowerCase().replace(/[®™©]/g, '').trim()
}

/** 英语词形还原：ies→y → sses→ss → (x|z|ch|sh)es→词干 → 去尾s */
function lemmaWord(w: string): string {
  if (w.length < 3 || !/^[a-z]+$/.test(w)) return w
  if (/(?<=.[^i])ies$/.test(w)) return w.replace(/ies$/, 'y')
  if (/sses$/.test(w)) return w.slice(0, -2)
  if (/(?:x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (/[^s]s$/.test(w)) return w.slice(0, -1)
  return w
}

function lemmaPhrase(s: string): string {
  return s.split(/\s+/).map(lemmaWord).join(' ')
}

function getUntranslatableIndex(glossaryMap: Map<string, string>): UntranslatableIndex {
  let idx = untranslatableIndexCache.get(glossaryMap)
  if (!idx) {
    idx = { norm: new Map(), lemma: new Map() }
    for (const [k, v] of glossaryMap.entries()) {
      const kNorm = normalizeGlossaryKey(k)
      const vNorm = normalizeGlossaryKey(v)
      idx.norm.set(kNorm, vNorm)
      idx.lemma.set(lemmaPhrase(kNorm), vNorm)
    }
    untranslatableIndexCache.set(glossaryMap, idx)
  }
  return idx
}

export function isUntranslatable(s: string, glossaryMap?: Map<string, string>): boolean {
  // 0. 纯标点/符号不承载可翻译语义，避免 +、—、• 等触发漏翻重试。
  // 保留字母、数字和占位符中的下划线以免掩盖真正的文本或实体还原失败。
  if (!s.replace(/[\p{P}\p{S}\s]/gu, '')) return true

  // 1. 术语库检查：如果源文在术语库中且目标语言与源文相同，不算漏翻
  if (glossaryMap) {
    const normalizedKey = normalizeGlossaryKey(s)
    const idx = getUntranslatableIndex(glossaryMap)
    // v8.10 性能：WeakMap 预索引 O(1) 查询，替代全库遍历（原实现每次调用 O(n) 扫两遍）
    const directValue = idx.norm.get(normalizedKey)
    if (directValue !== undefined && directValue === normalizedKey) {
      return true // 术语库中英文目标语言一致，不算漏翻
    }
    // v8.7: 单复数归一化豁免 — 术语库可能只收录复数（Drones/Tablets），
    // 源文出现单数（Drone/Tablet）且该目标语言同形（pt/pt-BR/es 等）时也应豁免。
    // 注意：此处归一化仅用于豁免判断，不参与任何替换，单复数规则只作用于判断不污染译文。
    if (directValue === undefined) {
      const lemmaKey = lemmaPhrase(normalizedKey)
      const lemmaValue = idx.lemma.get(lemmaKey)
      if (lemmaValue !== undefined) {
        // 术语目标值与源文词形一致（同形）→ 豁免；不同形（如 de: Drohnen）→ 不豁免，正常判漏翻
        if (lemmaValue === normalizedKey || lemmaPhrase(lemmaValue) === lemmaKey) {
          return true
        }
      }
    }
  }

  // 1. 纯品牌名（首字母大写 + 可选 ®™© + 空格 + 其他字母）
  // v7.5 修复：原正则 /^[A-Z][a-zA-Z\s®™©]*$/ 会误匹配任何英文句子。
  // 新增功能词排除：含 for/your/the/with 等常见英文功能词的文本不是品牌名。
  // v8.0 收紧：无功能词时，还需包含 Lexar 品牌关键词或短标签才豁免
  if (TITLE_CASE_RE.test(s)) {
    if (!FUNCTION_WORDS_RE.test(s)) {
      // v8.0: 必须包含已知 Lexar 品牌/等级关键词才豁免（防止 "High Speed" 等短描述被误判为品牌名）
      const brandOrGrade = BRAND_GRADE_RE.test(s)
      const isShortLabel = s.split(/\s+/).length <= 3
      // 短标签需同时包含品牌/等级词才豁免，纯描述性短文本不豁免
      if (brandOrGrade && isShortLabel) return true
      // 否则不豁免 → 让 detectUntranslatedText 正常检测 → 触发重试
    }
  }

  // 2. 数字 + 单位 / 纯数字 / 百分比 / 温度 / 倍率 — 全球统一格式
  // v7.5.3: 扩展覆盖 %、°C/°F、x/X 倍率、纯数字、货币符号
  // v7.5.7: strip trailing * before matching (fixes 4000GB*、700TBW* 等被误判漏翻)
  const sNoStar = s.replace(TRAILING_STAR_RE, '')
  if (NUM_UNIT_RE.test(sNoStar)) return true
  if (PERCENT_RE.test(sNoStar)) return true
  if (TEMP_RE.test(sNoStar)) return true
  if (MULTIPLIER_RE.test(sNoStar)) return true
  if (PURE_NUM_RE.test(sNoStar)) return true
  if (CURRENCY_CODE_RE.test(sNoStar)) return true
  if (DOLLAR_PREFIX_RE.test(sNoStar)) return true
  if (DOLLAR_SUFFIX_RE.test(sNoStar)) return true
  if (K_SUFFIX_RE.test(sNoStar)) return true
  if (TBW_RE.test(sNoStar)) return true

  // 2.5 产品型号 + 可选容量（NM1090 PRO 4TB, NM790 2TB, D40E 1TB 等）— 全球统一
  if (MODEL_CAPACITY_RE.test(s)) return true

  // 3. 纯技术缩写（SSD, USB, NVMe, PCIe 等）— 全球统一
  const words = s.toLowerCase().replace(/[®™©]/g, '').trim().split(/\s+/)
  if (words.length > 0 && words.every(w => TECH_ABBREVS.has(w) || /^\d/.test(w))) {
    return true
  }

  // 4. 产品名组合：必须同时满足两个条件
  //    a) 包含 ≥2 个品牌关键词
  //    b) 不包含任何"上下文"（动词、介词、描述性文本）
  const brandMatches = s.match(BRAND_KEYWORDS_RE)

  if (brandMatches && brandMatches.length >= 2) {
    const hasContext = CONTEXT_PATTERNS.some(pattern => pattern.test(s))

    if (hasContext) {
      // 有上下文 → 不是纯产品名 → 必须翻译
      return false
    }

    // 无上下文 → 纯产品名 → 不判为漏翻
    return true
  }

  return false
}

/**
 * 检测译文是否包含目标语言的特征字符。
 * 用于判断译文是否真正被翻译成了目标语言（而非保留英文原文）。
 *
 * 返回 { hasFeatures: boolean, featureRatio: number, details: string }
 * - hasFeatures: 是否包含目标语言特征字符
 * - featureRatio: 特征字符占比
 * - details: 检测详情（用于日志）
 */
export function detectTargetLanguageFeatures(
  text: string,
  targetLang: string
): { hasFeatures: boolean; featureRatio: number; details: string } {
  if (!text) return { hasFeatures: false, featureRatio: 0, details: 'empty text' }

  // 各语言的特征字符正则
  const LANG_FEATURES: Record<string, { pattern: RegExp; name: string }> = {
    'vi': {
      // 越南语特征：ă, â, ê, ô, ơ, ư, đ + 声调符号
      pattern: /[ăâêôơưđÀÁẢÃẠàáảãạĂĂẢÃẠăăảãạÂÂẢÃẠââảãạÈÉẺẼẸèéẻẽẹÊÊẨẪẬêêẩẫậÌÍỈĨỊìíỉĩịÒÓỎÕỌòóỏõọÔÔỔỖỘôôổỗộƠƠỞỠỢơơởỡợÙÚỦŨỤùúủũụƯƯỬỮỰưưửữựỲÝỶỸỴỳýỷỹỵĐđ]/,
      name: 'Vietnamese diacritics'
    },
    'th': {
      // 泰文字符范围
      pattern: /[฀-๿]/,
      name: 'Thai characters'
    },
    'ar': {
      // 阿拉伯文字符范围
      pattern: /[؀-ۿ]/,
      name: 'Arabic characters'
    },
    'ru': {
      // 西里尔字符范围
      pattern: /[Ѐ-ӿ]/,
      name: 'Cyrillic characters'
    },
    'zh-CN': {
      // CJK统一汉字
      pattern: /[一-鿿]/,
      name: 'CJK characters'
    },
    'zh-TW': {
      // CJK统一汉字
      pattern: /[一-鿿]/,
      name: 'CJK characters'
    },
    'ja': {
      // 平假名 + 片假名
      pattern: /[぀-ゟ゠-ヿ]/,
      name: 'Japanese Hiragana/Katakana'
    },
    'ko': {
      // 韩文谚文音节
      pattern: /[가-힯]/,
      name: 'Korean Hangul'
    },
    'de': {
      // 德语变音符号
      pattern: /[äöüßÄÖÜ]/,
      name: 'German umlauts'
    },
    'fr': {
      // 法语特殊字符
      pattern: /[éèêëàâôùûçïîÉÈÊËÀÂÔÙÛÇÏÎ]/,
      name: 'French diacritics'
    },
    'es': {
      // 西班牙语特殊字符
      pattern: /[áéíóúñüÁÉÍÓÚÑÜ]/,
      name: 'Spanish diacritics'
    },
    'pt': {
      // 葡萄牙语特殊字符
      pattern: /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/,
      name: 'Portuguese diacritics'
    },
    'pt-BR': {
      // 巴西葡萄牙语特殊字符
      pattern: /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/,
      name: 'Brazilian Portuguese diacritics'
    },
    'it': {
      // 意大利语特殊字符
      pattern: /[àèéìòóùÀÈÉÌÒÓÙ]/,
      name: 'Italian diacritics'
    },
    'nl': {
      // 荷兰语变音符号
      pattern: /[äëïöüÄËÏÖÜ]/,
      name: 'Dutch diacritics'
    },
    'pl': {
      // 波兰语特殊字符
      pattern: /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/,
      name: 'Polish diacritics'
    },
    'sv': {
      // 瑞典语特殊字符
      pattern: /[åäöÅÄÖ]/,
      name: 'Swedish diacritics'
    },
    'tr': {
      // 土耳其语特殊字符
      pattern: /[çğıİöşüÇĞIÖŞÜ]/,
      name: 'Turkish diacritics'
    },
    'id': {
      // 印尼语：标准书写不使用变音符号，使用常见词缀作为特征
      pattern: /(?:nya|kah|pun|lah|tah)$/i,
      name: 'Indonesian common suffixes'
    },
  }

  const feature = LANG_FEATURES[targetLang]
  if (!feature) {
    // 英文目标：无法通过特征字符判断（英文没有特殊字符）
    return { hasFeatures: true, featureRatio: 1.0, details: 'English has no special features' }
  }

  const matches = text.match(new RegExp(feature.pattern, 'g')) || []
  const featureRatio = matches.length / text.length

  return {
    hasFeatures: matches.length > 0,
    featureRatio,
    details: `${matches.length} ${feature.name} found (${(featureRatio * 100).toFixed(2)}%)`
  }
}

/**
 * 检测是否为同语系变体语言对（共享字符集，放宽漏翻检测）
 * v8.5: CN→TW/HK、PT→PT-BR 等场景
 * v9.3: pt 与 pt-BR 任一侧出现即视为同语系对（区分词投票无法区分欧葡/巴葡，
 *       且 pt-BR→pt 反向场景同样适用）
 */
function isSameScriptLanguagePair(src: string, tgt: string): boolean {
  const SAME_SCRIPT_PAIRS = [
    ['zh-CN', 'zh-TW'], ['zh-CN', 'zh-HK'],
    ['pt', 'pt-BR'],
  ]
  if ((src === 'pt' || src === 'pt-BR') && (tgt === 'pt' || tgt === 'pt-BR')) return true
  return SAME_SCRIPT_PAIRS.some(([s, t]) =>
    (s === src && t === tgt) || (t === src && s === tgt)
  )
}

/**
 * 检测翻译/校对后是否存在漏翻（译文==源文但应被翻译）。
 * 返回漏翻条目的索引集合，由调用方决定处理策略。
 *
 * v9.3: 新增可选参数 batchSrcLang — 批次级源语言判定结果（detectSourceLanguage）。
 * 解决：逐条 detectSingleTextLanguage 是字符集级检测，拉丁文本一律返回 'en'，
 * 导致 ['pt','pt-BR'] 同语系豁免成为死代码、de→de 校对场景"源==目标跳过"失效。
 * 批次级判定只做加法（多豁免），永不做减法（少检测）。
 */
export function detectUntranslatedText(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang: string,
  glossaryMap?: Map<string, string>,
  batchSrcLang?: string,
): Set<number> {
  const untranslatedIndices = new Set<number>()

  function normalize(s: string): string {
    return s.replace(/[®™©]/g, '').replace(/[""'`''「」『』【】〔〕]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  // 检测指令文本的正则（防止重试指令污染最终译文）
  const INSTRUCTION_PATTERNS = [
    /\[TRANSLATE REQUIRED\]/i,
    /\[MANDATORY TRANSLATION\]/i,
    /\[PARTIAL TRANSLATION DETECTED\]/i,
    /⛔\s*UNTRANSLATED!/i,
    /Translate\s+".*?"\s+to/i,
  ]

  // 优化：预构建术语库小写集合（循环外一次构建，避免每条文本重复构建）
  const glossaryLower = glossaryMap
    ? new Set([...glossaryMap.keys()].map(k => k.toLowerCase()))
    : null

  // v9.3: 批次级豁免的纯度条件 — 批次文本有明显英文信号时，批次级豁免静默失效。
  // 多语种混杂批次（如 pt 为主+混入英文）防止批次级豁免把英文条目也豁免掉。
  // 判定：英文区分词命中 ≥2 个 → 视为有英文信号。
  const batchHasEnglishSignal = (() => {
    if (!batchSrcLang || batchSrcLang === 'en') return false
    let enHits = 0
    const enDict = LATIN_DISTINCTIVE_WORDS.en
    for (const t of sourceTexts) {
      const ws = t.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/)
      for (const w of ws) {
        if (w.length >= 2 && enDict.has(w)) { enHits++; break }
      }
      if (enHits >= 2) return true
    }
    return false
  })()
  // 批次级豁免生效条件：判定为非英语言 且 无英文混入信号
  const batchExemptLang = (batchSrcLang && batchSrcLang !== 'en' && !batchHasEnglishSignal)
    ? batchSrcLang
    : undefined

  // v9.3: 同语系对的二元守卫 — 同语系对跳过维度2后，防止 LLM 摆烂返回纯英文。
  // 译文含 ≥2 个英文区分词 且 无目标语言特征/功能词 → 仍判漏翻。
  // 只拦"明显是英语"的长句，短句（零命中）零误伤。
  function englishLeakGuard(trans: string): boolean {
    const ws = trans.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/).filter(w => w.length >= 2)
    let enCount = 0
    for (const w of ws) { if (LATIN_DISTINCTIVE_WORDS.en.has(w)) enCount++ }
    if (enCount < 2) return false
    // 有目标语言特征字符 → 不是纯英文摆烂
    if (/[^\x00-\x7F]/.test(trans)) return false
    // 有目标语言功能词 → 不是纯英文摆烂
    if (containsLanguageFunctionWords(trans, targetLang)) return false
    return true
  }

  for (let i = 0; i < sourceTexts.length; i++) {
    const src = sourceTexts[i] || ''
    const trans = translatedTexts[i] || ''
    if (!src || !trans) continue

    // 如果译文包含指令文本，视为漏翻
    if (INSTRUCTION_PATTERNS.some(pattern => pattern.test(trans))) {
      untranslatedIndices.add(i)
      continue
    }

    // 跳过源语言==目标语言的条目（不需要翻译，如同语言校对场景）
    // v9.3: 批次级判定补充——拉丁源文逐条检测恒为 'en'，de→de/pt→pt 等校对场景
    // 靠批次级判定生效（带纯度条件，混杂英文时失效回退逐条维度2）
    const srcLang = detectSingleTextLanguage(src)
    if (srcLang === targetLang) continue
    if (batchExemptLang && batchExemptLang === targetLang) continue

    // 跳过不需要翻译的文本（品牌名/技术缩写/存储容量/术语库一致项）
    if (isUntranslatable(src, glossaryMap)) continue

    // 同语系变体语言对：放宽检测
    // v9.3: 并集判定——批次级（治 pt→pt-BR 死代码）∪ 逐条级（保 zh 等现有行为），
    // 豁免只增不减，混杂批次中少数派语言条目反而比现在多一层保护
    const isSameScript = isSameScriptLanguagePair(srcLang, targetLang)
      || (batchExemptLang !== undefined && isSameScriptLanguagePair(batchExemptLang, targetLang))

    // 维度1：归一化后完全相同 → 漏翻（同语系变体跳过此检测）
    if (!isSameScript && normalize(src) === normalize(trans)) {
      untranslatedIndices.add(i)
      continue
    }

    // v9.3: 同语系对跳过维度1+维度2，只保留二元守卫。
    // 原因：维度2 的特征字符表/功能词表对 pt/pt-BR 完全相同，天生无区分度，
    // 只能靠"英文占比"代理指标，误报率天然高；zh 对维度2本来就空转（CJK 特征恒真）。
    // 真质检交给校对环节（母语者语感检查）。二元守卫拦"LLM 摆烂返回纯英文"。
    if (isSameScript) {
      if (englishLeakGuard(trans)) {
        debugWarn(
          `[detectUntranslatedText] 同语系对二元守卫命中：译文疑为纯英文`,
          { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
        )
        untranslatedIndices.add(i)
      }
      continue
    }

    // 维度2：目标语言特征检测（针对非英文目标语言）
    // v7.5.3: 扩展支持非英文源语言 — 不仅是 EN→XX，XX→YY 也要检测
    // 如果译文完全没有目标语言特征 → 高度怀疑漏翻
    if (targetLang !== 'en' && srcLang !== targetLang) {
      // 剥离已知指令前缀，得到"纯译文"用于特征分析
      let cleanTrans = trans
      for (const pattern of INSTRUCTION_PATTERNS) {
        cleanTrans = cleanTrans.replace(pattern, '')
      }
      // 剥离指令中常见的描述片段
      cleanTrans = cleanTrans.replace(/The following text.*?translated to\s+\w+/gi, '')
      cleanTrans = cleanTrans.replace(/Do NOT keep it in English\.?/gi, '')
      cleanTrans = cleanTrans.replace(/Even if it contains brand names.*?MUST be translated:?/gi, '')
      cleanTrans = cleanTrans.trim()

      const featureCheck = detectTargetLanguageFeatures(cleanTrans, targetLang)

      if (!featureCheck.hasFeatures) {
        // 拉丁语系语言（de/fr/nl/sv/...）可能不含特征字符
        // v8.2: 功能词检测通过 → 直接确认已翻译，不再检查英文占比
        // 原因：extractNonTargetWords 会把目标语言词（如德语 "Beschleunigung"、西班牙语 "Controlador"）
        // 误判为"非目标词"，因为这些词不含重音符号但确实是目标语言词。
        // 功能词列表（LANG_FUNCTION_WORDS）已经足够可靠，不需要额外的英文占比检查。
        if (LATIN_SCRIPT_LANGS.has(targetLang) && containsLanguageFunctionWords(cleanTrans, targetLang)) {
          // 有目标语言功能词 → 确认已翻译
          // 英文占比合理 → 确认已翻译
        } else {
          // v7.5.3: 源语言特征残留检测 — 如果译文包含源语言特征，说明没翻
          // 适用于 CN→VI（译文有汉字无越南声调）、JA→EN（译文有假名）等
          if (srcLang !== 'en') {
            const srcFeatureCheck = detectTargetLanguageFeatures(cleanTrans, srcLang)
            if (srcFeatureCheck.hasFeatures) {
              debugWarn(
                `[detectUntranslatedText] 维度2检测到漏翻：译文包含源语言(${srcLang})特征`,
                { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
              )
              untranslatedIndices.add(i)
              continue
            }
            // 拉丁源→拉丁目标（FR→DE）：检查是否包含源语言功能词但无目标语言功能词
            if (LATIN_SCRIPT_LANGS.has(targetLang) && LATIN_SCRIPT_LANGS.has(srcLang)) {
              const hasTargetFW = containsLanguageFunctionWords(cleanTrans, targetLang)
              const hasSrcFW = containsLanguageFunctionWords(cleanTrans, srcLang)
              if (!hasTargetFW && hasSrcFW) {
                debugWarn(
                  `[detectUntranslatedText] 维度2检测到漏翻：译文含${srcLang}功能词但无${targetLang}功能词`,
                  { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
                )
                untranslatedIndices.add(i)
                continue
              }
            }
          }

          // 进一步检查：译文中源语言单词占比（针对英文源语言保留此逻辑）
          if (srcLang === 'en') {
            const nonTargetWords = extractNonTargetWords(cleanTrans, glossaryLower)
            const totalWords = cleanTrans.split(/\s+/).filter(w => w.length > 0)
            const englishRatio = totalWords.length > 0 ? nonTargetWords.length / totalWords.length : 0

            if (nonTargetWords.length === 0) {
              continue
            }
            // v8.2: 阈值从 0.6 放宽到 0.70，技术文案中合理保留的英文术语较多
            if (englishRatio > 0.70) {
              debugWarn(
                `[detectUntranslatedText] 维度2检测到漏翻：译文无${targetLang}特征，英文占比${(englishRatio * 100).toFixed(1)}%`,
                { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
              )
              untranslatedIndices.add(i)
              continue
            }
          }
        }
      } else {
        // v8.2: hasFeatures=true 时，不再检查英文占比
        // 原因：拉丁语系技术文案中，目标语言词（如德语 "Beschleunigung"、西班牙语 "Controlador"）
        // 不含重音符号，被 extractNonTargetWords 误判为"非目标词"，导致误判率居高不下。
        // 既然已有特征字符（hasFeatures=true），说明译文确实包含目标语言特征，应该信任特征检测结果。
        // 对于 CJK/AR/TH/RU 等语言，特征字符检测已经足够可靠。
      }
    }

    // 维度3：部分翻译检测（针对多句子文本）
    // TODO: 可以后续实现句子级别的漏翻检测
  }

  return untranslatedIndices
}
