import { LLMConfig, LANGUAGES } from '@messages/types'
import { API_MAX_RETRIES, API_RETRY_DELAY_MS } from '@lib/constants'
import { getFewShotExamples } from '@lib/few-shot-examples'
import { filterRelevantGlossary } from '@lib/glossary-filter'
import { postProcessTranslation } from '@lib/post-process'

interface XhrResponse {
  ok: boolean
  status: number
  text: string
  json: unknown
}

function xhrRequest(method: string, url: string, headers: Record<string, string>, body?: string): Promise<XhrResponse> {
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
    xhr.ontimeout = () => reject(new Error('请求超时'))
    xhr.timeout = 15000
    xhr.send(body || null)
  })
}

export async function fetchWithRetry(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
  maxRetries = API_MAX_RETRIES,
  baseDelay = API_RETRY_DELAY_MS,
): Promise<XhrResponse> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await xhrRequest(options.method, url, options.headers, options.body)
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
  marketing: `【营销文案】术语库强制标准，在此基础上本土化润色。保留卖点力度，句式通顺自然。数字/规格原样不动。`,
  description: `【产品描述】术语库强制标准。保留原文段落结构。用词自然通顺，符合目标语言行业习惯。`,
}

// ============================================================
// Lexar 品牌调性指南
// ============================================================
const BRAND_VOICE = `【Lexar 品牌指南】全球存储品牌，注册商标。品牌名"Lexar"/"雷克沙"为专有名词，在任何语言中禁止翻译、禁止音译（如不可转为レクシャー/렉사等）、禁止转写，必须原样保留。产品系列名(NM1090/ARES/THOR/PLAY/DIAMOND/GOLD/ARMOR/SILVER/JumpDrive等)同样禁止翻译。`

// ============================================================
// 上下文关联提示
// ============================================================
const CONTEXT_HINT = `文本按设计稿层级排列，相邻条目存在上下文关联（如标题→副标题→正文），翻译时注意语义连贯和术语风格一致。`

export async function translateBatch(
  texts: string[],
  targetLang: string,
  glossaryMap: Map<string, string>,
  config: LLMConfig,
  sourceLang?: string,
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

  if (targetLang === 'zh-TW') {
    // ============================================================
    // 简体中文 → 台湾繁体：专门用语本地化 prompt
    // ============================================================
    systemPrompt = `你是專業的簡→繁轉換+在地化專家，專精3C存儲行業。
${industryBlock}
${contentTypeGuide}

${BRAND_VOICE}

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

  let systemPrompt: string

  if (targetLang === 'zh-TW') {
    systemPrompt = `你是專業的簡→繁在地化校稿專家。對照原文與譯文逐條檢查：1.台灣用語正確性 2.術語庫譯法合規 3.語句自然流暢 4.全形標點 5.型號規格保留原樣。${glossaryHint}

輸出 JSON 陣列，reason 用4字以內簡述：[{"i":1,"text":"修正譯文","reason":"用語修正"},{"i":2,"text":"OK","reason":""}] 無需修正 text 填 "OK"。`
  } else {
    systemPrompt = `你是翻译校对专家，专精3C数码存储行业。对照原文与译文逐条检查：1.准确无漏译错译 2.术语库译法合規 3.型号规格参数原样保留 4.标点规范句式自然。${glossaryHint}

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
