import { LLMConfig, LANGUAGES } from '@messages/types'
import { API_MAX_RETRIES, API_RETRY_DELAY_MS, API_TIMEOUT_MS } from '@lib/constants'
import { getFewShotExamples } from '@lib/few-shot-examples'
import { filterRelevantGlossary } from '@lib/glossary-filter'
import { postProcessTranslation, restoreTrademarkSymbols, enforceGlossaryTerms, capitalizeFirstLetter } from '@lib/post-process'

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
  // 短文本（无句号/问号）→ 标题/功能名称
  if (texts.length > 0 && texts.every(t => t.length < 50) && texts.every(t => !/[。\?!?.]/.test(t))) {
    return 'title'
  }
  // 含技术规格参数 → 规格
  if (/(\d+\s*(TB|GB|MB|MB\/s|GB\/s|MT\/s|MHz|PCIe|NVMe|SATA|USB|Gen\d|M\.2|IOPS|TBW))/.test(joined)) {
    return 'specification'
  }
  // 营销文案特征词
  if (/\b(experience|perfect|ultimate|unleash|revolutioniz|seamless|effortless|exceptional|game-?changing|cutting-?edge|state-?of-?the-?art|reliabl|designed for|protect|defend|powerful|compact|stylish)\b/i.test(joined)) {
    return 'marketing'
  }
  return 'description'
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

// ============================================================
// Lexar 品牌调性指南
// ============================================================
const BRAND_VOICE = `【品牌/专有名词保护】所有品牌名（Lexar、雷克沙、DJI、Canon、Sony、PlayStation、iPhone、SanDisk、Kingston、Samsung、WD、Intel、AMD、NVIDIA等）和标准协议名（DirectStorage、XMP、EXPO、CUDIMM、UDIMM、SODIMM等）在任何语言中禁止翻译、禁止音译，必须原样保留。`

// ============================================================
// 产品命名结构规则
// ============================================================
const PRODUCT_NAMING_RULES = `【产品命名结构】Lexar产品名遵循固定结构：Lexar + 型号/系列名 + 规格参数 + 品类词 + 后缀

翻译规则：
- 型号/系列名：禁止翻译，原样保留。例如：NM790、ARES、THOR、SL500、ARMOR 700、1800x GOLD、CFexpress Type A、D40E、F35 PRO 等均为不可翻译的型号标识
- 规格参数：PCIe、NVMe、DDR4/DDR5、USB 3.2、M.2 2280、UHS-I/UHS-II、CFexpress、SATA、Type-C 等硬件参数原样保留
- 品类词：按目标语言固定译法翻译（见下方品类词对照表）
- 后缀：(EOL)、with Heatsink、with Magnetic Set 等附件/状态标记按目标语言翻译
- 世代：2nd Gen 按目标语言翻译（如二代/第2世代/2세대/Gen 2）

【优先级】术语库已收录的产品名 → 术语库译法最高优先级；术语库未收录的新产品 → 按上述结构规则翻译，型号原样保留，品类词按对照表翻译`

// 校对专用精简版：校对不翻译，只需提醒型号/系列名不可改动
const PROOFREAD_PRODUCT_RULES = `【产品名规则】型号/系列名禁止翻译、原样保留；仅品类词需翻译，译法以术语库为准。`

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

function getCategoryWordGuide(targetLang: string): string {
  const lines: string[] = []
  for (const [en, map] of Object.entries(CATEGORY_WORDS)) {
    const translated = map[targetLang]
    if (translated) {
      lines.push(`  ${en} → ${translated}`)
    }
  }
  if (lines.length === 0) return ''
  return `\n【品类词对照表（${targetLang}）】\n${lines.join('\n')}`
}

// 按需注入品类词：仅标题和规格类文本需要（产品名场景），营销/描述不需要
function getCategoryWordGuideIfNeeded(targetLang: string, contentType: ContentType): string {
  if (contentType === 'title' || contentType === 'specification') {
    return getCategoryWordGuide(targetLang)
  }
  return ''
}

