import { LLMConfig, LANGUAGES } from '@messages/types'
import { API_MAX_RETRIES, API_RETRY_DELAY_MS, API_TIMEOUT_MS } from '@lib/constants'
import { getFewShotExamples } from '@lib/few-shot-examples'
import { filterRelevantGlossary } from '@lib/glossary-filter'
import { normalizeTextForLLM, protectCjkSpaces } from '@lib/text-normalizer'
import { maskEntities, unmaskEntities } from '@lib/entity-masker'
import { postProcessTranslation, restoreTrademarkSymbols, restoreStorageUnitFormatting, enforceGlossaryTerms, enforceShortLabelLength, capitalizeFirstLetter, detectTranslationExpansion } from '@lib/post-process'
import { GLOSSARY_TAG_MAP } from '@lib/default-glossary'

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
  let cjkChars = 0, latinChars = 0
  for (const t of texts) {
    for (const ch of t) {
      if (ch >= '一' && ch <= '鿿') cjkChars++
      else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latinChars++
    }
  }
  return cjkChars > latinChars ? 'zh-CN' : 'en'
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
    /(GOLD|DIAMOND|ARMOR).*(CFexpress|microSD|\bSD\b|卡|card)/i.test(joined) ||
    /Professional.*(CFexpress|microSD|\bSD\b|卡|card)/i.test(joined) ||
    /CFexpress.*(GOLD|DIAMOND)/i.test(joined) ||
    /1667x|2000x|800x\s*PRO/i.test(joined)
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
    /CFexpress/i.test(name) ||
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
// 术语库按产品线过滤
// 只保留「通用术语」+「当前产品线相关术语」，其余不注入
// 预期节省约 40-60% 的术语注入 token
//
// v2 增强（2026-06-30）：产品名条目要求型号关键词在源文本中出现，
// 未匹配则完全跳过产品名表格，按命名规则直接翻译。
// ============================================================

/**
 * 判断术语条目是否为产品名（需型号检测才注入）
 * 规则：GLOSSARY_TAG_MAP tag 不含 "common" 且 source 以 "Lexar " 开头
 */
function isProductNameEntry(source: string): boolean {
  const tags = GLOSSARY_TAG_MAP[source]
  if (!tags || tags.length === 0) return false
  if (tags.includes('common')) return false
  return /^Lexar\s/i.test(source)
}

/**
 * 从产品名中提取型号关键词，用于源文本匹配
 * "Lexar NM790 M.2 2280 PCIe Gen 4x4 NVMe SSD" → ["NM790", "2280", "Gen", "4x4", "NVMe"]
 * "Lexar ARES RGB DDR5 Desktop Memory" → ["ARES", "RGB", "DDR5"]
 * "Lexar SL500 Portable SSD" → ["SL500"]
 */
function extractModelKeywords(source: string): string[] {
  const name = source.replace(/^Lexar\s+/i, '')
  const keywords: string[] = []

  // 1. 首段字母+数字型号（如 NM790, SL500, D70E, ES3）
  const modelMatch = name.match(/^([A-Z]+\d+[A-Za-z]*)($|\s)/)
  if (modelMatch) keywords.push(modelMatch[1])

  // 1b. 产品名中后段的单字母+数字型号（如 JumpDrive S80, Dual Drive D300, E300, E6）
  const shortCodes = name.match(/\b([A-Z]\d+[A-Za-z]?)\b/g)
  if (shortCodes) keywords.push(...shortCodes)

  // 1c. 产品名中任意的多字母+数字型号（如 Professional NM1090, Elite E32c）
  const longCodes = name.match(/\b([A-Z]{2,}\d+[A-Za-z]?)\b/g)
  if (longCodes) keywords.push(...longCodes)

  // 2. 产品系列名
  const seriesMatch = name.match(/\b(ARES|THOR|ARMOR|PLAY|JUMPDRIVE|Workflow)\b/gi)
  if (seriesMatch) keywords.push(...seriesMatch)
  // "Go" 单独处理：仅大写（Lexar Professional Go / Workflow Go）
  if (/\bGo\b/.test(name)) keywords.push('Go')

  // 3. 数字标识（如 1066x, 2000x, 800x, 2280, 700）
  const numMatches = name.match(/\b(\d{3,4}x|\d{3,}[A-Z]?)\b/g)
  if (numMatches) {
    for (const n of numMatches) {
      // 过滤掉太通用的数字（如纯 2.5, 3.1, 3.2 这类 USB 版本号）
      if (/^\d{3,}/.test(n) || /[A-Z]$/.test(n) || n.endsWith('x')) {
        keywords.push(n)
      }
    }
  }

  // 4. 系列变体（如 SILVER, GOLD, DIAMOND, BLUE）
  const colorMatch = name.match(/\b(SILVER|GOLD|DIAMOND)\b/i)
  if (colorMatch) keywords.push(colorMatch[1])

  // 5. 过滤通用技术词/规格：这些词出现在多个不同产品名中，不能作为唯一型号标识
  const GENERIC_TECH = new Set([
    'DDR4', 'DDR5', 'RGB', 'OC', 'PRO', 'SSD', 'NVMe', 'PCIe',
    'SD', 'SDXC', 'SDHC', 'UHS', 'USB', 'SATA', 'M2', 'Type',
    'Express', 'CUDIMM', 'UDIMM', 'SODIMM', 'DIMM', 'TLC', 'NAND',
    '2280', '2230', '2242',  // M.2 规格 — 跨产品通用
    'Gen', 'Gen4', 'Gen3', 'Gen5',  // PCIe 代数
    'Card', 'Reader', 'Drive', 'SSD',  // 品类词 — 跨产品通用
  ])
  return [...new Set(keywords)].filter(k => !GENERIC_TECH.has(k.toUpperCase()))
}

/**
 * 检查产品名是否在源文本中被提及（型号关键词匹配）
 * 能提取关键词时做精准匹配；无法提取关键词时用全名子串匹配
 */
function isProductInText(source: string, sourceTexts: string[]): boolean {
  const keywords = extractModelKeywords(source)
  const joinedText = sourceTexts.join(' ').toLowerCase()

  if (keywords.length > 0) {
    // 有关键词：精准型号匹配
    for (const kw of keywords) {
      if (kw.length >= 2 && joinedText.includes(kw.toLowerCase())) {
        return true
      }
    }
    return false
  }

  // 无法提取关键词：用去除 "Lexar " 前缀后的产品名做子串匹配
  // 例如 "Lexar SSD Dash" → 检查源文本是否包含 "SSD Dash"
  const strippedName = source.replace(/^Lexar\s+/i, '').toLowerCase()
  return joinedText.includes(strippedName)
}

function filterGlossaryByProductLine(
  glossaryMap: Map<string, string>,
  productLine: string | null,
  runtimeProductLines?: Record<string, string>,  // source → productLine，来自上传的CSV
  sourceTexts?: string[],  // 源文本，用于产品名型号检测
): Map<string, string> {
  const allowedSources = new Set<string>()

  // Tag-based 过滤：从 GLOSSARY_TAG_MAP 中筛选
  // 规则：tag 包含 'common'（通用术语）或当前产品线 tag 的术语
  for (const [source, tags] of Object.entries(GLOSSARY_TAG_MAP)) {
    if (tags.includes('common') || (productLine ? tags.includes(productLine) : false)) {
      allowedSources.add(source)
    }
  }

  // 运行时产品线数据（来自上传CSV的「产品线」列）
  if (productLine && runtimeProductLines) {
    for (const [source, pl] of Object.entries(runtimeProductLines)) {
      if (pl === productLine || pl === 'common') {
        allowedSources.add(source)
      }
    }
  }

  // 过滤 glossaryMap
  const filtered = new Map<string, string>()
  for (const [source, target] of glossaryMap.entries()) {
    if (!allowedSources.has(source)) continue

    // 产品名条目：要求型号关键词在源文本中出现，否则跳过
    if (isProductNameEntry(source)) {
      if (!sourceTexts || sourceTexts.length === 0) continue
      if (!isProductInText(source, sourceTexts)) continue
    }

    filtered.set(source, target)
  }

  return filtered
}

// ============================================================
// 术语库按场景过滤
// 非电商场景下排除营销口号/情感描述类术语，保留技术术语、产品品类、品牌术语
// 产品名（140条自动分类）始终通过，只过滤专属术语中的营销文案
// ============================================================
const MARKETING_ONLY_TERMS = new Set([
  'End Storage Anxiety',
  'Power Up Your Play',
  'Seamless Play, Ultimate Gaming',
  'Zero Lag Game Loading',
  'Capture the Diamond Moments',
  'Unleash Your Full Potential in Work and Play',
  'Unlock Device Potential',
  'Unmatched Performance',
  'Unleash Your Computer with Next-Gen DDR5',
  'Smooth 4K Video Recording',
  'No dropped frames',
  'No sudden speed drop',
  'Play Hard, Work Hard',
  'Professional Grade Performance',
  'Steel-Armored, Unstoppable Performance',
  'Full Game Library Storage',
  'Seamlessly compatible with Intel XMP 3.0 & AMD EXPO for one-click overclocking.',
  'DDR5 Performance with Powerful Heatsink',
  'Heat-Defying 6nm Controller',
  'Compact & Portable',
  '4X Faster than USB 3.0',
])

function filterGlossaryByScene(
  glossaryObj: Record<string, string>,
  scenePreset: string,
): Record<string, string> {
  // 电商场景不过滤，全量注入
  if (scenePreset === 'ecommerce' || !scenePreset) return glossaryObj

  const filtered: Record<string, string> = {}
  for (const [source, target] of Object.entries(glossaryObj)) {
    if (!MARKETING_ONLY_TERMS.has(source)) {
      filtered[source] = target
    }
  }
  return filtered
}

