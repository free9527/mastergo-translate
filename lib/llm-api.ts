import { LLMConfig, LANGUAGES, MARKETING_ONLY_TERMS, COMPLIANCE_TERMS, isMarketingTerm, isComplianceTerm } from '@messages/types'
import { API_MAX_RETRIES, API_RETRY_DELAY_MS, API_TIMEOUT_MS } from '@lib/constants'
import { filterRelevantGlossary } from '@lib/glossary-filter'
import { normalizeTextForLLM, protectCjkSpaces } from '@lib/text-normalizer'
import { maskEntities, unmaskEntities, maskEntitiesForProofread, maskGlossaryTerms, unmaskGlossaryTerms } from '@lib/entity-masker'
import { postProcessTranslation, restoreTrademarkSymbols, restoreStorageUnitFormatting, enforceGlossaryTerms, capitalizeFirstLetter, detectTranslationExpansion, detectBrandInjection } from '@lib/post-process'
import {
  IRON_RULES,
  IDENTITY_MISSION,
  getProductLineTone,
  SCENE_CONSTRAINTS,
  getStyleGuide,
  getLangSpecificPrompt,
  getCategoryWordGuide,
  getFewShotExamplesV2,
  OUTPUT_ANCHOR,
  PROOFREAD_SYSTEM_PROMPT,
  getProofreadQualityInstruction,
} from '@lib/prompt-constants'

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
        console.warn('[translate] API ' + res.status + ', retry', attempt + 1, '/', maxRetries)
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)))
        continue
      }
      return res
    } catch (e) {
      lastError = e as Error
      // 网络错误和超时都应该重试，不要直接抛
      if (attempt < maxRetries) {
        console.warn('[translate] request error, retry', attempt + 1, '/', maxRetries, e)
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
  // 中文 vs 英文
  return cjkChars > latinChars ? 'zh-CN' : 'en'
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
// ============================================================
export function detectProductLine(texts: string[], pageName?: string, fileName?: string): string | null {
  // 优先级：文件名 > 页面名 > 文本内容
  // 文件名/页面名通常用产品型号命名，比文本内容更可靠
  const nameResult = detectProductLineFromName(fileName, pageName)
  if (nameResult) return nameResult

  const joined = texts.join(' ')

  // 1. 电竞内存：ARES/THOR + DDR/DIMM
  if (/(ARES|THOR).*(DDR|DIMM|内存|記憶體|メモリ|메모리)/i.test(joined) ||
      /(DDR|DIMM).*(ARES|THOR)/i.test(joined)) {
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
    return 'gaming_ssd'
  }

  // 3. 游戏存储卡：PLAY + card/microSD/SD
  if (/PLAY.*(卡|card|microSD|SD|記憶卡|存储卡)/i.test(joined) ||
      /(卡|card|microSD|SD).*PLAY/i.test(joined)) {
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
    return 'professional_imaging'
  }

  // 5. PC/AI 生产力：NM/NQ/NS/EQ 系列 SSD
  if (/[NMNQ]\d+|NS\d+|EQ\d+/i.test(joined)) {
    return 'pc_productivity'
  }

  // 6. 创新生活：pexar
  if (/pexar|数字相框|數字相框|digital\s*photo\s*frame/i.test(joined)) {
    return 'innovation_lifestyle'
  }

  // 7. 消费存储卡：SILVER/BLUE（含 PLUS/PRO）+ microSD/SD/card
  if (/\b(BLUE|SILVER)\b.*(microSD|\bSD\b|卡|card|記憶卡|存储卡)/i.test(joined) ||
      /(microSD|\bSD\b|卡|card).*\b(BLUE|SILVER)\b/i.test(joined)) {
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
    return 'portable_storage'
  }

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

// ============================================================
// 术语库按场景过滤（仅保留两处硬编码规则：营销过滤 + 合规强制）
// ============================================================

function filterGlossaryByScene(
  glossaryObj: Record<string, string>,
  scenePreset: string,
): Record<string, string> {
  // 电商场景不过滤，全量注入
  if (scenePreset === 'ecommerce' || !scenePreset) return glossaryObj

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

// ============================================================
// 5-Module System Prompt Assembly
// ============================================================

/**
 * Build the complete system prompt from clearly-bounded modules.
 *
 *   M1 IDENTITY      (always)       — Role + Mission, target language
 *   M3 CONSTRAINTS    (always)       — Iron rules + glossary + category + context, English
 *   LANG_SPECIFIC     (always)       — Per-language localization rules, target language
 *   M2 TONE & STYLE   (ecommerce)    — Product tone + style, target language
 *   M4 FEW-SHOT       (ecommerce)    — Examples, target language
 *   M5 OUTPUT         (always)       — Format, English
 *
 * Each rule appears exactly once. No cross-module duplication.
 */
export function buildSystemPrompt(params: {
  targetLang: string
  sourceName: string
  targetDisplayName: string
  productLine: string | null
  scenePreset: string
  style: string
  glossaryHint: string
  categoryWordGuide: string
  langBlock: string
  fewShot: string
  useEnInstruction: boolean
}): string {
  const { targetLang, sourceName, targetDisplayName, productLine, scenePreset, style,
    glossaryHint, categoryWordGuide, langBlock, fewShot, useEnInstruction } = params

  // ── M1: IDENTITY (target language) ──
  const mission = IDENTITY_MISSION[targetLang] || IDENTITY_MISSION['en'] || ''
  const role = `[IDENTITY]\nYou are the Chief Localization Expert for Lexar (雷克沙), specializing in storage, gaming, imaging, and consumer electronics.\n\n[MISSION]\n${mission}`

  // ── M3: CONSTRAINTS (English, always) ──
  const glossaryLabel = '\n\n[GLOSSARY]\nUse the translations below for exact matches (case-insensitive).'
  const glossaryBlock = glossaryHint ? `${glossaryLabel}${glossaryHint}` : ''

  const categoryBlock = categoryWordGuide || ''

  const contextHint = '\n\n[CONTEXT] Independent UI strings from the same design file. Translate each entry independently. When the same source term appears across entries, use the same target term.'

  const constraintsBlock = `${IRON_RULES}${glossaryBlock}${categoryBlock}${contextHint}`

  // ── LANG_SPECIFIC: per-language localization rules (target language, always) ──
  const langBlock_str = langBlock ? `\n\n${langBlock}` : ''

  // ── M2: TONE & STYLE (target language, ecommerce only) ──
  const isEcommerce = scenePreset === 'ecommerce'
  let toneBlock = ''
  if (isEcommerce) {
    const productTone = getProductLineTone(productLine, targetLang)
    const styleGuide = getStyleGuide(style, targetLang)
    const toneParts = [productTone, styleGuide].filter(Boolean)
    if (toneParts.length > 0) {
      toneBlock = '\n\n' + toneParts.join('\n')
    }
  }

  // ── M4: FEW-SHOT (target language, ecommerce only) ──
  const fewShotBlock = (isEcommerce && fewShot)
    ? `\n\n[REFERENCE]\n${fewShot}`
    : ''

  // ── Assembly: M1 → M3 → LANG_SPECIFIC → M2 → M4 → M5 ──
  return `${role}\n\n${constraintsBlock}${langBlock_str}${toneBlock}${fewShotBlock}\n\n${OUTPUT_ANCHOR}`
}

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
): Promise<string[]> {
  const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang

  const detectedSource = sourceLang || detectSourceLanguage(texts)
  const isEnSource = detectedSource === 'en'
  // 指令语言选择：只由目标语言决定，不受源语言影响
  // CJK目标（zh-CN/zh-TW/ja/ko）→ 中文指令（Qwen母语 + 共享字符系统 + 语法接近）
  // 其余目标 → 英文指令（通用拉丁脚本，不会干扰西里尔/阿拉伯/泰文等输出）
  const useEnInstruction = !['zh-CN', 'zh-TW', 'ja', 'ko'].includes(targetLang)

  // 语言名称按指令语言适配，避免英文句子里出现"法语"、中文句子里出现"French"
  const sourceName = getLangDisplayName(detectedSource, useEnInstruction)
  const targetDisplayName = getLangDisplayName(targetLang, useEnInstruction)

  const { texts: cleanTexts, tags: htmlTags } = protectHtmlTags(texts)

  // 源文本预标准化（Unicode NFC + 全角→半角 + 零宽字符移除 + 兼容字符规范化）
  const normalizedTexts = normalizeTextForLLM(cleanTexts)

  // ⚠️ 实体遮蔽必须在 CJK 空格保护之前执行！
  // 仅遮蔽正则匹配的实体（产品型号/URL/Email/测量值），不遮蔽术语。
  const { texts: maskedTexts, entityMap } = maskEntities(normalizedTexts)

  // ⚠️ 术语遮蔽（译前）：将文本中的术语替换为 ZZ{N}ZZ 占位符。
  // LLM 只看到占位符无法扩展为营销文案，译后还原为术语库译文。
  // 使用 ZZ{N}ZZ 而非历史 __TRM_N__ 格式，避免双下划线类似 markdown 导致 Qwen 截断。
  const { texts: glossMaskedTexts, termMap: glossTermMap } = maskGlossaryTerms(maskedTexts, glossaryMap)

  // CJK 空格保护：直接删除 CJK 主导文本中的空格，防止 LLM 误判为条目分隔符
  const spaceProtectedTexts = protectCjkSpaces(glossMaskedTexts)

  // 产品线检测（提前到术语过滤之前）
  const productLine = getEffectiveProductLine(config, texts, pageName, fileName)

  // 术语注入：优先使用任务级预计算提示词（跨批次 system prompt 一致 → API 缓存命中）
  // 无预计算时回退到逐批次术语过滤（兼容旧调用路径）
  let glossaryHint: string
  if (taskGlossaryHint !== undefined) {
    glossaryHint = taskGlossaryHint
  } else {
    let glossaryObj: Record<string, string> = {}
    for (const [k, v] of glossaryMap.entries()) { glossaryObj[k] = v }
    glossaryObj = filterGlossaryByScene(glossaryObj, config.scenePreset)
    const filtered = filterRelevantGlossary(glossaryObj, texts, 100)
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

  // 使用 [N] 格式包裹每条文本，防止 LLM（Qwen）将文本内部空格误判为条目分隔符
  // 含空格的文本加引号包裹，LLM 识别为单个实体
  const quotedIndices = new Set<number>()
  const textList = spaceProtectedTexts.map((t, i) => {
    if (/\s/.test(t)) {
      quotedIndices.add(i)
      return `[${i + 1}] "${t}"`
    }
    return `[${i + 1}] ${t}`
  }).join('\n')

  // few-shot 示例
  const fewShot = getFewShotExamplesV2(detectedSource, targetLang, productLine, config.translationStyle, 2)

  // 品类词对照表 (v7: all languages, filtered by product line)
  const categoryWordGuide = getCategoryWordGuide(targetLang, productLine)

  // 语言专属提示词
  const langBlock = getLangSpecificPrompt(targetLang)

  // 5-Module System Prompt Assembly
  const systemPrompt = buildSystemPrompt({
    targetLang,
    sourceName,
    targetDisplayName,
    productLine,
    scenePreset: config.scenePreset,
    style: config.translationStyle,
    glossaryHint,
    categoryWordGuide,
    langBlock,
    fewShot,
    useEnInstruction,
  })
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
  // 对源文本被引号包裹的条目，自动剥离译文首尾的配对引号。
  if (quotedIndices.size > 0) {
    result = result.map((t, i) => {
      if (!quotedIndices.has(i)) return t
      // 仅当首尾是配对引号时才剥离（避免剥离译文本身包含的引号）
      if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
        const inner = t.slice(1, -1)
        // 防止过度剥离：如果内部还有引号（嵌套），保留原样
        if (inner.includes('"')) return t
        return inner
      }
      return t
    })
  }

  // 还原实体占位符（必须在 restoreHtmlTags 之前）
  if (entityMap.size > 0) {
    result = unmaskEntities(result, entityMap)
  }

  // 还原术语占位符 ZZ{N}ZZ → glossaryTarget（在实体还原之后，避免混淆）
  if (glossTermMap.size > 0) {
    const unmasked = unmaskGlossaryTerms(result, glossTermMap)
    if (unmasked.missingIndices.size > 0) {
      console.warn(
        '[translateBatch] glossary unmask: placeholder missing for',
        unmasked.missingIndices.size,
        'indices, keeping source text as fallback',
        [...unmasked.missingIndices].map(j => ({ idx: j, src: texts[j]?.slice(0, 50) })),
      )
      // 缺少占位符的条目回退到源文
      for (const idx of unmasked.missingIndices) {
        unmasked.texts[idx] = texts[idx]
      }
    }
    result = unmasked.texts
  }

  // 恢复 HTML 标签
  if (htmlTags.size > 0) {
    result = restoreHtmlTags(result, htmlTags)
  }

  // 语言特定后处理
  result = result.map(t => postProcessTranslation(t, targetLang))

  // 品牌注入检测：在术语库校准之前检测 LLM 是否添加了源文中不存在的品牌名/规格
  // 必须在校准之前运行，避免术语库正确应用的跨语言品牌名（如 雷克沙）被误判
  const injectionResult = detectBrandInjection(texts, result, glossaryMap)
  if (injectionResult.injectedIndices.size > 0) {
    console.warn(
      `[translateBatch] 检测到 ${injectionResult.injectedIndices.size} 条品牌/规格注入，已回退到源文`,
      [...injectionResult.injectedIndices].map(j => ({
        source: texts[j].slice(0, 50),
        injected: result[j].slice(0, 80),
        fallback: injectionResult.texts[j].slice(0, 50),
      })),
    )
    result = injectionResult.texts
  }

  // 术语库强制校准（翻译后直接替换，零 token 开销）
  result = enforceGlossaryTerms(texts, result, glossaryMap)

  // 商标符号还原（兜底：原文有则译文必有，原文无则不添加）
  result = restoreTrademarkSymbols(texts, result)

  // 存储单位格式还原：原文数字和单位连写时，恢复译文的连写格式
  // 修复 AI 常见错误：900MB/s → 900 MB/s 还原为 900MB/s
  result = restoreStorageUnitFormatting(texts, result)

  // 首字母大写
  result = result.map(t => capitalizeFirstLetter(t))

  // 译文扩展检测：检测 LLM 是否异常扩展了译文（最后一道防线）
  const expansionResult = detectTranslationExpansion(texts, result)
  if (expansionResult.expandedIndices.size > 0) {
    console.warn(
      `[translateBatch] 检测到 ${expansionResult.expandedIndices.size} 条异常扩展译文，已自动截断`,
      [...expansionResult.expandedIndices].map(j => ({
        source: texts[j].slice(0, 50),
        original: result[j].slice(0, 80),
        fixed: expansionResult.texts[j].slice(0, 80),
      })),
    )
    result = expansionResult.texts
  }

  // 批次内重复译文检测：不同源文产生完全相同译文（>20字符）= 交叉污染
  const MIN_DUP_LEN = 20
  const groups = new Map<string, number[]>()
  for (let i = 0; i < result.length; i++) {
    if (result[i].length < MIN_DUP_LEN) continue
    const key = result[i]
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(i)
  }
  for (const [translation, indices] of groups) {
    if (indices.length > 1) {
      const uniqueSources = new Set(indices.map(j => texts[j]))
      if (uniqueSources.size > 1) {
        console.warn(
          `[translateBatch] 批次内交叉污染：${indices.length} 条不同源文 → 相同译文，已回退源文`,
          indices.map(j => ({ idx: j, src: texts[j].slice(0, 50) })),
        )
        for (const j of indices) {
          result[j] = texts[j]
        }
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
}

export async function proofreadBatch(
  items: ProofreadInput[],
  targetLang: string,
  glossaryMap: Map<string, string>,
  config: LLMConfig,
  pageName?: string,
  fileName?: string,
  taskGlossaryHint?: string,
): Promise<ProofreadResult[]> {
  const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang

  const sourceTexts = items.map(it => it.sourceText)
  const detectedSource = detectSourceLanguage(sourceTexts)
  const isEnSource = detectedSource === 'en'
  // 指令语言选择：只由目标语言决定
  // CJK目标→中文指令，其余→英文指令
  const useEnInstruction = !['zh-CN', 'zh-TW', 'ja', 'ko'].includes(targetLang)
  const targetDisplayName = getLangDisplayName(targetLang, useEnInstruction)

  // 校对也做产品线检测，补全闭环
  const productLine = getEffectiveProductLine(config, sourceTexts, pageName, fileName)
  const categoryWordGuide = getCategoryWordGuide(targetLang, productLine)

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

  const transLabel = useEnInstruction ? 'Trans' : '译'
  const textList = items.map((it, i) => `[${i + 1}] ${proofreadSpaceProtected[i]}\n${transLabel}：${maskedTranslations[i]}`).join('\n\n')

  // ⛔ 校对环节术语反补全闭环：术语 hint 的 label 不含反补全指令，
  // 需在注入前追加以防校对模型参照术语格式"纠正"译文（添加原文没有的品牌/规格）
  if (glossaryHint) {
    glossaryHint += useEnInstruction
      ? '\n⛔ Above glossary: exact match only. Do NOT "correct" translations by completing partial product names (e.g., do not change "PLAY X PCIe 4.0 SSD" to "Lexar PLAY X M.2 PCIe 4.0 NVMe SSD" based on glossary patterns).'
      : '\n⛔ 以上术语仅当完全一致时才套用。严禁参照术语格式"纠正"译文，将部分产品名补全为全称。'
  }

  // v7: QA Checklist proofread (not re-translate)
  // Inject IRON_RULES so proofread LLM works under the same constraints as translation LLM
  const langBlock = getLangSpecificPrompt(targetLang)
  const qualityInstruction = getProofreadQualityInstruction(targetLang)
  const systemPrompt = IRON_RULES + '\n\n' + PROOFREAD_SYSTEM_PROMPT + glossaryHint + categoryWordGuide + langBlock + qualityInstruction

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

  const results: ProofreadResult[] = items.map(() => ({ text: '', reason: '' }))
  let jsonParsed = false

  // 尝试 JSON 解析
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ i: number; text?: string; reason?: string }>
      for (const entry of parsed) {
        if (entry.i >= 1 && entry.i <= results.length) {
          // 清洗 [N] 前缀（LLM 可能在 text 字段中带入了索引标记）
          let entryText = (entry.text || '').trim()
          entryText = entryText.replace(/^\[\d+\]\s*/, '')
          const isOK = /^OK[。.]?\s*$/i.test(entryText)
          results[entry.i - 1] = {
            text: isOK ? '' : entryText,
            reason: (entry.reason || '').trim(),
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
          if (parts[0] !== 'OK') {
            results[idx] = {
              text: parts[0].trim(),
              reason: (parts[1] || '').trim(),
            }
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
    return t
  })

  // 校对后代码级品牌注入检测（校对 LLM 在校正过程中可能引入新错误）
  const proofInjectionResult = detectBrandInjection(
    items.map(it => it.sourceText),
    resultTexts,
    glossaryMap,
  )
  if (proofInjectionResult.injectedIndices.size > 0) {
    console.warn(
      `[proofreadBatch] 校对后检测到 ${proofInjectionResult.injectedIndices.size} 条品牌/规格注入，已回退`,
      [...proofInjectionResult.injectedIndices].map(j => ({
        source: items[j].sourceText.slice(0, 50),
        proofread: resultTexts[j].slice(0, 80),
      })),
    )
    resultTexts = proofInjectionResult.texts
  }

  // 校对后译文扩展检测
  const proofExpansionResult = detectTranslationExpansion(
    items.map(it => it.sourceText),
    resultTexts,
  )
  if (proofExpansionResult.expandedIndices.size > 0) {
    console.warn(
      `[proofreadBatch] 校对后检测到 ${proofExpansionResult.expandedIndices.size} 条异常扩展，已截断`,
      [...proofExpansionResult.expandedIndices].map(j => ({
        source: items[j].sourceText.slice(0, 50),
        proofread: resultTexts[j].slice(0, 80),
        fixed: proofExpansionResult.texts[j].slice(0, 80),
      })),
    )
    resultTexts = proofExpansionResult.texts
  }

  // 校对后批次内重复检测
  const MIN_DUP_LEN = 20
  const dupGroups = new Map<string, number[]>()
  for (let i = 0; i < resultTexts.length; i++) {
    if (resultTexts[i].length < MIN_DUP_LEN) continue
    const key = resultTexts[i]
    if (!dupGroups.has(key)) dupGroups.set(key, [])
    dupGroups.get(key)!.push(i)
  }
  for (const [translation, indices] of dupGroups) {
    if (indices.length > 1) {
      const uniqueSources = new Set(indices.map(j => items[j].sourceText))
      if (uniqueSources.size > 1) {
        console.warn(
          `[proofreadBatch] 校对后交叉污染：${indices.length} 条不同源文 → 相同译文，已回退`,
          indices.map(j => ({ idx: j, src: items[j].sourceText.slice(0, 50) })),
        )
        for (const j of indices) {
          resultTexts[j] = items[j].sourceText
        }
      }
    }
  }

  for (let i = 0; i < results.length; i++) {
    results[i].text = resultTexts[i]
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
