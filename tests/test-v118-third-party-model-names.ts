/**
 * v11.8 第三方型号/设备名保护测试
 *
 * 背景（2026-08-13 实机报告 en→de，20 语种通病）：
 *   第三方品牌设备/型号名被 LLM 加戏或直译：
 *     Luna Ultra → "Kameramodell: Luna Ultra"（加品类前缀）
 *     Pocket 4P / Pocket 4 / ... / Action 6 → "Kameramodelle: ..."
 *     Mavic 4 Pro / Mavic 3 / Mavic 2 Pro → "Drohnenmodelle: ..."
 *     Antigravity A1 → "Drohne Antigravity A1"；Osmo 360 → "Kamera Osmo 360"
 *     Legion Go / Steam Deck / ROG ALLY / G Cloud → "Handheld-Konsole ..."
 *     Steam → "Dampf"（直译）
 *
 * 根因（三条独立）：
 *   A. isModelListOrCode 结构性豁免不了无数字纯文本型号（Mavic 3 大写占比 1/5 等，全不命中）
 *   B. v10.5 豁免只是漏翻判定层——不遮蔽、不进 prompt；LLM 加戏后译文≠源文，
 *      漏翻检测不触发 → 豁免防重试 → 加戏译文干净落地
 *   C. LEAN prompt 原则 1 只举 Lexar 型号例，无第三方判定标准 → LLM 行为漂移
 *
 * 修复（零检测/豁免代码改动）：
 *   - 词表 identity 行（src===target 21 列全同形）×16，一石三鸟：
 *     S1 整条短路 + S2 译中遮蔽(__GLOSSARY_N__) + 漏翻豁免(isUntranslatable 规则1/lemma)
 *   - prompt LEAN/LEAN_ZH 原则 1 各 +1 句（残余缺口：遮蔽防"词条被改"不防"占位符前加前缀"）
 *   - GLOSSARY_VERSION 4→5 存量静默升级
 *
 * 覆盖：
 *   A. isUntranslatable 豁免（de 视图）：16 词条正样例 + lemma 复数 + 反样例
 *   B. 遮蔽往返：嵌入式命中 → 占位符无残留明文 → unmask 同形还原；长度优先（Steam Deck 不被 Steam 切）
 *   C. S1 整条短路：translateBatch mock 回显，identity 行原文落地、零重试、真实句子照翻
 *   D. 回归护栏：非 identity 文本行为不变；isModelListOrCode 豁免不受影响（v10.5 不破）
 *   E. prompt 断言：LEAN/LEAN_ZH 含第三方型号规则句
 *
 * ⚠️ v11.9 演进注意：本文件是 v11.8 的时点测试——当时 16 词条放在专属 CSV，
 *   v11.9 已将其下沉为代码内置层（lib/third-party-models.ts）并从 CSV 删除，
 *   本文件 A/B/C 三段依赖 CSV 数据的断言随之整体失效（28 处）。
 *   三层防线的现行回归测试 = tests/test-v119-builtin-third-party.ts（D 段同款用例）。
 *   本文件保留作历史时点参考，D/E 段（不依赖 CSV 词条位置）仍有效。
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { translateBatch, isUntranslatable } from '../lib/llm-api'
import { maskGlossaryTerms, unmaskGlossaryTerms } from '../lib/entity-masker'
import { DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '../lib/default-glossary'
import { CORE_PRINCIPLES_LEAN, CORE_PRINCIPLES_LEAN_ZH } from '../lib/prompt-constants'
import { GLOSSARY_VERSION } from '../lib/constants'
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
// Mock XHR：队列式脚本化响应（与 test-v105 同款）
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

/** 从生成的专属 CSV 构建 de 目标视图（模拟 ui/App.vue buildGlossaryMaps 全语言 key 注册） */
function buildDeGlossaryMap(): Map<string, string> {
  const map = new Map<string, string>()
  const lines = DEFAULT_GLOSSARY_EXCLUSIVE_CSV.split('\n').filter(l => l.trim())
  const header = lines[0].split(',')
  const deIdx = header.indexOf('de')
  assert(deIdx > 0, 'SETUP de 列存在', `header=${header.slice(0, 5).join('/')}`)
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    const src = cols[0]?.trim()
    const de = cols[deIdx]?.trim()
    if (src && de) map.set(src, de)
  }
  return map
}

const deGlossary = buildDeGlossaryMap()

// ═══════════════════════════════════════════════════════════════
// A. isUntranslatable 豁免（identity 行规则1整条直配 + lemma 复数）
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. isUntranslatable 第三方型号/设备名豁免（de 视图）')
out.push('═'.repeat(60))

