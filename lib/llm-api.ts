import { LLMConfig, LANGUAGES } from '@messages/types'
import { API_MAX_RETRIES, API_RETRY_DELAY_MS, API_TIMEOUT_MS } from '@lib/constants'
import { getFewShotExamples } from '@lib/few-shot-examples'
import { filterRelevantGlossary } from '@lib/glossary-filter'
import { normalizeTextForLLM } from '@lib/text-normalizer'
import { maskEntities, unmaskEntities } from '@lib/entity-masker'
import { postProcessTranslation, restoreTrademarkSymbols, restoreStorageUnitFormatting, enforceGlossaryTerms, capitalizeFirstLetter } from '@lib/post-process'
import { GLOSSARY_PRODUCT_LINE_MAP, COMMON_GLOSSARY_SOURCES } from '@lib/default-glossary'

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
// 内容类型检测
// ============================================================
type ContentType = 'title' | 'specification' | 'marketing' | 'description'

export function detectContentType(texts: string[]): ContentType {
  const joined = texts.join(' ')
  // 优先检测技术规格（含参数关键词，避免被 title 短路）
  if (/(\d+\s*(TB|GB|MB|MB\/s|GB\/s|MT\/s|MHz|PCIe|NVMe|SATA|USB|Gen\d|M\.2|IOPS|TBW))/.test(joined)) {
    return 'specification'
  }
  // 营销文案特征词（在 title 之前检测，避免短营销文案被误判为标题）
  if (/\b(experience|perfect|ultimate|unleash|revolutioniz|seamless|effortless|exceptional|game-?changing|cutting-?edge|state-?of-?the-?art|reliabl|designed for|protect|defend|powerful|compact|stylish|anxiety|potential|unmatched|capture|unlock|boost|perform)\b/i.test(joined)) {
    return 'marketing'
  }
  // 短文本（无句号/问号）→ 标题/功能名称
  if (texts.length > 0 && texts.every(t => t.length < 50) && texts.every(t => !/[。\?!?.]/.test(t))) {
    return 'title'
  }
  return 'description'
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
// ============================================================
function filterGlossaryByProductLine(
  glossaryMap: Map<string, string>,
  productLine: string | null,
  runtimeProductLines?: Record<string, string>,  // source → productLine，来自上传的CSV
): Map<string, string> {
  // 收集需要保留的术语 source
  const allowedSources = new Set<string>(COMMON_GLOSSARY_SOURCES)

  if (productLine) {
    const lineSources = GLOSSARY_PRODUCT_LINE_MAP[productLine]
    if (lineSources) {
      for (const s of lineSources) {
        allowedSources.add(s)
      }
    }
    // 运行时产品线数据（来自上传CSV的「产品线」列）
    if (runtimeProductLines) {
      for (const [source, pl] of Object.entries(runtimeProductLines)) {
        if (pl === productLine || pl === 'common') {
          allowedSources.add(source)
        }
      }
    }
  } else {
    // 无产品线时：保留通用 + 所有产品线的术语（兜底）
    for (const sources of Object.values(GLOSSARY_PRODUCT_LINE_MAP)) {
      for (const s of sources) {
        allowedSources.add(s)
      }
    }
    if (runtimeProductLines) {
      for (const source of Object.keys(runtimeProductLines)) {
        allowedSources.add(source)
      }
    }
  }

  // 过滤 glossaryMap
  const filtered = new Map<string, string>()
  for (const [source, target] of glossaryMap.entries()) {
    if (allowedSources.has(source)) {
      filtered.set(source, target)
    }
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
// HTML 标签保护
// ============================================================
function protectHtmlTags(texts: string[]): { texts: string[]; tags: Map<string, string> } {
  const tagMap = new Map<string, string>()
  let counter = 0
  const result = texts.map(t => {
    return t.replace(/<[^>]+>/g, match => {
      const key = `\x00HTML${counter}\x00`
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
// 内容类型风格指南
// ============================================================
const CONTENT_TYPE_GUIDES: Record<ContentType, string> = {
  title: `【标题/功能名】简短精准，品牌和产品系列名不翻译，保留容量/接口/速度参数。术语库最高优先级。`,
  specification: `【技术规格】参数/数值/单位原样保留（TB/GB/MB/s、PCIe、NVMe、SATA、USB等）。术语库强制标准。句式简洁客观。`,
  marketing: `【营销文案】术语库强制标准，在此基础上本土化润色。保留卖点力度，句式通顺自然，首字母大写。数字/规格原样不动。`,
  description: `【产品描述】术语库强制标准。保留原文段落结构。用词自然通顺，首字母大写，符合目标语言行业习惯。`,
}

const CONTENT_TYPE_GUIDES_EN: Record<ContentType, string> = {
  title: `[Title / Feature Name] Concise and precise. Brand names and product series names must NOT be translated. Preserve capacity/interface/speed parameters. Glossary terms are highest priority.`,
  specification: `[Technical Specifications] Parameters, values, and units must be preserved as-is (TB/GB/MB/s, PCIe, NVMe, SATA, USB, etc.). Glossary terms are mandatory. Concise, objective phrasing.`,
  marketing: `[Marketing Copy] Glossary terms are mandatory. Adapt and localize naturally on top of that. Preserve selling-point impact. Smooth, natural phrasing. Capitalize first letter of sentences. Numbers/specs remain unchanged.`,
  description: `[Product Description] Glossary terms are mandatory. Preserve the original paragraph structure. Use natural, fluent wording with first-letter capitalization, matching target-language industry conventions.`,
}

// ============================================================
// 全局铁则（所有翻译强制注入，主规则源）
// 基于 Lexar × Qwen 3.7 翻译质量提升手册 Section 二
// ============================================================
const GLOBAL_RULES = `【品牌与专有名词铁则】
1. 品牌名保护：所有品牌名（Lexar、雷克沙、DJI、Canon、Sony、PlayStation、iPhone、SanDisk、Kingston、Samsung、WD、Intel、AMD、NVIDIA等）和标准协议名（DirectStorage、XMP、EXPO、CUDIMM、UDIMM、SODIMM等）在任何语言中禁止翻译、禁止音译，必须原样保留。
2. 所有技术规格、行业标准符号原样保留不翻译，包括但不限于：GB/TB/MB/s、UHS-I/II、V30/V60/V90、A1/A2、PCIe、NVMe、CFexpress Type A/B、SD、microSD、SSD、USB 3.2、4K/8K、UHD、RAW。
3. 产品系列名/型号名（ARES、THOR、ARMOR、NM、NQ、PLAY、SILVER、Silver PLUS、Silver PRO、BLUE、GOLD、DIAMOND、JUMPDRIVE、Professional、WorkFlow 等）保留英文原词，仅可在正文中补充目标语言释义，禁止单独翻译系列名。特别注意：Silver/Blue/Gold/Diamond 等看似颜色词的词汇在 Lexar 语境下均为产品系列名，禁止翻译为"银色/蓝色/金色/钻石"等。
4. 产品完整型号（如 Lexar Professional CFexpress Type B 1800GB）字母数字格式完全保留，不得拆分、改写、本地化数字。
5. 禁止对任何缩写和标准协议名进行无依据展开；所有行业通用缩写和标准协议名（DirectStorage、XMP、EXPO、CUDIMM、UDIMM、SODIMM等）直接保留，不得擅自补全翻译。

【品类词严格区分】
6. 存储品类词固定区分，严禁混用：台式机内存=Desktop Memory（非PC RAM）、笔记本内存=Laptop Memory（非Notebook RAM）、内置固态=SSD（非Solid State Drive全拼）、移动固态=Portable SSD、U盘=Flash Drive、双接口U盘=Dual Drive、固态U盘=Solid State Dual Drive、存储卡=Card、读卡器=Reader、硬盘盒=Enclosure、扩展坞=Hub。

【领域与语体原则】
7. 领域锚定：数码存储、专业摄影摄像、消费电子行业。遇到多义词时，必须以此领域为第一判断标准选择释义。
8. 受众：面向专业摄影师、影视创作者与普通消费者，技术说明严谨客观，营销文案符合目标语言本土表达习惯，禁止中式外语直译。
9. 忠实原文：严格对应原文信息，不得漏译、增译、自行补充原文没有的卖点与修饰；禁止为了流畅度篡改产品参数、性能描述。
10. 术语统一：同一概念全文使用同一译法，禁止前后不一致。

【格式与合规铁则】
11. 数字、标点、千位分隔符、小数点严格遵循目标语言国家官方规范，禁止自动套用中文或英文格式。
12. 目标语言为非拉丁字母时，嵌入的英文/数字保持原书写方向，不得整体反转。
13. 严格遵守目标语言地区广告法规，禁止使用「最、第一、顶级、最强」等极限违禁词，替换为「专业级、旗舰、高性能」等合规表述。
14. 输出要求：仅输出纯目标语言译文，禁止夹带原文、注释、序号、翻译说明；禁止混合多种语言输出。

【Qwen 模型易错点强制修正】
15. 禁止静默回退到英文：即使表达困难，也必须使用目标语言完成翻译，不得出现英文解释或中英混排。
16. 所有带声调、变音、附标的字符必须完整保留，不得省略、替换为普通字母。
17. 禁止将中文成语、四字营销话术直译成目标语言字面意思，需做本土化意译，保留核心卖点。
18. 禁止破坏原文结构：列表、表格、层级关系保持原样，仅翻译文字内容。
19. ⚠️ 禁止在译文任何位置使用括号添加解释、英文原文、别名、读音、补充说明。尤其是以下 Qwen 常见错误模式必须杜绝：
    - "高速存储(High-speed storage)" → 错误，应为纯译文
    - "Lexar（雷克沙）" → 错误，品牌名禁止翻译或注音
    - "PCIe(高速接口标准)" → 错误，协议名保留原词无需解释
    - "紧凑型(compact)设计" → 错误，禁止在括号内夹带英文原文
    译文必须纯粹——任何补充信息、解释、双语对照均不得以括号或任何其他形式嵌入输出。
20. ⚠️ 读取速度和写入速度必须严格区分，禁止混淆：Read speed→读取速度、Write speed→写入速度，两者互不替代。尤其是在游戏存储语境下，禁止因"游戏看重读取"而将写入速度错误翻译为读取速度。写入和读取是独立技术指标，必须各译各的。`

// ============================================================
// 全局铁则（英文版，EN 源时注入）
// ============================================================
const GLOBAL_RULES_EN = `[Brand & Proper Noun Rules]
1. Brand name protection: all brand names (Lexar, 雷克沙, DJI, Canon, Sony, PlayStation, iPhone, SanDisk, Kingston, Samsung, WD, Intel, AMD, NVIDIA, etc.) and standard protocol names (DirectStorage, XMP, EXPO, CUDIMM, UDIMM, SODIMM, etc.) must remain in their original form in any language — no translation, no transliteration.
2. All technical specifications and industry standard symbols must be preserved untranslated, including but not limited to: GB/TB/MB/s, UHS-I/II, V30/V60/V90, A1/A2, PCIe, NVMe, CFexpress Type A/B, SD, microSD, SSD, USB 3.2, 4K/8K, UHD, RAW.
3. Product series/model names (ARES, THOR, ARMOR, NM, NQ, PLAY, SILVER, Silver PLUS, Silver PRO, BLUE, GOLD, DIAMOND, JUMPDRIVE, Professional, WorkFlow, etc.) must remain in English. Explanatory translations may be added in body text only; never translate series names standalone. CRITICAL: Words like Silver, Blue, Gold, Diamond may look like color/descriptor words but in Lexar context they are product series names — do NOT translate them as "银色/蓝色/金色/钻石".
4. Complete product model numbers (e.g. Lexar Professional CFexpress Type B 1800GB) must be preserved in full alphanumeric format — no splitting, rewriting, or localizing digits.
5. Never expand abbreviations or standard protocol names without basis. All industry-standard abbreviations and protocol names (DirectStorage, XMP, EXPO, CUDIMM, UDIMM, SODIMM, etc.) must be preserved as-is.

[Category Word Strict Distinction]
6. Storage category words are fixed and must not be mixed: Desktop Memory (NOT PC RAM), Laptop Memory (NOT Notebook RAM), internal SSD (NOT spelled out as Solid State Drive), Portable SSD, Flash Drive (single port), Dual Drive (dual port), Solid State Dual Drive, Card, Reader, Enclosure, Hub.

[Domain & Register Principles]
7. Domain anchoring: digital storage, professional photography/videography, consumer electronics. When encountering ambiguous terms, use this domain as the primary criterion for selecting the correct meaning.
8. Audience: professional photographers, filmmakers, and general consumers. Technical descriptions must be rigorous and objective. Marketing copy must conform to target language native expression conventions — no calqued Chinese-style foreign language.
9. Faithfulness to source: strictly correspond to the original information. No omissions, additions, or self-supplied selling points or embellishments not present in the source. Do not alter product parameters or performance descriptions for the sake of fluency.
10. Terminology consistency: use the same translation for the same concept throughout the entire text. No inconsistency.

[Format & Compliance Rules]
11. Numbers, punctuation, thousands separators, and decimal points must strictly follow the target language country's official conventions. Do not auto-apply Chinese or English formatting.
12. When the target language uses a non-Latin script, embedded English/numbers must maintain their original writing direction — do not reverse.
13. Strictly comply with target language regional advertising regulations. Prohibited superlative claims such as "best", "#1", "top-tier", "strongest" must be replaced with compliant alternatives like "professional-grade", "flagship", "high-performance".
14. Output requirement: only output pure target language translation. No source text, notes, numbering, or translation explanations. No mixing of multiple languages.

[Qwen Model Error-Prone Fixes]
15. No silent fallback to English: even when expression is difficult, must complete translation in the target language. No English explanations or mixed Chinese-English output.
16. All characters with tones, diacritics, and accents must be fully preserved — no omission or replacement with plain letters.
17. Do not literally translate Chinese idioms or four-character marketing phrases into the target language. Use localized paraphrasing while preserving core selling points.
18. Do not destroy original document structure: lists, tables, and hierarchical relationships must remain intact. Only translate text content.
19. ⚠️ NEVER add parenthetical explanations, original English text, aliases, pronunciation guides, or supplementary notes anywhere in the translation output. These Qwen-common error patterns are strictly forbidden:
    - "High-speed storage (高速存储)" → WRONG, must be pure translation
    - "Lexar (雷克沙)" → WRONG, brand names must stay in original form only
    - "compact (紧凑型) design" → WRONG, never embed source language in parentheses
    The output must be PURE translation — no supplementary information, no bilingual glosses, no explanations embedded in parentheses or any other form.
20. ⚠️ Read speed and Write speed must be strictly distinguished — never confuse them. "Read speed" and "Write speed" are independent specifications. In gaming storage contexts especially, do NOT default to "read speed" for all speed mentions. Each must be translated correctly per the actual specification.`

// ============================================================
// 翻译风格预设（仅含风格差异化描述，全局铁则单独注入）
// ============================================================
export const STYLE_PRESETS: Record<string, string> = {
  standard: `【翻译风格：通用标准版】
【风格】翻译风格自然流畅，句式通顺，符合目标语言的表达习惯。术语库固定译法为最高标准。根据不同目标市场调整语序和用词，避免机械直译源语言结构。`,
  professional: `【翻译风格：严谨专业版】
【风格】翻译风格严谨正式，技术表述精准客观，术语前后统一，不美化不夸张。句式简洁，避免冗余修饰词。符合技术文档与产品规格说明的行业编写规范。`,
  marketing: `【翻译风格：电商营销版】
【风格】在准确传达产品卖点的基础上，优化句式使其更具吸引力和说服力。符合目标市场电商产品页的本土表达风格。保持高端数码品牌质感，不过度夸张。英语市场可偏活力感，日语市场偏安心信赖感，德语市场以技术实力和数据说话。`,
}

const STYLE_PRESETS_EN: Record<string, string> = {
  standard: `[Translation Style: Standard]
[Style] Natural, fluent, and idiomatic in the target language. Balance accuracy with readability. Glossary terms are the highest authority. Adapt sentence structure and word choice to the target market conventions — do not calque the source-language structure.`,
  professional: `[Translation Style: Professional]
[Style] Rigorous and formal. Technically precise and objective. Consistent terminology throughout — no embellishment or exaggeration. Use concise sentences without redundant modifiers. Conform to technical documentation and product specification writing standards.`,
  marketing: `[Translation Style: E-commerce Marketing]
[Style] Engaging, persuasive e-commerce copy. Accurately convey product selling points while optimizing for impact and natural readability. Match the target market's native e-commerce expression style. Maintain premium digital brand quality — never overstate or use empty superlatives. Adapt tone per market: English-speaking markets can be benefit-driven and energetic; German market values fact-based, specification-led persuasion; Japanese market values trust-building and politeness; Nordic markets prefer understated, minimal copy.`,
}

// ============================================================
// 场景提示词（用户可选，默认电商详情页）
// ============================================================
export const SCENE_PRESETS: Record<string, string> = {
  technical_params: `【场景：技术参数表】本场景翻译风格固定为严谨专业，以下约束优先级最高。所有数值、单位、符号原样保留（禁止改值、禁止加空格、禁止转换单位），仅翻译说明文字。表行1:1严格对应，不合并/拆分/增删行项。解释性文字长度≤原文，不自行补充技术说明。保留 "-"、"N/A"、"TBD" 等占位符原样。术语极致严谨，不做任何意译与发挥。`,
  ecommerce: `【场景：电商详情页】卖点前置，短句为主，适合快速阅读。符合目标语言本土电商表达习惯，有感染力但不夸大。禁止直译中文网络热词、成语梗，做本土化意译。标题简洁有冲击力，详情段落逻辑清晰。细分市场语气：日语/韩语市场偏安心信赖感、避免过度夸张；德语市场以技术实力和数据说服；中东/东南亚市场偏柔和、价值导向；英语市场偏活力感、利益驱动。`,
  packaging: `【场景：包装文案】本场景翻译风格固定为严谨专业，以下约束优先级最高。译文简洁，单行长度≤源文110%（预留印刷版面缓冲）。合规信息（产地、质保、警示语、认证标记）直译不可改写，符合目标国法规。品牌、型号、规格、条形码区域附近文字不遮挡核心标识。禁止断词换行（hyphenation-based line break），避免生僻词，确保普通消费者快速理解。`,
  ui: `【场景：软件UI】本场景翻译风格固定为严谨专业，以下约束优先级最高。按钮文字1~3词（主操作按钮优先1词），菜单项统一名词或动名词风格。报错/提示语 action-first（如"无法连接"而非"连接失败"），Toast消息≤15字(CJK)/≤40字符(拉丁)。统一使用指令式或名词式风格，前后一致，不堆砌专业术语。RTL语言（阿拉伯语）确保UI方向正确。预留文本膨胀空间，德语、荷兰语、波兰语等长词语言优先最短表达。`,
  after_sales: `【场景：售后文档/保修卡】本场景翻译风格固定为严谨专业，以下约束优先级最高。技术术语绝对精确，法律免责条款直译不可改写。保修期限、条件、联系方式等关键信息原样保留、不得遗漏。使用正式敬语（Sie/vous/usted/敬体），禁用口语/俚语。零营销语言——纯事实陈述和操作指引。`,
}

export const SCENE_PRESETS_EN: Record<string, string> = {
  technical_params: `[Scene: Technical Parameter Table] Style is locked to Professional. All values, units, and symbols must be preserved as-is (no value changes, no added spaces, no unit conversion). Translate only explanatory text. Table rows must be 1:1 — no merging, splitting, adding, or removing rows. Explanatory text length must not exceed source. Preserve "-", "N/A", "TBD" placeholders exactly. Be rigorously precise with terminology — no paraphrasing or creative interpretation.`,
  ecommerce: `[Scene: E-commerce Product Page] Lead with key selling points. Use short sentences for quick scanning. Match the target market's native e-commerce expression style — compelling but not exaggerated. Never calque English marketing slang or idioms; adapt them natively. Titles should be punchy and concise; body copy should flow logically. Market-specific tone: Japanese/Korean — trust-building and polite, avoid hyperbole. German — data-driven, specification-led persuasion. Middle East/SEA — softer tone, value-oriented. English-speaking — benefit-driven and energetic.`,
  packaging: `[Scene: Packaging Copy] Style is locked to Professional. Keep translations concise — single line length ≤110% of source (preserve print layout buffer). Compliance info (origin, warranty, warnings, cert marks) must be translated literally per local regulations — no rewriting. Brand, model, spec labels, and barcode areas must not be obscured by translation. No hyphenation-based word breaks. Avoid obscure vocabulary; ensure quick comprehension by general consumers.`,
  ui: `[Scene: Software UI] Style is locked to Professional. Buttons: 1–3 words (primary actions prefer 1 word). Menus: consistent noun or verb-noun style. Error messages: action-first format (e.g. "Cannot connect" not "Connection failure"). Toast messages: ≤15 chars (CJK) / ≤40 chars (Latin). Use consistent style throughout. Avoid technical jargon overload. RTL languages (Arabic): ensure correct UI direction. Reserve space for text expansion; for German, Dutch, Polish, and other long-word languages, prefer the shortest viable expression.`,
  after_sales: `[Scene: After-Sales / Warranty Documents] Style is locked to Professional. Technical terms must be absolutely precise. Legal disclaimers must be translated literally — no paraphrasing. Warranty periods, conditions, and contact info must be preserved exactly. Use formal address (Sie/vous/usted/polite form). No slang or colloquialisms. Zero marketing language — pure factual and instructional content only.`,
}

// ============================================================
// 产品线策略（自动检测匹配，实现"同词不同境"语义映射）
// ============================================================
const PRODUCT_LINE_STRATEGIES: Record<string, string> = {
  professional_imaging: `【产品线：专业影像】受众为职业摄影师/影视团队。"高速/性能"→8K RAW不掉帧、高速连拍不卡顿、极速导出。"可靠/耐用"→极端环境防护、数据绝对安全。钢甲系列额外强调物理抗损。`,
  consumer_cards: `【产品线：消费存储卡】受众为vlog创作者/旅拍爱好者/家庭用户。"高速/性能"→4K视频畅拍不中断、连拍不卡顿、记录生活每一帧。"可靠"→选对卡、少踩坑、数据不丢失。文案语气亲近可信赖，可适度使用痛点场景切入（"插卡提示错误？"类）。`,
  gaming_card: `【产品线：游戏存储卡】受众为Switch/Steam Deck/ROG Ally等掌机玩家。"高读写速度"→UHS-I/V30高速读写确保游戏加载快、存档写入快、关卡秒切、开放世界无缝读图，读写速度不拖累游戏体验。"A2等级"→高随机读写IOPS提升掌机程序运行效率，游戏启动更快、运行更流畅、资源加载不卡顿。"大容量"→512GB/1TB海量空间，游戏库随身携带，告别反复删除重装的焦虑。⚠️ 读写速度必须严格区分："读取速度"/"写入速度"各有所指，禁止混用或一律写成读取速度。文案简洁有活力，可用游戏圈表达（"加载碾压""随身游戏库"）。`,
  gaming_ssd: `【产品线：电竞SSD】受众为3A大作玩家/PS5玩家。"游戏性能"→3A秒加载、消除材质延迟、DirectStorage潜能释放。`,
  gaming_dimm: `【产品线：电竞内存】受众为硬核电竞发烧友/超频玩家。"游戏性能"→提升1% Low帧、拒绝团战掉帧、突破超频极限。`,
  pc_productivity: `【产品线：PC/AI生产力】受众为AI PC用户/内容创作者/PC升级用户。"高速/性能"→AI模型秒级响应、巨型工程文件秒传、多任务游刃有余、旧电脑焕新。`,
  portable_storage: `【产品线：移动存储】受众为商务人士/学生/旅行者/移动创作者。"高速/性能"→手机文件秒传、旅行照片快速备份、移动办公不等待、拍摄素材即拍即传。"设计"→轻便随身、坚固耐用。`,
  innovation_lifestyle: `【产品线：创新生活】受众为家庭用户/送礼人群。"分享/连接"→跨越距离陪伴家人、一键上传珍贵瞬间。文案温暖感性，强调情感连接与隐私安全。`,
}

const PRODUCT_LINE_STRATEGIES_EN: Record<string, string> = {
  professional_imaging: `[Product Line: Professional Imaging] Audience: professional photographers and filmmakers. "High-speed / performance" → no dropped frames at 8K RAW, uninterrupted burst shooting, instant offload. "Reliability / durability" → extreme environment protection, absolute data safety. ARMOR series: additionally emphasize physical damage resistance.`,
  consumer_cards: `[Product Line: Consumer Cards] Audience: vloggers, travel photographers, families. "High-speed / performance" → smooth 4K recording without interruption, burst shooting without lag, capturing every frame of life. "Reliability" → choose the right card, avoid pitfalls, never lose data. Tone: approachable and trustworthy. May use relatable pain-point scenarios (e.g., "Card error?" moments).`,
  gaming_card: `[Product Line: Gaming Card] Audience: Switch, Steam Deck, ROG Ally, and other handheld gamers. "High read/write speed" → UHS-I, V30 fast read/write speeds ensure quick game loading, fast save writing, instant level transitions, and seamless open-world streaming — never let the card bottleneck your gameplay. "A2 rating" → high random read/write IOPS boost app performance on handhelds: faster game launches, smoother in-game asset streaming, zero stutter. "Large capacity" → 512GB/1TB to carry your entire game library — no more deleting and reinstalling. ⚠️ CRITICAL: "Read speed" and "Write speed" are distinct specifications — never confuse them or default to "read speed" for all speed mentions. Keep copy concise and energetic. May use gaming-native language ("blazing load times", "carry your game library").`,
  gaming_ssd: `[Product Line: Gaming SSD] Audience: AAA gamers and PS5 players. "Gaming performance" → instant AAA loading, eliminate texture pop-in, unleash DirectStorage potential.`,
  gaming_dimm: `[Product Line: Gaming Memory] Audience: hardcore esports enthusiasts and overclockers. "Gaming performance" → boost 1% Low FPS, eliminate team-fight frame drops, push overclocking limits.`,
  pc_productivity: `[Product Line: PC / AI Productivity] Audience: AI PC users, content creators, PC upgraders. "High-speed / performance" → near-instant AI model response, massive project file transfers in seconds, effortless multitasking, breathe new life into older systems.`,
  portable_storage: `[Product Line: Portable Storage] Audience: business travelers, students, mobile creators. "High-speed / performance" → instant phone file transfers, fast travel photo backups, no-wait mobile productivity, capture-and-transfer on the go. "Design" → lightweight and portable, ruggedly durable.`,
  innovation_lifestyle: `[Product Line: Innovation Lifestyle] Audience: families and gift-givers. "Sharing / connection" → bridge distances to be with loved ones, upload precious moments in one tap. Tone: warm and heartfelt. Emphasize emotional connection and privacy protection.`,
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
  'zh-CN': `【zh-CN 专项】
术语强制统一：存储卡、固态硬盘、读卡器、读取速度、写入速度、移动固态硬盘。禁止"内存卡"→统一"存储卡"。
禁止港台用语混入：禁用「記憶卡、固態硬碟、讀卡機、行動硬碟、相機、影片」等繁体词汇。
数字格式：1,000 MB/s（逗号千分位），MB/s 不空格。品牌名"雷克沙 Lexar"标注可选，全文统一即可。
广告合规：严格遵守中国大陆广告法，禁用「最佳、第一、顶级、秒杀、极致、碾压」等极限词。禁止直译英文营销俚语为中文网络梗，保持专业数码产品文案调性。禁止自行增加原文没有的夸张修饰。`,

  'zh-TW': `【zh-TW 专项】
不是简体转繁体，而是台湾本土术语本地化：記憶卡（非存儲卡）、固態硬碟（非固態硬盤）、讀卡機（非讀卡器）、行動硬碟（非移動硬盤）、相機、影片、軟體、程式、螢幕、隨身碟。禁止"内存卡"→统一"記憶卡"。USB隨身碟 = USB flash drive。
数字格式：1,000 MB/s（逗号千分位），MB/s 不空格。
用字严格遵循台湾正体规范：身分（非身份）、週（非周）、裡（非里）、後（非后），避免简体异体字混入。一对多繁简必须准确：只→隻/衹、干→乾/幹/干、复→復/複，禁止机械一对一转换。禁用大陆特有政策词汇与网络用语，文案符合台湾3C产品市场表达习惯。`,

  'ja': `【ja 专项】
品牌首次出现标注「レクサー」，后文统一使用 Lexar。⚠️ 禁止将 Lexar 误写为任何其他形式。
文体统一：商品详情页统一使用です・ます敬体。
术语标准化：SDカード、リード速度（读取速度）、ライト速度（写入速度）、プロフェッショナル、ポータブルSSD、カードリーダー（读卡器）、USBメモリ（闪存盘）。
数字格式：1,000 MB/s（逗号千分位），半角数字。
技术符号保留英文，通用词汇使用行业标准和制汉语。禁止中式日语直译；强调稳定、安心、長寿命、高耐久等符合日本市场偏好的表达。避免过度夸张营销词，符合日本广告法规范。片假名外来语使用行业标准转写，禁止自行音译。
电商语体：商品详细介绍用です・ます調，建立信赖感而非压迫感。多用量化数据和具体场景（如"最大読み取り速度 X MB/s"），避免空泛形容词（"驚異的""圧倒的"等慎重使用）。禁止机械直译英文比较级/最高级（better→より優れた，NOT より良いだけ）。`,

  'ko': `【ko 专项】
品牌首次标注 렉사르，正文保留 Lexar。
术语标准化：SD 카드、SSD、읽기 속도（读取速度）、쓰기 속도（写入速度）、휴대용 SSD（便携SSD）、카드 리더기（读卡器）、USB 플래시 드라이브（闪存盘）。
数字格式：1,000 MB/s（逗号千分位），半角数字。
技术术语优先使用行业通用英文外来语，不强行使用生僻汉字词。文案使用通用书面语体（해요체/하오체），避免高阶敬语与非正式平语。禁止使用日语来源的汉字词汇（如"取扱説明書"→"사용 설명서"），符合韩国市场用语习惯。严格限制极限修饰词，遵守韩国广告法规。
电商语体：韩国电商产品页常用简洁有力短句，关键卖点数据前置。"최대""초고속"等可用但需有数据支撑。避免日式长定语修饰句，改用韩语自然的多短句结构。`,

  'fr': `[French-specific rules]
Use Metropolitan French (France), NOT Quebec French. All nouns must have correct gender, adjectives must agree in gender and number.
Fixed terminology: carte microSD/SD, SSD portable (portable SSD), lecteur de cartes (card reader), clé USB (flash drive), vitesse de lecture (read speed), vitesse d'écriture (write speed).
⚠️ Non-breaking spaces (espace insécable): before colons, semicolons, exclamation marks, question marks. Use thin non-breaking space before units → « 280 Mo/s ».
⚠️ Accent check: Conçu, écrire, déjà, grâce — never omit accents.
Number format: 1 000 Mo/s (non-breaking thin space as thousands separator), space before unit.
Keep UI and short copy concise — avoid long adjective chains that cause text overflow. Minimize English loanwords; prefer native French technical terms (e.g. micrologiciel NOT firmware).
E-commerce tone: French product copy should be elegant and precise — warm but not overly familiar. Use "vous" (not "tu"). Marketing copy can highlight design and quality-of-life benefits alongside specs. Never use "meilleur", "n°1", "incroyable" without concrete substantiation — French advertising law enforces this strictly. Include standard consumer protection phrasing where applicable (garantie, SAV).`,

  'de': `[German-specific rules]
🚨 BRAND RED LINE: Lexar ≠ Lexware! Lexware is a different German software company — NEVER confuse them. The brand is ALWAYS "Lexar".
ALL nouns MUST be capitalized, no exceptions.
Fixed terminology: Speicherkarte (memory card), Tragbare SSD (portable SSD), Kartenleser (card reader), USB-Stick (flash drive), Lesegeschwindigkeit (read speed), Schreibgeschwindigkeit (write speed).
⚠️ Compound noun integrity check: Lesegeschwindigkeit (one word, never split), Speicherkarte (one word), Schreibgeschwindigkeit (one word).
Number format: 14.000 MB/s (dot as thousands separator), 14,5 MB/s (comma as decimal).
Copy should be factual and objective, matching German professional market expectations — even marketing copy should remain grounded and evidence-based, avoiding unsupported superlatives. Do NOT calque English word order into German (verb-final in subordinate clauses).
E-commerce tone: German consumers expect specification-driven copy. Lead with technical data and certifications. "Professionell", "zuverlässig", "leistungsstark" are acceptable but must be backed by specs. Avoid empty intensifiers like "unglaublich", "revolutionär", "der Beste" — these undermine credibility. "Sie" is correct for product copy; never use "du" in marketing.`,

  'es': `[Spanish-specific rules]
Use International Castilian Spanish — do NOT mix in Mexican, Argentine, or other regional slang. All nouns must have correct gender and number agreement.
Fixed terminology: tarjeta microSD/SD, SSD portátil (portable SSD), lector de tarjetas (card reader), unidad flash USB (flash drive), velocidad de lectura (read speed), velocidad de escritura (write speed).
🚨 Spelling check: tarjeta ≠ trajeta, máximo ≠ maximo, compatible ≠ compatible, portátil ≠ portatil — all accents required.
Number format: 1.000 MB/s (dot as thousands separator).
Use formal Usted imperative: Aproveche, Combine, Descargue (NOT informal tú forms Aprovecha, Combina, Descarga). Marketing copy can be warm and direct, matching both Latin American and Spanish market expectations.`,

  'pt': `[European Portuguese rules]
Use Portugal mainland formal Portuguese. Do NOT mix in Brazilian Portuguese vocabulary or grammar.
Fixed terminology: cartão de memória, SSD portátil, leitor de cartões, velocidade de leitura (read speed), velocidade de gravação (write speed).
⚠️ Adjective-noun agreement: adjectives must agree in GENDER and NUMBER with the noun they modify. "Cartão" is masculine singular → use masculine singular adjectives (impressionante, rápido, etc.). Never use plural adjectives with singular nouns ("é impressionantes" → WRONG, must be "é impressionante" or "impressionantemente" for adverbs).
⚠️ Adverb vs Adjective: when modifying a verb or an entire clause, use the -mente adverb form (impressionantemente, rapidamente), NOT the adjective. English often uses flat adverbs — Portuguese does NOT.
⚠️ False friends / calques to avoid: "emparelhado" is ONLY for Bluetooth/wireless pairing — do NOT use for "used with" or "combined with". "When paired with" → "quando utilizado com" or "quando usado com".
Keep sentences natural, not word-for-word translations. Portuguese prefers shorter, more direct phrasing than English.
Pronouns and clitics follow European Portuguese rules (post-position: "carrega-se", not "se carrega").
"Mais depressa" is acceptable for colloquial speed; "mais rapidamente" is preferred for technical/product copy.
⛔ RED LINE: U盘=Pen USB (NOT Pen Drive), 笔记本=Portátil (NOT Notebook), 硬盘盒=Caixa (NOT Case).`,

  'pt-BR': `[Brazilian Portuguese rules]
Use Brazilian Portuguese throughout. Do NOT mix in European Portuguese vocabulary.
Fixed terminology: cartão de memória, SSD portátil, leitor de cartões, pendrive (flash drive), velocidade de leitura (read speed), velocidade de gravação (write speed).
Number format: 1.000 MB/s (dot as thousands separator).
Watch for false friends: atualmente = currently (NOT actually), sensível = sensitive (NOT sensible).
Marketing copy should be more engaging, matching Brazilian e-commerce style. Use você forms (not tu).
⛔ RED LINE: U盘=Pen Drive (NOT Pen USB), 笔记本=Notebook (NOT Portátil), 硬盘盒=Case (NOT Caixa).`,

  'it': `[Italian-specific rules]
All nouns and adjectives must agree in gender and number.
Fixed terminology: scheda microSD/SD, SSD portatile (portable SSD), lettore di schede (card reader), chiavetta USB (flash drive), velocità di lettura (read speed), velocità di scrittura (write speed).
⚠️ Accent check: è (is), perché, più — required accents, never omit.
Number format: 1.000 MB/s (dot as thousands separator).
Photography-related copy can be slightly softer and more elegant, matching Italian photography culture. Keep pace lively but don't overdo colloquialisms. Keep UI copy concise — avoid long subordinate clauses.`,

  'nl': `[Dutch-specific rules]
Fixed terminology: microSD-kaart, Draagbare SSD (portable SSD — prefer over "Portable SSD"), kaartlezer (card reader), USB-stick (flash drive), leessnelheid (read speed), schrijfsnelheid (write speed).
🚨 Spelling check: SILVER ≠ SLVER — do not drop letters.
Compound nouns must be correctly joined as one word: leessnelheid, schrijfsnelheid, snelheidsklasse — no spacing errors.
Number format: 1.000 MB/s (dot as thousands separator).
Copy should be factual and objective, suitable for professional product descriptions. Expect text expansion of ~20% — keep short copy concise.`,

  'pl': `[Polish-specific rules]
ALL special diacritic characters must be preserved: ą ę ł ń ó ś ź ż — never omit or replace with plain letters. Nouns and adjectives must be correctly declined for case.
Fixed terminology: karta microSD/SD, Przenośny dysk SSD (portable SSD), czytnik kart (card reader), pendrive (flash drive), prędkość odczytu (read speed), prędkość zapisu (write speed).
Number format: 1 000 MB/s (space as thousands separator).
Allow extra space for text expansion in UI — prefer short forms.`,

  'sv': `[Swedish-specific rules]
Preserve special characters: å ä ö.
Fixed terminology: microSD-kort, bärbar SSD (portable SSD), kortläsare (card reader), USB-minne (flash drive), läshastighet (read speed), skrivhastighet (write speed).
🚨 Spelling check: bärbar ≠ bärbär (portable = bärbar, single 'r' in the second syllable).
Number format: 1 000 MB/s (space as thousands separator).
Copy should be minimal and restrained — avoid verbose embellishment, matching Nordic aesthetic. Prefer Swedish terms over English (spelande over gaming, läsare over reader). Compound nouns must be correctly spelled — do not split them.`,

  'tr': `[Turkish-specific rules]
ALL special characters must be preserved: ı İ ö ü ç ş ğ. Strictly distinguish i/ı and I/İ — dots matter.
Fixed terminology: microSD kart, Taşınabilir SSD (portable SSD), kart okuyucu (card reader), USB bellek (flash drive), okuma hızı (read speed), yazma hızı (write speed).
⚠️ I/ı vs İ/i check: uppercase İ → lowercase i, uppercase I → lowercase ı. Never confuse them.
Suffixes separated by apostrophe: 280 MB/s'ye, cihazı'na.
Number format: 1.000 MB/s (dot as thousands separator).
Use standard formal written Turkish, suitable for both professional users and consumers. Maintain cultural neutrality — avoid religiously sensitive expressions.`,

  'ru': `[Russian-specific rules]
Use Cyrillic throughout; Lexar and technical symbols remain in Latin script, embedded LTR within the text.
Fixed terminology: скорость чтения (read speed), скорость записи (write speed), карта памяти (memory card), портативный SSD (portable SSD), кардридер (card reader).
All nouns and adjectives must be correctly declined (6 cases). Emphasize cold-weather durability and ruggedness where relevant to the Russian market.
Number format: 1 000 MB/s (space as thousands separator), comma as decimal (14,5).`,

  'vi': `[Vietnamese-specific rules]
ALL tone marks and special characters must be preserved: đ ư ơ ă â — missing tones change word meaning entirely. Never truncate text at byte boundaries that break combined tone marks; every syllable's tone must be complete.
Use Northern standard Vietnamese (Hanoi official accent), NOT Southern dialect.
Fixed terminology: thẻ nhớ (memory card), ổ cứng SSD di động (portable SSD), đầu đọc thẻ (card reader), ổ USB (flash drive), tốc độ đọc (read speed), tốc độ ghi (write speed).
Number format: 1.000 MB/s (dot as thousands separator).
Use correct classifiers (measure words) for product categories — do not calque from English. E-commerce copy should be lively and direct, matching Vietnamese market style.`,

  'th': `[Thai-specific rules]
All superscript/subscript vowels and tone marks must display completely — no character overlap, loss, or distortion.
Use standard common register, NOT royal/high honorifics, and NOT overly casual speech.
Brand annotation: เล็กซาร์; technical parameters remain in English.
Avoid Buddhist-sensitive vocabulary and imagery. Default left-aligned layout; reserve sufficient line height to prevent character clipping. Word breaking must follow Thai writing conventions — never break mid-word.`,

  'id': `[Indonesian-specific rules]
Use official standard Indonesian (Bahasa Indonesia) — do NOT mix in Malay vocabulary.
Fixed terminology: kartu memori (memory card), SSD portabel (portable SSD), pembaca kartu (card reader), flashdisk (flash drive), kecepatan baca (read speed), kecepatan tulis (write speed).
Language should be accessible and direct, suitable for both general users and photography enthusiasts. Avoid overly formal/stiff expressions; match Indonesian 3C product copy style.`,

  'ar': `[Arabic-specific rules]
Use Modern Standard Arabic (MSA/fusha) — do NOT mix in any national dialect.
Full text RTL; embedded Lexar, English terms, numbers, and symbols remain LTR — bidirectional text logic must be correct.
Fixed terminology: بطاقة ذاكرة (memory card), سرعة القراءة (read speed), سرعة الكتابة (write speed), قرص SSD محمول (portable SSD), قارئ بطاقات (card reader).
Cultural compliance: gender-neutral phrasing; avoid sensitive imagery and religious references. Avoid exaggerated marketing language unsuitable for Middle Eastern markets. Number format: consistently use either Arabic-Indic (١٬٠٠٠) or Western (1,000) numerals throughout.`,

  'en': `[English-specific rules]
Use American English spelling consistently: color, center, fiber, license — do NOT mix in British spelling.
⚡ Category word calibration: Desktop Memory / Laptop Memory / Portable SSD / Flash Drive / Dual Drive / Solid State Dual Drive / Card / Reader / Enclosure / Hub — verify against category word glossary, never improvise.
Fixed terminology: Read speed / Write speed, Professional filmmaker, Content creator, Rugged design.
Number format: 1,000 MB/s (comma as thousands separator).
Technical copy should be concise and objective; marketing copy should use short sentences, avoid complex clauses. Distinguish consumer vs. professional product line tone — do not mix them.
⚠️ Do NOT literally translate Chinese four-character marketing slogans into awkward English; use native digital industry expressions.`,
}

// ============================================================
// 输出前自检规则（精简版，注入任务结尾，模型自我校验）
// ============================================================
// 精简自检：只检查输出后才能验证的东西（全局铁则已覆盖品牌/术语/忠实性）
const SELF_CHECK = `【输出前自检 — 内部校验，禁止输出到译文】
1. 目标语言特殊字符、变音符号、声调是否完整无遗漏？
2. 输出是否为纯目标语言 — 无原文、无注释、无混合语言？
3. 原文结构（列表、层级、换行）是否完整保留？
4. 译文中是否出现括号解释（如"存储(fast)"、"品牌(中文)"）？如有则必须移除，输出纯净译文。
5. 短文本标签/按钮/参数名（源文<15个单词或字符）是否被过度扩写？如译文长度超出源文50%以上，压缩至最精练表达。`
const SELF_CHECK_EN = `[Pre-output self-check — internal only, do NOT include in output]
1. Are all target language special characters, diacritics, and tone marks fully preserved?
2. Is the output pure target language — no source text, no explanatory notes, no mixed languages?
3. Is the original structure (lists, hierarchy, line breaks) fully preserved?
4. Does any translation contain parenthetical explanations (e.g. "storage (存储)", "brand (品牌)")? If so, remove them — output pure translation only.
5. Did any short label/button/parameter name (source <15 words or characters) get over-expanded? If the translation exceeds 50% of the source length, compress to the most concise viable expression.`

// ============================================================
// 尾部加固提醒（Qwen 对 prompt 首尾注意力最高，在末尾重申不可违抗规则）
// ============================================================
const CRITICAL_REMINDER = `【🔴 再次强调 — 以下规则绝对不可违反】
- 品牌名（Lexar/DJI/Canon/Sony/SanDisk/Kingston/Samsung/WD/Intel/AMD/NVIDIA等）和产品系列名（ARES/THOR/SILVER/BLUE/GOLD/DIAMOND/PLAY/ARMOR/NM/NQ/NS/EQ等）在任何语言中禁止翻译、禁止音译、禁止加注音
- 技术规格（GB/MB/s/PCIe/NVMe/CFexpress/SD/microSD/USB等）原样保留不翻译
- Silver/Blue/Gold/Diamond 是产品系列名，禁止翻译为颜色词
- 禁止在括号中添加解释、原文、别名——输出必须纯净
- 禁止回退到英文——必须使用目标语言完成全部翻译
- 术语库译法为最高优先级，必须严格使用
- 原文中的所有数字、容量值、速度值必须原样保留，数值绝对不可更改
- 短标签/按钮/参数名（<15字符）禁止扩写为长句——保持同等简洁度`

const CRITICAL_REMINDER_EN = `[🔴 FINAL REMINDER — the following rules are absolute and must not be violated]
- Brand names (Lexar, DJI, Canon, Sony, SanDisk, Kingston, Samsung, WD, Intel, AMD, NVIDIA, etc.) and product series names (ARES, THOR, SILVER, BLUE, GOLD, DIAMOND, PLAY, ARMOR, NM, NQ, NS, EQ, etc.) must NEVER be translated, transliterated, or annotated in any language
- Technical specs (GB, MB/s, PCIe, NVMe, CFexpress, SD, microSD, USB, etc.) must be preserved as-is
- Silver, Blue, Gold, Diamond are product series names — NEVER translate as color words
- NEVER add parenthetical explanations, original text, or aliases — output must be pure
- NEVER fall back to English — all output must be in the target language
- Glossary terms are the highest authority — use them exactly as specified
- All numbers, capacity values, and speed values in the source must be preserved exactly — NEVER alter any numeric value
- Short labels, buttons, and parameter names (<15 characters) must NOT be expanded into full sentences — maintain the same conciseness`

// ============================================================
// 辅助函数
// ============================================================
function getStylePrompt(config: LLMConfig, isEnSource?: boolean, scenePreset?: string): string {
  // 非电商场景强制严谨专业版，消除风格×场景的矛盾组合
  const isSceneForced = scenePreset === 'technical_params' || scenePreset === 'packaging' || scenePreset === 'ui' || scenePreset === 'after_sales'
  const effectiveStyle = isSceneForced ? 'professional' : config.translationStyle

  // 场景已锁定风格时，跳过独立风格块——场景提示词已声明"本场景翻译风格固定为严谨专业"
  if (isSceneForced && effectiveStyle === 'professional') return ''

  if (effectiveStyle === 'custom') {
    const custom = (config.translationStyleCustom || '').trim()
    if (!custom) return ''
    const label = isEnSource ? '\n[Translation Style: Custom] ' : '\n【翻译风格：自定义】'
    return label + custom
  }
  const presets = isEnSource ? STYLE_PRESETS_EN : STYLE_PRESETS
  const preset = presets[effectiveStyle]
  return preset ? `\n${preset}` : ''
}

function getScenePrompt(config: LLMConfig, isEnSource?: boolean): string {
  const presets = isEnSource ? SCENE_PRESETS_EN : SCENE_PRESETS
  const preset = presets[config.scenePreset]
  return preset ? `\n${preset}` : ''
}

function getLangSpecificPrompt(targetLang: string): string {
  const rules = LANG_SPECIFIC[targetLang]
  return rules ? `\n${rules}` : ''
}

// ============================================================
// 目标语言 TAIL 加固（弱语言专属）
// 根因：Qwen 弱语言子网在英文→目标语言切换时丢失指令约束。
// 方案：在 TAIL 最后用目标语言本身注入硬规则，激活目标语言子网。
// ============================================================
function getTargetLangReinforcement(targetLang: string): string {
  switch (targetLang) {
    case 'pt':
      return `\n[⚠️ REGRAS FINAIS EM PORTUGUÊS — LEIA ANTES DE GERAR]
1. "Write speed" = velocidade de GRAVAÇÃO. "Read speed" = velocidade de LEITURA. São coisas DIFERENTES. NUNCA troque.
2. Concordância de género e número: "o cartão é impressionante" (não "impressionantes"). Advérbios usam -mente: "impressionantemente rápido".
3. Termos técnicos em INGLÊS: "host", "firmware", "driver", "chipset" NÃO se traduzem. "Dispositivo host" (NUNCA "anfitrião").
4. "Emparelhado" é SÓ para Bluetooth/pareamento sem fios. "When paired with" = "quando utilizado com" ou "quando usado com".
5. UHS-I e UHS-II são especificações técnicas DISTINTAS. Não as confunda nem as altere.
6. NÃO invente nada que não esteja no texto original. NÃO adicione contexto sobre produtos futuros.
7. Texto curto na origem = texto curto na tradução. NÃO expanda frases curtas em parágrafos.
8. Escreva frases naturais em português, não traduções palavra-por-palavra do inglês. Seja direto e conciso.`
    case 'pt-BR':
      return `\n[⚠️ ANTES DE GERAR — REGRAS EM PORTUGUÊS (BR)]
- Concordância: adjetivos concordam em GÉNERO e NÚMERO com o substantivo.
- Termos técnicos NÃO se traduzem: "host", "firmware", "driver", "chipset" mantêm-se em inglês.
- "Write speed" = "velocidade de gravação", "Read speed" = "velocidade de leitura". NUNCA confundir.
- UHS-I e UHS-II são especificações distintas — não as altere.
- Texto curto na origem = texto curto na tradução. NÃO expanda.
- NÃO invente informação que não está no texto original.`
    case 'vi':
      return `\n[⚠️ TRƯỚC KHI DỊCH — QUY TẮC TIẾNG VIỆT]
- Thuật ngữ kỹ thuật KHÔNG dịch: "host", "firmware", "driver", "chipset" giữ nguyên tiếng Anh.
- "Write speed" = "tốc độ ghi", "Read speed" = "tốc độ đọc". KHÔNG nhầm lẫn.
- Văn bản nguồn ngắn = bản dịch ngắn. KHÔNG mở rộng câu ngắn thành đoạn dài.
- KHÔNG thêm thông tin không có trong văn bản gốc.`
    case 'th':
      return `\n[⚠️ ก่อนแปล — กฎภาษาไทย]
- คำศัพท์เทคนิคห้ามแปล: "host", "firmware", "driver", "chipset" เก็บเป็นภาษาอังกฤษ
- "Write speed" = "ความเร็วเขียน", "Read speed" = "ความเร็วอ่าน" ห้ามสลับ
- ต้นฉบับสั้น = คำแปลสั้น ห้ามขยายความ
- ห้ามเพิ่มข้อมูลที่ไม่มีในต้นฉบับ`
    case 'ar':
      return `\n[⚠️ قبل الترجمة — قواعد اللغة العربية]
- المصطلحات التقنية لا تترجم: "host", "firmware", "driver", "chipset" تبقى بالإنجليزية
- "Write speed" = "سرعة الكتابة", "Read speed" = "سرعة القراءة" — لا تخلط بينهما
- النص القصير = ترجمة قصيرة. لا توسع
- لا تضف معلومات غير موجودة في النص الأصلي`
    default:
      return ''
  }
}

function getGlobalRulesForProofread(isEnSource?: boolean): string {
  if (isEnSource) {
    return `[Brand & Terminology] All brand names (Lexar, DJI, Canon, Sony, SanDisk, Kingston, Samsung, WD, Intel, AMD, NVIDIA, etc.) and standard protocol names (DirectStorage, XMP, EXPO, etc.) must remain in original form — no translation. All technical specs and industry standard symbols must be preserved untranslated. Product series/model names (ARES, THOR, ARMOR, BLUE, SILVER, etc.) remain in English — color-looking words like Silver/Blue/Gold are Lexar series names, do NOT translate. Product model numbers must keep original alphanumeric format.

[Category Words] Storage category words must be strictly distinguished: Desktop Memory (NOT PC RAM), Laptop Memory (NOT Notebook RAM), internal SSD, Portable SSD, Flash Drive, Dual Drive, Solid State Dual Drive, Card, Reader, Enclosure, Hub.

[Compliance] Follow target language advertising regulations — no superlative claims. Numbers, punctuation, and symbols must follow target language conventions.

[Faithfulness] Strictly match original information — no omissions, additions, or embellishments not in the source.`
  }
  return `【品牌与专有名词铁则】所有品牌名（Lexar、DJI、Canon、Sony、SanDisk、Kingston、Samsung、WD、Intel、AMD、NVIDIA等）和标准协议名（DirectStorage、XMP、EXPO等）禁止翻译、必须原样保留。所有技术规格、行业标准符号原样保留不翻译。产品系列名/型号名（ARES、THOR、ARMOR、BLUE、SILVER等）保留英文原词——Silver/Blue/Gold等看似颜色词的词汇均为Lexar产品系列名，禁止翻译。产品完整型号字母数字格式完全保留。

【品类词区分】存储品类词固定区分，严禁混用：台式机内存=Desktop Memory、笔记本内存=Laptop Memory、内置固态=SSD、移动固态=Portable SSD、U盘=Flash Drive、双接口U盘=Dual Drive、固态U盘=Solid State Dual Drive、存储卡=Card、读卡器=Reader、硬盘盒=Enclosure、扩展坞=Hub。

【格式合规】遵守目标语言广告法规，禁止使用极限违禁词。数字、标点、符号遵循目标语言规范。

【忠实原文】严格对应原文信息，不得漏译、增译、自行补充原文没有的卖点与修饰。`
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
function getCategoryWordGuideIfNeeded(targetLang: string, _contentType: ContentType, productLine?: string | null, isEnSource?: boolean): string {
  return getCategoryWordGuide(targetLang, productLine, isEnSource)
}

// ============================================================
// 上下文关联提示
// ============================================================
const CONTEXT_HINT = `文本按设计稿层级排列，相邻条目存在上下文关联（如标题→副标题→正文），翻译时注意语义连贯和术语风格一致。`
const CONTEXT_HINT_EN = `Texts are arranged in design-layer order. Adjacent entries have contextual relationships (e.g. title→subtitle→body). Maintain semantic coherence and consistent terminology/style across entries.`

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
): Promise<string[]> {
  const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang

  const detectedSource = sourceLang || detectSourceLanguage(texts)
  const isEnSource = detectedSource === 'en'
  const sourceName = detectedSource === 'zh-CN' ? '简体中文' : '英文'

  const contentType = detectContentType(texts)
  const contentTypeGuide = isEnSource ? CONTENT_TYPE_GUIDES_EN[contentType] : CONTENT_TYPE_GUIDES[contentType]

  const { texts: cleanTexts, tags: htmlTags } = protectHtmlTags(texts)

  // 源文本预标准化（Unicode NFC + 全角→半角 + 零宽字符移除 + 兼容字符规范化）
  const normalizedTexts = normalizeTextForLLM(cleanTexts)

  // 实体遮蔽（产品型号/URL/Email/纯测量值 → 占位符，防止 LLM 幻觉）
  const { texts: maskedTexts, entityMap } = maskEntities(normalizedTexts)

  // 产品线检测（提前到术语过滤之前）
  const productLine = getEffectiveProductLine(config, texts, pageName, fileName)

  // 术语三层过滤：产品线 → 场景 → 相关性
  const filteredGlossaryMap = filterGlossaryByProductLine(glossaryMap, productLine, runtimeProductLines)
  let glossaryObj: Record<string, string> = {}
  for (const [k, v] of filteredGlossaryMap.entries()) { glossaryObj[k] = v }
  glossaryObj = filterGlossaryByScene(glossaryObj, config.scenePreset)
  let { glossaryHint } = filterRelevantGlossary(glossaryObj, texts, 10)

  // 跨批次术语注入：将其他批次中也会出现的术语及其标准译法提前注入本批次
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

  const textList = maskedTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')

  // few-shot 示例
  const fewShot = getFewShotExamples(detectedSource, targetLang, contentType, 2)

  let systemPrompt: string

  let pageContextBlock = ''
  if (pageContext && pageContext.length > 1) {
    const ctxList = pageContext.map((t, i) => `${i + 1}. ${t}`).join('\n')
    pageContextBlock = `\n【整页上下文（仅供参考，了解页面结构和术语一致性，不需要翻译）】\n${ctxList}\n`
  }

  // 全局铁则 + 风格 + 场景 + 产品线
  const globalRules = isEnSource ? GLOBAL_RULES_EN : GLOBAL_RULES
  const styleBlock = getStylePrompt(config, isEnSource, config.scenePreset)
  const sceneBlock = getScenePrompt(config, isEnSource)
  const productLineBlock = productLine ? `\n${isEnSource ? PRODUCT_LINE_STRATEGIES_EN[productLine] : PRODUCT_LINE_STRATEGIES[productLine]}` : ''
  const langBlock = getLangSpecificPrompt(targetLang)

  if (targetLang === 'zh-TW' && detectedSource === 'zh-CN') {
    // ============================================================
    // 简体中文 → 台湾繁体：专门用语本地化 prompt
    // ============================================================
    systemPrompt = `你是專業的簡→繁轉換+在地化專家，專精3C存儲行業。

${globalRules}

${contentTypeGuide}

${styleBlock}${sceneBlock}${productLineBlock}${pageContextBlock}

${getCategoryWordGuideIfNeeded(targetLang, contentType, productLine, isEnSource)}

【規則】術語庫最高優先級，必須嚴格使用${glossaryHint}

${htmlTags.size > 0 ? '【HTML标签】保留原文中所有HTML标签位置不变。\n' : ''}【上下文】${CONTEXT_HINT}

${langBlock}
${CRITICAL_REMINDER}

${SELF_CHECK}
${getTargetLangReinforcement(targetLang)}
【輸出】全形標點。嚴格按編號對應，格式「編號. 結果」。${fewShot}`
  } else {
    // ============================================================
    // 通用：3C存储行业翻译 prompt（多层提示词架构）
    // ============================================================
    const roleEn = isEnSource ? 'You are a professional translator for Lexar storage products, specializing in 3C/storage cross-border e-commerce.' : '你是Lexar存储品牌专业翻译，专精3C/存储跨境电商。'
    systemPrompt = `${roleEn}

${globalRules}

${isEnSource ? `Translate the following text from ${sourceName} to ${targetName}.` : `将以下文本从${sourceName}翻译成${targetName}。`}

${contentTypeGuide}

${styleBlock}${sceneBlock}${productLineBlock}${pageContextBlock}

${getCategoryWordGuideIfNeeded(targetLang, contentType, productLine, isEnSource)}

${isEnSource ? '[Rule] Glossary terms are highest priority. You MUST use them exactly as specified:' : '【规则】术语库最高优先级，必须严格使用'}${glossaryHint}

${htmlTags.size > 0 ? (isEnSource ? '[HTML Tags] Preserve all HTML tags in their original positions.\n' : '【HTML标签】保留原文中所有HTML标签位置不变。\n') : ''}${isEnSource ? 'Context' : '【上下文】'}${isEnSource ? CONTEXT_HINT_EN : CONTEXT_HINT}

${langBlock}
${isEnSource ? CRITICAL_REMINDER_EN : CRITICAL_REMINDER}

${isEnSource ? SELF_CHECK_EN : SELF_CHECK}
${getTargetLangReinforcement(targetLang)}
${isEnSource ? '[Output] Strictly follow "N. translation" format. Preserve original line breaks and paragraph structure.' : '【输出】严格按 "编号. 译文" 格式，保持原文换行分段。'}${fewShot}`
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

  // 后备：逐行解析 "编号. 译文" 格式
  if (result.length === 0) {
    const lines = content.split('\n')
    for (const line of lines) {
      const match = line.match(/^\d+\.\s*(.+)/)
      if (match) result.push(match[1].trim())
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

  // 还原实体占位符（必须在 restoreHtmlTags 之前，确保占位符层级正确）
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

  // 商标符号还原（兜底：原文有则译文必有，原文无则不添加）
  result = restoreTrademarkSymbols(texts, result)

  // 存储单位格式还原：原文数字和单位连写时，恢复译文的连写格式
  // 修复 AI 常见错误：900MB/s → 900 MB/s 还原为 900MB/s
  result = restoreStorageUnitFormatting(texts, result)

  // 首字母大写（仅营销文案和产品描述需要）
  if (contentType === 'marketing' || contentType === 'description') {
    result = result.map(t => capitalizeFirstLetter(t))
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
): Promise<ProofreadResult[]> {
  const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang

  const sourceTexts = items.map(it => it.sourceText)
  const detectedSource = detectSourceLanguage(sourceTexts)
  const isEnSource = detectedSource === 'en'

  // 校对也做内容类型和产品线检测，补全闭环
  const contentType = detectContentType(sourceTexts)
  const contentTypeGuide = isEnSource ? CONTENT_TYPE_GUIDES_EN[contentType] : CONTENT_TYPE_GUIDES[contentType]
  const productLine = getEffectiveProductLine(config, sourceTexts, pageName, fileName)
  const categoryWordGuide = getCategoryWordGuideIfNeeded(targetLang, contentType, productLine, isEnSource)

  // 术语三层过滤：产品线 → 场景 → 相关性（校对也需要检查术语合规）
  const filteredGlossaryMap = filterGlossaryByProductLine(glossaryMap, productLine, runtimeProductLines)
  let glossaryObjProof: Record<string, string> = {}
  for (const [k, v] of filteredGlossaryMap.entries()) { glossaryObjProof[k] = v }
  glossaryObjProof = filterGlossaryByScene(glossaryObjProof, config.scenePreset)
  const { glossaryHint } = filterRelevantGlossary(glossaryObjProof, sourceTexts, 10)

  // 源文本预标准化（仅对 sourceText，不动 translatedText）
  const normalizedSourceTexts = normalizeTextForLLM(sourceTexts)

  const transLabel = isEnSource ? 'Trans' : '译'
  const textList = items.map((it, i) => `${i + 1}. ${normalizedSourceTexts[i]}\n${transLabel}：${it.translatedText}`).join('\n\n')

  const styleBlock = getStylePrompt(config, isEnSource, config.scenePreset)
  const sceneBlock = getScenePrompt(config, isEnSource)
  const productLineBlock = productLine ? `\n${isEnSource ? PRODUCT_LINE_STRATEGIES_EN[productLine] : PRODUCT_LINE_STRATEGIES[productLine]}` : ''
  const langBlock = getLangSpecificPrompt(targetLang)

  let systemPrompt: string

  if (targetLang === 'zh-TW' && detectedSource === 'zh-CN') {
    systemPrompt = `你是專業的簡→繁在地化校稿專家，專精3C存儲行業。

${getGlobalRulesForProofread(false)}
${styleBlock}
${sceneBlock}
${productLineBlock}
${contentTypeGuide}
${categoryWordGuide}

【上下文】${CONTEXT_HINT}

對照原文與譯文逐條檢查：1.台灣用語正確性 2.術語庫譯法合規 3.語句自然流暢 4.場景適應性（字符長度、精簡度等） 5.全形標點。${glossaryHint}

${langBlock}
${CRITICAL_REMINDER}
${getTargetLangReinforcement(targetLang)}
輸出 JSON 陣列，reason 用4字以內簡述：[{"i":1,"text":"修正譯文","reason":"用語修正"},{"i":2,"text":"OK","reason":""}] 無需修正 text 填 "OK"。`
  } else if (isEnSource) {
    systemPrompt = `You are a 3C storage industry translation proofreader. Review ${targetName} translations for quality.

${getGlobalRulesForProofread(true)}
${styleBlock}
${sceneBlock}
${productLineBlock}
${contentTypeGuide}
${categoryWordGuide}

Context: ${CONTEXT_HINT_EN}

Check each source→translation pair: 1. Accuracy — no omissions or mistranslations 2. Glossary compliance 3. Natural flow and proper punctuation 4. Scene fitness (character length, conciseness, etc.).${glossaryHint}

${langBlock}
${CRITICAL_REMINDER_EN}
${getTargetLangReinforcement(targetLang)}
Output JSON array, reason must be in Chinese (max 4 Chinese characters): [{"i":1,"text":"corrected text","reason":"术语修正"},{"i":2,"text":"OK","reason":""}] If no correction needed, text = "OK".`
  } else {
    systemPrompt = `你是3C存储行业翻译校对专家，检查${targetName}译文质量。

${getGlobalRulesForProofread(false)}
${styleBlock}
${sceneBlock}
${productLineBlock}
${contentTypeGuide}
${categoryWordGuide}

【上下文】${CONTEXT_HINT}

对照原文与译文逐条检查：1.准确无漏译错译 2.术语库译法合規 3.标点规范句式自然 4.场景适应性（字符长度、精简度等）。${glossaryHint}

${langBlock}
${CRITICAL_REMINDER}
${getTargetLangReinforcement(targetLang)}
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

  // 后备：逐行解析
  const lines = content.split('\n')
  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s*(.+)/)
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