// ============================================================
// 上下文关联提示
// ============================================================
const CONTEXT_HINT = `文本按设计稿层级排列，相邻条目存在上下文关联（如标题→副标题→正文），翻译时注意语义连贯和术语风格一致。`

// ============================================================
// 商标符号规则
// ============================================================
const TRADEMARK_RULE = `【商标符号】®™©等符号不影响术语库匹配，术语库译法优先级最高。翻译时这些符号严格跟随原文：原文有则保留且位置不变，原文无则绝不添加。`

export async function translateBatch(
  texts: string[],
  targetLang: string,
  glossaryMap: Map<string, string>,
  config: LLMConfig,
  sourceLang?: string,
  pageContext?: string[],
): Promise<string[]> {
  const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang

  const detectedSource = sourceLang || detectSourceLanguage(texts)
  const sourceName = detectedSource === 'zh-CN' ? '简体中文' : '英文'

  const contentType = detectContentType(texts)
  const contentTypeGuide = CONTENT_TYPE_GUIDES[contentType]

  const { texts: cleanTexts, tags: htmlTags } = protectHtmlTags(texts)

  // 智能术语过滤：只注入当前文本中实际出现的术语
  const glossaryObj: Record<string, string> = {}
  for (const [k, v] of glossaryMap.entries()) { glossaryObj[k] = v }
  const { glossaryHint } = filterRelevantGlossary(glossaryObj, texts, 10)

  const textList = cleanTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')

  // few-shot 示例
  const fewShot = getFewShotExamples(detectedSource, targetLang, contentType, 1)

  let systemPrompt: string

	const industryBlock = config.industryContext ? '\n【行业上下文（补充参考，核心规则优先）】\n' + config.industryContext : ''

  // 整页上下文：帮LLM了解页面结构，保持术语和风格一致
  let pageContextBlock = ''
  if (pageContext && pageContext.length > 1) {
    const ctxList = pageContext.map((t, i) => `${i + 1}. ${t}`).join('\n')
    pageContextBlock = `\n【整页上下文（仅供参考，了解页面结构和术语一致性，不需要翻译）】\n${ctxList}\n`
  }

  if (targetLang === 'zh-TW') {
    // ============================================================
    // 简体中文 → 台湾繁体：专门用语本地化 prompt
    // ============================================================
    systemPrompt = `你是專業的簡→繁轉換+在地化專家，專精3C存儲行業。
${industryBlock}${pageContextBlock}
${contentTypeGuide}

${BRAND_VOICE}

${TRADEMARK_RULE}

${PRODUCT_NAMING_RULES}
${getCategoryWordGuideIfNeeded(targetLang, contentType)}

【規則】
1. 簡轉繁+詞彙在地化（內存→記憶體、硬盤→硬碟、U盤→隨身碟、固件→韌體等）
2. 型號/容量/接口/協議(PCIe/NVMe/SATA/USB/Type-C/1TB等)原樣保留不動${glossaryHint}

【上下文】${CONTEXT_HINT}

【輸出】全形標點。嚴格按編號對應，格式「編號. 結果」。${fewShot}`
  } else {
    // ============================================================
    // 通用：3C存储行业翻译 prompt（带内容分流 + 品牌调性）
    // ============================================================
    systemPrompt = `你是Lexar存储品牌专业翻译，专精3C/存储跨境电商。
${industryBlock}
将以下文本从${sourceName}翻译成${targetName}。

${contentTypeGuide}

${BRAND_VOICE}

${TRADEMARK_RULE}

${PRODUCT_NAMING_RULES}
${getCategoryWordGuideIfNeeded(targetLang, contentType)}

【规则】
- 术语库最高优先级，必须严格使用
- 型号/容量/接口/协议(PCIe/NVMe/SATA/USB/Type-C/1TB等)原样保留${glossaryHint}

${htmlTags.size > 0 ? '【HTML标签】保留原文中所有HTML标签位置不变。\n' : ''}【上下文】${CONTEXT_HINT}

【输出】严格按 "编号. 译文" 格式，保持原文换行分段。${fewShot}`
  }

  // 分内容类型 temperature：标题和规格要极保守，营销要灵活
  const tempByType: Record<string, number> = { title: 0.1, specification: 0.1, description: 0.3, marketing: 0.5 }
  const temperature = tempByType[contentType] || 0.3

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

  // 恢复 HTML 标签
  if (htmlTags.size > 0) {
    result = restoreHtmlTags(result, htmlTags)
  }

  // 语言特定后处理
  result = result.map(t => postProcessTranslation(t, targetLang))

  // 术语库强制校准（翻译后直接替换，零 token 开销）
  // 注意：必须在 restoreTrademarkSymbols 之前执行，否则术语库译法（无®™）会覆盖已还原的商标符号
  result = enforceGlossaryTerms(texts, result, glossaryMap)

  // 商标符号还原（兜底：原文有则译文必有，原文无则不添加）
  result = restoreTrademarkSymbols(texts, result)

  // 首字母大写（拉丁/西里尔字母语言，仅当首字符为小写+第二个字符也是小写时转换，安全避免误伤 iPhone/eBay）
  // 仅营销文案和产品描述需要，标题和规格保留原有大小写
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
): Promise<ProofreadResult[]> {
  const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang

  // 智能术语过滤（校对也需要检查术语合规）
  const glossaryObj: Record<string, string> = {}
  for (const [k, v] of glossaryMap.entries()) { glossaryObj[k] = v }
  const sourceTexts = items.map(it => it.sourceText)
  const { glossaryHint } = filterRelevantGlossary(glossaryObj, sourceTexts, 10)

  const textList = items.map((it, i) => `${i + 1}. ${it.sourceText}\n译：${it.translatedText}`).join('\n\n')

  const industryBlock = config.industryContext ? '\n【行业上下文（补充参考，核心规则优先）】\n' + config.industryContext : ''

  let systemPrompt: string

  if (targetLang === 'zh-TW') {
    // 精简版校对 prompt：去掉了品类词对照表和冗长产品命名规则（代码层 enforceGlossaryTerms 兜底）
    systemPrompt = `你是專業的簡→繁在地化校稿專家，專精3C存儲行業。${industryBlock}

${BRAND_VOICE}

${PROOFREAD_PRODUCT_RULES}

${TRADEMARK_RULE}

【上下文】${CONTEXT_HINT}

對照原文與譯文逐條檢查：1.台灣用語正確性 2.術語庫譯法合規 3.語句自然流暢 4.全形標點。${glossaryHint}

輸出 JSON 陣列，reason 用4字以內簡述：[{"i":1,"text":"修正譯文","reason":"用語修正"},{"i":2,"text":"OK","reason":""}] 無需修正 text 填 "OK"。`
  } else {
    // 精简版校对 prompt：去掉了品类词对照表和冗长产品命名规则（代码层 enforceGlossaryTerms 兜底）
    systemPrompt = `你是3C存储行业翻译校对专家，检查${targetName}译文质量。${industryBlock}

${BRAND_VOICE}

${PROOFREAD_PRODUCT_RULES}

${TRADEMARK_RULE}

【上下文】${CONTEXT_HINT}

对照原文与译文逐条检查：1.准确无漏译错译 2.术语库译法合規 3.标点规范句式自然。${glossaryHint}

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
          // 宽松匹配 "OK" / "OK。" / "OK." / "ok" 等变体
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
// 例如目标西班牙语却输出中文"主機"
// ============================================================
// 拉丁字母为主的语言代码
const LATIN_SCRIPT_LANGS = new Set(['en', 'es', 'fr', 'de', 'pt', 'pt-BR', 'it', 'nl', 'pl', 'sv', 'tr', 'vi', 'id', 'ms', 'fi', 'da', 'no', 'hu', 'cs', 'ro', 'sk', 'hr', 'sl', 'lt', 'lv', 'et'])

export function isProofreadScriptMismatch(text: string, targetLang: string): boolean {
  if (!text) return false
  // 拉丁文字目标语言：如果校对结果包含 CJK 统一汉字，明显是脚本错乱
  if (LATIN_SCRIPT_LANGS.has(targetLang)) {
    return /[一-鿿㐀-䶿]/.test(text)
  }
  return false
}
