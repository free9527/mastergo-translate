import { LLMConfig, LANGUAGES, isMarketingTerm, isComplianceTerm } from '@messages/types'
import { API_MAX_RETRIES, API_RETRY_DELAY_MS, API_TIMEOUT_MS, DEBUG_MODE, MIN_DUP_LEN, PRODUCT_LINE_CACHE_SIZE } from '@lib/constants'
import { filterRelevantGlossary } from '@lib/glossary-filter'
import { normalizeTextForLLM, protectCjkSpaces } from '@lib/text-normalizer'
import { maskEntities, unmaskEntities, maskEntitiesForProofread, maskGlossaryTerms, unmaskGlossaryTerms } from '@lib/entity-masker'
import { postProcessTranslation, restoreTrademarkSymbols, restoreStorageUnitFormatting, enforceGlossaryTerms, capitalizeFirstLetter, detectTranslationExpansion, detectBrandInjection, validateNumbers, cleanKey } from '@lib/post-process'
import {
  IDENTITY_MISSION,
  CORE_PRINCIPLES,
  CORE_PRINCIPLES_ZH,
  CORE_PRINCIPLES_LEAN,
  CORE_PRINCIPLES_LEAN_ZH,
  BRAND_NAME_RULE,
  BRAND_NAME_RULE_ZH,
  getStyleCard,
  renderLangForTranslate,
  buildProofreadSystemPrompt,
  isCJKTarget,
  PRODUCT_NAME_PARSE_PROMPT,
  PRODUCT_NAME_PARSE_PROMPT_ZH,
} from '@lib/prompt-constants'
import { getFewShotExamples } from '@lib/few-shot-examples'
import { isBuiltinThirdPartyWholeText, isBuiltinModelSegment, BUILTIN_THIRD_PARTY_ENTRIES, BUILTIN_THIRD_PARTY_ALL_KEYS } from '@lib/third-party-models'
import { shouldSkipGlossaryEntry } from '@lib/glossary-guard'
/**
 * 内置第三方遮蔽表（v11.13）：第三方词条的 source→source identity Map。
 *
 * 与 BUILTIN_THIRD_PARTY_ENTRIES（GlossaryEntry[]，进 UI 层 buildGlossaryMaps）分工：
 * UI 层 Map 供徽章/待确认面板；本 Map 供 llm-api 内部（S1 短路、isUntranslatable
 * 兜底），保证第三方词条即使 UI 层术语库被替换/清空，翻译管道自身的豁免链仍完整。
 * 同一批词条两处各持一份 Map，是「豁免链不依赖外部注入」的冗余设计。
 */
const BUILTIN_THIRD_PARTY_MASK_MAP: Map<string, string> = new Map(
  BUILTIN_THIRD_PARTY_ENTRIES.map(e => [e.source, e.source])
)

