/**
 * v10.6 疑似错词保留 + 回退兜底测试
 *
 * 背景（2026-08-01 实机日志 zh-CN→zh-TW）：源稿错别字 `Panasionic` 匹配不上术语库
 * （panasionic ≠ panasonic），进 LLM 后被音译成 `帕納西奧尼克`——错词被翻成诡异词上画布。
 *
 * 方案（与用户对齐，对齐 CAT 工具行业标准）：错词不翻、不猜、不音译、不自动改。
 *   - prompt 层：CORE_PRINCIPLES 加"疑似错词保留原形"规则（LLM 用多语言语感判错词，20 语言通吃）
 *   - 代码兜底：revertMisspelledWordTranslation —— LLM 万一翻了（音译成非拉丁文字），兜回源文原形
 *   - 零编辑距离/零词典/零自动替换（用户明确否决"差一个字母自动改"的风险）
 *
 * 覆盖：
 *   A. prompt 规则已注入 CORE_PRINCIPLES（中英双语）
 *   B. revertMisspelledWordTranslation 正反样例（通过 translateBatch 端到端触发）
 *   C. 端到端：Panasionic→帕納西奧尼克 被回退为 Panasionic + 待确认标记
 *   D. 20 语种：非拉丁目标全兜底、拉丁目标不兜底
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { translateBatch, detectUntranslatedText, buildSystemPrompt } from '../lib/llm-api'
import { CORE_PRINCIPLES, CORE_PRINCIPLES_ZH } from '../lib/prompt-constants'
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
// A. prompt 规则注入验证
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. prompt 规则注入（CORE_PRINCIPLES 中英双语）')
out.push('═'.repeat(60))

assert(/MISSPELLED WORDS/i.test(CORE_PRINCIPLES), 'A1 英文 CORE_PRINCIPLES 含错词规则')
assert(/keep the EXACT original spelling/i.test(CORE_PRINCIPLES), 'A2 英文规则含"保留原拼写"')
assert(/never "帕納西奧尼克"/.test(CORE_PRINCIPLES), 'A3 英文规则含反例（Panasionic 反例）')
assert(/疑似错词/.test(CORE_PRINCIPLES_ZH), 'A4 中文 CORE_PRINCIPLES_ZH 含错词规则')
assert(/原样保留源文拼写/.test(CORE_PRINCIPLES_ZH), 'A5 中文规则含"原样保留源文拼写"')
assert(/绝不译成 "帕納西奧尼克"/.test(CORE_PRINCIPLES_ZH), 'A6 中文规则含反例')

// ═══════════════════════════════════════════════════════════════
// Mock XHR：队列式脚本化响应
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

async function main() {
  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('B/C. 端到端：疑似错词被LLM音译 → 回退保留原形 + 待确认标记')
  out.push('═'.repeat(60))

  // C1: 核心场景——Panasionic 被音译成帕納西奧尼克 → 回退为 Panasionic
  clearUiLogs()
  mockCalls.length = 0
  // 批次 3 条：型号列表（v10.5 豁免保留）、真实句子（正常翻译）、Panasionic（错词被音译）
  enqueueResponse(
    '[1] EOS R5    /    EOS R6    /    EOS RP\n' +
    '[2] 極速傳輸 絕佳體驗\n' +
    '[3] 帕納西奧尼克'
  )
  const untranslated = new Set<number>()
  const misspelled = new Set<number>()
  const r1 = await translateBatch(
    ['EOS R5    /    EOS R6    /    EOS RP', '极速传输 绝佳体验', 'Panasionic'],
    'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated, misspelled)

  assert(r1.length === 3, 'C1 返回 3 条', `got ${r1.length}`)
  assert(r1[2] === 'Panasionic', 'C2 疑似错词被音译后回退为原形 Panasionic', JSON.stringify(r1[2]))
  assert(misspelled.has(2), 'C3 疑似错词索引进独立 misspelledIndices 通道', `got ${[...misspelled]}`)
  assert(!untranslated.has(2), 'C3b 疑似错词不进 untranslatedIndices（与漏翻区分）', `untranslated=${[...untranslated]}`)

  // C4: 真实句子正常翻译不受影响（不被误回退）
  assert(r1[1] === '極速傳輸 絕佳體驗', 'C4 真实句子正常翻译不被误回退', JSON.stringify(r1[1]))

  // B 段：正反样例（通过端到端，非拉丁目标 zh-TW）
  out.push('')
  out.push('─'.repeat(40))
  out.push('B. 正反样例（zh-TW 非拉丁目标）')
  out.push('─'.repeat(40))

  // B1: 术语库已收录的品牌词被翻译 → 不兜底（走 LOCK/正常流程，不是错词）
  clearUiLogs(); mockCalls.length = 0
  const glossary = new Map<string, string>([['Panasonic', 'Panasonic']])
  enqueueResponse('[1] Panasonic')  // LLM 原样回显（在库，正常）
  const b1untrans = new Set<number>()
  const rb1 = await translateBatch(['Panasonic'], 'zh-TW', glossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, b1untrans)
  assert(rb1[0] === 'Panasonic', 'B1 术语库已收录品牌词保留原形（短路，非错词兜底）', JSON.stringify(rb1[0]))

  // B2: 短词（<6）被音译 → 不兜底（长度约束）
  clearUiLogs(); mockCalls.length = 0
  enqueueResponse('[1] 索尼')  // Sony 被译成索尼（合法翻译，且 Sony 长度 4<6）
  const rb2 = await translateBatch(['Sony'], 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, new Set())
  assert(rb2[0] === '索尼', 'B2 短词(<6)被翻译不兜底（Sony→索尼 合法）', JSON.stringify(rb2[0]))

  // B3: 含数字的词被翻 → 不兜底（已有归属：型号豁免）
  clearUiLogs(); mockCalls.length = 0
  enqueueResponse('[1] A7M4 型號相機')  // 含数字+空格，非单词
  const rb3 = await translateBatch(['A7M4 camera'], 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, new Set())
  assert(rb3[0] === 'A7M4 型號相機', 'B3 含数字非单词不兜底', JSON.stringify(rb3[0]))

  // B4: 多词短语被翻 → 不兜底（非单词）
  clearUiLogs(); mockCalls.length = 0
  enqueueResponse('[1] 高速傳輸')
  const rb4 = await translateBatch(['High Speed'], 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, new Set())
  assert(rb4[0] === '高速傳輸', 'B4 多词短语正常翻译不兜底', JSON.stringify(rb4[0]))

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('D. 20 语种：非拉丁目标兜底 / 拉丁目标不兜底')
  out.push('═'.repeat(60))

  // D1: 拉丁目标（en/de/fr 等）不兜底——拉丁→拉丁猜测无法与合法翻译区分，归校对
  clearUiLogs(); mockCalls.length = 0
  enqueueResponse('[1] Panasionic-DE-variant')  // 拉丁目标，LLM 用另一拉丁词
  const d1untrans = new Set<number>()
  const rd1 = await translateBatch(['Panasionic'], 'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, d1untrans)
  // 拉丁目标：revertMisspelledWordTranslation 直接 return（script==='latin'），译文保留 LLM 输出
  assert(rd1[0] === 'Panasionic-DE-variant', 'D1 拉丁目标(de)不兜底（保留LLM输出，归校对）', JSON.stringify(rd1[0]))

  // D2: 各非拉丁目标（ja/ko/zh-CN/ru/ar/th）均兜底——错词被音译成非拉丁 → 回退原形
  const nonLatinTargets: Array<[string, string]> = [
    ['ja', 'パナシオニック'], ['ko', '파나시오닉'], ['zh-CN', '帕纳西奥尼克'],
    ['ru', 'Панасионик'], ['ar', 'باناسيونيك'], ['th', 'พานาซิโอนิค'],
  ]
  for (const [tgt, translit] of nonLatinTargets) {
    clearUiLogs(); mockCalls.length = 0
    enqueueResponse(`[1] ${translit}`)
    const duntrans = new Set<number>()
    const dmiss = new Set<number>()
    const rd = await translateBatch(['Panasionic'], tgt, emptyGlossary, config,
      undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, duntrans, dmiss)
    assert(rd[0] === 'Panasionic', `D2-${tgt} 非拉丁目标兜底回退原形`, JSON.stringify(rd[0]))
    assert(dmiss.has(0), `D2-${tgt} 疑似错词进 misspelledIndices`, `got ${[...dmiss]}`)
    assert(!duntrans.has(0), `D2-${tgt} 不进 untranslatedIndices（与漏翻区分）`, `got ${[...duntrans]}`)
  }

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('E. v10.6.2 拉丁→拉丁：LLM 原样保留错词不标漏翻（2026-08-03 实机缺口）')
  out.push('═'.repeat(60))

  // E1-E3: detectUntranslatedText 对"拉丁源→拉丁同文目标，src===trans"的疑似错词豁免
  const e1 = detectUntranslatedText(['Panasionic'], ['Panasionic'], 'de', emptyGlossary)
  assert(!e1.has(0), 'E1 拉丁目标(de)错词保留不标漏翻', `got ${[...e1]}`)
  const e2 = detectUntranslatedText(['Panasionic'], ['Panasionic'], 'fr', emptyGlossary)
  assert(!e2.has(0), 'E2 拉丁目标(fr)错词保留不标漏翻', `got ${[...e2]}`)
  const e3 = detectUntranslatedText(['Transfser'], ['Transfser'], 'es', emptyGlossary)
  assert(!e3.has(0), 'E3 拉丁目标(es)通用错词保留不标漏翻', `got ${JSON.stringify([...e3])}, size=${e3.size}`)

  // E4: 反例——拉丁目标下真正的漏翻（多词短语 src===trans）仍要被抓
  const e4 = detectUntranslatedText(['High speed transmission'], ['High speed transmission'], 'de', emptyGlossary)
  assert(e4.has(0), 'E4 拉丁目标真漏翻（多词）仍被抓', `got ${[...e4]}`)

  // E5: 反例——非拉丁目标（ja）src===trans 的真漏翻仍要被抓（脚本校验，不受豁免影响）
  const e5 = detectUntranslatedText(['Hello world'], ['Hello world'], 'ja', emptyGlossary)
  assert(e5.has(0), 'E5 非拉丁目标(ja)真漏翻仍被抓', `got ${[...e5]}`)

  // E6: 端到端——en→de 的 Panasionic 原样保留：不进 untranslatedIndices（有 E1 豁免），
  //      也不进 misspelledIndices（拉丁目标无法形式判定，归校对 LLM 裁决）
  clearUiLogs(); mockCalls.length = 0
  enqueueResponse('[1] Panasionic')
  const e6untrans = new Set<number>()
  const e6miss = new Set<number>()
  const re6 = await translateBatch(['Panasionic'], 'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, e6untrans, e6miss)
  assert(re6[0] === 'Panasionic', 'E6 拉丁目标(de)端到端保留原形', JSON.stringify(re6[0]))
  assert(!e6untrans.has(0), 'E6b 拉丁目标错词保留不进 untranslatedIndices', `got ${[...e6untrans]}`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('F. v10.6.2 品牌/产品名不直译 prompt 规则注入（中英双语）')
  out.push('═'.repeat(60))

  const promptZh = buildSystemPrompt({ targetLang: 'zh-TW', langBlock: '', styleCard: '', fewShotBlock: '', includeRemediation: true })  // v11.5: BRAND 段移到重试层，测试显式开注入
  assert(/品牌与产品名/.test(promptZh), 'F1 zh 指令含品牌产品名规则')
  assert(/Professional/.test(promptZh) && /SILVER/.test(promptZh), 'F2 zh 规则列产品线词')
  assert(/專業級/.test(promptZh), 'F3 zh 规则含反例（專業級）')
  const promptEn = buildSystemPrompt({ targetLang: 'de', langBlock: '', styleCard: '', fewShotBlock: '', includeRemediation: true })  // v11.5 同上
  assert(/BRAND & PRODUCT NAMES/.test(promptEn), 'F4 en 指令含品牌产品名规则')
  assert(/Professional/.test(promptEn) && /NEVER translate/.test(promptEn), 'F5 en 规则含品牌词+禁止直译')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v106-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v10.6 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v106-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
