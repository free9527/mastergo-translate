/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

/**
 * v10.8 扩展检测语义移交校对测试
 *
 * 背景：detectTranslationExpansion 原先用"译文长度/源文长度"比例判加戏，命中即自动截断
 * （translated.slice(0, maxLen)，在句号/逗号/空格处硬切）。长度≠加戏——de/pt/fr 天然比
 * en 长 50-90%，一条正常详尽翻译可能完全没加戏，代码却一刀切截断，造出半截句子上画布。
 * 这是 v10.2 截断误杀（过短方向）的同型病，方向相反（过长误杀）：代码用长度代理干语义的活。
 *
 * 修复（v10.8，沿用 v10.2"代码管形式/LLM管语义"总原则）：
 *   A. detectTranslationExpansion 改为纯检测——保留长度比例+数字豁免，删除所有截断逻辑，
 *      原样返回输入译文，只透出 expandedIndices + 长度比
 *   B. S6 调用处删除 result=expansionResult.texts（不再自动截断），debugWarn→console.warn
 *   C. translateBatch 新增 expansionIndices 输出参数，把超长信号透传给 App.vue
 *   D. proofreadBatch 新增 expansionFlags 入参，对超长条目在校对 user prompt 追加中性提示
 *      （"长≠错，若语义忠实保持原样"），由校对 LLM 语义裁决加戏 vs 合法详尽
 *
 * 覆盖：
 *   A. 纯检测不修改：超长译文不被截断原样保留；expandedIndices 正确；数字豁免；短源文阈值
 *   B. 信号透传：translateBatch 的 expansionIndices 输出正确
 *   C. 校对 hint 注入：命中条目 user prompt 含长度提示；未命中不含；zh/en 双指令语言文案
 *   D. 端到端：超长译文不再被截断上画布；校对判加戏→精简 / 判合法→保持
 */

import { translateBatch, proofreadBatch } from '../lib/llm-api'
import { detectTranslationExpansion } from '../lib/post-process'
import { clearUiLogs } from '../lib/ui-debug-log'
import { LLMConfig } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ═══════════════════════════════════════════════════════════════
// Mock XHR：队列式脚本化响应
// ═══════════════════════════════════════════════════════════════
interface MockCall { body: string }
const mockCalls: MockCall[] = []
const responseQueue: string[] = []

;(globalThis as Record<string, unknown>).XMLHttpRequest = class {
  status = 200
  responseText = ''
  timeout = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  open(_m: string, _u: string, _a: boolean) { /* noop */ }
  setRequestHeader(_k: string, _v: string) { /* noop */ }
  send(body?: string) {
    mockCalls.push({ body: body || '' })
    const content = responseQueue.shift() ?? ''
    this.responseText = JSON.stringify({ choices: [{ message: { content } }] })
    setTimeout(() => this.onload && this.onload(), 0)
  }
}

const config: LLMConfig = {
  apiUrl: 'https://mock.local/v1/chat/completions',
  apiKey: 'test',
  model: 'test-model',
  translationStyle: '',
  translationStyleCustom: '',
  scenePreset: '',
  enableProofread: false,
  proofreadApiKey: '',
  proofreadApiUrl: '',
  proofreadModel: '',
}

const emptyGlossary = new Map<string, string>()