// ============================================================
// 预计算任务级术语提示词 — 用全部源文本一次性过滤术语库，
// 将相同的 glossaryHint 注入每个批次，确保 system prompt 100% 一致 → API 缓存命中
// ============================================================
export function buildTaskGlossaryHint(
  glossaryMap: Map<string, string>,
  productLine: string | null,
  scenePreset: string,
  runtimeProductLines?: Record<string, string>,
  allSourceTexts?: string[],
): string {
  const filteredGlossaryMap = filterGlossaryByProductLine(glossaryMap, productLine, runtimeProductLines, allSourceTexts)
  const glossaryObj: Record<string, string> = {}
  for (const [k, v] of filteredGlossaryMap.entries()) { glossaryObj[k] = v }
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
// 全局铁则（所有翻译强制注入，主规则源）
// 基于 Lexar × Qwen 3.7 翻译质量提升手册 Section 二
// ============================================================
const GLOBAL_RULES = `【铁则 — 绝对不可违反】
1. 品牌名/系列名禁止翻译：Lexar、雷克沙、ARES、THOR、ARMOR、NM、NQ、PLAY、SILVER、BLUE、GOLD、DIAMOND、JUMPDRIVE、Professional、WorkFlow 等必须原样保留。Silver/Blue/Gold/Diamond 是产品系列名，禁止译为"银色/蓝色/金色/钻石"。
2. 技术规格/行业标准符号原样保留：GB/TB/MB/s、UHS-I/II、V30/V60/V90、A1/A2、PCIe、NVMe、CFexpress、SD、microSD、SSD、USB 3.2、4K/8K、DirectStorage、XMP、EXPO、CUDIMM 等。
3. 品类词固定区分，严禁混用：台式机内存=Desktop Memory、笔记本内存=Laptop Memory、内置固态=SSD、移动固态=Portable SSD、U盘=Flash Drive、双接口U盘=Dual Drive、存储卡=Card、读卡器=Reader、硬盘盒=Enclosure、扩展坞=Hub。
4. 术语库译法为最高优先级，必须严格使用。数字/容量/速度值原样保留，绝对不可更改。
5. 读取速度(Read speed)≠写入速度(Write speed)，严格区分，禁止混译。
6. 禁止在译文任何位置使用括号添加解释、原文、别名。输出必须为纯译文，禁止混合多种语言。
7. 短标签/按钮/参数名(<15字符)禁止扩写为长句，保持同等简洁度。
8. 忠实原文不扩写：不得漏译、增译、添加原文没有的卖点、功能说明、品牌故事或使用场景。译文信息量与原文完全一致。即使知道相关背景也不得补充。
9. 合规信息（保修条款、认证标志CE/FCC、法律免责声明）必须逐字直译，不得改写、省略或替换为目标市场等效条款。`

// ============================================================
// 全局铁则（英文版，EN 源时注入）
// ============================================================
const GLOBAL_RULES_EN = `[IRON RULES]
1. Brand/series names preserved as-is: Lexar, ARES, THOR, ARMOR, NM, NQ, PLAY, SILVER, BLUE, GOLD, DIAMOND, JUMPDRIVE, Professional, WorkFlow. Silver/Blue/Gold/Diamond are Lexar series names — NOT colors.
2. Tech specs preserved: GB/TB/MB/s, UHS-I/II, V30/V60/V90, A1/A2, PCIe, NVMe, CFexpress, SD, microSD, SSD, USB 3.2, 4K/8K, DirectStorage, XMP, EXPO, CUDIMM.
3. Category words fixed: Desktop Memory, Laptop Memory, internal SSD, Portable SSD, Flash Drive, Dual Drive, Card, Reader, Enclosure, Hub.
4. Glossary terms: highest priority, use exactly. Numbers/specs preserved verbatim.
5. Read speed ≠ Write speed.
6. No parenthetical explanations or mixed languages in output.
7. Short labels (<15 chars): keep short, don't expand into sentences.
8. Faithful to source — no omissions, additions, embellished claims, marketing copy, feature descriptions, brand stories, or usage scenarios. Suppress background knowledge.
9. Compliance text (warranty, CE/FCC, legal): verbatim only.`

// ============================================================
// 场景提示词（用户可选，默认电商详情页）
// 已瘦身：删除铁则已覆盖的内容（数值原样/忠实原文/品牌保护等）
// ============================================================

// STYLE_PRESETS 仅用于 UI 预览面板（翻译时语气由 getTranslationContext 注入）
export const STYLE_PRESETS: Record<string, string> = {
  standard: `【语气】平实自然，通顺易读。`,
  professional: `【语气】严谨正式，技术表述精准客观。句式简洁，避免冗余修饰。`,
  marketing: `【语气】有说服力，突出卖点。保持高端品牌调性，不虚构不夸大。`,
}

export const SCENE_PRESETS: Record<string, string> = {
  technical_params: `【场景：技术参数表】表格行项1:1严格对应，不合并/拆分/增删。保留 "-"、"N/A"、"TBD" 等占位符原样。`,
  ecommerce: `【场景：商品详情页】卖点前置，短句为主。源语言特有表达（俚语/热词/习语）不直译，找目标语言等效说法。市场适配方向见语言专属提示。`,
  packaging: `【场景：包装文案】禁止断词换行。避免生僻词。合规信息直译不可改写。`,
  ui: `【场景：软件UI】报错action-first。预留文本膨胀空间（DE/NL/PL优先最短表达）。RTL确保UI方向正确。`,
  after_sales: `【场景：售后/保修卡】零营销语言。法律免责条款直译不可改写。敬语体系见语言专属提示。`,
  manual: `【场景：说明书】操作步骤1:1严格对应。安全警告逐字直译。使用指令式语气，简短明确。`,
  spec_sheet: `【场景：规格书/数据表】表格1:1。参数名使用行业标准译法。"Typ."/"Max."/"Min." 等标注原样保留。禁止营销描述。`,
}

export const SCENE_PRESETS_EN: Record<string, string> = {
  technical_params: `[Scene: Technical Specs] Table rows 1:1 — no merge/split/add/remove. Preserve "-", "N/A", "TBD" exactly.`,
  ecommerce: `[Scene: E-commerce] Lead with selling points, short sentences. Never calque source-language slang. See language-specific rules for market adaptation.`,
  packaging: `[Scene: Packaging] No hyphenation breaks. Avoid obscure vocabulary. Compliance text verbatim.`,
  ui: `[Scene: Software UI] Error messages action-first. Reserve expansion space for DE/NL/PL. RTL: ensure correct direction.`,
  after_sales: `[Scene: After-Sales/Warranty] Zero marketing language. Legal disclaimers verbatim. See language-specific rules for formality.`,
  manual: `[Scene: User Manual] Steps strictly 1:1. Safety warnings verbatim. Imperative tone, short and unambiguous.`,
  spec_sheet: `[Scene: Spec Sheet] Table 1:1. Use industry-standard terms for parameter names. Preserve "Typ."/"Max."/"Min." labels. No marketing language.`,
}

// ============================================================
// 产品线翻译策略（8条产品线，统一中/英文版）
// 每块 = 语义映射 + 术语要点 + 陷阱提醒，不承载风格（风格由 TRANSLATION_CONTEXT 的语气行独立表达）
// ============================================================
const PRODUCT_LINE_STRATEGIES: Record<string, string> = {
  professional_imaging: `【专业影像 — 受众：专业摄影师、影视从业者、内容工作室】
品牌定位：影视工业级可靠性，数据即资产不可丢失。
语调：严谨克制，数据说话（比特率/MB/s/VPG）。避免消费级形容词（"超快""惊人"）。
词汇：不掉帧(dropped frames)、连拍(burst shooting)、导出(offload)、VPG(Video Performance Guarantee)、影院级(cinema-grade)。
禁忌：不可称为"游戏卡"、不可使用消费级速度形容词。`,
  consumer_cards: `【消费存储卡 — 受众：主流消费者、家庭用户、日常拍摄者】
品牌定位：买得起的高品质存储，稳定耐用是核心竞争力。
语调：实用、可靠、不浮夸。功能描述清晰直接。
词汇：4K畅拍、数据安全、持久耐用、即插即用。UHS总线/U3/V30用行业标准表达。
禁忌：不可夸大性能为"专业级""旗舰级"。不可暗示游戏性能。`,
  gaming_card: `【游戏存储卡 — 受众：主机/掌机玩家、Switch/Steam Deck用户】
品牌定位：消除游戏加载等待，大容量游戏库随身携带。
语调：硬核但不浮夸，性能数据导向（A2/IOPS/V30）。
⚠️ 核心陷阱：读取速度(游戏加载) ≠ 写入速度(安装/存档效率)。A2 = 高随机读写IOPS(运行流畅度)。V30/V60/V90 = 持续写入保证(录制不掉帧)。
禁忌：不可混淆读取/写入性能。不可夸大游戏体验（"开挂""碾压"）。`,
  gaming_ssd: `【电竞SSD — 受众：硬核PC玩家、DIY装机爱好者、性能发烧友】
品牌定位：消除加载瓶颈，3A秒进、DirectStorage就绪。
语调：极客但不傲慢。参数说话（PCIe代数/顺序读写/随机IOPS/散热方案）。
⚠️ 核心陷阱：读取速度(游戏加载) ≠ 写入速度(安装/存档)。DirectStorage = GPU直读SSD绕开CPU解压。散热方案决定持续性能。
禁忌：不可混淆读取/写入。不可承诺非特定游戏的帧率提升。`,
  gaming_dimm: `【电竞内存 — 受众：超频玩家、DIY装机、电竞战队】
品牌定位：1% Low帧提升者，拒绝团战掉帧，突破超频极限。
语调：硬核极客，参数精确（DDR代数/频率MHz/CL时序/电压）。
词汇：1% Low帧、团战稳定性、XMP/EXPO一键超频、PMIC独立供电、散热马甲热阻。
禁忌：不可承诺所有CPU/主板都能达到标称频率。不可暗示内存频率=游戏帧率线性提升。`,
  pc_productivity: `【PC/AI生产力 — 受众：内容创作者、AI开发者、企业IT、工作站用户】
品牌定位：AI时代的效率基石，海量数据处理从容不迫。
语调：专业高效，技术表述严谨。避免消费级营销口吻。
词汇：多线程并发、本地LLM推理、I/O吞吐、内容创作流水线、巨型文件传输。
禁忌：不可简化AI性能为单一数字。不可与游戏SSD共用游戏化语言。`,
  portable_storage: `【移动存储 — 受众：移动办公者、内容创作者、户外摄影师、普通用户】
品牌定位：数据随身，坚固可靠，疾速传输。
语调：便捷实用导向，强调场景价值（即拍即传、快速备份、跨设备兼容）。
词汇：桥接芯片、温控保护、IP防护等级、AES加密、即拍即传、跨平台兼容。
⚠️ 品类词严禁混用：U盘(Flash Drive) ≠ 移动固态(Portable SSD) ≠ 双接口U盘(Dual Drive) ≠ 硬盘盒(Enclosure) ≠ 扩展坞(Hub)。
禁忌：不可将PSSD称为"U盘"。不可将Hub称为"扩展器"。`,
  innovation_lifestyle: `【创新生活 — 受众：家庭用户、数码礼品购买者、生活品质消费者】
品牌定位：科技温暖生活，连接家人情感。
语调：温暖但不煽情，简洁优雅。避免硬核参数堆砌。
词汇：一键分享、家庭云相框、跨越距离、陪伴家人。屏幕参数/App绑定如实呈现。
品牌区分：pexar = 温暖科技陪伴；Lexar Hub = 简洁优雅效率工具。
禁忌：不可用"孝顺""送礼"等道德绑架式文案。不可过度情感化。`,
}

const PRODUCT_LINE_STRATEGIES_EN: Record<string, string> = {
  professional_imaging: `[Professional Imaging — Audience: Pro photographers, filmmakers, content studios]
Brand position: Cinema-grade reliability. Data is the asset — never compromise.
Tone: Restrained, data-backed, technical. No consumer-grade hype ("stunning", "incredible", "blazing" for cards).
Vocabulary: dropped frames, burst shooting, offload, VPG (Video Performance Guarantee), bitrate, cinema-grade, IP rating.
Taboo: Never call it a "gaming card". Never apply consumer-tier speed adjectives to professional cards.`,
  consumer_cards: `[Consumer Cards — Audience: Mainstream consumers, families, everyday shooters]
Brand position: Quality storage everyone can trust. Stability and endurance are core strengths.
Tone: Practical, reliable, straightforward. Function-first descriptions.
Vocabulary: smooth 4K, data safety, durable, plug-and-play. UHS bus/U3/V30: industry-standard.
Taboo: Never upsell as "pro-grade" or "flagship". Never imply gaming performance.`,
  gaming_card: `[Gaming Card — Audience: Console/handheld gamers, Switch/Steam Deck users]
Brand position: Eliminate game-loading wait. Carry your full game library anywhere.
Tone: Hardcore but honest. Performance-data driven (A2/IOPS/V30).
⚠️ CRITICAL: Read speed (game loading) ≠ Write speed (install/archive efficiency). A2 = high random IOPS (gameplay smoothness). V30/V60/V90 = sustained write (no dropped frames in recording).
Taboo: Never conflate read/write speeds. Never overstate gaming experience.`,
  gaming_ssd: `[Gaming SSD — Audience: Hardcore PC gamers, DIY builders, performance enthusiasts]
Brand position: Eliminate loading bottlenecks. Instant AAA loading, DirectStorage-ready.
Tone: Geeky but not arrogant. Spec-driven (PCIe generation, sequential R/W, random IOPS, thermal solution).
⚠️ CRITICAL: Read speed (game loading) ≠ Write speed (install/archival). DirectStorage = GPU reads SSD directly, bypassing CPU decompression. Thermal solution dictates sustained performance.
Taboo: Never conflate read/write. Never promise FPS boosts for unspecified titles.`,
  gaming_dimm: `[Gaming Memory — Audience: Overclockers, DIY builders, esports teams]
Brand position: The 1% Low FPS improver. Eliminate team-fight stutters, push OC limits.
Tone: Hardcore geek, spec-precise (DDR generation, frequency MHz, CL timings, voltage).
Vocabulary: 1% Low FPS, team-fight stability, XMP/EXPO one-click OC, PMIC independent power, heatsink thermal resistance.
Taboo: Never promise rated frequency on all CPU/motherboard combinations. Never imply linear frequency-to-FPS scaling.`,
  pc_productivity: `[PC / AI Productivity — Audience: Content creators, AI developers, enterprise IT, workstation users]
Brand position: The efficiency foundation for the AI era. Massive data handled effortlessly.
Tone: Professional, technically rigorous. No consumer-marketing fluff.
Vocabulary: multi-threaded concurrency, local LLM inference, I/O throughput, content creation pipeline, massive file transfer.
Taboo: Never reduce AI performance to a single number. Never recycle gaming SSD language.`,
  portable_storage: `[Portable Storage — Audience: Mobile professionals, creators, outdoor photographers, general users]
Brand position: Your data, anywhere. Rugged, reliable, blazing transfers.
Tone: Practical and scenario-driven. Emphasize use-case value (capture-and-transfer, fast backup, cross-device compatibility).
Vocabulary: bridge chip, thermal protection, IP rating, AES encryption, capture-and-transfer, cross-platform.
⚠️ Category words NEVER interchangeable: Flash Drive ≠ Portable SSD ≠ Dual Drive ≠ Enclosure ≠ Hub.
Taboo: Never call a PSSD a "flash drive" or "USB stick". Never call a Hub an "extender".`,
  innovation_lifestyle: `[Innovation Lifestyle — Audience: Families, gift buyers, lifestyle-oriented consumers]
Brand position: Technology that warms life, connecting families across distance.
Tone: Warm but not saccharine. Clean and elegant. No spec-dumping.
Vocabulary: one-tap sharing, family cloud frame, bridge distances, family connection. Screen specs/App pairing: accurately represented.
Brand distinction: pexar = warm tech companionship; Lexar Hub = clean, elegant efficiency tool.
Taboo: Never use guilt-based marketing ("filial piety", "obligation"). Never over-sentimentalize.`,
}

// 产品线 → 相关品类词映射（只注入跟当前产品线相关的品类词，省 token 减干扰）
const PRODUCT_LINE_CATEGORY_MAP: Record<string, string[]> = {
  professional_imaging: ['Card', 'Reader'],
  consumer_cards: ['Card', 'Reader'],
  gaming_card: ['Card'],
  gaming_ssd: ['SSD', 'Portable SSD'],
  gaming_dimm: ['Desktop Memory', 'Laptop Memory'],
  pc_productivity: ['SSD', 'Portable SSD', 'Hub'],
  portable_storage: ['Portable SSD', 'Flash Drive', 'Dual Drive', 'Card', 'Reader', 'Enclosure', 'Hub'],
  innovation_lifestyle: [],
}

// ============================================================
// 语言专属提示词（20语种，目标语言匹配时自动注入）
// 原则：只写LLM容易出错、代码无法自动修复的专属规则
// ============================================================
const LANG_SPECIFIC: Record<string, string> = {
  'zh-CN': `【zh-CN】存储卡(非内存卡)、固态硬盘、读卡器、读取速度、写入速度、移动固态硬盘。禁用港台词汇。禁用极限词(最佳/第一/顶级)。中英文/数字间加半角空格。使用自然的简体中文表达，避免翻译腔。`,
  'zh-TW': `【zh-TW】詞彙在地化（禁止只做簡繁字體轉換）：无人机→空拍機、內存→記憶體、硬盤→硬碟、U盘→隨身碟、移動固態→可攜式固態硬碟、屏幕→螢幕、分辨率→解析度、固件→韌體。記憶卡(非内存卡)、固態硬碟、讀卡機、行動硬碟、隨身碟。正体字规范：身分(非身份)、週(非周)。禁用大陆政策词汇与网络用语。使用自然的台灣繁體中文表達，避免翻譯腔。`,
  'ja': `【ja】初出「レクサー」、以降Lexar。です・ます調。SDカード、リード速度、ライト速度、ポータブルSSD、カードリーダー、USBメモリ。カタカナ優先：新技術用語はカタカナ表記。和製英語を使用、英語直訳を避ける。過度な誇張禁止。说明书/包装用极其克制的客观描述。自然な日本語の表現を用い、翻訳調を避ける。`,
  'ko': `【ko】初出렉사르、以降Lexar。읽기 속도、쓰기 속도、휴대용 SSD、카드 리더기、USB 플래시 드라이브。하십시오체(습니다/ㅂ니다) 통일, 반말 금지。외래어 우선 사용、간결하게。띄어쓰기 엄수。IT 용어: 영어 차용어 우선 (SSD, NVMe, 게이밍)。자연스러운 한국어 표현, 번역투를 피할 것.`,
  'fr': `[fr] Metropolitan French (NOT Quebec). Carte microSD/SD, SSD portable, lecteur de cartes, clé USB, vitesse de lecture/écriture. Espace insécable avant : ; ! ?. Use "vous" not "tu". Séparateur décimal : virgule (7,5 Mo/s). Utilisez des expressions naturelles en français, évitez les calques.`,
  'de': `[de] 🚨 Lexar ≠ Lexware! Speicherkarte, Tragbare SSD, Kartenleser, USB-Stick, Lese-/Schreibgeschwindigkeit. Compound nouns: one word. "Sie" not "du". UI: use shortest form to avoid text overflow. Natürliche deutsche Ausdrucksweise — keine wortwörtlichen Übersetzungen.`,
  'es': `[es] International Castilian Spanish. Tarjeta microSD/SD, SSD portátil, lector de tarjetas, velocidad de lectura/escritura. Use formal "Usted". "ordenador" NOT "computadora", "tarjeta de memoria" NOT "memoria". Usa expresiones naturales en español, evita calcos del original.`,
  'pt': `[pt] Portugal mainland Portuguese. Cartão de memória, SSD portátil, leitor de cartões, velocidade de leitura/gravação. ⛔ Pen USB (NOT Pen Drive), Portátil (NOT Notebook), Caixa (NOT Case). Adjective-noun gender/number agreement. Use expressões naturais do português europeu, evite decalques.`,
  'pt-BR': `[pt-BR] Brazilian Portuguese. Cartão de memória, SSD portátil, leitor de cartões, pendrive, velocidade de leitura/gravação. ⛔ Pen Drive (NOT Pen USB), Notebook (NOT Portátil), Case (NOT Caixa). Use "você". IT术语常直接借用英语。语气可相对热情。Use expressões naturais do português brasileiro, evite decalques.`,
  'it': `[it] Scheda microSD/SD, SSD portatile, lettore di schede, chiavetta USB, velocità di lettura/scrittura. Accents: è, perché, più — never omit. Keep English tech terms (SSD, NVMe, gaming). Usa espressioni naturali in italiano, evita calchi dalla lingua di partenza.`,
  'nl': `[nl] microSD-kaart, Draagbare SSD, kaartlezer, USB-stick, leessnelheid, schrijfsnelheid. Compound nouns as one word. Expect ~20% text expansion. Gebruik natuurlijk Nederlands, vermijd letterlijke vertalingen.`,
  'pl': `[pl] Karta microSD/SD, Przenośny dysk SSD, czytnik kart, pendrive, prędkość odczytu/zapisu. Preserve ą ę ł ń ó ś ź ż. Correct case declension. "dysk SSD" (nie "napęd SSD"). Używaj naturalnych polskich wyrażeń, unikaj kalk językowych.`,
  'sv': `[sv] microSD-kort, bärbar SSD, kortläsare, USB-minne, läshastighet, skrivhastighet. Preserve å ä ö. Minimal, restrained copy — Nordic aesthetic. Retain English IT terms (SSD, NVMe, PCIe, gaming, flash). Använd naturliga svenska uttryck — ingen översättningssvenska.`,
  'tr': `[tr] microSD kart, Taşınabilir SSD, kart okuyucu, USB bellek, okuma hızı, yazma hızı. Preserve ı İ ö ü ç ş ğ. Distinguish I/ı vs İ/i. Apostrophe-separated suffixes. Doğal Türkçe ifadeler kullanın, çeviri kokusundan kaçının.`,
  'ru': `[ru] карта памяти, портативный SSD, кардридер, скорость чтения/записи. Cyrillic text; Latin for Lexar/tech symbols (embedded LTR). 6-case declension. Используйте естественные русские выражения, избегайте калькирования.`,
  'vi': `[vi] thẻ nhớ, ổ cứng SSD di động, đầu đọc thẻ, ổ USB, tốc độ đọc/ghi. Preserve đ ư ơ ă â + tone marks. Northern standard (Hanoi). Confirm ALL tone marks (sắc, huyền, hỏi, ngã, nặng). Diễn đạt tự nhiên theo tiếng Việt, tránh dịch sát từng chữ.`,
  'th': `[th] การ์ดหน่วยความจำ, SSD แบบพกพา, เครื่องอ่านการ์ด, แฟลชไดรฟ์, ความเร็วอ่าน/เขียน. Standard register (NOT royal/casual). Avoid Buddhist-sensitive vocabulary. Polite particles (ครับ/ค่ะ) only in customer-facing UI. ใช้สำนวนภาษาไทยที่เป็นธรรมชาติ หลีกเลี่ยงการแปลตรงตัว`,
  'id': `[id] kartu memori, SSD portabel, pembaca kartu, flashdisk, kecepatan baca/tulis. Official Bahasa Indonesia (NOT Malay). Formal "Anda", avoid colloquial "kamu"/"lu"/"gue". Prefix system (me-, di-, ter-, pe-) correctly applied. Gunakan ungkapan alami bahasa Indonesia, hindari penerjemahan kaku.`,
  'ar': `[ar] بطاقة ذاكرة, قرص SSD محمول, قارئ بطاقات, سرعة القراءة/الكتابة. MSA (fusha) only. Full RTL; embedded Latin LTR. Gender-neutral. Diacritics (tashkeel): add only on ambiguous terms. Avoid Egyptian/Levantine colloquialisms. استخدم تعبيرات عربية طبيعية، وتجنب الترجمة الحرفية.`,
  'en': `[en] American English spelling. Read speed / Write speed. Use native digital industry expressions. Keep it concise and punchy. Use natural American English — no translationese.`,
}


// ============================================================
// 输出前自检规则（精简版，注入任务结尾，模型自我校验）
// ============================================================
// 精简自检：只检查输出后才能验证的东西（全局铁则已覆盖品牌/术语/忠实性）
// 输出纯度锚点（利用 Qwen 对 prompt 首尾注意力最高的特性，末尾放核心输出约束）
const OUTPUT_ANCHOR = `输出前内存校验（不要输出校验过程）：
1. 占位符 __TRM_N__ 完好无损且位置正确
2. ↵ 换行标记原样保留、位置不变
3. 术语库译法正确使用
4. 未添加原文不存在的信息
5. 遵守目标语言专属规则
校验通过后直接输出纯译文——无解释、无括号、无混合语言。禁止扩写为营销文案。短标签保持同等简洁。`
const OUTPUT_ANCHOR_EN = `Self-check in memory (don't output):
1. __TRM_N__ placeholders intact
2. ↵ line-break markers preserved exactly at original positions
3. Glossary terms applied correctly
4. No added info absent from source
5. Target language rules followed
→ Output pure translation only. No expansion. Short labels stay short.`

// ============================================================
// 辅助函数
// ============================================================
// ============================================================
// 场景→风格路由：纯技术场景强制严谨专业版
// spec_sheet/technical_params/manual/after_sales 天然是技术性的，
// 即使 UI 选择了 marketing 风格，也应强制覆盖为 professional。
// ============================================================
function getEffectiveStyle(scenePreset: string, requestedStyle: string): string {
  // 只有商品详情页允许三种风格（standard/professional/marketing），
  // 其他所有场景（包装/ui/售后/说明书/规格书/技术参数）强制严谨专业版
  if (scenePreset !== 'ecommerce') return 'professional'
  return requestedStyle
}

// ============================================================
// TRANSLATION_CONTEXT — 统一的翻译上下文注入
// 合并 STYLE + SCENE + PRODUCT_LINE，消除模块互斥和重叠
// ============================================================
function getTranslationContext(
  productLine: string | null,
  scenePreset: string,
  style: string,
  isEnSource: boolean,
): string {
  // 纯技术场景强制专业版风格
  const effectiveStyle = getEffectiveStyle(scenePreset, style)
  const parts: string[] = []

  // —— 产品语境 ——
  if (productLine) {
    const plBlocks = isEnSource ? PRODUCT_LINE_STRATEGIES_EN : PRODUCT_LINE_STRATEGIES
    const block = plBlocks[productLine]
    if (block) parts.push(block)
  } else {
    parts.push(isEnSource
      ? '[Product Context] General 3C/storage product. Translate accurately with industry-standard terminology.'
      : '【产品语境】通用3C存储产品。使用行业标准术语，准确翻译。')
  }

  // —— 场景约束 ——
  const scenePresets = isEnSource ? SCENE_PRESETS_EN : SCENE_PRESETS
  const scene = scenePresets[scenePreset]
  if (scene) parts.push(scene)

  // —— 语气方向（始终注入，永不跳过） ——
  const toneMap: Record<string, Record<string, string>> = {
    standard: {
      cn: '【语气】平实自然，通顺易读。',
      en: '[Tone] Clear, natural, easy to read.',
    },
    professional: {
      cn: '【语气】严谨正式，精准客观。句式简洁，无冗余修饰。',
      en: '[Tone] Formal, precise, objective. Concise — no redundant modifiers.',
    },
    marketing: {
      cn: '【语气】有说服力，突出卖点。保持高端品牌调性，不虚构不夸大。',
      en: '[Tone] Persuasive, benefit-led. Premium brand voice. Never fabricate or exaggerate.',
    },
  }
  const tone = toneMap[effectiveStyle] || toneMap['standard']
  parts.push(isEnSource ? tone.en : tone.cn)

  return '\n' + parts.join('\n')
}

function getLangSpecificPrompt(targetLang: string): string {
  const rules = LANG_SPECIFIC[targetLang]
  return rules ? `\n${rules}` : ''
}

// ============================================================
// 校对专用精简产品语境（相比翻译版去掉受众/品牌定位/语气指导，
// 只保留术语规则和禁忌——校对的核心是检查准确性而非风格创作）
// ============================================================
const PROOFREAD_PL_CN: Record<string, string> = {
  professional_imaging: '\n【专业影像】检查：不掉帧/连拍/导出/VPG术语正确，禁止称"游戏卡"。',
  consumer_cards: '\n【消费存储卡】检查：4K畅拍/数据安全/即插即用术语正确，禁止夸大性能。',
  gaming_card: '\n【游戏存储卡】读取速度≠写入速度，A2=随机IOPS，V30=持续写入。',
  gaming_ssd: '\n【电竞SSD】读取速度≠写入速度，DirectStorage=GPU直读SSD。散热决定持续性能。',
  gaming_dimm: '\n【电竞内存】1% Low帧/XMP/EXPO/PMIC，不承诺所有平台可达标称频率。',
  pc_productivity: '\n【PC/AI生产力】多线程/LLM推理/I/O吞吐，禁止使用游戏化语言。',
  portable_storage: '\n【移动存储】品类词严禁混用：U盘≠移动固态≠双接口U盘≠硬盘盒≠扩展坞。',
  innovation_lifestyle: '\n【创新生活】pexar=温暖科技陪伴，禁止道德绑架式文案。',
}

const PROOFREAD_PL_EN: Record<string, string> = {
  professional_imaging: '\n[Professional Imaging] Check: dropped frames, burst shooting, offload, VPG. Never "gaming card".',
  consumer_cards: '\n[Consumer Cards] Check: smooth 4K, data safety, plug-and-play. No "pro-grade" or "flagship".',
  gaming_card: '\n[Gaming Card] Read speed ≠ Write speed. A2=random IOPS. V30=sustained write.',
  gaming_ssd: '\n[Gaming SSD] Read speed ≠ Write speed. DirectStorage=GPU reads SSD directly. Thermal dictates sustained perf.',
  gaming_dimm: '\n[Gaming Memory] 1% Low FPS, XMP/EXPO, PMIC. Never promise rated freq on all platforms.',
  pc_productivity: '\n[PC/AI Productivity] Multi-threaded, LLM inference, I/O throughput. No gaming language.',
  portable_storage: '\n[Portable Storage] Category words NEVER interchangeable: Flash Drive≠Portable SSD≠Dual Drive≠Enclosure≠Hub.',
  innovation_lifestyle: '\n[Innovation Lifestyle] pexar=warm tech companionship. No guilt-based marketing.',
}

function getProofreadContext(productLine: string | null, isEnSource: boolean): string {
  if (!productLine) {
    return isEnSource
      ? '\n[Product Context] General 3C/storage product. Verify terminology consistency.'
      : '\n【产品语境】通用3C存储产品。检查术语一致性。'
  }
  const block = isEnSource ? PROOFREAD_PL_EN[productLine] : PROOFREAD_PL_CN[productLine]
  return block || ''
}


/**
 * 校对专用目标语言末尾规则
 *
 * 与 getTargetLangReinforcement（翻译用）不同，校对规则聚焦于：
 * 1. 检测译文是否异常扩展（校对的核心价值）
 * 2. 术语合规性检查
 * 3. 长度匹配检查
 *
 * 用目标语言书写以利用语言启动效应，让校对模型在目标语言语境中评审。
 */
function getProofreadTargetLangReinforcement(targetLang: string): string {
  switch (targetLang) {
    case 'zh-TW':
      return `\n[🔍 校對檢查清單 — 繁體中文]
- 擴展檢測：譯文是否比原文長很多？如有，標記為「過度擴寫」並壓縮至原文長度。
- 術語合規：譯文中的術語是否與術語庫一致？不一致則修正。
- 保護術語：軟體名/品牌名（如 Lexar Recovery Tool）是否在譯文中被翻譯或擴寫？如有，恢復為原始名稱。
- 原創內容：譯文是否添加了原文沒有的產品功能/優惠/故事？如有，刪除。
- 簡繁轉換：用語是否為台灣繁體？（硬盤→硬碟、固態→固態硬碟、U盤→隨身碟、內存→記憶體）`
    case 'zh-CN':
      return `\n[🔍 校对检查清单 — 简体中文]
- 扩展检测：译文是否比原文长很多？如是，标记为「过度扩写」并压缩至原文长度。
- 术语合规：译文中的术语是否与术语库一致？不一致则修正。
- 原创内容：译文是否添加了原文没有的产品功能/优惠/故事？如有，删除。`
    case 'ja':
      return `\n[🔍 校正チェックリスト — 日本語]
- 拡張検出：訳文が原文より大幅に長いか？長い場合は「過剰拡張」として原文長に圧縮。
- 用語合规：訳文中の用語は用語集と一致しているか？不一致なら修正。
- オリジナル内容：原文にない製品機能や特典情報が追加されていないか？あれば削除。`
    case 'ko':
      return `\n[🔍 교정 체크리스트 — 한국어]
- 확장 감지: 번역문이 원문보다 훨씬 긴가? 길면 "과도확장"으로 표시하고 원문 길이로 압축.
- 용어 규정: 번역문의 용어가 용어집과 일치하는가? 불일치 시 수정.
- 원본 내용: 원문에 없는 제품 기능/혜택 정보가 추가되었는가? 있으면 삭제.`
    case 'fr':
      return `\n[🔍 CHECKLIST DE RELECTURE — FRANÇAIS]
- Détection d'expansion : la traduction est-elle beaucoup plus longue que la source ? Si oui, compresser.
- Conformité terminologique : les termes correspondent-ils au glossaire ? Corriger si non.
- Contenu original : des fonctions/produits/promotions absents de la source ont-ils été ajoutés ? Supprimer.`
    case 'de':
      return `\n[🔍 PRÜFCHECKLISTE — DEUTSCH]
- Expansionserkennung: Ist die Übersetzung viel länger als die Quelle? Falls ja, auf Quelllänge komprimieren.
- Terminologie-Compliance: Stimmen die Begriffe mit dem Glossar überein? Falls nicht, korrigieren.
- Originalinhalte: Wurden nicht in der Quelle enthaltene Funktionen/Angebote hinzugefügt? Löschen.`
    case 'es':
      return `\n[🔍 CHECKLIST DE REVISIÓN — ESPAÑOL]
- Detección de expansión: ¿la traducción es mucho más larga que el original? Si sí, comprimir.
- Conformidad terminológica: ¿coinciden los términos con el glosario? Corregir si no.
- Contenido original: ¿se añadieron funciones/ofertas no presentes en el original? Eliminar.`
    case 'pt':
      return `\n[🔍 CHECKLIST DE REVISÃO — PORTUGUÊS]
- Deteção de expansão: a tradução está muito mais longa que o original? Se sim, comprimir.
- Conformidade terminológica: os termos correspondem ao glossário? Corrigir se não.
- Conteúdo original: foram adicionadas funções/ofertas ausentes no original? Eliminar.`
    case 'pt-BR':
      return `\n[🔍 CHECKLIST DE REVISÃO — PORTUGUÊS BRASILEIRO]
- Detecção de expansão: a tradução está muito mais longa que o original? Se sim, comprimir.
- Conformidade terminológica: os termos correspondem ao glossário? Corrigir se não.
- Conteúdo original: foram adicionadas funções/ofertas ausentes no original? Eliminar.`
    case 'it':
      return `\n[🔍 CHECKLIST DI REVISIONE — ITALIANO]
- Rilevamento espansione: la traduzione è molto più lunga dell'originale? Se sì, comprimere.
- Conformità terminologica: i termini corrispondono al glossario? Correggere se no.
- Contenuto originale: sono state aggiunte funzioni/offerte non presenti nell'originale? Eliminare.`
    case 'nl':
      return `\n[🔍 CONTROLELIJST — NEDERLANDS]
- Expansiedetectie: is de vertaling veel langer dan het origineel? Zo ja, comprimeren.
- Terminologische conformiteit: komen de termen overeen met de woordenlijst? Corrigeer indien niet.
- Originele inhoud: zijn er functies/aanbiedingen toegevoegd die niet in het origineel staan? Verwijderen.`
    case 'pl':
      return `\n[🔍 LISTA KONTROLNA — POLSKI]
- Wykrywanie rozszerzenia: czy tłumaczenie jest znacznie dłuższe niż oryginał? Jeśli tak, skompresuj.
- Zgodność terminologiczna: czy terminy są zgodne z glosariuszem? Popraw jeśli nie.
- Oryginalna treść: czy dodano funkcje/oferty nieobecne w oryginale? Usuń.`
    case 'sv':
      return `\n[🔍 CHECKLISTA — SVENSKA]
- Expansionsdetektering: är översättningen mycket längre än originalet? Komprimera i så fall.
- Terminologisk efterlevnad: matchar termerna ordlistan? Korrigera om inte.
- Originalinnehåll: har funktioner/erbjudanden som saknas i originalet lagts till? Ta bort.`
    case 'tr':
      return `\n[🔍 KONTROL LİSTESİ — TÜRKÇE]
- Genişletme tespiti: çeviri orijinalden çok daha uzun mu? Uzunsa sıkıştır.
- Terminoloji uyumu: terimler sözlükle eşleşiyor mu? Eşleşmiyorsa düzelt.
- Orijinal içerik: orijinalde olmayan işlevler/teklifler eklendi mi? Kaldır.`
    case 'ru':
      return `\n[🔍 КОНТРОЛЬНЫЙ СПИСОК — РУССКИЙ]
- Обнаружение расширения: перевод намного длиннее оригинала? Если да, сжать.
- Терминологическое соответствие: термины совпадают с глоссарием? Исправить, если нет.
- Оригинальный контент: добавлены ли функции/предложения, отсутствующие в оригинале? Удалить.`
    case 'vi':
      return `\n[🔍 DANH SÁCH KIỂM TRA — TIẾNG VIỆT]
- Phát hiện mở rộng: bản dịch có dài hơn nhiều so với bản gốc không? Nếu có, hãy nén lại.
- Tuân thủ thuật ngữ: các thuật ngữ có khớp với bảng thuật ngữ không? Sửa nếu không.
- Nội dung gốc: có thêm chức năng/ưu đãi không có trong bản gốc không? Xóa bỏ.`
    case 'th':
      return `\n[🔍 รายการตรวจสอบ — ภาษาไทย]
- การตรวจจับการขยายความ: ฉบับแปลยาวกว่าต้นฉบับมากหรือไม่? หากใช่ ให้บีบอัด
- การปฏิบัติตามคำศัพท์: คำศัพท์ตรงกับอภิธานศัพท์หรือไม่? แก้ไขหากไม่ตรง
- เนื้อหาต้นฉบับ: มีการเพิ่มฟังก์ชัน/ข้อเสนอที่ไม่มีในต้นฉบับหรือไม่? ลบออก`
    case 'id':
      return `\n[🔍 DAFTAR PERIKSA — BAHASA INDONESIA]
- Deteksi ekspansi: apakah terjemahan jauh lebih panjang dari aslinya? Jika ya, kompres.
- Kepatuhan terminologi: apakah istilah sesuai dengan glosarium? Perbaiki jika tidak.
- Konten orisinal: apakah ada fungsi/penawaran yang tidak ada di sumber asli? Hapus.`
    case 'ar':
      return `\n[🔍 قائمة التحقق — العربية]
- كشف التوسع: هل الترجمة أطول بكثير من النص الأصلي؟ إذا كان الأمر كذلك، قم بالضغط.
- الامتثال للمصطلحات: هل تتطابق المصطلحات مع المسرد؟ صحح إذا لم تتطابق.
- المحتوى الأصلي: هل تمت إضافة وظائف/عروض غير موجودة في النص الأصلي؟ احذف.`
    case 'en':
      return `\n[🔍 PROOFREAD CHECKLIST — ENGLISH]
- Expansion detection: is the translation much longer than the source? If so, compress to source length.
- Terminology compliance: do terms match the glossary? Correct if not.
- Original content: were functions/offers not in the source added? Remove.`
    default:
      return ''
  }
}

function getGlobalRulesForProofread(isEnSource?: boolean): string {
  if (isEnSource) {
    return `[Rules] Brand/series names untranslated. Technical specs preserved as-is. Silver/Blue/Gold are Lexar series names — never translate as colors. Category words strictly distinguished: Desktop Memory, Laptop Memory, SSD, Portable SSD, Flash Drive, Dual Drive, Card, Reader, Enclosure, Hub. Read speed ≠ Write speed. No omissions or additions. No expansion into marketing copy. Short labels stay short. Compliance text verbatim. No parenthetical explanations.`
  }
  return `【规则】品牌/系列名禁止翻译。技术规格原样保留。Silver/Blue/Gold是产品系列名禁止译为颜色词。品类词严格区分：台式机内存、笔记本内存、SSD、移动固态、U盘、双接口U盘、存储卡、读卡器、硬盘盒、扩展坞。读取速度≠写入速度。不得漏译增译。严禁扩写为营销文案。短标签保持简洁。合规信息逐字直译。禁止添加括号解释。`
}

// ============================================================
// 品类词多语言对照表
// ============================================================
const CATEGORY_WORDS: Record<string, Record<string, string>> = {
  // 内置SSD
  'SSD': {
    'zh-CN': '固态硬盘', 'zh-TW': '固態硬碟', 'ja': 'SSD', 'ko': 'SSD',
    'fr': 'SSD', 'de': 'SSD', 'es': 'Unidad de estado sólido (SSD)',
    'pt': 'SSD Interno', 'pt-BR': 'SSD Interno', 'it': 'SSD',
    'ru': 'SSD', 'vi': 'Ổ Cứng SSD', 'th': 'SSD ภายใน', 'id': 'SSD Internal',
    'ar': 'SSD داخلي', 'nl': 'Interne SSD', 'pl': 'Dysk SSD wewnętrzny',
    'sv': 'Intern SSD', 'tr': 'Dahili SSD',
  },
  // 移动固态硬盘
  'Portable SSD': {
    'zh-CN': '移动固态硬盘', 'zh-TW': '行動固態硬碟', 'ja': 'ポータブルSSD', 'ko': '휴대용 SSD',
    'fr': 'SSD portable', 'de': 'Tragbare SSD', 'es': 'SSD portátil',
    'pt': 'SSD Portátil', 'pt-BR': 'SSD Portátil', 'it': 'SSD portatile',
    'ru': 'Портативный SSD', 'vi': 'SSD Di Động', 'th': 'SSD แบบพกพา', 'id': 'SSD Portabel',
    'ar': 'SSD محمول', 'nl': 'Draagbare SSD', 'pl': 'Przenośny dysk SSD',
    'sv': 'Portabel SSD', 'tr': 'Taşınabilir SSD',
  },
  // 台式机内存
  'Desktop Memory': {
    'zh-CN': '台式机内存条', 'zh-TW': '桌上型電腦記憶體', 'ja': 'デスクトップメモリ', 'ko': '데스크탑 메모리',
    'fr': 'Mémoire pour ordinateur de bureau', 'de': 'Desktop Arbeitsspeicher',
    'es': 'Memoria de sobremesa', 'pt': 'Memória RAM para Desktop', 'pt-BR': 'Memória RAM para Desktop',
    'it': 'Memoria per Desktop', 'ru': 'Оперативная память для ПК',
    'vi': 'Bộ Nhớ Máy Tính Để Bàn', 'th': 'แรมคอมพิวเตอร์ตั้งโต๊ะ', 'id': 'RAM Desktop',
    'ar': 'ذاكرة RAM لأجهزة الكمبيوتر المكتبية', 'nl': 'RAM-geheugen voor desktop',
    'pl': 'Pamięć RAM do komputera stacjonarnego', 'sv': 'Arbetsminne för stationär dator',
    'tr': 'Masaüstü RAM',
  },
  // 笔记本内存
  'Laptop Memory': {
    'zh-CN': '笔记本电脑内存', 'zh-TW': '筆記型電腦記憶體', 'ja': 'ラップトップメモリ', 'ko': '랩탑 메모리',
    'fr': 'Mémoire pour ordinateur portable', 'de': 'Laptop Arbeitsspeicher',
    'es': 'Memoria para portátil', 'pt': 'Memória RAM para Portátil', 'pt-BR': 'Memória RAM para Notebook',
    'it': 'Memoria per Laptop', 'ru': 'Оперативная память для ноутбука',
    'vi': 'Bộ Nhớ Máy Tính Xách Tay', 'th': 'แรมโน้ตบุ๊ก', 'id': 'RAM Laptop',
    'ar': 'ذاكرة RAM لأجهزة الكمبيوتر المحمولة', 'nl': 'RAM-geheugen voor laptop',
    'pl': 'Pamięć RAM do laptopa', 'sv': 'Arbetsminne för bärbar dator',
    'tr': 'Laptop RAM',
  },
  // U盘
  'Flash Drive': {
    'zh-CN': '闪存盘', 'zh-TW': '隨身碟', 'ja': 'USBメモリ', 'ko': 'USB 메모리',
    'fr': 'Clé USB', 'de': 'USB-Stick', 'es': 'Unidad flash',
    'pt': 'Pen USB', 'pt-BR': 'Pen Drive', 'it': 'Unità flash',
    'ru': 'USB-флеш-накопитель', 'vi': 'Flash Drive', 'th': 'แฟลชไดร์ฟ', 'id': 'Flashdisk',
    'ar': 'محرك فلاش USB', 'nl': 'USB-stick', 'pl': 'Pendrive',
    'sv': 'USB-minne', 'tr': 'USB Bellek',
  },
  // 双接口U盘
  'Dual Drive': {
    'zh-CN': '双接口U盘', 'zh-TW': '雙接頭隨身碟', 'ja': 'デュアルドライブ', 'ko': '듀얼 드라이브',
    'fr': 'Clé USB double interface', 'de': 'Dual-USB-Stick', 'es': 'Unidad flash de doble interfaz',
    'pt': 'Pen USB Dupla Interface', 'pt-BR': 'Pen Drive Dupla Interface', 'it': 'Unità flash a doppia interfaccia',
    'ru': 'USB-накопитель с двумя разъёмами', 'vi': 'USB Hai Đầu', 'th': 'แฟลชไดร์ฟสองพอร์ต', 'id': 'Flashdisk Dual Interface',
    'ar': 'محرك فلاش ثنائي الواجهة', 'nl': 'Dual-USB-stick', 'pl': 'Pendrive z dwoma złączami',
    'sv': 'USB-minne med dubbla gränssnitt', 'tr': 'Çift Arayüzlü USB Bellek',
  },
  // 固态U盘
  'Solid State Dual Drive': {
    'zh-CN': '固态U盘', 'zh-TW': '固態隨身碟', 'ja': 'ソリッドステートデュアルドライブ', 'ko': '솔리드 스테이트 듀얼 드라이브',
    'fr': 'Clé USB SSD double interface', 'de': 'SSD-Dual-USB-Stick', 'es': 'Unidad flash SSD de doble interfaz',
    'pt': 'Pen USB SSD Dupla Interface', 'pt-BR': 'Pen Drive SSD Dupla Interface', 'it': 'Unità flash SSD a doppia interfaccia',
    'ru': 'SSD-накопитель с двумя разъёмами', 'vi': 'USB SSD Hai Đầu', 'th': 'โซลิดสเตทแฟลชไดร์ฟสองพอร์ต', 'id': 'SSD Flashdisk Dual Interface',
    'ar': 'محرك أقراص صلب ثنائي الواجهة', 'nl': 'SSD Dual-USB-stick', 'pl': 'Pendrive SSD z dwoma złączami',
    'sv': 'SSD USB-minne med dubbla gränssnitt', 'tr': 'SSD Çift Arayüzlü USB Bellek',
  },
  // 存储卡
  'Card': {
    'zh-CN': '存储卡', 'zh-TW': '記憶卡', 'ja': 'カード', 'ko': '카드',
    'fr': 'Carte', 'de': 'Karte', 'es': 'Tarjeta',
    'pt': 'Cartão', 'pt-BR': 'Cartão', 'it': 'Scheda',
    'ru': 'Карта памяти', 'vi': 'Thẻ', 'th': 'เมมโมรี่การ์ด', 'id': 'Kartu Memori',
    'ar': 'بطاقة ذاكرة', 'nl': 'Geheugenkaart', 'pl': 'Karta pamięci',
    'sv': 'Minneskort', 'tr': 'Hafıza Kartı',
  },
  // 读卡器
  'Reader': {
    'zh-CN': '读卡器', 'zh-TW': '讀卡機', 'ja': 'リーダー', 'ko': '리더',
    'fr': 'Lecteur', 'de': 'Lesegerät', 'es': 'Lector',
    'pt': 'Leitor', 'pt-BR': 'Leitor', 'it': 'Lettore',
    'ru': 'Картридер', 'vi': 'Reader', 'th': 'การ์ดรีดเดอร์', 'id': 'Card Reader',
    'ar': 'قارئ بطاقات', 'nl': 'Kaartlezer', 'pl': 'Czytnik kart',
    'sv': 'Kortläsare', 'tr': 'Kart Okuyucu',
  },
  // 硬盘盒
  'Enclosure': {
    'zh-CN': '硬盘盒', 'zh-TW': '硬碟盒', 'ja': 'ケース', 'ko': '케이스',
    'fr': 'Boîtier', 'de': 'Gehäuse', 'es': 'Receptáculo',
    'pt': 'Caixa', 'pt-BR': 'Case', 'it': 'Custodia',
    'ru': 'Корпус', 'vi': 'Enclosure', 'th': 'กล่อง', 'id': 'Casing',
    'ar': 'علبة', 'nl': 'Behuizing', 'pl': 'Obudowa',
    'sv': 'Kabinett', 'tr': 'Kutusu',
  },
  // 扩展坞
  'Hub': {
    'zh-CN': '扩展坞', 'zh-TW': '擴充埠', 'ja': 'ハブ', 'ko': '허브',
    'fr': 'Hub', 'de': 'Hub', 'es': 'Concentrador',
    'pt': 'Hub', 'pt-BR': 'Hub', 'it': 'Hub',
    'ru': 'Хаб', 'vi': 'Hub', 'th': 'ฮับ', 'id': 'Hub',
    'ar': 'موزع', 'nl': 'Hub', 'pl': 'Hub',
    'sv': 'Hubb', 'tr': 'Hub',
  },
}

function getCategoryWordGuide(targetLang: string, productLine?: string | null, isEnSource?: boolean): string {
  // 无产品线时兜底只注入最通用的品类词，避免全量注入浪费 token
const FALLBACK_CATEGORY_WORDS = ['SSD', 'Card', 'Flash Drive']
const lines: string[] = []
const allowedWords = productLine
  ? (PRODUCT_LINE_CATEGORY_MAP[productLine] || FALLBACK_CATEGORY_WORDS)
  : FALLBACK_CATEGORY_WORDS
for (const [en, map] of Object.entries(CATEGORY_WORDS)) {
  if (!allowedWords.includes(en)) continue
  const translated = map[targetLang]
  if (translated) {
    lines.push(`  ${en} → ${translated}`)
  }
}
if (lines.length === 0) return ''
const label = isEnSource ? `[Category Word Reference (${targetLang})]` : `【品类词对照表（${targetLang}）】`
return `\n${label}\n${lines.join('\n')}`
}

// 注入品类词：所有内容类型均需术语一致性保障
// 产品线过滤 + 内容类型相关词汇，省 token
function getCategoryWordGuideIfNeeded(targetLang: string, productLine?: string | null, isEnSource?: boolean): string {
  return getCategoryWordGuide(targetLang, productLine, isEnSource)
}

// ============================================================
// 上下文关联提示
// ============================================================
const CONTEXT_HINT = `文本按设计稿层级排列，相邻条目存在上下文关联（如标题→副标题→正文），翻译时注意语义连贯和术语风格一致。`
const CONTEXT_HINT_EN = `Adjacent entries share context (title→subtitle→body). Keep terminology and style consistent across entries.`

export async function translateBatch(
  texts: string[],
  targetLang: string,
  glossaryMap: Map<string, string>,
  config: LLMConfig,
  sourceLang?: string,
  pageContext?: string[],
  runtimeProductLines?: Record<string, string>,
  runtimeTermTypes?: Record<string, string>,
  pageName?: string,
  fileName?: string,
  crossBatchTerms?: string[],
  taskGlossaryHint?: string,
): Promise<string[]> {
  const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang

  const detectedSource = sourceLang || detectSourceLanguage(texts)
  const isEnSource = detectedSource === 'en'
  const sourceName = detectedSource === 'zh-CN' ? '简体中文' : '英文'

  const { texts: cleanTexts, tags: htmlTags } = protectHtmlTags(texts)

  // 源文本预标准化（Unicode NFC + 全角→半角 + 零宽字符移除 + 兼容字符规范化）
  const normalizedTexts = normalizeTextForLLM(cleanTexts)

  // 提取不应翻译的术语（两层：1. source===target 2. termType==='保留原文'）
  // 这些术语在翻译时必须保持原样，需要遮蔽后发给 LLM
  const protectedTerms: string[] = []
  for (const [src, tgt] of glossaryMap.entries()) {
    if (src.length < 3) continue
    // 第1层：当前目标语言下 source === target（术语库明确指示不翻译）
    if (src === tgt) {
      protectedTerms.push(src)
      continue
    }
    // 第2层：termType 标记为"保留原文"的术语（软件名/品牌名等始终不翻译）
    if (runtimeTermTypes && runtimeTermTypes[src]?.startsWith('保留原文')) {
      protectedTerms.push(src)
    }
  }

  // ⚠️ 实体遮蔽必须在 CJK 空格保护之前执行！
  // 实体遮蔽先将多词术语（如 "Lexar Recovery Tool"）整体替换为占位符，
  // 然后 CJK 空格保护删除剩余的空格（v2：直接删除，不引入任何占位符字符）
  const { texts: maskedTexts, entityMap } = maskEntities(normalizedTexts, protectedTerms)

  // CJK 空格保护：删除 CJK 主导文本中的空格，防止 LLM（Qwen）误判为条目分隔符
  // v2：直接删除空格而非占位替换——任何占位符字符都可能被 tokenizer 当作边界
  const { texts: spaceProtectedTexts } = protectCjkSpaces(maskedTexts)

  // 产品线检测（提前到术语过滤之前）
  const productLine = getEffectiveProductLine(config, texts, pageName, fileName)

  // 术语注入：优先使用任务级预计算提示词（跨批次 system prompt 一致 → API 缓存命中）
  // 无预计算时回退到逐批次术语过滤（兼容旧调用路径）
  let glossaryHint: string
  if (taskGlossaryHint !== undefined) {
    glossaryHint = taskGlossaryHint
  } else {
    const filteredGlossaryMap = filterGlossaryByProductLine(glossaryMap, productLine, runtimeProductLines, texts)
    let glossaryObj: Record<string, string> = {}
    for (const [k, v] of filteredGlossaryMap.entries()) { glossaryObj[k] = v }
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
  const fewShot = getFewShotExamples(detectedSource, targetLang, 1)

  let systemPrompt: string

  let pageContextBlock = ''
  if (pageContext && pageContext.length > 1) {
    const ctxList = pageContext.map((t, i) => `${i + 1}. ${t}`).join('\n')
    pageContextBlock = `\n【整页上下文（仅供参考，了解页面结构和术语一致性，不需要翻译）】\n${ctxList}\n`
  }

  // 全局铁则 + 风格 + 场景 + 产品线
  // 电商场景且产品线已检测到时，产品线×风格策略已内置风格指导，跳过全局风格块避免冗余
  const globalRules = isEnSource ? GLOBAL_RULES_EN : GLOBAL_RULES
  const contextBlock = getTranslationContext(productLine, config.scenePreset, config.translationStyle, isEnSource)
  const langBlock = getLangSpecificPrompt(targetLang)

  if (targetLang === 'zh-TW' && detectedSource === 'zh-CN') {
    // 简体中文 → 台湾繁体：特殊ROLE，共用通用路径（不重复铁则）
    const roleZhTw = '你是 Lexar（雷克沙）首席本地化翻譯專家，精通存儲、電競、影像及消費電子領域。核心使命：將簡體中文精準轉換為台灣繁體並完成用語在地化。嚴格忠實於原文信息邊界——透過調整詞彙色彩、句式結構來適配產品線與受眾，但絕對禁止自由創作、腦補參數或誇大宣傳。不擴寫、不補充、不美化。'
    systemPrompt = `${roleZhTw}

${globalRules}

将以下文本从${sourceName}翻译成${targetName}。
⚠️ 原文中的 ↵ 符號代表換行，譯文中請保留同樣的換行位置。

${contextBlock}${pageContextBlock}

${getCategoryWordGuideIfNeeded(targetLang, productLine, isEnSource)}

【规则】术语库最高优先级，必须严格使用${glossaryHint}

${htmlTags.size > 0 ? '【HTML标签】保留原文中所有HTML标签位置不变。\n' : ''}【上下文】${CONTEXT_HINT}

${langBlock}
${fewShot}
${OUTPUT_ANCHOR}
__XXX_N__ 格式标记必须原样保留在译文对应位置。

【輸出】嚴格按 "[N] 譯文" 格式，一行一條。⚠️ 每條 [N] 是一段完整文本，空格不是分隔符，嚴禁只翻前半段或分多行輸出！`
  } else {
    // ============================================================
    // 通用：3C存储行业翻译 prompt（多层提示词架构）
    // ============================================================
    const roleCn = '你是 Lexar（雷克沙）首席本地化翻譯專家，精通存儲、電競、影像及消費電子領域。核心使命：將源文本精準、地道地翻譯為目標語言。嚴格忠實於原文信息邊界——透過調整詞彙色彩、句式結構來適配產品線與受眾，但絕對禁止自由創作、腦補參數或誇大宣傳。'
    const roleEn = 'You are Lexar\'s lead localization expert, specializing in storage, gaming, imaging, and consumer electronics. Core mission: Translate source text accurately and idiomatically into the target language. Stay strictly within the source\'s information boundary — adapt vocabulary, sentence structure, and register to fit the product line and audience, but NEVER fabricate, embellish specifications, or add claims not in the source.'
    systemPrompt = `${isEnSource ? roleEn : roleCn}

${globalRules}

${isEnSource ? `Translate the following text from ${sourceName} to ${targetName}.` : `将以下文本从${sourceName}翻译成${targetName}。`}
	${isEnSource ? '⚠️ The ↵ symbol in source text represents a line break. Preserve it at the same position in your translation.' : '⚠️ 原文中的 ↵ 符号代表换行，译文中请保留同样的换行位置。'}

${contextBlock}${pageContextBlock}

${getCategoryWordGuideIfNeeded(targetLang, productLine, isEnSource)}

${isEnSource ? '[Rule] Glossary terms are highest priority. You MUST use them exactly as specified:' : '【规则】术语库最高优先级，必须严格使用'}${glossaryHint}

${htmlTags.size > 0 ? (isEnSource ? '[HTML Tags] Preserve all HTML tags in their original positions.\n' : '【HTML标签】保留原文中所有HTML标签位置不变。\n') : ''}${isEnSource ? 'Context' : '【上下文】'}${isEnSource ? CONTEXT_HINT_EN : CONTEXT_HINT}

${langBlock}
${fewShot}
${(isEnSource || !["zh-CN","zh-TW","ja","ko"].includes(targetLang)) ? OUTPUT_ANCHOR_EN : OUTPUT_ANCHOR}
${isEnSource ? 'Keep __XXX_N__ markers exactly as-is in your output.' : '__XXX_N__ 格式标记必须原样保留在译文对应位置。'}

${isEnSource ? '[Output] Strictly follow "[N] translation" format - one line per item. Each [N] is ONE complete text; do NOT split by internal spaces. No line breaks inside a single result.' : '【输出】严格按 "[N] 译文" 格式，一行一条。⚠️ 每条 [N] 是一段完整文本，空格不是分隔符，严禁只翻前半段或分多行输出！'}`
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

  // 恢复 HTML 标签
  if (htmlTags.size > 0) {
    result = restoreHtmlTags(result, htmlTags)
  }

  // 语言特定后处理
  result = result.map(t => postProcessTranslation(t, targetLang))

  // 术语库强制校准（翻译后直接替换，零 token 开销）
  result = enforceGlossaryTerms(texts, result, glossaryMap)

  // 短标签扩写硬守卫（源文 < 15 字符且译文过长时，降低阈值重新匹配术语库并硬截断）
  result = enforceShortLabelLength(texts, result, glossaryMap)

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
  runtimeProductLines?: Record<string, string>,
  runtimeTermTypes?: Record<string, string>,
  pageName?: string,
  fileName?: string,
  taskGlossaryHint?: string,
): Promise<ProofreadResult[]> {
  const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang

  const sourceTexts = items.map(it => it.sourceText)
  const detectedSource = detectSourceLanguage(sourceTexts)
  const isEnSource = detectedSource === 'en'

  // 校对也做产品线检测，补全闭环
  const productLine = getEffectiveProductLine(config, sourceTexts, pageName, fileName)
  const categoryWordGuide = getCategoryWordGuideIfNeeded(targetLang, productLine, isEnSource)

  // 术语注入：优先使用任务级预计算提示词（跨批次 system prompt 一致 → API 缓存命中）
  let glossaryHint: string
  if (taskGlossaryHint !== undefined) {
    glossaryHint = taskGlossaryHint
  } else {
    const filteredGlossaryMap = filterGlossaryByProductLine(glossaryMap, productLine, runtimeProductLines, sourceTexts)
    let glossaryObjProof: Record<string, string> = {}
    for (const [k, v] of filteredGlossaryMap.entries()) { glossaryObjProof[k] = v }
    glossaryObjProof = filterGlossaryByScene(glossaryObjProof, config.scenePreset)
    const result = filterRelevantGlossary(glossaryObjProof, sourceTexts, 100)
    glossaryHint = result.glossaryHint
  }

  // 源文本预标准化（\n → ↵，供 LLM 识别换行位置）
  const normalizedSourceTexts = normalizeTextForLLM(sourceTexts)
  // 译文中的实际 \n 也统一转为 ↵，确保源/译格式一致，避免校对模型误删换行
  const normalizedTranslatedTexts = items.map(it => it.translatedText.replace(/[\n\r]+/g, ' ↵ '))

  const transLabel = isEnSource ? 'Trans' : '译'
  const textList = items.map((it, i) => `[${i + 1}] ${normalizedSourceTexts[i]}\n${transLabel}：${normalizedTranslatedTexts[i]}`).join('\n\n')

  const proofreadContextBlock = getProofreadContext(productLine, isEnSource)
  const langBlock = getLangSpecificPrompt(targetLang)

  let systemPrompt: string

  if (targetLang === 'zh-TW' && detectedSource === 'zh-CN') {
    systemPrompt = `你是 Lexar（雷克沙）首席校稿專家，精通存儲、電競、影像及消費電子領域。核心使命：檢查簡→繁轉換與用語在地化品質，嚴格忠實於原文信息邊界——發現擴寫、增譯、腦補參數或營銷語言時必須修正。

${getGlobalRulesForProofread(false)}

${proofreadContextBlock}

${categoryWordGuide}
${CONTEXT_HINT}

逐條檢查：1.台灣用語正確性 2.術語合規 3.語句自然流暢。${glossaryHint}
⚠️ 保護術語檢查：軟體名/品牌名如在譯文中被翻譯或擴寫為營銷文案，修正為保留原始名稱。
⚠️ 譯文長度必須與原文匹配。若已正確且長度匹配回「OK」，不得改寫。
⚠️ 換行位置請保留 ↵ 標記，嚴禁在 JSON 輸出中插入真正的換行或回車！

${langBlock}
${OUTPUT_ANCHOR}
輸出 JSON 陣列，reason 用4字以內簡述：[{"i":1,"text":"修正譯文","reason":"用語修正"},{"i":2,"text":"OK","reason":""}] 無需修正 text 填 "OK"。`
  } else if (isEnSource) {
    systemPrompt = `You are Lexar's lead proofreader, specializing in storage, gaming, imaging, and consumer electronics. Core mission: Review ${targetName} translations against the source's information boundary — detect and correct any expansion, fabrication, embellished claims, or terminology violations.

${getGlobalRulesForProofread(true)}

${proofreadContextBlock}

${categoryWordGuide}
Context: ${CONTEXT_HINT_EN}

Check each pair: 1. Accuracy — no omissions 2. Glossary compliance 3. Natural flow.${glossaryHint}
⚠️ Translation length MUST match source. If correct and length-matched, return "OK" — do NOT rewrite.
⚠️ Use ↵ for line breaks. NEVER insert actual newlines or carriage returns in JSON output!

${langBlock}
${OUTPUT_ANCHOR_EN}
Output JSON array, reason in Chinese (max 4 chars): [{"i":1,"text":"corrected text","reason":"术语修正"},{"i":2,"text":"OK","reason":""}] If no correction needed, text = "OK".`
  } else {
    systemPrompt = `你是 Lexar（雷克沙）首席校稿專家，精通存儲、電競、影像及消費電子領域。核心使命：檢查${targetName}譯文品質，嚴格忠實於原文信息邊界——發現擴寫、增譯、腦補參數或營銷語言時必須修正。

${getGlobalRulesForProofread(false)}

${proofreadContextBlock}

${categoryWordGuide}
【上下文】${CONTEXT_HINT}

逐条检查：1.准确无漏译错译 2.术语库译法合規 3.标点规范句式自然。${glossaryHint}
⚠️ 保护术语检查：软件名/品牌名如在译文中被翻译或扩写为营销文案，修正为保留原始名称。
⚠️ 译文长度必须与原文匹配。若已正确且长度匹配回"OK"，不得改写。
⚠️ 换行位置请保留 ↵ 标记，严禁在 JSON 输出中插入真正的换行或回车！

${langBlock}
${OUTPUT_ANCHOR}
输出 JSON 数组，reason 用4字以内简述：[{"i":1,"text":"修正译文","reason":"术语修正"},{"i":2,"text":"OK","reason":""}] 无需修正 text 填 "OK"。`
  }

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

  // 尝试 JSON 解析
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ i: number; text?: string; reason?: string }>
      for (const entry of parsed) {
        if (entry.i >= 1 && entry.i <= results.length) {
          const entryText = (entry.text || '').trim()
          const isOK = /^OK[。.]?\s*$/i.test(entryText)
          results[entry.i - 1] = {
            text: isOK ? '' : entryText,
            reason: (entry.reason || '').trim(),
          }
        }
      }
      return results
    } catch { /* fall through to line parsing */ }
  }

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