import { uiLog } from '@lib/ui-debug-log'

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
// 源语言检测（v10.0：已收口至 lib/lang-detect.ts 单一事实源，此处 re-export 兼容既有导入）
// ============================================================
export {
  detectSourceLanguage, detectSingleTextLanguage, detectLatinLang,
  getScriptClass, getTargetScript, isSameScriptLanguagePair, hasFunctionWords,
  LATIN_FUNCTION_WORDS, LATIN_DISTINCTIVE_WORDS, LATIN_DISTINCTIVE_CHARS,
  TARGET_SCRIPT_PATTERNS,
} from '@lib/lang-detect'
import {
  detectSourceLanguage, detectSingleTextLanguage, detectLatinLang,
  getScriptClass, getTargetScript, isSameScriptLanguagePair, hasFunctionWords,
  TARGET_SCRIPT_PATTERNS,
} from '@lib/lang-detect'
import { isSameLanguageExempt } from '@lib/keep-source'

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
  includeRemediation?: boolean  // v11.5: true 时注入补救条款（BRAND + 补全/品类精度/错词）——统一重试专用，首调不传
}): string {
  const { targetLang, langBlock, styleCard, fewShotBlock, glossaryHint, includeRemediation = false } = params

  // CJK 目标使用中文指令，其余使用英文指令
  const isZhInstruction = isCJKTarget(targetLang)

  // ── IDENTITY (instruction language) ──
  const role = isZhInstruction
    ? `[身份]\n你是 Lexar（雷克沙）存储产品的本地化专家。你产出自然、精准的译文，读起来像母语者写的一样。`
    : `[IDENTITY]\nYou translate Lexar storage product content. Your translations read as if originally written in the target language by a native speaker.`

  // ── CORE PRINCIPLES (instruction language) ──
  // v11.5: 首调用 LEAN（补救条款移到重试层，注意力集中）；重试 includeRemediation=true 时拼回全量
  const principles = isZhInstruction
    ? (includeRemediation ? CORE_PRINCIPLES_ZH : CORE_PRINCIPLES_LEAN_ZH)
    : (includeRemediation ? CORE_PRINCIPLES : CORE_PRINCIPLES_LEAN)

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

  // ── BRAND/PRODUCT NAMES (instruction language) ──
  // v10.6.2: 品牌/产品线词不直译 —— Lexar 官方各语言市场统一用英文产品名
  // （"Lexar Professional SILVER PLUS" 在繁中/日/韩/德法官网都是英文原名）。
  // LLM 容易把 Professional/GOLD/ARMOR 等英文词直译成"專業級/金色/装甲"（2026-08-03 实机
  // zh-TW 把 "Lexar Professional" 译成 "Lexar專業級"）。同语系转换场景（zh-CN→zh-TW）
  // 源文是中文，LLM 更容易把嵌入的英文产品词一并翻译。
  // v11.5: 移出首调（补救型条款）——仅 includeRemediation=true（统一重试）时注入。
  // 首调安全依据：术语遮蔽（术语库含全部品牌名）+ S5 enforceGlossaryTerms + 校对 CHECK 2 三重兜底。
  const brandNameRule = includeRemediation
    ? '\n' + (isZhInstruction ? BRAND_NAME_RULE_ZH : BRAND_NAME_RULE)
    : ''

  // ── OUTPUT (instruction language) ──
  // v12.0 第2步：翻译输出 schema 化——[N] 逐行 → {"translations":[{i,text}]} JSON object。
  // 实测（tests/test-schema-live.ts A/C 段）：json_object 模式下 ↵ 字面保留、15 条满批完整、
  // 占位符/引号/emoji/超长句无损。逐行解析兜底在 llm-api.ts 保留（防御代码不删）。
  const outputFormat = isZhInstruction
    ? `\n[输出格式]\n仅输出合法 JSON 对象：{"translations":[{"i":<1-based 索引>,"text":"<译文>"}]}\n- 每条都要有对应项，i 与输入 [N] 一一对应\n- 纯 JSON，无 markdown 代码块，无解释\n⛔ ↵ 是字面字符标记，不是换行指令 — 在 text 中输出字符 "↵"，不要转为真实换行。\n→ 开始翻译：`
    : `\n[OUTPUT]\nOutput ONLY a valid JSON object: {"translations":[{"i":<1-based index>,"text":"<translation>"}]}\n- Include ALL items — "i" must match the input [N] indices exactly\n- Raw JSON only, no markdown code blocks, no explanations\n⛔ The ↵ symbol is a LITERAL CHARACTER, NOT a line break — output it as the characters "↵" inside text strings.\nDo not wrap translations in quotation marks unless the source text itself is quoted.\n→ Output translations now:`

  // ── Assembly: IDENTITY → PRINCIPLES → MISSION → STYLE → FEWSHOT → LANG_RULES → CONTEXT → BRAND → GLOSSARY → OUTPUT ──
  return `${role}\n\n${principles}\n\n[MISSION·${targetLang}]\n${mission}${styleCard}${fewShotBlock}${langBlock_str}${contextHint}${brandNameRule}${glossaryBlock}${outputFormat}`
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

// ============================================================
// v10.4: 管道阶段化 — auditStage 不变量审计
// ============================================================
// 背景（v9.11 根因）：translateBatch 922 行单函数、result[] 23 处赋值，
// 中间检测点快照被后续兜底链静默覆盖，无任何机制能发现。
// v10.4 不改逻辑，只在每个阶段出口做只读审计：
//   不变量1 长度恒等（result.length === texts.length，漂移即阶段函数违约）
//   不变量2 S5(还原)之后不得残留 __XXX_N__ 占位符
//   不变量3 条目必须是字符串（不得产生 null/undefined）
// 只报警不改数据——审计里做隐式修复 = 给审计本身埋 v9.11 同款雷（见 HANDOFF v10.4）。
// S4 出口长度漂移沿用既有 L839 归一化（既有行为），审计只记录漂移量。
const PLACEHOLDER_RE = /__[A-Z]+_\d+__/
function auditStage(stage: string, texts: string[], result: string[]): void {
  if (result.length !== texts.length) {
    uiLog('translate', `⛔ [audit:${stage}] 长度漂移 源${texts.length}条→译${result.length}条`)
    debugWarn(`[audit:${stage}] ⛔ length mismatch`, { expected: texts.length, got: result.length })
  }
  if (stage >= 'S5') {
    const residual = result.filter(t => typeof t === 'string' && PLACEHOLDER_RE.test(t)).length
    if (residual > 0) {
      uiLog('translate', `⛔ [audit:${stage}] ${residual} 条残留 __XXX_N__ 占位符`)
      debugWarn(`[audit:${stage}] ⛔ residual placeholders`, { residual })
    }
  }
  const bad = result.filter(t => typeof t !== 'string').length
  if (bad > 0) {
    uiLog('translate', `⛔ [audit:${stage}] ${bad} 条非字符串条目`)
    debugWarn(`[audit:${stage}] ⛔ non-string entries`, { bad })
  }
}

// ═══════════════════════════════════════════════════════════════
// v11.3: 产品名槽位解析 — LLM 兜底（代码判定失败时的语义裁决）
// ═══════════════════════════════════════════════════════════════
// 原则：LLM 只做"是不是产品名+系列名是什么"的判断，不输出译名。
//       译名由代码按五槽位规则渲染（20 语种风格统一），LLM 不碰翻译。
// 校验：代码对 LLM 输出做形式校验（子串/重组/非空），防 LLM 编造。
// ═══════════════════════════════════════════════════════════════

/** LLM 产品名解析结果 */
export interface LLMProductNameParse {
  /** 是否判定为独立产品名 */
  isProductName: boolean
  /** 系列名（源文原样，空字符串表示无） */
  series: string
  /** 型号代码（源文原样，空字符串表示无） */
  model: string
}

/**
 * 用 LLM 解析产品名槽位（代码判定失败时的兜底）。
 *
 * 触发条件（由调用方保证）：强锚点(Lexar®) + 品类词指纹 + 代码解析失败。
 * LLM 输出结构化 JSON（isProductName/series/model），代码做形式校验：
 *   1. series 必须是源文子串（防编造）
 *   2. series + model + 品类词重组 ≈ 源文（防漏段/加段）
 *   3. 校验不通过 → 返回 null（放弃保护，走正常管道）
 *
 * @param sourceText 整条原文（去®）
 * @param targetLang 目标语言（决定指令语言：CJK→中文，其余→英文）
 * @param config     LLM 配置
 * @returns 解析结果（校验通过）或 null（校验失败/LLM 判非产品名）
 */
export async function parseProductNameWithLLM(
  sourceText: string,
  targetLang: string,
  config: LLMConfig,
): Promise<LLMProductNameParse | null> {
  const useEnInstruction = !isCJKTarget(targetLang)
  const systemPrompt = useEnInstruction ? PRODUCT_NAME_PARSE_PROMPT : PRODUCT_NAME_PARSE_PROMPT_ZH

  try {
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
          { role: 'user', content: `Analyze: "${sourceText}"` },
        ],
        temperature: 0.1,  // 低温度，求稳定
      }),
    })

    if (!res.ok) {
      uiLog('translate', `产品名LLM解析 API 失败 (${res.status}): ${sourceText.slice(0, 40)}`)
      return null
    }

    const data = res.json as Record<string, unknown>
    const content: string = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || ''

    // 提取 JSON（LLM 可能包裹 markdown 代码块）
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      uiLog('translate', `产品名LLM解析无JSON: ${sourceText.slice(0, 40)} → ${content.slice(0, 80)}`)
      return null
    }

    let parsed: LLMProductNameParse
    try {
      parsed = JSON.parse(jsonMatch[0]) as LLMProductNameParse
    } catch {
      uiLog('translate', `产品名LLM解析JSON解析失败: ${sourceText.slice(0, 40)} → ${jsonMatch[0].slice(0, 80)}`)
      return null
    }

    // 校验 1：isProductName 必须是布尔值
    if (typeof parsed.isProductName !== 'boolean') {
      uiLog('translate', `产品名LLM解析isProductName非布尔: ${sourceText.slice(0, 40)}`)
      return null
    }

    // LLM 判非产品名 → 返回结果（调用方放弃保护）
    if (!parsed.isProductName) {
      return { isProductName: false, series: '', model: '' }
    }

    // 校验 2：series 必须是源文子串（或空字符串）
    const series = (parsed.series || '').trim()
    if (series && !sourceText.includes(series)) {
      uiLog('translate', `产品名LLM解析series非源文子串: "${series}" ∉ "${sourceText.slice(0, 40)}"`)
      return null
    }

    // 校验 3：model 必须是源文子串（或空字符串）
    const model = (parsed.model || '').trim()
    if (model && !sourceText.includes(model)) {
      uiLog('translate', `产品名LLM解析model非源文子串: "${model}" ∉ "${sourceText.slice(0, 40)}"`)
      return null
    }

    // 校验 4：series 非空且是单 token 描述词 → 拒绝（防 LLM 把 Fast 判为系列名）
    // 与代码 DESCRIPTIVE_WORDS 对齐，但只校验 LLM 输出的 series，不拦截代码路径
    const DESCRIPTIVE_CHECK = new Set(['fast', 'high', 'speed', 'new', 'ultra-fast', 'ultrafast'])
    if (series && DESCRIPTIVE_CHECK.has(series.toLowerCase())) {
      uiLog('translate', `产品名LLM解析series为描述词: "${series}"，拒绝`)
      return null
    }

    uiLog('translate', `产品名LLM解析成功: "${sourceText.slice(0, 40)}" → series="${series}" model="${model}"`)
    return { isProductName: true, series, model }

  } catch (e) {
    uiLog('translate', `产品名LLM解析异常: ${sourceText.slice(0, 40)} → ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}


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
  glossaryEnMap?: Map<string, string>,  // v9.10: EN 视图，供 isUntranslatable 豁免（防全语言视图误判豁免 R5）
  untranslatedIndices?: Set<number>,    // v9.11: 输出参数 — 最终仍漏翻（保留原文）的条目索引，供 UI 标记翻译失败
  misspelledIndices?: Set<number>,      // v10.6: 输出参数 — 疑似错词被回退保留原形的条目索引，供 UI 单独标记"疑似拼写错误"（与漏翻区分）
  expansionIndices?: Set<number>,       // v10.8: 输出参数 — 译文显著超长的条目索引，透出给校对层作长度异常 hint（不再自动截断）
  firstCallAnomalyIndices?: Set<number>, // v11.5: 输出参数 — 首调（重试前）检出的异常条目索引（截断+漏翻），供实机观测首调质量（prompt 减肥效果验证）
): Promise<string[]> {
  // ═══════════════════════════════════════════════════════════
  // S1: 预处理（产出 texts 变体，不动 result）
  //     HTML标签保护 → NFC标准化 → 术语整条短路（glossaryMatchedIndices）
  // ═══════════════════════════════════════════════════════════
  const detectedSource = sourceLang || detectSourceLanguage(texts)
  const isEnSource = detectedSource === 'en'
  if (!_isRetry) {
    uiLog('translate', `批次开始: ${texts.length}条 → ${targetLang}, 源语言判定=${detectedSource}${sourceLang ? '(手动)' : '(自动)'}`)
  }
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
  // v11.13: 内置第三方词条先注册——不依赖 UI 层 buildGlossaryMaps 注入，
  // 用户术语库被替换/清空时第三方型号 S1 短路依然生效（内置优先，用户不可覆盖）。
  for (const [key, value] of BUILTIN_THIRD_PARTY_MASK_MAP.entries()) {
    glossaryLookup.set(key.toLowerCase().replace(/[®™©]/g, '').trim(), value)
  }
  for (const [key, value] of glossaryMap.entries()) {
    const k = key.toLowerCase().replace(/[®™©]/g, '').trim()
    if (!glossaryLookup.has(k)) glossaryLookup.set(k, value)  // 内置优先，first-wins
  }
  const preprocessedTexts = normalizedTexts.map((text, i) => {
    const lookupKey = text.toLowerCase().replace(/[®™©]/g, '').trim()
    const matchedValue = glossaryLookup.get(lookupKey)
    // v11.14: 脏条目（句形 key + identity/乱码™值）不走整条短路——该句走正常 LLM
    // 翻译（2026-08-17 事故根治）；句形 key + 正经译文值的策展条目照常短路。
    if (matchedValue && shouldSkipGlossaryEntry(text, matchedValue)) {
      uiLog('glossary', `v11.14 脏条目跳过 S1 短路: "${text.slice(0, 60)}"`)
      return text
    }
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

  // ═══════════════════════════════════════════════════════════
  // S2: 遮蔽（产出 texts 变体，不动 result）
  //     术语遮蔽(__GLOSSARY_N__) → 实体遮蔽(__PRD_N__等) → CJK空格保护 → ™剥离
  //     ⚠️ 顺序是 v9.2 修正结果：术语必须先于实体，见下方详细注释
  // ═══════════════════════════════════════════════════════════
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
  uiLog('translate', `S1-S2 预处理+遮蔽完成: ${texts.length}条, 术语短路${glossaryMatchedIndices.size}条, 术语遮蔽${termMap.size}词, 实体遮蔽${entityMap.size}词`)

  // ═══════════════════════════════════════════════════════════
  // S3: Prompt 构建（产品线/风格/术语提示/风格卡/few-shot，不动 result）
  // ═══════════════════════════════════════════════════════════
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
  // v9.11: 标注改用批次级 detectedSource（detectSourceLanguage 有拉丁细分能力），
  //        弃用逐条 detectSingleTextLanguage —— 它是字符集级检测，拉丁文本恒返回 'en'（v9.3 死代码），
  //        pt 源文被标注 (en→ja) 会让模型困惑"这不是英文"而回显原文（2026-07-31 实测漏翻根因）。
  const quotedIndices = new Set<number>()
  const textList = tmStrippedTexts.map((t, i) => {
    const srcLang = detectedSource
    // 行首 * 替换为 ※，避免 LLM 将其解析为 markdown 列表标记导致漏翻
    const escaped = t.replace(/^\*\s*/, '※ ')
    if (/\s/.test(escaped)) {
      quotedIndices.add(i)
      return `[${i + 1}] (${srcLang}→${targetLang}) "${escaped}"`
    }
    return `[${i + 1}] (${srcLang}→${targetLang}) ${escaped}`
  }).join('\n')

  // v8.0: 语言专属提示词（仅 品类词 + rules，tone/style/compliance/scene 由 getStyleCard 统一注入）
  // v11.5: 首调不注入 commonErrors（补救型历史事故对照表移到重试层，首调注意力集中）
  const langBlock = renderLangForTranslate(targetLang, productLine, /* includeCommonErrors */ forceTranslate)

  // v8.0: 统一风格卡片（替代分散的 productTone + styleGuide + sceneConstraints）
  const styleCard = getStyleCard(targetLang, productLine, effectiveStyle || 'standard', config.scenePreset)

  // v8.0: 目标语言 Few-Shot 示例（按场景+风格动态选择类型）
  // v8.6: 使用实际检测到的源语言，而非硬编码 'en'
  const fewShot = getFewShotExamples(detectedSource, targetLang, 2, config.scenePreset, effectiveStyle)
  const fewShotBlock = fewShot ? `\n[EXAMPLES]\n${fewShot}` : ''

  // System Prompt: IDENTITY → CORE_PRINCIPLES → MISSION → STYLE → FEWSHOT → LANG_RULES → GLOSSARY → OUTPUT
  // v11.5: 统一重试（forceTranslate=true）换用瘦身 prompt——去风格卡/few-shot，补救条款全量回归。
  // 效果：重试 prompt 从"首调全文+7行"（~95行）变为"精简骨架+全部补救"（~40行，减60%+），
  // 且补救条款（BRAND/补全/品类精度/错词/commonErrors）在重试层全量注入，首调出的错重试全能兜住。
  let systemPrompt = buildSystemPrompt({
    targetLang,
    langBlock,
    styleCard: forceTranslate ? '' : styleCard,
    fewShotBlock: forceTranslate ? '' : fewShotBlock,
    glossaryHint,
    includeRemediation: forceTranslate,
  })

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

  // ═══════════════════════════════════════════════════════════
  // S4: LLM 调用 + 结果解析（产生 result，出口长度归一化到 texts.length）
  // ═══════════════════════════════════════════════════════════
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
      // v12.0 第2步：翻译输出 schema 化——API 层硬约束 JSON object（实测 A/C 段全绿）
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    uiLog('translate', `❌ API 请求失败 (${res.status}): ${res.text.slice(0, 150)}`)
    throw new Error(`API 请求失败 (${res.status}): ${res.text.slice(0, 200)}`)
  }

  const data = res.json as Record<string, unknown>
  const content: string = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || ''

  if (!_isRetry) {
    uiLog('translate', `LLM 原始返回(截断600字): ${content.slice(0, 600)}`)
  } else {
    uiLog('translate', `重试 LLM 原始返回(截断300字): ${content.slice(0, 300)}`)
  }

  let result: string[] = []

  // 尝试 JSON 解析（优先，v12.0 起 json_object 模式强制 {"translations":[...]}）
  // i 映射修复：entry.i（1-based 索引）优先于数组位置——防模型乱序输出时译文错位
  const jsonMatch = content.match(/\{[\s\S]*"translations"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { translations?: Array<{ i?: number; text?: string }> }
      if (parsed.translations && Array.isArray(parsed.translations)) {
        const hasValidIndex = parsed.translations.some(e => typeof e.i === 'number' && e.i >= 1)
        if (hasValidIndex) {
          // v12.0: i 索引映射（乱序安全）
          const byIndex: string[] = []
          for (const entry of parsed.translations) {
            if (typeof entry.i === 'number' && entry.i >= 1 && entry.text) byIndex[entry.i - 1] = entry.text.trim()
          }
          // 无 i 或 i 越界的按顺序补位（i 缺失场景的保守兜底）
          let cursor = 0
          for (const entry of parsed.translations) {
            if (!entry.text) continue
            if (typeof entry.i === 'number' && entry.i >= 1) continue
            while (byIndex[cursor] !== undefined) cursor++
            byIndex[cursor++] = entry.text.trim()
          }
          for (let i = 0; i < byIndex.length; i++) result.push(byIndex[i] ?? '')
          result = result.filter((_, i) => i < texts.length || byIndex[i] !== undefined)
        } else {
          // 旧形态：无 i 字段，按数组位置（v12.0 前模型的偶发 JSON 输出）
          for (const entry of parsed.translations) {
            if (entry.text) result.push(entry.text.trim())
          }
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

  auditStage('S4', texts, result)
  uiLog('translate', `S4 LLM调用+解析完成: ${result.length}条, 空结果${result.filter(t => !t).length}条`)

  // ═══════════════════════════════════════════════════════════
  // S5: 还原（unmask → restoreHtmlTags → postProcessTranslation）
  //     出口后不得残留 __XXX_N__ 占位符（不变量2 起点）
  // ═══════════════════════════════════════════════════════════
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

  auditStage('S5', texts, result)
  uiLog('translate', `S5 还原完成: 实体还原${entityMap.size}词, 术语还原${termMap.size}词`)

  // ═══════════════════════════════════════════════════════════
  // S6: 安全后处理（品牌注入→术语校准→v9.9合规→™还原→数字校验→存储单位→首字母→扩展检测→重复检测）
  // ═══════════════════════════════════════════════════════════
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

  // v9.9: 术语合规校验 — 整条源文命中术语库时，译文必须等于术语库目标值（硬约束）
  // 根因：LLM 可能对整条术语自由发挥（如 pt "Cartão Lexar..." → ja "Lexar®プロフェッショナル..."），
  // 而 enforceGlossaryTerms 的子串校准在"译文找不到源术语子串"时静默放弃。
  // 此校验是兜底：只要源文整条 cleanKey 命中，译文被代码锁死为术语库值，不依赖 LLM 配合。
  // 仅作用于"整条命中"（保守）：嵌入句的术语合规由遮蔽 + enforceGlossaryTerms 负责，不在此强制。
  if (normalizedGlossaryMap) {
    for (let i = 0; i < result.length; i++) {
      if (glossaryMatchedIndices.has(i)) continue        // 短路路径已处理
      if (revertedIndices.has(i)) continue                // 品牌注入回退源文的条目跳过
      if (!(texts[i] || '').trim()) continue
      const expected = normalizedGlossaryMap.get(cleanKey(texts[i]))
      if (expected && shouldSkipGlossaryEntry(texts[i], expected)) continue   // v11.14: 脏条目（identity/乱码™值）不锁定
      if (expected && result[i] !== expected) {
        debugWarn('[translateBatch] 术语合规校验：整条命中术语库但译文不符，已锁定为术语库值', {
          source: texts[i].slice(0, 60), was: result[i].slice(0, 60), fixed: expected.slice(0, 60),
        })
        result[i] = expected
      }
    }
  }

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

  // 译文扩展检测（v10.8 起：只检测不截断，长度信号透出给校对层语义裁决）
  // 长度≠加戏（de/pt/fr 天然长 50-90%），自动截断会把合法详尽译文切成半截句上画布。
  // 代码只量化"是否显著超长"，透出 expandedIndices 供校对 hint；裁决权移交校对 LLM。
  const expansionResult = detectTranslationExpansion(texts, result, targetLang)
  if (expansionResult.expandedIndices.size > 0) {
    console.warn(
      `[translateBatch] ⚠️ 检测到 ${expansionResult.expandedIndices.size} 条译文显著超长（已透出给校对裁决，不自动截断）`,
      [...expansionResult.expandedIndices].map(j => ({
        idx: j,
        source: texts[j].slice(0, 50),
        translated: result[j].slice(0, 80),
        lengthRatio: (expansionResult.ratios.get(j) ?? 0).toFixed(2),
      })),
    )
    if (expansionIndices) {
      for (const j of expansionResult.expandedIndices) expansionIndices.add(j)
    }
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

  auditStage('S6', texts, result)
  uiLog('translate', `S6 安全后处理完成: 品牌注入回退${revertedIndices.size}条`)

  // ═══════════════════════════════════════════════════════════
  // S7: 异常检测 + 多层兜底重试（S7a检测→S7b统一重试→S7c激进→S7d子兜底→S7e术语组合→S7f标记）
  //     仅首轮（!_isRetry）执行；result[j] 单点写入集中在 S7b-S7f，v9.11 事故现场
  // ═══════════════════════════════════════════════════════════
  // 异常检测 + 统一重试：截断 + 漏翻合并为一次重试
  // 优化：从最多4次额外API调用降为1次
  if (!_isRetry) {
    // 首次检测：收集所有异常条目
    // 排除品牌注入/扩展检测回退的索引（这些是LLM输出了错误内容，重试无意义）
    // v7.3: validateNumbers 不再回退，revertedIndices 仅含品牌注入+扩展检测
    let truncatedIndices = detectTruncatedTexts(texts, result, targetLang)
    let untranslatedIndices = detectUntranslatedText(texts, result, targetLang, glossaryMap, detectedSource, glossaryEnMap)
    for (const idx of revertedIndices) {
      truncatedIndices.delete(idx)
      untranslatedIndices.delete(idx)
    }
    const hasAnomaly = truncatedIndices.size > 0 || untranslatedIndices.size > 0
    auditStage('S7a', texts, result)

    // v11.5: 首调异常观测输出（prompt 减肥效果实机验证：首调漏翻率应 ≤ 减肥前基线）
    if (firstCallAnomalyIndices) {
      for (const idx of truncatedIndices) firstCallAnomalyIndices.add(idx)
      for (const idx of untranslatedIndices) firstCallAnomalyIndices.add(idx)
    }

    if (hasAnomaly) {
      // 合并异常条目（去重）
      const anomalyIndices = new Set<number>()
      for (const idx of truncatedIndices) anomalyIndices.add(idx)
      for (const idx of untranslatedIndices) anomalyIndices.add(idx)

      uiLog('translate', `检测到 ${anomalyIndices.size} 条异常（截断${truncatedIndices.size}/漏翻${untranslatedIndices.size}），统一重试: ${[...anomalyIndices].map(j => `[${j}]${texts[j].slice(0, 40)}`).join(' | ')}`)
      if (truncatedIndices.size > 0) {
        uiLog('translate', `截断判定明细: ${[...truncatedIndices].map(j => `源${texts[j].length}字→译${(result[j] || '').length}字 "${(result[j] || '(空)').slice(0, 30)}"`).join(' | ')}`)
      }

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
        glossaryEnMap,  // v9.10: 传递 EN 视图
      )

      // 更新结果
      let k = 0
      for (const j of anomalyIndices) {
        const retryText = retryResults[k] || ''
        // v9.7: 重试结果为空 → 回退源文，让激进翻译/逐句拆分/大小写归一化/术语组合兜底链有机会工作
        // 若直接用空字符串覆盖，后续 detectUntranslatedText 会因空字符串跳过检测，
        // 激进翻译的 srcText 也是空 → 整条兜底链对"空结果"完全失效。
        result[j] = retryText || texts[j]
        uiLog('translate', `重试结果应用: [${j}] ← "${result[j].slice(0, 40)}"${retryText ? '' : '(空→回退源文)'}`)
        // 清理可能残留的强制翻译指令前缀（防止指令污染最终译文）
        // 匹配所有实际使用的指令前缀：[MANDATORY]、[MANDATORY TRANSLATION]、[PARTIAL TRANSLATION DETECTED]、[TRANSLATE REQUIRED]
        result[j] = result[j].replace(/\[(MANDATORY|MANDATORY TRANSLATION|PARTIAL TRANSLATION DETECTED|TRANSLATE REQUIRED)\][\s\S]*?\n\n/g, '').trim()
        k++
      }
      auditStage('S7b', texts, result)

      // 重试后再次检测，标记仍失败的条目
      // 优化：并行化重试后检测（与首次检测一致）
      const retriedTruncated = detectTruncatedTexts(texts, result, targetLang)
      const retriedUntranslated = detectUntranslatedText(texts, result, targetLang, glossaryMap, detectedSource, glossaryEnMap)
      uiLog('translate', `重试后再检测: 截断${retriedTruncated.size}条/漏翻${retriedUntranslated.size}条 ${retriedUntranslated.size > 0 ? [...retriedUntranslated].map(j => `[${j}]`).join('') : ''}`)

      if (retriedTruncated.size > 0) {
        uiLog('translate', `重试后仍截断 ${retriedTruncated.size} 条，标记失败: ${[...retriedTruncated].map(j => `[${j}]${texts[j].slice(0, 40)}`).join(' | ')}`)
        debugWarn(
          `[translateBatch] ${retriedTruncated.size} 条译文重试后仍截断，标记为翻译失败`,
          [...retriedTruncated].map(j => ({ idx: j, source: texts[j].slice(0, 80) })),
        )
        for (const j of retriedTruncated) {
          result[j] = ''
        }
        auditStage('S7b-trunc', texts, result)
      }

      if (retriedUntranslated.size > 0) {
        // v10.6.2: 激进兜底前拦截疑似错词 —— LLM 已两次原样保留（首调+统一重试），
        // 源文是拉丁单词、目标是非拉丁脚本时，src===trans 最可能是"LLM 遵守错词保留规则"。
        // 继续激进兜底只会空转 API（v8.4 MAX_AGGRESSIVE_RETRIES 的同类教训），
        // 直接走 misspelledIndices 独立通道（与 S7f/S8 的回退路径共用一个出口）。
        for (const j of [...retriedUntranslated]) {
          if (isSuspectMisspelledWord(texts[j], glossaryMap) && getTargetScript(targetLang) !== 'latin' && result[j] === texts[j]) {
            retriedUntranslated.delete(j)
            misspelledIndices?.add(j)
            uiLog('translate', `疑似错词拦截（LLM两次原样保留，跳过激进兜底）: "${texts[j].slice(0, 50)}"`)
          }
        }
        if (retriedUntranslated.size > 0) {
          debugWarn(
            `[translateBatch] ${retriedUntranslated.size} 条漏翻重试后仍未翻译，执行激进逐条翻译`,
            [...retriedUntranslated].map(j => ({ idx: j, text: texts[j].slice(0, 80) })),
          )
        }
      }

      if (retriedUntranslated.size > 0) {

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
源文可能是任何语言（不一定是英文）— 不要因为看不懂或它不是英文而保留原文。
关键：Title Case、全大写或带项目符号的文本不是跳过翻译的理由 — 必须翻译。
${isSameScript ? `重要：源文是简体中文，译文必须转换为繁体中文。即使某些字在简繁中写法相同，也必须确认并完成转换。不要只加引号或做最小改动。` : ''}
禁止返回源文原文。只输出译文，不要解释。`
          : `You are a translator. Translate the given text to ${aggressiveTargetDisplayName}.
Keep proper nouns, product codes, and numbers in their original form — translate EVERYTHING else.
The source text may be in ANY language (not necessarily English) — never keep it unchanged just because you don't recognize it or it isn't English.
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
          uiLog('translate', `激进逐条翻译: "${srcText.slice(0, 50)}"`)
          // v10.2: 子兜底仅在激进请求真正发出且返回非 ok 时才运行——
          // 避免 API 未响应时子兜底连环空耗（2026-07-31 实机日志教训）
          let aggressiveAttempted = false

          try {
            aggressiveAttempted = true
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
              uiLog('translate', `激进翻译返回: ${agContent.slice(0, 150)}`)
              let agTranslated = agContent.trim()
                .replace(/^"+|"+$/g, '')           // 去掉首尾引号
                .replace(/^\[?\d+\]?\s*\.?\s*/, '') // 去掉 [N] 或 N. 前缀
                .trim()

              // v7.5.5: 还原术语占位符 → 目标语译文
              agTranslated = unmaskForRetry(agTranslated, retryTermMap)

              // v7.5.3: 验证激进翻译结果是否真正被翻译（防止只改标点/空格但实质仍是英文）
              // v9.3: 同语系变体对豁免"与源文相同=失败"——两变体写法相同的句子，原样保留是正确答案
              if (agTranslated && (agTranslated !== srcText || isSameScript)) {
                const agCheck = detectUntranslatedText([srcText], [agTranslated], targetLang, glossaryMap, detectedSource, glossaryEnMap)
                if (agCheck.size === 0) {
                  result[j] = agTranslated
                  debugWarn(`[translateBatch] 激进翻译成功: "${srcText.slice(0, 50)}" → "${agTranslated.slice(0, 50)}"`)
                  uiLog('translate', `激进翻译成功: "${srcText.slice(0, 40)}" → "${agTranslated.slice(0, 40)}"`)
                  continue
                }
                debugWarn(`[translateBatch] 激进翻译结果仍判定为漏翻: "${srcText.slice(0, 50)}" → "${agTranslated.slice(0, 50)}"`)
                uiLog('translate', `激进翻译结果仍判定为漏翻: "${agTranslated.slice(0, 60)}"`)
              }
            }
          } catch (e) {
            debugWarn(`[translateBatch] 激进翻译请求失败:`, e)
            uiLog('translate', `激进翻译请求异常: ${e instanceof Error ? e.message : String(e)}`)
          }

          // ═══════════════════════════════════════════════════════════
          // v7.5.3: 激进单条失败后的子兜底 — 绝不能留英文
          // 子兜底 1: 逐句拆分翻译（长文本拆短 → 降低保留偏置）
          // 子兜底 2: 大小写归一化（Title Case → sentence case → 不再像产品名）
          // v7.5.5: 子兜底也使用 masked 文本，消除 LLM "品牌名→保留英文" 偏见
          // v10.2: 激进请求未发出（fetch 抛异常/超时）时跳过子兜底——
          // API 已经不可达，连环调用只会放大延迟并制造脏日志
          // ═══════════════════════════════════════════════════════════
          let rescued = false
          if (!aggressiveAttempted) {
            stillUntranslatedAfterAggressive.add(j)
            continue
          }

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
            uiLog('translate', `逐句拆分翻译尝试 (${sentences.length}句): "${srcText.slice(0, 40)}"`)
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
            const combinedCheck = detectUntranslatedText([srcText], [combined], targetLang, glossaryMap, detectedSource, glossaryEnMap)
            if (combinedCheck.size === 0) {
              result[j] = combined
              debugWarn(`[translateBatch] 逐句拆分翻译成功: ${sentences.length}句 → "${combined.slice(0, 80)}"`)
              uiLog('translate', `逐句拆分翻译成功: "${combined.slice(0, 60)}"`)
              rescued = true
            } else {
              uiLog('translate', `逐句拆分结果仍判漏翻: "${combined.slice(0, 60)}"`)
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
                    const ncCheck = detectUntranslatedText([srcText], [ncTrans], targetLang, glossaryMap, detectedSource, glossaryEnMap)
                    if (ncCheck.size === 0) {
                      result[j] = ncTrans
                      debugWarn(`[translateBatch] 大小写归一化翻译成功: "${srcText.slice(0, 50)}" → "${ncTrans.slice(0, 50)}"`)
                      uiLog('translate', `大小写归一化翻译成功: "${ncTrans.slice(0, 60)}"`)
                      rescued = true
                    } else {
                      uiLog('translate', `大小写归一化结果仍判漏翻: "${ncTrans.slice(0, 60)}"`)
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
                uiLog('translate', `子兜底结果英文残留超标 ${(engRatio*100).toFixed(0)}%，回退标记: "${rescuedText.slice(0, 50)}"`)
                rescued = false
                stillUntranslatedAfterAggressive.add(j)
              }
            }
          }

          if (!rescued) {
            stillUntranslatedAfterAggressive.add(j)
          }
          auditStage('S7c-d', texts, result)
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
              uiLog('translate', `术语库组合兜底成功: "${composed.slice(0, 60)}"`)
            } else {
              // Layer 3: 术语库也无法帮助，保留原文
              // v9.11: 保留原文的同时把索引通过 untranslatedIndices 暴露给调用方 ——
              // v8.7 的"静默保留原文交校对/人工"实测不可靠：校对 LLM 同样可能放过，
              // 且用户完全无感知（画布上仍是源文、无任何标记）。可靠性优先：
              // 漏翻必须进 translateErrors → 待确认红条 + 阻塞批量应用 + 一键重翻。
              result[j] = texts[j]
              // v10.6.2: 疑似错词（拉丁单词，LLM 音译后又被激进兜底纠正回原文）
              // 走 misspelledIndices 独立通道，不标"翻译失败"（v10.6 只堵了 S8 安全网一处，
              // 漏了 S7f 这个入口——2026-08-03 实机 Panasionic 案例）
              if (isSuspectMisspelledWord(texts[j], glossaryMap) && getTargetScript(targetLang) !== 'latin') {
                misspelledIndices?.add(j)
                uiLog('translate', `疑似错词进独立通道（激进兜底回原文）: "${texts[j].slice(0, 50)}"`)
              } else {
                untranslatedIndices?.add(j)
                uiLog('translate', `⚠️ 兜底链全部失败，保留原文并标记: "${texts[j].slice(0, 50)}"`)
              }
              debugWarn(
                `[translateBatch] 术语库兜底失败，保留原文: "${texts[j].slice(0, 50)}"`,
              )
            }
          }
          auditStage('S7e-f', texts, result)
        }
      }
    }
  }

  // v10.6: 疑似错词兜底（在 S7 全部检测/重试之后，避免回退为源文被二次拦截）。
  // 判定权在 LLM（prompt 规则利用多语言语感，20 语言通吃），此处仅硬兜底铁证路径——
  // LLM 万一没忍住把疑似错词音译/意译成非拉丁文字（Panasionic→帕納西奧尼克），兜回源文原形。
  // 仅非拉丁目标有此硬信号；拉丁目标跳过（拉丁→拉丁猜测无法与合法翻译形式区分，归校对 LLM）。
  // 零编辑距离/零词典/零自动替换——只回退保留，不猜测正确拼写，规避用户担忧的新匹配风险。
  const misspelledReverted = revertMisspelledWordTranslation(texts, result, glossaryMap, targetLang)
  // v10.6: 疑似错词走独立 misspelledIndices 通道（UI 单独标记"疑似拼写错误"），
  // 不进 untranslatedIndices——它不是"翻译失败"，是"源稿疑似拼错"，语义须区分（用户反馈）。
  for (const idx of misspelledReverted) misspelledIndices?.add(idx)

  // v7.5.4: 最终商标符号兜底 — 确保管道中任何步骤都不会丢失 ®™©
  result = restoreTrademarkSymbols(texts, result)

  // ═══════════════════════════════════════════════════════════
  // S8: 最终兜底（™还原 → 残留占位符清理 → v9.11 漏翻安全网）
  // ═══════════════════════════════════════════════════════════
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

  // v9.11: 最终漏翻安全网 — 返回前对最终结果做一次完整漏翻检测
  // 根因（2026-07-31）：中间检测点（重试后）的 result 快照可能被后续兜底链步骤
  // （激进翻译 result[j]= / 子兜底 / 术语组合 / Layer 3 保留原文）覆盖，
  // 而"激进重试结果仍判漏翻"的条目只是 continue 跳过、Layer 3 静默保留原文——
  // 中间任何一环漏报，用户都完全无感知（画布仍是源文、无待确认、无标记）。
  // 此处对最终结果统一兜底：任何漏翻条目都通过 untranslatedIndices 暴露给 UI。
  // 该检测同时覆盖重试路径（_isRetry=true 时外层函数会继续走完此处）。
  // v10.6: 疑似错词（已回退保留原形）豁免——它不是漏翻，是有意保留源文并单独标记，
  // 安全网若把它再判漏翻，会与 misspelledIds 双通道混淆（实测 zh-TW 目标 src===trans 触发安全网）。
  if (untranslatedIndices) {
    const finalUntranslated = detectUntranslatedText(texts, result, targetLang, glossaryMap, detectedSource, glossaryEnMap)
    for (const idx of finalUntranslated) {
      if (misspelledIndices?.has(idx)) continue  // 疑似错词已单独标记，不重复判漏翻
      untranslatedIndices.add(idx)
    }
    const reportedCount = [...finalUntranslated].filter(idx => !misspelledIndices?.has(idx)).length
    if (!_isRetry && reportedCount > 0) {
      uiLog('translate', `最终安全网检出漏翻 ${reportedCount} 条: ${[...finalUntranslated].filter(idx => !misspelledIndices?.has(idx)).map(j => `[${j}]${texts[j].slice(0, 40)}`).join(' | ')}`)
    }
    if (untranslatedIndices.size > 0) {
      uiLog('translate', `上报漏翻索引: ${[...untranslatedIndices].join(',')}`)
    }
  }

  auditStage('S8', texts, result)
  uiLog('translate', `S8 最终兜底完成: 返回${result.length}条`)

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
  normalizedGlossaryMap?: Map<string, string>,  // v9.10: 校对路径合规校验用（与翻译管道对齐）
  expansionFlags?: Set<number>,                 // v10.8: 译文显著超长的条目索引（长度异常信号，供 CHECK 1 语义裁决）
  prohibitedFixMap?: Map<number, Array<{ word: string; note: string }>>,  // v11.12: 批内索引→命中违禁词列表（语义改写必须列具体词）
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
  // v9.11: 与翻译管道对齐 — 标注改用批次级 detectedProofreadSource
  //        （detectSingleTextLanguage 拉丁文本恒 'en'，pt 源文标 (en→ja) 会让校对误判"非英文=已翻译"）
  // v11.12+: 术语库锁定项预豁免（用户拍板 2026-08-14：术语库最高优先级）。
  // 源文整条命中术语库且译文==钦定值 → 不进修正链，避免与术语合规锁定死锁
  // （改写→锁回→再命中）。豁免后徽章由调用方保留，只做提示。
  if (normalizedGlossaryMap && prohibitedFixMap && prohibitedFixMap.size > 0) {
    for (const i of [...prohibitedFixMap.keys()]) {
      if (i < 0 || i >= items.length) continue
      const expected = normalizedGlossaryMap.get(cleanKey(sourceTexts[i] || ''))
      if (expected && items[i].translatedText === expected) {
        prohibitedFixMap.delete(i)
      }
    }
  }

  const textList = items.map((it, i) => {
    const srcLang = detectedProofreadSource
    // 行首 * 替换为 ※，避免 LLM 将其解析为 markdown 列表标记
    const escapedSource = proofTmStrippedSources[i].replace(/^\*\s*/, '※ ')
    // v10.8: 长度异常提示 — 翻译管道检测到译文显著超长（形式信号），透出给校对做语义裁决。
    //        中性措辞：明确"长≠错"，合法详尽译文应保持原样，避免诱导 LLM 过度改写。
    const expansionNote = (expansionFlags && expansionFlags.has(i))
      ? (useEnInstruction
          ? '\n⚠️ Note: This translation is notably longer than the source. Verify whether it adds information absent from the source. If it is faithful and natural, keep it as-is; only tighten it if it contains source-absent additions.'
          : '\n⚠️ 提示：本条译文显著长于源文。请确认是否添加了源文没有的信息。若语义忠实、表达自然，请保持原样；仅当含有源文没有的添加内容时才精简。')
      : ''
    // v11.12: 违禁词修正提示 — 祈使句列出具体词（语义改写是定向替换，不列词 LLM 不知道绕开哪个）；
    //         不写成"原词→建议词"对照表，防 LLM 在输出里复述违禁词。
    const prohibitedHits = prohibitedFixMap ? prohibitedFixMap.get(i) : undefined
    const prohibitedNote = (prohibitedHits && prohibitedHits.length > 0)
      ? (useEnInstruction
          ? `\n⚠️ Note: This translation contains platform-prohibited word(s): ${prohibitedHits.map(h => h.word).join(', ')}. Rewrite it to avoid ALL listed words while preserving the original meaning and tone. Output ONLY the rewritten text, without the prohibited words or any explanation.`
          : `\n⚠️ 提示：本条译文含平台违禁词：${prohibitedHits.map(h => h.word).join('、')}。请在保持原意和语气的前提下改写规避以上全部违禁词。只输出改写后的文本，不要包含违禁词本身或任何解释。`)
      : ''
    return `[${i + 1}] (${srcLang}→${targetLang}) ${escapedSource}\n${transLabel}：${maskedTranslations[i]}${expansionNote}${prohibitedNote}`
  }).join('\n\n')

  // ⛔ 校对环节术语反补全闭环：术语 hint 的 label 不含反补全指令，
  // 需在注入前追加以防校对模型参照术语格式"纠正"译文（添加原文没有的品牌/规格）
  if (glossaryHint) {
    glossaryHint += useEnInstruction
      ? '\n⛔ Above glossary: exact match only. Do NOT "correct" translations by completing partial product names (e.g., do not change "PLAY X PCIe 4.0 SSD" to "Lexar PLAY X M.2 PCIe 4.0 NVMe SSD" based on glossary patterns).'
      : '\n⛔ 以上术语仅当完全一致时才套用。严禁参照术语格式"纠正"译文，将部分产品名补全为全称。'
  }

  // ═══════════════════════════════════════════════════════════
  // 校对 system prompt 组装（v11.0: 委托 buildProofreadSystemPrompt 纯函数）
  // ═══════════════════════════════════════════════════════════
  // ROLE+CHECKLIST (PROOFREAD_SYSTEM_PROMPT) — 独立 QA 视角
  // GLOSSARY (glossaryHint)                 — 术语参照
  // CALIBRATION (市场语感校准块)             — v11.0: 与翻译同源同段，白名单+禁加词双边界
  // LANG_SPECIFIC (renderLangForProofread)  — 品类词+rules+quality+compliance
  //
  // ⛔ 校对用独立的 PROOFREAD_SYSTEM_PROMPT（CORE DIRECTIVE + CHECK 1-4），不共享翻译规则
  // ⛔ 不注入 scene/tone/style — 翻译已负责风格，校对不重复
  // v11.0: 市场语感除外——翻译被允许用的市场原生词，校对必须有同一份白名单，
  //        否则会把正确翻译误当不自然表达拦下（两个 LLM 看到的世界必须一致）
  // ═══════════════════════════════════════════════════════════
  const systemPrompt = buildProofreadSystemPrompt({
    targetLang,
    productLine,
    useEnInstruction,
    glossaryHint,
    sourceLang: detectedProofreadSource,              // v11.5: 变体对条件注入
    hasExpansionFlags: !!expansionFlags && expansionFlags.size > 0,  // v11.5: 超长提示条件注入
    hasProhibitedFix: !!prohibitedFixMap && prohibitedFixMap.size > 0,  // v11.12: 违禁词全局块条件注入
  })

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
      // v12.0: 校对输出 schema 化——API 层硬约束 JSON object（软约定→硬保证，解析失败率降为 0）
      // 实测（tests/test-schema-live.ts B 段 10 次/组）：硬约束格式服从 10/10、reason 枚举全合规、
      // 错误抓取率与软约定无统计差异。↵ 字面保留实测通过（A 段）。
      response_format: { type: 'json_object' },
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
  // v12.0: 优先 {"results":[...]}（json_object 模式的新约定），向后兼容裸 [...]（旧软约定输出）
  // 定位策略：找最后一个 "results" 键（内容文本含 results 字样时防误锚——坑16同型：
  // 对位置的假设比对内容的假设脆弱），再在其后取平衡 {..} 段，JSON.parse 校验通过才采信。
  function extractResultsObject(text: string): Record<string, unknown> | null {
    let searchFrom = 0
    for (;;) {
      const keyIdx = text.indexOf('"results"', searchFrom)
      if (keyIdx < 0) return null
      // 向前找包含该键的最近开括号
      let openIdx = -1
      for (let i = keyIdx - 1; i >= 0; i--) {
        if (text[i] === '{') { openIdx = i; break }
        if (text[i] === '}') break  // 键在对象外（如 array 元素里），继续找下一个
      }
      if (openIdx >= 0) {
        // 从 openIdx 起取平衡大括号段
        let depth = 0, inStr = false, esc = false, end = -1
        for (let i = openIdx; i < text.length; i++) {
          const ch = text[i]
          if (esc) { esc = false; continue }
          if (ch === '\\') { esc = true; continue }
          if (ch === '"') { inStr = !inStr; continue }
          if (inStr) continue
          if (ch === '{') depth++
          else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
        }
        if (end > openIdx) {
          try { return JSON.parse(text.slice(openIdx, end + 1)) } catch { /* 找下一个 */ }
        }
      }
      searchFrom = keyIdx + 1
    }
  }
  const resultsObj = extractResultsObject(content)
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (resultsObj && Array.isArray((resultsObj as { results?: unknown[] }).results)) {
    for (const entry of (resultsObj as { results: Array<{ i: number; text?: string; reason?: string; ambiguous?: string[] }> }).results) {
      if (entry.i >= 1 && entry.i <= results.length) {
        let entryText = (entry.text || '').trim()
        entryText = entryText.replace(/^\[\d+\]\s*/, '')
        results[entry.i - 1] = {
          text: entryText,
          reason: (entry.reason || '').trim(),
          ambiguous: Array.isArray(entry.ambiguous) ? entry.ambiguous.filter(a => a && a.trim()) : [],
        }
      }
    }
    jsonParsed = true
  }
  if (!jsonParsed && jsonMatch) {
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
  // v9.10: 复用传入的 glossaryMap（已是 full 视图），不再复制 — 避免双份 Map 漂移
  const proofreadSourceTexts = items.map(it => it.sourceText)
  resultTexts = enforceGlossaryTerms(proofreadSourceTexts, resultTexts, glossaryMap, new Set())

  // v10.7: 术语合规校验日志升级 — 用户要求"可靠性最重要"，debugWarn 依赖 DEBUG_MODE，
  //        默认关闭导致现场无法追溯。改为始终输出 warn（不影响功能，仅增加可观测性）。
  if (normalizedGlossaryMap) {
    for (let i = 0; i < resultTexts.length; i++) {
      if (!(proofreadSourceTexts[i] || '').trim()) continue
      const expected = normalizedGlossaryMap.get(cleanKey(proofreadSourceTexts[i]))
      if (expected && shouldSkipGlossaryEntry(proofreadSourceTexts[i], expected)) continue   // v11.14: 脏条目不锁定
      if (expected && resultTexts[i] !== expected) {
        console.warn('[proofreadBatch] ⛔ 术语合规校验：整条命中术语库但译文不符，已锁定为术语库值', {
          source: proofreadSourceTexts[i].slice(0, 60),
          was: resultTexts[i].slice(0, 60),
          fixed: expected.slice(0, 60),
        })
        resultTexts[i] = expected
      }
    }
  }

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
 *
 * v10.2 判定口径重构（根因：pt→ja "Resistente a altas temperaturas"(31字符) →
 * "高温に強い"(6字符) 被旧长度比 0.25 误杀，重试链空转 4 次 API 后标记失败）：
 *
 * 代码只判"形式完整"，不判"语义完整"——语义完整性（信息点是否翻全）归校对 LLM
 * CHECK 1（无漏译），代码用长度代理跨语系必然误杀（拉丁→CJK 字符密度差 3-5 倍）。
 *
 * 规则（按 targetLang 提供时生效）：
 *   1. 译文为空 → 截断（无论源文长度、语言对，零误判）
 *   2. 目标脚本存在性：译文不含目标脚本字符 → 截断（如 ja 译文纯拉丁字符）
 *      —— 拉丁→CJK 的合法短译文必然含目标字符，不受长度影响
 *   3. 长度比（仅拉丁→拉丁保留）：译文 < 源文 × 0.15 且源文 > 30 → 截断
 *      —— 拉丁语系间字符密度接近，长度比有效；阈值从 0.25 降到 0.15 进一步保守化
 *      —— 跨语系对（拉丁→CJK 等）完全不做长度判定
 *   targetLang 缺省时保持旧行为（0.25），仅兼容测试/外部直调。
 * 返回截断条目的索引集合，由调用方决定重试或标记失败。
 */
export function detectTruncatedTexts(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang?: string,
): Set<number> {
  const truncatedIndices = new Set<number>()
  const MIN_SOURCE_LEN = 30

  for (let i = 0; i < sourceTexts.length; i++) {
    const src = sourceTexts[i] || ''
    const trans = translatedTexts[i] || ''
    if (!src) continue
    // 译文为空 → 视为截断（无论源文长度）
    if (!trans) {
      truncatedIndices.add(i)
      continue
    }
    // v10.5: 不可翻译条目（型号/单位/品牌等）跳过截断判定 ——
    // 根因：zh 目标只查"译文是否含 CJK 字符"，型号列表纯拉丁 → 误报截断；
    // 更危险的是 S7b-trunc 对"重试后仍截断"执行 result[j]=''（静默清空无标记），
    // 型号列表此前是靠漏翻兜底链才被救回。形式不可翻译的条目本就不该做完整性判定。
    if (isUntranslatable(src)) continue
    // 短源文跳过后续检测（但空结果已在上面捕获）
    if (src.length < MIN_SOURCE_LEN) continue

    if (targetLang) {
      const script = getTargetScript(targetLang)
      const pattern = TARGET_SCRIPT_PATTERNS[script]
      if (pattern) {
        // 非拉丁目标：只判目标脚本存在性，不判长度
        if (!pattern.test(trans)) truncatedIndices.add(i)
        continue
      }
      // 拉丁目标：长度比 0.15 兜底
      if (trans.length < src.length * 0.15) truncatedIndices.add(i)
    } else {
      // 兼容旧调用（测试/外部直调，无语言信息）：原 0.25 比例
      if (trans.length < src.length * 0.25) truncatedIndices.add(i)
    }
  }

  return truncatedIndices
}

// ============================================================
// 漏翻检测：检查译文是否与源文实质相同（即 LLM 没翻译）
// 正常化比较（去 ®™© + 合并空格 + 小写），排除商标/空格差异
// ============================================================

/**
 * v10.6: 疑似错词兜底 — LLM 把"本该保留原形的疑似错词"翻成了别的东西时，回退为源文原形。
 *
 * 设计哲学（与用户对齐，对齐 CAT 工具行业标准）：错词不翻、不猜、不音译、不自动改。
 * 判定权在 LLM（prompt 规则利用其多语言语感，20 语言通吃），此处只是硬兜底——
 * LLM 万一没忍住翻了（音译成 CJK 等），代码兜回原形，不让"诡异译文"上画布。
 *
 * 判定（全部满足才回退，宁可漏不可误）：
 *   1. 源文是单个拉丁词（无空格/标点/数字），长度 ≥6 —— 只碰"单词"
 *   2. 源文不在术语库（key/value 均不含，大小写无关）—— 已收录品牌走 LOCK 不兜底
 *   3. 源文不被 isUntranslatable 豁免（型号/单位/品牌词已有归属）—— 不重复拦截
 *   4. 译文 ≠ 源文 —— LLM 确实做了改动（没改动=遵守了规则，无需兜底）
 *   5. 译文含非拉丁字符（CJK/西里尔等）—— 即"音译/意译成了别的文字"，这是唯一硬信号
 *
 * 注意：纯拉丁译文（如 en 目标或 LLM 用另一拉丁词猜测）不在此兜底——
 * 拉丁→拉丁的"猜测"无法与"合法翻译"区分（形式不可判），交给校对 LLM 语义裁决。
 * 本兜底只管"拉丁源词 → 非拉丁译文"这条铁证路径（Panasionic→帕納西奧尼克）。
 */
// 拉丁单疑似错词：无空格/标点/数字的纯字母单词，长度≥6（Panasionic/Spede/Transfser）
const SUSPECT_MISSPELLED_WORD_RE = /^[A-Za-z]{6,}$/


/**
 * v10.6.2: 疑似错词形态判定器（模块级，供漏翻检测/兜底链/回退兜底/UI 徽章共用）。
 *
 * 背景（2026-08-03 实机日志）：en→zh-TW 的 `Panasionic` 被判"翻译失败⚠️漏翻"而非
 * "疑似拼写错误"。根因：untranslatedIndices 有三个写入入口（S7f Layer 3 / S8 剩余 /
 * S8 安全网豁免），v10.6 只豁免了 S8 安全网一处；且 LLM 遵守 prompt 规则原样保留时，
 * 错词形态（拉丁源→拉丁同文译文）根本走不到 revertMisspelledWordTranslation 的
 * "译文含非拉丁字符"铁证分支——保留原形是正确行为，却被漏翻链全程拦截空转 4 次 API。
 *
 * 本判定器把"疑似错词形态"抽成单一口径，在各入口前置豁免（对齐 v10.5 型号豁免模式：
 * 错词形态根本不进漏翻检测/兜底链，而不是走完链再回退）。
 * 5 重约束与 revertMisspelledWordTranslation 完全同构（仅去掉"译文"两条件——它判形态）：
 *   1. 单个拉丁词 ≥6（SUSPECT_MISSPELLED_WORD_RE）
 *   2. 不在术语库（key/value，大小写无关）——已收录品牌走 LOCK
 *   3. 不被 isUntranslatable 豁免（型号/单位/品牌词已有归属）——不重复拦截
 * 宁可漏不可误：任一不满足返回 false，走正常漏翻链。
 */
export function isSuspectMisspelledWord(src: string, glossaryMap?: Map<string, string>): boolean {
  const s = (src || '').trim()
  if (!SUSPECT_MISSPELLED_WORD_RE.test(s)) return false
  // v11.13: 内置第三方整词豁免前置 —— Nintendo/Lenovo/Logitech 等裸品牌词形态上
  // 就是"≥6 纯拉丁单字"，与疑似错词完全同形；它们是已知品牌，不是错词。
  // 与 isUntranslatable 0.1 同一份名单，两处判断口径必须一致。
  if (isBuiltinThirdPartyWholeText(s)) return false
  if (glossaryMap && glossaryMap.size > 0) {
    const key = normalizeGlossaryKey(s)
    for (const [k, v] of glossaryMap.entries()) {
      if (normalizeGlossaryKey(k) === key || normalizeGlossaryKey(v) === key) return false
    }
  }
  if (isUntranslatable(s, glossaryMap)) return false
  return true
}

function revertMisspelledWordTranslation(
  texts: string[],
  result: string[],
  glossaryMap: Map<string, string>,
  targetLang: string,
): Set<number> {
  const reverted = new Set<number>()
  const script = getTargetScript(targetLang)
  // 仅非拉丁目标才有"音译成别种文字"的硬信号；拉丁目标无此信号，直接跳过
  if (script === 'latin') return reverted

  for (let i = 0; i < texts.length; i++) {
    const src = (texts[i] || '').trim()
    const trans = (result[i] || '').trim()
    if (!src || !trans) continue
    // 1-3. 疑似错词形态（单词≥6 / 非术语库 / 非已豁免类别）— 委托 isSuspectMisspelledWord 单一口径
    if (!isSuspectMisspelledWord(src, glossaryMap)) continue
    // 4. LLM 做了改动
    if (trans === src) continue
    // 5. 译文含非拉丁字符（音译/意译铁证）
    if (!/[^\x00-\x7F]/.test(trans)) continue

    // 全部命中 → 回退为源文原形
    result[i] = texts[i]
    reverted.add(i)
    uiLog('translate', `疑似错词回退保留原形: "${src}" (译文"${trans.slice(0, 30)}"已回退，请核对源稿)`)
    debugWarn(`[translateBatch] 疑似错词被LLM翻译，已回退保留原形`, { idx: i, source: src, was: trans.slice(0, 60) })
  }
  return reverted
}

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
// v10.5: 裸单位豁免 — "MB/s*" / "GB/s" / "TBW" 等无数字纯单位。
// NUM_UNIT_RE 要求数字开头（^[\d,.]+），裸单位落不穿（2026-08-01 实机日志："MB/s*" 被判漏翻空转整条兜底链）。
const PURE_UNIT_RE = /^(GB|MB|TB|KB|MB\/s|GB\/s|TB\/s|MHz|GHz|TBW)\*?$/i

/**
 * v10.5: 第三方产品型号/型号列表豁免（相机兼容列表等场景）。
 *
 * 根因（2026-08-01 实机日志）："EOS R5 / EOS R6 / ..." "A1 / A7M4 / ..." 等友商相机
 * 型号列表全球统一、本不该翻，LLM 原样回显是正确行为。但 isUntranslatable 的白名单
 * 只覆盖 Lexar 自有型号（BRAND_GRADE_RE），MODEL_CAPACITY_RE 又是"整条"正则，
 * 多行/带斜杠的列表匹配不上 → 全部误判漏翻 → 每条空转 4 次兜底 API 后标红。
 *
 * 判定（仅认拉丁字符集，CJK/西里尔等文本天然不匹配）：
 *   单段：含数字 + 大写字母占比 ≥50%（如 E-M1-Mark-II）
 *   多段（按 / 或换行切分）：每段都是型号形态（含数字且大写占比≥50%，或全大写）
 * 不误判样例：'4K/8K video recording'（小写词为主）、'SUPER FAST SPEED'（无数字）、
 *   'Read/write speed 2050MB/s'（小写词为主）。
 */
function isModelListOrCode(s: string): boolean {
  // v11.13: 切分符补 ↵ —— text-normalizer.ts 在管道最前端已把扫描文本的 \n
  // 转成 ' ↵ '（U+21B5），检测器永远见不到真换行；只按 /\n 切分会让多行型号列表
  // 变成"一整段带非法字符 ↵"，段字符集校验整锅失败 → 多行列表全部误判漏翻。
  const segs = s.split(/\/|\n|↵/).map(x => x.trim()).filter(Boolean)
  if (segs.length === 0) return false
  const isModelish = (seg: string): boolean => {
    if (!/^[A-Za-z0-9\s\-*.®™©]+$/.test(seg)) return false
    // v11.13: 内置第三方词条（遮蔽表 ∪ 整词豁免名单全集）作为段直接成立——
    // 收录即钦定型号的形态认证，无需再过数字/大写规则（'Bones' 无数字）。
    if (BUILTIN_THIRD_PARTY_ALL_KEYS.has(normalizeGlossaryKey(seg))) return true
    // v11.13: 段名单（Mini/Switch NS）——不进遮蔽表（切碎既有词条/过遮蔽），
    // 只在【整条全是型号段】的列表语境认段，正文不受影响。
    if (isBuiltinModelSegment(seg)) return true
    const letters = seg.replace(/[^A-Za-z]/g, '')
    if (letters.length === 0) return false
    const upper = letters.replace(/[^A-Z]/g, '').length
    const upperRatio = upper / letters.length
    if (/\d/.test(seg) && upperRatio >= 0.5) return true
    if (upperRatio === 1) return true
    return false
  }
  if (segs.length === 1) {
    return /\d/.test(segs[0]) && isModelish(segs[0])
  }
  return segs.every(isModelish)
}

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
  // 0.1 内置第三方整词豁免（v11.13）— 裸品牌词/无数字短型号整条命中即豁免。
  // 独立于术语库（不可被用户 CSV 覆盖/删除削弱），且只在此做整词匹配、
  // 不进遮蔽表（子串遮蔽裸品牌词=大面积过遮蔽，v11.9 红线）。
  // 放在最前：代码内置零成本短路，比任何形态规则都可靠。
  if (isBuiltinThirdPartyWholeText(s)) return true

  // 0. 纯标点/符号不承载可翻译语义，避免 +、—、• 等触发漏翻重试。
  // 保留字母、数字和占位符中的下划线以免掩盖真正的文本或实体还原失败。
  if (!s.replace(/[\p{P}\p{S}\s]/gu, '')) return true

  // 0.5 单字符（含单个字母）— 无语言特征，无法判断翻译必要性，豁免
  // v9.5: 解决 F10 边界（"A" 单字符无法检测语言，默认放行）
  if (s.trim().length === 1) return true

  // 1. 术语库检查：如果源文在术语库中且目标语言与源文相同，不算漏翻
  // v11.13: 内置第三方表优先于用户术语库——不依赖 UI 层注入，翻译管道自带兜底；
  // 用户删/换 CSV 后第三方型号豁免链依然完整（v11.9 内置化初衷的闭环补全）。
  {
    const normalizedKey = normalizeGlossaryKey(s)
    // key 已归一化（小写+去®™©+trim），查询前必须先归一化——遮蔽表 key 是原始
    // 大小写（'Steam Deck'），直接 get 会失配；全集含遮蔽表∪整词豁免名单。
    if (BUILTIN_THIRD_PARTY_ALL_KEYS.has(normalizedKey)) return true
  }
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
  // v10.5: 裸单位（MB/s*、GB/s、TBW 等无数字纯单位）
  if (PURE_UNIT_RE.test(sNoStar)) return true

  // 2.5 产品型号 + 可选容量（NM1090 PRO 4TB, NM790 2TB, D40E 1TB 等）— 全球统一
  if (MODEL_CAPACITY_RE.test(s)) return true

  // 2.6 第三方产品型号/型号列表（EOS R5 / ..., A1 / A7M4 / ..., E-M1-Mark-II 等）— 全球统一
  if (isModelListOrCode(s)) return true

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

// ═══════════════════════════════════════════════════════════════
// v9.5: 三层漏翻检测架构 — 代码做确定性判断，LLM 做模糊性判断
// （v10.0：语言检测/字符集分类/功能词表已收口至 lib/lang-detect.ts，此处仅保留简繁特征字检测）
// ═══════════════════════════════════════════════════════════════

// 简繁特征字表（高频区分字，覆盖营销/技术文案常用字）
// 原则：只收录"该写法仅在简体/繁体中出现"的字，简繁同形字（如 性/能/人/全）不收录
// 同形字无区分度，收录会导致双向误判（v9.5 初始版本误收 17 个同形字，已清理）
// v11.15（2026-08-18 实机事故）：词片段拆字建表漏网同形字「放」「言」——
// 繁体"釋放/語言/播放/發言"的 放/言 与简体同形，zh-CN→zh-TW 完美译文被判漏翻，
// 全链重试（统一重试→激进→逐句拆分→兜底→最终安全网）层层拒收 → 误报"翻译失败"。
// 已删；test-v1115 以行为断言锁回归（两表交集恒为空）。
const SIMPLIFIED_ONLY_CHARS = new Set(
  '让这说会对开关时间问题现发现实义经验证号国际学习体台湾龙们为产众优亿仅们见页车马门问闻间买卖读书读写话语讲谈议论认记忆讨训议讲谢谢请诸课传释电脑设计专为电脑'.split('')
)
const TRADITIONAL_ONLY_CHARS = new Set(
  '讓這說會對開關時間問題現發現實義經驗證號國際學習體臺灣龍們為產眾優億僅從們見頁車馬門問聞間買賣讀書讀寫話語講談議論認記憶討訓議講謝謝請諸課傳釋電腦設計專為電腦'.split('')
)

// 简繁同形字（无区分度，从特征字表中排除）
const SHARED_CJK_CHARS = new Set('性能'.split(''))

function hasExclusiveChars(text: string, exclusiveSet: Set<string>): boolean {
  for (const ch of text) {
    if (SHARED_CJK_CHARS.has(ch)) continue
    if (exclusiveSet.has(ch)) return true
  }
  return false
}

export function hasSimplifiedOnlyChars(text: string): boolean {
  return hasExclusiveChars(text, SIMPLIFIED_ONLY_CHARS)
}

export function hasTraditionalOnlyChars(text: string): boolean {
  return hasExclusiveChars(text, TRADITIONAL_ONLY_CHARS)
}


/** 翻译必要性分类 */
export type Necessity =
  | { kind: 'translate' }                                    // 跨字符集，必须翻译
  | { kind: 'variant'; conversion: 's2t' | 't2s' | 'pt' }   // 同字符集变体转换
  | { kind: 'verify' }                                      // 同字符集同语言，校验模式

export function classifyNecessity(src: string, targetLang: string): Necessity {
  const srcScript = getScriptClass(src)
  const targetScript = getTargetScript(targetLang)

  if (srcScript !== targetScript) {
    return { kind: 'translate' }
  }

  if (srcScript === 'cjk') {
    if (targetLang === 'zh-TW' || targetLang === 'zh-HK') return { kind: 'variant', conversion: 's2t' }
    if (targetLang === 'zh-CN') return { kind: 'variant', conversion: 't2s' }
    return { kind: 'translate' }
  }

  if (srcScript === 'latin') {
    if (targetLang === 'pt' || targetLang === 'pt-BR') return { kind: 'variant', conversion: 'pt' }
    const srcLang = detectLatinLang(src)
    if (srcLang && srcLang === targetLang) return { kind: 'verify' }
    return { kind: 'translate' }
  }

  return { kind: 'verify' }
}

/**
 * 检测翻译/校对后是否存在漏翻（译文==源文但应被翻译）。
 * 返回漏翻条目的索引集合，由调用方决定处理策略。
 *
 * v9.5: 三层检测架构 — 代码做确定性判断，LLM 做模糊性判断。
 * 第一层：代码前置过滤（isUntranslatable + 字符集分类 + 跨字符集必须翻译）
 * 第二层：代码变体校验（简繁特征字 + 拉丁变体英文混入检测）
 * 第三层：LLM 语义校验（校对环节处理代码无法判断的边界）
 *
 * 删除 v9.3 补丁逻辑：批次级豁免/纯度条件/二元守卫/同语系并集，
 * 改为逐条 necessity 分类，混杂批次中每条文本独立判断。
 */
export function detectUntranslatedText(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang: string,
  glossaryMap?: Map<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  batchSrcLang?: string,  // v9.5: 保留参数兼容，不再使用
  glossaryEnMap?: Map<string, string>,  // v9.10: EN 视图，供 isUntranslatable 豁免判断（防全语言视图误判豁免 R5）
): Set<number> {
  const untranslatedIndices = new Set<number>()

  // 检测指令文本的正则（防止重试指令污染最终译文）
  const INSTRUCTION_PATTERNS = [
    /\[TRANSLATE REQUIRED\]/i,
    /\[MANDATORY TRANSLATION\]/i,
    /\[PARTIAL TRANSLATION DETECTED\]/i,
    /⛔\s*UNTRANSLATED!/i,
    /Translate\s+".*?"\s+to/i,
  ]

  // v9.10: isUntranslatable 豁免只用 EN 视图 — 全语言视图会把其他语言列的同形值误判为"不可翻译"
  // （如某语言列 src===tgt 的同形日常词），导致真漏翻被豁免掩盖。未提供 en 视图时回退 glossaryMap（向后兼容）。
  const untranslatableGlossary = glossaryEnMap || glossaryMap

  // v10.5: 术语库已知值集合（归一化）——脚本校验豁免用。
  // 场景：源稿错别字（Panasionic）被 LLM 纠正为术语库值（Panasonic）后，
  // 译文纯拉丁、在 zh 目标下会被"必须含 CJK 字符"的脚本校验误报漏翻。
  // 术语库值是用户钦定的正确结果，命中即视为合规，不再做脚本校验。
  // 注意：只豁免脚本校验，不豁免 src===trans 判定（错别字原样回显仍会被抓、走纠正链）。
  const knownGlossaryValues = new Set<string>()
  if (glossaryMap) {
    for (const v of glossaryMap.values()) {
      knownGlossaryValues.add(normalizeGlossaryKey(v))
    }
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

    // 第一层：不可翻译 → 跳过（v9.10: 仅 EN 视图豁免）
    if (isUntranslatable(src, untranslatableGlossary)) continue

    // v10.6.2: 疑似错词豁免 — 拉丁源→拉丁同文译文（LLM 按 prompt 规则保留错词原形）
    // 在形式上与漏翻完全不可区分，必须前置豁免，否则错词走完漏翻兜底链空转 API 后
    // 被标"翻译失败⚠️漏翻"（2026-08-03 实机 Panasionic 案例；详见 translateBatch 头注）
    if (
      isSuspectMisspelledWord(src, glossaryMap) &&
      getScriptClass(src) === 'latin' && getTargetScript(targetLang) === 'latin' &&
      src === trans
    ) continue

    // v9.11→v10.0: 同源拉丁语言豁免已收口至 keep-source 注册表 isSameLanguageExempt（三重守卫注释见该模块）
    if (isSameLanguageExempt(src, { targetLang, batchSources: sourceTexts })) continue

    // 逐条 necessity 分类（不依赖批次级语言检测）
    const necessity = classifyNecessity(src, targetLang)

    switch (necessity.kind) {
      case 'translate': {
        // 跨字符集必须翻译：源文==译文 → 漏翻
        // v9.11: 同一调用内源文==译文才判漏翻 — 跨调用同形词（如 pt→ja 重试后保留原文）
        // 与"LLM 原样回显"在此无法区分；可靠兜底由 translateBatch 的最终安全网负责。
        if (src === trans) {
          // 反向校验：拉丁目标语言，译文含目标语言功能词 → 已翻译，不算漏翻
          if (getTargetScript(targetLang) === 'latin' && hasFunctionWords(trans, targetLang)) {
            break
          }
          debugWarn(
            `[detectUntranslatedText] 跨字符集漏翻：源文==译文`,
            { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
          )
          untranslatedIndices.add(i)
          break
        }

        // v9.8: 目标字符集校验 — 译文必须包含目标语言字符，否则判漏翻
        // 解决"LLM 微调源语言后返回"（如葡语→葡语加标点）绕过 normalize 比对的问题
        // v10.5: 译文命中术语库已知值（如错别字被纠正为库内正确拼写）→ 豁免脚本校验
        const targetScript = getTargetScript(targetLang)
        const transIsKnownGlossaryValue = knownGlossaryValues.has(normalizeGlossaryKey(trans))
        if (!transIsKnownGlossaryValue && targetScript === 'ja' && !/[぀-ゟ゠-ヿ一-鿿]/.test(trans)) {
          debugWarn(
            `[detectUntranslatedText] 目标字符集校验漏翻：ja 目标译文不含日文字符`,
            { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
          )
          untranslatedIndices.add(i)
        } else if (!transIsKnownGlossaryValue && targetScript === 'ko' && !/[가-힯]/.test(trans)) {
          debugWarn(
            `[detectUntranslatedText] 目标字符集校验漏翻：ko 目标译文不含韩文字符`,
            { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
          )
          untranslatedIndices.add(i)
        } else if (!transIsKnownGlossaryValue && targetScript === 'cjk' && !/[一-鿿]/.test(trans)) {
          debugWarn(
            `[detectUntranslatedText] 目标字符集校验漏翻：zh 目标译文不含中文字符`,
            { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
          )
          untranslatedIndices.add(i)
        }
        break
      }

      case 'variant': {
        // 变体转换校验
        if (necessity.conversion === 's2t') {
          // 简体→繁体：译文含简体特征字 → 漏翻
          if (hasSimplifiedOnlyChars(trans)) {
            debugWarn(
              `[detectUntranslatedText] 简繁转换漏翻：译文含简体特征字`,
              { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
            )
            untranslatedIndices.add(i)
          }
        } else if (necessity.conversion === 't2s') {
          // 繁体→简体：译文含繁体特征字 → 漏翻
          if (hasTraditionalOnlyChars(trans)) {
            debugWarn(
              `[detectUntranslatedText] 简繁转换漏翻：译文含繁体特征字`,
              { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
            )
            untranslatedIndices.add(i)
          }
        } else if (necessity.conversion === 'pt') {
          // 葡语变体：检查是否混入英文（英文功能词≥1 且无葡语功能词）
          if (hasFunctionWords(trans, 'en') && !hasFunctionWords(trans, 'pt')) {
            debugWarn(
              `[detectUntranslatedText] 葡语变体漏翻：译文疑为英文`,
              { idx: i, source: src.slice(0, 80), translation: trans.slice(0, 80) }
            )
            untranslatedIndices.add(i)
          }
        }
        break
      }

      case 'verify': {
        // 同语言校验模式：源文==译文是正确结果，跳过
        break
      }
    }
  }

  return untranslatedIndices
}