async function main() {
  // ═══════════════════════════════════════════════════════════
  out.push('═'.repeat(60))
  out.push('A. 纯检测不修改：超长译文不被截断原样保留')
  out.push('═'.repeat(60))

  // A1: 超长译文（无数字）—— 旧版会截断，v10.8 应原样保留 + 标记 expandedIndices
  {
    const src = ['High speed transfer']
    const longTrans = ['这是一个非常详尽且冗长的翻译版本，包含了大量源文中并没有明确表达出来的额外修饰和补充说明内容']
    const r = detectTranslationExpansion(src, longTrans, 'zh-TW')
    assert(r.texts[0] === longTrans[0], 'A1 超长译文原样保留（不再自动截断）', `got "${r.texts[0].slice(0, 30)}"`)
    assert(r.expandedIndices.has(0), 'A2 超长译文被标记 expandedIndices', `got ${[...r.expandedIndices]}`)
    assert(typeof r.ratios.get(0) === 'number' && (r.ratios.get(0) ?? 0) > 1, 'A3 长度比透出（>1）', `got ${r.ratios.get(0)}`)
  }

  // A2: 含源文数字的超长译文 —— 数字豁免仍生效（不标记）
  {
    const src = ['Read speed up to 2050MB/s']
    const longTrans = ['读取速度高达 2050MB/s，这是一个非常详尽的翻译，包含了很多额外的描述性文字来补充说明这个速度指标的实际意义和使用场景']
    const r = detectTranslationExpansion(src, longTrans, 'zh-TW')
    assert(!r.expandedIndices.has(0), 'A4 含源文数字的超长译文豁免（不标记）', `got ${[...r.expandedIndices]}`)
    assert(r.texts[0] === longTrans[0], 'A5 数字豁免条目同样原样保留', `got "${r.texts[0].slice(0, 30)}"`)
  }

  // A3: 正常长度译文 —— 不标记
  {
    const src = ['High speed transfer for professional use']
    const normalTrans = ['高速传输，专为专业用途设计']
    const r = detectTranslationExpansion(src, normalTrans, 'zh-TW')
    assert(!r.expandedIndices.has(0), 'A6 正常长度译文不标记', `got ${[...r.expandedIndices]}`)
  }

  // A4: 短源文 2x 阈值仍生效（<10 字符源文用更宽松阈值）
  {
    const src = ['Fast']  // 4 字符 < 10，de 目标 ratio 1.9 * 2.0 = 3.8 阈值
    const trans = ['Sehr schnelle Übertragung']  // 25 字符 = 6.25x > 3.8 → 应标记
    const r = detectTranslationExpansion(src, trans, 'de')
    assert(r.expandedIndices.has(0), 'A7 短源文超 2x 阈值仍标记', `got ${[...r.expandedIndices]}`)
    assert(r.texts[0] === trans[0], 'A8 短源文超长译文同样原样保留', `got "${r.texts[0]}"`)
  }

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('B. 信号透传：translateBatch 的 expansionIndices 输出')
  out.push('═'.repeat(60))

  // B1: LLM 输出超长译文 → expansionIndices 透出 + 译文不被截断
  // 关键：首调用「含 CJK 的超长译文」——有 CJK 不触发截断兜底，src≠trans 不触发漏翻，
  //       因此零重试、零激进兜底，1 次 API 调用即得最终结果，队列干净。
  //       这与 B1 末尾的 detectTruncatedTexts 兜底无关（后者只认无 CJK 的纯拉丁译文）。
  clearUiLogs()
  mockCalls.length = 0
  const longLLMOutput = '这是一个非常详尽且冗长的翻译版本，包含了大量源文中并没有明确表达出来的额外修饰和补充说明内容，远超正常翻译长度'
  responseQueue.push(`[1] ${longLLMOutput}`)  // 仅需首调 1 次响应
  const expansionIdx = new Set<number>()
  const untranslatedIdx = new Set<number>()
  const r1 = await translateBatch(
    ['High speed transfer'],
    'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    untranslatedIdx, undefined, expansionIdx,
  )
  assert(r1[0] === longLLMOutput, 'B1 translateBatch 不再自动截断超长译文', `got "${r1[0].slice(0, 30)}" (len=${r1[0].length})`)
  assert(expansionIdx.has(0), 'B2 expansionIndices 透出超长信号', `got ${[...expansionIdx]}`)

  // B2: 正常长度译文 → expansionIndices 为空
  // "高速传输"（4 字符，CJK 目标）长度正常，expansion 应不命中 → Set 保持为空。
  //       它可能因 zh-TW 截断检测（无繁体特征字）走兜底链，但那与 expansion 信号无关。
  //       关键：只要首调响应不触发漏翻（含 CJK），expansion 就只认首调结果，队列干净。
  clearUiLogs()
  mockCalls.length = 0
  responseQueue.push('[1] 高速传输')  // 首调 1 次响应
  const expansionIdx2 = new Set<number>()
  await translateBatch(
    ['Fast transfer speed for data'],
    'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    new Set(), undefined, expansionIdx2,
  )
  assert(expansionIdx2.size === 0, 'B3 正常长度译文 expansionIndices 为空', `got ${[...expansionIdx2]}`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('C. 校对 hint 注入：命中条目含长度提示，未命中不含')
  out.push('═'.repeat(60))

  // C1: zh-TW（中文指令）—— 命中条目含"显著长于源文"，未命中不含
  clearUiLogs()
  mockCalls.length = 0
  responseQueue.push('[]')  // 校对 LLM 返回空数组 = 全部 OK 无修改
  const items = [
    { sourceText: 'High speed transfer', translatedText: '这是一个非常详尽且冗长的翻译版本，包含了大量额外的修饰和补充说明内容' },
    { sourceText: 'Fast data transfer', translatedText: '快速数据传输' },
  ]
  const expansionFlags = new Set<number>([0])  // 只标记第 0 条
  await proofreadBatch(items, 'zh-TW', emptyGlossary, config, undefined, undefined, undefined, undefined, expansionFlags)
  assert(mockCalls.length === 1, 'C1 校对调用 1 次', `got ${mockCalls.length}`)
  const c1Body = JSON.parse(mockCalls[0].body)
  const c1UserMsg = c1Body.messages.find((m: { role: string }) => m.role === 'user').content
  assert(/显著长于源文/.test(c1UserMsg), 'C2 命中条目含"显著长于源文"提示', c1UserMsg.slice(0, 200))
  assert(/保持原样/.test(c1UserMsg), 'C3 提示含"保持原样"中性措辞（防诱导过度改写）')
  // 未命中条目（第 2 条）的 Trans 行后不应紧跟提示
  const c1Lines = c1UserMsg.split('\n')
  const c1SecondTransIdx = c1Lines.findIndex((l: string) => l.includes('快速数据传输'))
  const c1SecondHasNote = c1SecondTransIdx >= 0 && c1Lines[c1SecondTransIdx].includes('显著长于源文')
  assert(!c1SecondHasNote, 'C4 未命中条目不含长度提示')

  // C2: de（英文指令）—— 命中条目含"notably longer than the source"
  clearUiLogs()
  mockCalls.length = 0
  responseQueue.push('[]')
  const itemsDe = [
    { sourceText: 'High speed transfer', translatedText: 'Dies ist eine sehr ausführliche und langatmige Übersetzungsversion mit vielen zusätzlichen Ergänzungen' },
  ]
  const expansionFlagsDe = new Set<number>([0])
  await proofreadBatch(itemsDe, 'de', emptyGlossary, config, undefined, undefined, undefined, undefined, expansionFlagsDe)
  const c2Body = JSON.parse(mockCalls[0].body)
  const c2UserMsg = c2Body.messages.find((m: { role: string }) => m.role === 'user').content
  assert(/notably longer than the source/.test(c2UserMsg), 'C5 英文指令含"notably longer than the source"', c2UserMsg.slice(0, 200))
  assert(/keep it as-is/.test(c2UserMsg), 'C6 英文提示含"keep it as-is"中性措辞')

  // C3: 不传 expansionFlags（undefined）—— 任何条目都不含提示（向后兼容）
  clearUiLogs()
  mockCalls.length = 0
  responseQueue.push('[]')
  await proofreadBatch(items, 'zh-TW', emptyGlossary, config, undefined, undefined, undefined, undefined, undefined)
  const c3Body = JSON.parse(mockCalls[0].body)
  const c3UserMsg = c3Body.messages.find((m: { role: string }) => m.role === 'user').content
  assert(!/显著长于源文/.test(c3UserMsg), 'C7 不传 expansionFlags 时无任何长度提示（向后兼容）')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('D. 端到端：超长译文不再截断；校对判加戏→精简 / 判合法→保持')
  out.push('═'.repeat(60))

  // D1: 端到端——LLM 输出超长译文 → 不被截断 → 校对判"加戏"→ 精简为紧凑版
  // 与 B1 相同：首调含 CJK 的超长译文，不触发截断兜底（有 CJK），不触发漏翻（src≠trans）。
  //       因此零重试、零激进兜底 → 首调响应直接成为最终结果，1 次 API 调用，队列干净。
  clearUiLogs()
  mockCalls.length = 0
  const d1Long = '这是一个非常详尽且冗长的翻译版本，包含了大量源文中并没有明确表达出来的额外修饰和补充说明内容'
  responseQueue.push(`[1] ${d1Long}`)  // 仅需首调 1 次响应
  const d1Trans = await translateBatch(
    ['High speed transfer'],
    'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    new Set(), undefined, new Set(),
  )
  assert(d1Trans[0] === d1Long, 'D1 端到端：超长译文原样进入校对（未被截断）', `got len=${d1Trans[0].length} val="${d1Trans[0].slice(0, 30)}"`)

  // 校对：判"加戏"→ 返回精简版
  // 注意：proofreadBatch 对"校对后仍漏翻"的条目会回退到翻译结果（v7.5.1 安全网）。
  //       精简版必须是含 CJK 且非空的"合法译文"（length≥2），否则被误判漏翻回退。
  clearUiLogs()
  mockCalls.length = 0
  responseQueue.push('[{"i":1,"text":"高效能資料傳輸","reason":"多翻"}]')
  const d1ProofItems = [{ sourceText: 'High speed transfer', translatedText: d1Long }]
  const d1Proof = await proofreadBatch(d1ProofItems, 'zh-TW', emptyGlossary, config, undefined, undefined, undefined, undefined, new Set([0]))
  assert(d1Proof[0].text === '高效能資料傳輸', 'D2 校对判加戏→精简为紧凑版', `got "${d1Proof[0].text}"`)

  // D2: 端到端——超长译文 → 校对判"合法详尽"→ 返回空（OK）→ 保持原样
  // 注意：proofreadBatch 对"text 为空"的条目会用 items[i].translatedText 兜底（保留原译），
  //       所以返回的是原译文本身而非空串——这正是"保持原样"的实现方式。
  clearUiLogs()
  mockCalls.length = 0
  responseQueue.push('OK')  // 校对 LLM 判合法，逐行格式输出 OK（无修改）
  const d2Proof = await proofreadBatch(d1ProofItems, 'zh-TW', emptyGlossary, config, undefined, undefined, undefined, undefined, new Set([0]))
  assert(d2Proof[0].text === d1Long, 'D3 校对判合法→保持原样（text 回退为原译文）', `got "${d2Proof[0].text.slice(0, 40)}" (len=${d2Proof[0].text.length})`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v108-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v10.8 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v108-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