const IDENTITY_TERMS = [
  'Steam Deck', 'Legion Go', 'ROG ALLY', 'G Cloud', 'Osmo 360',
  'Antigravity A1', 'Luna Ultra', 'Pocket 4P', 'Pocket 4', 'Pocket 3',
  'Pocket 2', 'Action 6', 'Mavic 4 Pro', 'Mavic 3', 'Mavic 2 Pro', 'Steam',
]

// A0: 16 词条全部已入库（de 视图含全部 key）
{
  const missing = IDENTITY_TERMS.filter(t => !deGlossary.has(t))
  assert(missing.length === 0, 'A0 16 词条全部已入 de 视图词表', missing.join(','))
  // identity 行断言：src === de 值
  const nonIdentity = IDENTITY_TERMS.filter(t => deGlossary.get(t) !== t)
  assert(nonIdentity.length === 0, 'A0b 16 词条 de 列全同形（identity）', nonIdentity.join(','))
}

for (const t of IDENTITY_TERMS) {
  assert(isUntranslatable(t, deGlossary) === true, `A-豁免: ${t}`)
}

// A-lemma: 复数形态经 lemma 还原命中（"Steam Decks" → "steam deck"）
assert(isUntranslatable('Steam Decks', deGlossary) === true, 'A-豁免: Steam Decks（lemma 复数）')

// A-反样例：描述性句子不得豁免
const NEGATIVES: Array<[string, string]> = [
  ['Capture every moment', '营销句'],
  ['Read speed up to 2050MB/s', '规格句'],
  ['High speed transfer for professional photography workflow', '长描述句'],
]
for (const [text, label] of NEGATIVES) {
  assert(isUntranslatable(text, deGlossary) === false, `A-不误判: ${label}`, JSON.stringify(text))
}

// ═══════════════════════════════════════════════════════════════
// B. 遮蔽往返：嵌入式命中 → 占位符 → unmask 同形还原
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('B. 译中遮蔽往返（maskGlossaryTerms / unmaskGlossaryTerms）')
out.push('═'.repeat(60))

{
  // B1: 两个设备名嵌入式命中 → 2 个占位符，无明文残留
  const src = ['Compatible with Steam Deck and ROG ALLY']
  const masked = maskGlossaryTerms(src, deGlossary)
  const placeholderCount = (masked.texts[0].match(/__GLOSSARY_\d+__/g) || []).length
  assert(placeholderCount === 2, 'B1 双设备名产生 2 个占位符', `got ${placeholderCount}: ${masked.texts[0]}`)
  assert(!masked.texts[0].includes('Steam') && !masked.texts[0].includes('ROG'), 'B1b 无明文残留', masked.texts[0])

  // B1c: unmask 同形还原（identity 行目标值=原文）
  const roundtrip = unmaskGlossaryTerms(masked.texts, masked.termMap)
  assert(roundtrip.texts[0] === src[0], 'B1c unmask 同形还原', roundtrip.texts[0])
  assert(roundtrip.missingIndices.size === 0, 'B1d 无还原缺失', `${[...roundtrip.missingIndices]}`)

  // B2: 长度优先 — "Steam Deck" 产生 1 个占位符（不被 bare "Steam" 行切成 2 个）
  const src2 = ['Works on Steam Deck']
  const masked2 = maskGlossaryTerms(src2, deGlossary)
  const count2 = (masked2.texts[0].match(/__GLOSSARY_\d+__/g) || []).length
  assert(count2 === 1, 'B2 Steam Deck 整体 1 个占位符（长度优先，不被 Steam 切）', `got ${count2}: ${masked2.texts[0]}`)
  const rt2 = unmaskGlossaryTerms(masked2.texts, masked2.termMap)
  assert(rt2.texts[0] === src2[0], 'B2b unmask 还原', rt2.texts[0])

  // B3: 列表形态整行遮蔽（v11.8 实体修复：连续遮蔽位置漂移的懒惰重匹配）
  const src3 = ['Pocket 4P / Pocket 4 / Pocket 3 / Pocket 2 / Action 6']
  const masked3 = maskGlossaryTerms(src3, deGlossary)
  const count3 = (masked3.texts[0].match(/__GLOSSARY_\d+__/g) || []).length
  assert(count3 === 5, 'B3 Pocket 列表 5 个占位符', `got ${count3}: ${masked3.texts[0]}`)
  assert(!/Pocket|Action/.test(masked3.texts[0]), 'B3b 列表无明文残留', masked3.texts[0])
  const rt3 = unmaskGlossaryTerms(masked3.texts, masked3.termMap)
  assert(rt3.texts[0] === src3[0], 'B3c 列表 unmask 还原', rt3.texts[0])

  // B4: 重匹配回归护栏 — 同词重复句每处独立遮蔽（既有行为：cleanKey 重叠检查允许多实例）
  //     关键断言：重匹配修复不得产生嵌套/损坏占位符，且每个占位符精确对应一个实例
  const src4 = ['Steam Deck and Steam Deck']
  const masked4 = maskGlossaryTerms(src4, deGlossary)
  const count4 = (masked4.texts[0].match(/__GLOSSARY_\d+__/g) || []).length
  assert(count4 === 2, 'B4 同词两处独立遮蔽（既有行为保持）', `got ${count4}: ${masked4.texts[0]}`)
  assert(!masked4.texts[0].includes('Steam'), 'B4b 无明文残留（无嵌套占位符）', masked4.texts[0])
  const rt4 = unmaskGlossaryTerms(masked4.texts, masked4.termMap)
  assert(rt4.texts[0] === src4[0], 'B4c unmask 还原', rt4.texts[0])
}

