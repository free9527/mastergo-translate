/**
 * v10.5 型号/单位豁免 + 检测层豁免测试
 *
 * 背景（2026-08-01 实机日志 zh-CN→zh-TW）：
 *   - 相机型号列表（EOS R5 / ...、A1 / A7M4 / ...）本不该翻，LLM 原样回显是正确行为，
 *     但 isUntranslatable 白名单只认 Lexar 自有型号 → 误判漏翻 → 每条空转 4 次兜底 API 后标红。
 *   - "MB/s*" 裸单位无数字开头，落不穿 NUM_UNIT_RE → 误判漏翻。
 *   - detectTruncatedTexts 对"不可翻译"条目误报截断（zh 目标只查 CJK 字符），
 *     且 S7b-trunc 会 result[j]='' 静默清空。
 *   - 源稿错别字 Panasionic 被 LLM 纠正为 Panasonic（术语库值）后，
 *     最终安全网的"必须含 CJK 字符"脚本校验仍误报漏翻。
 *
 * 覆盖：
 *   A. isUntranslatable 型号/列表正反样例
 *   B. isUntranslatable 裸单位正反样例
 *   C. detectTruncatedTexts 跳过不可翻译条目（空译文仍报截断）
 *   D. detectUntranslatedText 脚本校验豁免术语库已知值（src===trans 不豁免）
 *   E. 端到端队列 mock：型号列表回显不触发任何重试
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { translateBatch, isUntranslatable, detectTruncatedTexts, detectUntranslatedText } from '../lib/llm-api'
import { clearUiLogs } from '../lib/ui-debug-log'
import { LLMConfig } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass++
    out.push(`✅ ${name}`)
  } else {
    fail++
    out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock XHR：队列式脚本化响应（与 test-v911 / test-v104 同款）
// ═══════════════════════════════════════════════════════════════
interface MockCall { body: string }
const mockCalls: MockCall[] = []
const responseQueue: string[] = []
function enqueueResponse(content: string) { responseQueue.push(content) }

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

// ═══════════════════════════════════════════════════════════════
// A. isUntranslatable 型号/型号列表
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. isUntranslatable 型号/型号列表豁免')
out.push('═'.repeat(60))

const MODEL_POSITIVE: Array<[string, string]> = [
  ['EOS R5    /    EOS R6    /    EOS RP    /    EOS 90D    /    EOS M6\nEOS 77D    /    EOS 700D    /    EOS 750D    /    EOS 800D\n6D Mark II', '佳能型号列表'],
  ['Z 7II    /    Z50\nD500    /    D800    /    D810    /    D850\nD5100    /    D5500    /    D7500', '尼康型号列表'],
  ['GH6    /    GH5    /    GH4    /    G100    /    G95\nS1R    /    S1    /    G9    /    G7    /    S5M2X\nFZ1000', '松下型号列表'],
  ['X-H2S    /    GFX-100 II    /    X100V\nXT30    /    X-H1    /    X-T3    /    X-T1', '富士型号列表'],
  ['A1    /    A7M4    /    A7M3    /    A7R II    /    A7S\nA6000L    /    A6300    /    A6400    /    A6600\nRX100M5A    /    RX100M7G\nFDR-AX40    /    FDR-AX60', '索尼型号列表'],
  ['E-M1-Mark-II', '奥林巴斯单型号（连字符+小写）'],
  ['A7R II', '单型号含罗马数字'],
  ['6D Mark II', '单型号含小写词'],
]
for (const [text, label] of MODEL_POSITIVE) {
  assert(isUntranslatable(text, emptyGlossary) === true, `A-型号豁免: ${label}`, JSON.stringify(text.slice(0, 40)))
}

const MODEL_NEGATIVE: Array<[string, string]> = [
  ['4K/8K video recording', '斜杠分隔但含小写描述词'],
  ['Read/write speed up to 2050MB/s', '斜杠+句子'],
  ['SUPER FAST SPEED', '全大写但无数字（单段）'],
  ['High Speed Transfer', '标题大小写描述'],
  ['高速传输/极速体验', 'CJK 文本'],
]
for (const [text, label] of MODEL_NEGATIVE) {
  assert(isUntranslatable(text, emptyGlossary) === false, `A-不误判: ${label}`, JSON.stringify(text))
}

// ═══════════════════════════════════════════════════════════════
// B. isUntranslatable 裸单位
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('B. isUntranslatable 裸单位豁免')
out.push('═'.repeat(60))

assert(isUntranslatable('MB/s*', emptyGlossary) === true, 'B-裸单位: MB/s*')
assert(isUntranslatable('GB/s', emptyGlossary) === true, 'B-裸单位: GB/s')
assert(isUntranslatable('TBW', emptyGlossary) === true, 'B-裸单位: TBW（原有 TBW_RE 已覆盖）')
assert(isUntranslatable('MHz', emptyGlossary) === true, 'B-裸单位: MHz')
assert(isUntranslatable('read speed', emptyGlossary) === false, 'B-不误判: read speed')
assert(isUntranslatable('memory card', emptyGlossary) === false, 'B-不误判: memory card')

// ═══════════════════════════════════════════════════════════════
// C. detectTruncatedTexts 跳过不可翻译条目
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('C. detectTruncatedTexts 不可翻译条目豁免')
out.push('═'.repeat(60))

{
  const src = [
    'EOS R5    /    EOS R6    /    EOS RP    /    EOS 90D    /    EOS M6\nEOS 77D    /    EOS 700D',  // 型号列表（>30字）
    'This is a long descriptive sentence about product performance and reliability features',  // 真实长句（>30字）
    'Short text',  // 短句（<30字）
    'EOS R5 Mark II    /    EOS R6    /    EOS RP    /    EOS 90D    /    EOS M6    /    EOS 77D',  // 另一型号列表（EOS 全大写+数字段）
  ]
  const trans = [
    src[0],  // 型号列表原样回显 → 不应判截断（v10.5 豁免）
    'short',  // 真实长句被译成极短纯拉丁 → zh 目标无 CJK → 仍应判截断
    '',       // 空译文 → 仍应判截断（空值检查在豁免之前）
    src[3],  // 型号列表原样回显 → 不应判截断
  ]
  const trunc = detectTruncatedTexts(src, trans, 'zh-TW')
  assert(!trunc.has(0), 'C1 型号列表不误报截断')
  assert(trunc.has(1), 'C2 真实长句纯拉丁译文仍报截断（回归守卫）')
  assert(trunc.has(2), 'C3 空译文仍报截断（空值检查优先于豁免）')
  assert(!trunc.has(3), 'C4 另一型号列表不误报截断')
}

// ═══════════════════════════════════════════════════════════════
// D. detectUntranslatedText 脚本校验豁免术语库已知值
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('D. detectUntranslatedText 术语库已知值豁免（仅脚本校验）')
out.push('═'.repeat(60))

{
  // 术语库：Panasonic → Panasonic（全列同形，如用户 CSV 第 145 行）
  const glossary = new Map<string, string>([['Panasonic', 'Panasonic']])

  // D1: 源稿错别字被 LLM 纠正为术语库值 → 不应被脚本校验误报
  // （Panasionic ≠ Panasonic 所以 src!==trans 不触发；纯拉丁在 zh 目标下原本会触发脚本校验）
  const d1 = detectUntranslatedText(['Panasionic'], ['Panasonic'], 'zh-TW', glossary)
  assert(d1.size === 0, 'D1 错别字→术语库值（Panasonic）不报漏翻', `got ${[...d1]}`)

  // D2: 真实句子原样回显 → src===trans 仍报漏翻（术语库值豁免不管 src===trans）
  const d2 = detectUntranslatedText(['Panasionic'], ['Panasionic'], 'zh-TW', glossary)
  assert(d2.has(0), 'D2 错别字原样回显仍报漏翻（src===trans 不豁免）')

  // D3: 非术语库值的纯拉丁译文在 zh 目标下仍报漏翻（脚本校验回归守卫）
  const d3 = detectUntranslatedText(['This is a real sentence that must be translated'], ['This is a real sentence that must be translated'], 'zh-TW', glossary)
  assert(d3.has(0), 'D3 真实句子回显仍报漏翻（回归守卫）')

  // D4: 简体原样回显（含简体特征字）→ s2t 变体校验仍报漏翻（与脚本校验正交，不受库值豁免影响）
  const d4 = detectUntranslatedText(['高速传输 极致体验'], ['高速传输 极致体验'], 'zh-TW', glossary)
  assert(d4.has(0), 'D4 简体回显仍报漏翻（s2t 特征字校验回归守卫）')

  // D5: ja 目标（纯拉丁源文，规避 zh-TW 的 s2t 特征字短路）+ 纯拉丁非库值伪翻译仍报漏翻。
  // 这是脚本校验的原始设计场景（v9.8 防 LLM 用拉丁文充数），验证库值豁免没有把它一并放行。
  const d5 = detectUntranslatedText(['High speed transfer for professional photography workflow'], ['Some random latin output not in glossary'], 'ja', glossary)
  assert(d5.has(0), 'D5 ja目标 纯拉丁非库值伪翻译仍报漏翻（脚本校验回归守卫）')
}

// ═══════════════════════════════════════════════════════════════
// F. 20 语种普遍性验证（用户要求：bug 不只 CN→TW，需确认 20 语种全覆盖）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('F. 20 语种普遍性：型号/裸单位豁免 + 截断豁免 + 脚本校验豁免')
out.push('═'.repeat(60))

{
  const ALL_TARGETS = ['zh-CN','zh-TW','ja','ko','fr','de','es','pt','pt-BR','ru','it','vi','th','id','ar','nl','pl','sv','tr','en']
  const MODEL_LIST = 'EOS R5    /    EOS R6    /    EOS RP    /    EOS 90D    /    EOS M6\nEOS 77D    /    EOS 700D'
  const BARE_UNIT = 'MB/s*'

  // F1: isUntranslatable 型号列表豁免 — 与目标语种无关（函数不看 targetLang），全语种一致
  assert(isUntranslatable(MODEL_LIST, emptyGlossary) === true, 'F1 型号列表豁免与语种无关（isUntranslatable 无 targetLang 入参）')
  assert(isUntranslatable(BARE_UNIT, emptyGlossary) === true, 'F2 裸单位豁免与语种无关')

  // F3: detectTruncatedTexts 对型号列表回显 — 20 语种全不误报截断
  const truncFail: string[] = []
  for (const tgt of ALL_TARGETS) {
    const t = detectTruncatedTexts([MODEL_LIST, BARE_UNIT], [MODEL_LIST, BARE_UNIT], tgt)
    if (t.size > 0) truncFail.push(tgt)
  }
  assert(truncFail.length === 0, 'F3 型号/裸单位回显在 20 语种下均不误报截断', truncFail.join(','))

  // F4: detectTruncatedTexts 对真实长句的截断检出 — 抽查关键语种仍有效（回归守卫）
  const LONG_SRC = 'This is a long descriptive sentence about product performance and reliability features'
  const realTruncFail: string[] = []
  for (const tgt of ['ja','ko','zh-CN','zh-TW','th','ar','ru']) {
    // 非拉丁目标：纯拉丁极短译文 → 无目标脚本字符 → 应报截断
    const t = detectTruncatedTexts([LONG_SRC], ['ok'], tgt)
    if (!t.has(0)) realTruncFail.push(tgt)
  }
  assert(realTruncFail.length === 0, 'F4 真实截断在非拉丁目标下仍检出（回归守卫）', realTruncFail.join(','))

  // F5: detectUntranslatedText 脚本校验豁免术语库已知值 — 抽查 ja/ko/cjk 三脚本目标
  const glossary = new Map<string, string>([['Panasonic', 'Panasonic']])
  const scriptExemptFail: string[] = []
  for (const tgt of ['ja','ko','zh-TW','zh-CN']) {
    // 源稿错别字 → 纠正为术语库值（纯拉丁）→ 不应被脚本校验误报
    const u = detectUntranslatedText(['Panasionic'], ['Panasonic'], tgt, glossary)
    if (u.size > 0) scriptExemptFail.push(tgt)
  }
  assert(scriptExemptFail.length === 0, 'F5 术语库已知值在 ja/ko/zh 目标下均豁免脚本校验', scriptExemptFail.join(','))

  // F6: 非库值纯拉丁伪翻译在 ja/ko/zh 目标下仍报漏翻（脚本校验回归守卫，跨语种）
  const scriptGuardFail: string[] = []
  for (const tgt of ['ja','ko','zh-TW']) {
    const u = detectUntranslatedText(['High speed transfer for professional photography workflow'], ['Some random latin output not in glossary'], tgt, glossary)
    if (!u.has(0)) scriptGuardFail.push(tgt)
  }
  assert(scriptGuardFail.length === 0, 'F6 纯拉丁非库值伪翻译在 ja/ko/zh 下仍报漏翻（回归守卫）', scriptGuardFail.join(','))
}
// ═══════════════════════════════════════════════════════════════
// E. 端到端：型号列表回显不触发任何重试
// ═══════════════════════════════════════════════════════════════
async function main() {
  out.push('')
  out.push('═'.repeat(60))
  out.push('E. 端到端：型号列表回显 → 零重试零漏翻上报')
  out.push('═'.repeat(60))

  clearUiLogs()
  mockCalls.length = 0
  // LLM 对 3 条的返回：型号列表原样回显（正确行为），真实句子正常翻译
  enqueueResponse(
    '[1] EOS R5    /    EOS R6    /    EOS RP    /    EOS 90D    /    EOS M6\nEOS 77D    /    EOS 700D\n' +
    '[2] 極速傳輸 絕佳體驗\n' +
    '[3] A1    /    A7M4    /    A7M3    /    A7R II    /    A7S'
  )
  const untranslated = new Set<number>()
  const r = await translateBatch(
    [
      'EOS R5    /    EOS R6    /    EOS RP    /    EOS 90D    /    EOS M6\nEOS 77D    /    EOS 700D',
      '极速传输 绝佳体验',
      'A1    /    A7M4    /    A7M3    /    A7R II    /    A7S',
    ],
    'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated)

  assert(r.length === 3, 'E1 返回 3 条', `got ${r.length}`)
  assert(r[0] === 'EOS R5    /    EOS R6    /    EOS RP    /    EOS 90D    /    EOS M6\nEOS 77D    /    EOS 700D', 'E2 型号列表原样保留', JSON.stringify(r[0].slice(0, 40)))
  assert(r[2].startsWith('A1'), 'E3 第二型号列表原样保留', JSON.stringify(r[2].slice(0, 40)))
  assert(mockCalls.length === 1, 'E4 型号列表回显不触发任何重试（仅首调 1 次 API）', `实际 ${mockCalls.length} 次调用`)
  assert(untranslated.size === 0, 'E5 零漏翻上报', `got ${[...untranslated]}`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v105-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v10.5 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v105-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