// ═══════════════════════════════════════════════════════════════
// D. 回归护栏（v10.5 不受影响 — 本版本零代码改动）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('D. 回归护栏')
out.push('═'.repeat(60))

assert(
  isUntranslatable('EOS R5    /    EOS R6    /    EOS RP', emptyGlossary) === true,
  'D1 isModelListOrCode 豁免不受词表新增影响（v10.5 回归）'
)
assert(
  isUntranslatable('Read speed up to 2050MB/s', deGlossary) === false,
  'D2 非 identity 规格句仍不豁免（de 视图）'
)
assert(
  GLOSSARY_VERSION >= 5,
  'D3 GLOSSARY_VERSION 已升到 5+（存量用户静默升级）', `got ${GLOSSARY_VERSION}`
)

// ═══════════════════════════════════════════════════════════════
// E. prompt 断言：LEAN/LEAN_ZH 含第三方型号规则句
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('E. prompt 规则注入断言')
out.push('═'.repeat(60))

assert(
  CORE_PRINCIPLES_LEAN.includes('Third-party device and model names') &&
  CORE_PRINCIPLES_LEAN.includes('Steam Deck') &&
  CORE_PRINCIPLES_LEAN.includes('Handheld-Konsole'),
  'E1 LEAN 含第三方型号规则句（EN）'
)
assert(
  CORE_PRINCIPLES_LEAN_ZH.includes('第三方设备/型号名') &&
  CORE_PRINCIPLES_LEAN_ZH.includes('Steam Deck'),
  'E2 LEAN_ZH 含第三方型号规则句（ZH）'
)

// ═══════════════════════════════════════════════════════════════
// C. S1 整条短路：identity 行原文落地、零重试、真实句子照翻
// ═══════════════════════════════════════════════════════════════
async function main() {
  out.push('')
  out.push('═'.repeat(60))
  out.push('C. S1 整条短路端到端（en→de mock）')
  out.push('═'.repeat(60))

  clearUiLogs()
  mockCalls.length = 0
  // LLM 输入：[1] Steam Deck（短路后已是终态原文） [2] 营销句 [3] Mavic 3（短路终态）
  // 惯例：短路条目原样回显；营销句正常翻译
  enqueueResponse(
    '[1] Steam Deck\n' +
    '[2] Erlebe jeden Moment\n' +
    '[3] Mavic 3'
  )
  const untranslated = new Set<number>()
  const r = await translateBatch(
    ['Steam Deck', 'Experience every moment', 'Mavic 3'],
    'de', deGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated)

  assert(r.length === 3, 'C1 返回 3 条', `got ${r.length}`)
  assert(r[0] === 'Steam Deck', 'C2 Steam Deck 短路原文落地（无加戏无前缀）', JSON.stringify(r[0]))
  assert(r[1] === 'Erlebe jeden Moment', 'C3 真实句子正常翻译（不误豁免）', JSON.stringify(r[1]))
  assert(r[2] === 'Mavic 3', 'C4 Mavic 3 短路原文落地', JSON.stringify(r[2]))
  assert(mockCalls.length === 1, 'C5 零重试（仅首调 1 次 API）', `实际 ${mockCalls.length} 次调用`)
  assert(untranslated.size === 0, 'C6 零漏翻上报', `got ${[...untranslated]}`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v118-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v11.8 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v118-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
