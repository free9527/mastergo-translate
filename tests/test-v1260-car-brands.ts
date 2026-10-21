/**
 * v12.60 汽车品牌豁免（2026-10-21 dashcam 兼容列表实机：品牌名漏翻标红）
 *
 * 背景：Li Auto / ZEEKR / Mercedes-Benz / Chery / Jetour 等汽车品牌不在第三方名单、
 *   形态规则 isModelListOrCode 接不住（标题大小写/全大写无数字/连字符），
 *   LLM 正确保留英文但代码检测层不知其为品牌 → 判漏翻 → 每条空转 4+ 次兜底 API 标红。
 *
 * 方案（用户拍板「有风险的不收，代码层面加品牌豁免」）：汽车品牌字典铺开，
 *   只收无通用词/多义碰撞的专有名词。单词品牌走整词豁免 + 遮蔽表，多词品牌走遮蔽表。
 *
 * 覆盖：
 *   A. 实机 5 品牌 + 主流字典品牌全豁免（isUntranslatable 恒 true）
 *   B. 风险负样本：通用词/多义词品牌（Ford/Fiat/Ram…）不误豁免
 *   C. 裸品牌遮蔽往返（正文提及保留原文）
 *   D. 端到端：品牌条目不标漏翻、零重试（mock 回显品牌原文 = 真实 LLM 行为）
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { translateBatch, isUntranslatable } from '../lib/llm-api'
import { isBuiltinThirdPartyWholeText } from '../lib/third-party-models'
import { maskGlossaryTerms, unmaskGlossaryTerms } from '../lib/entity-masker'
import { restoreStorageUnitFormatting } from '../lib/post-process'
import { clearUiLogs } from '../lib/ui-debug-log'
import { LLMConfig } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

const emptyGlossary = new Map<string, string>()

// 单词品牌（整词豁免名单 + 遮蔽表）—— isBuiltinThirdPartyWholeText 应恒 true
const BARE_BRANDS = [
  // 实机裸品牌
  'ZEEKR', 'Chery', 'Jetour',
  // 字典
  'NIO', 'XPENG', 'Tesla', 'BYD', 'Geely', 'Haval', 'Denza', 'Leapmotor',
  'Arcfox', 'Hongqi', 'Rivian', 'Changan', 'Nissan', 'Toyota', 'Honda',
  'Mazda', 'Subaru', 'Mitsubishi', 'Hyundai', 'Kia', 'Lexus', 'Acura',
  'Infiniti', 'Volvo', 'Audi', 'Porsche', 'Ferrari', 'Bentley', 'Peugeot',
  'Renault', 'Citroen', 'Opel', 'Dacia', 'Skoda', 'Lamborghini', 'Bugatti', 'Maserati',
]
// 多词/连字符品牌（遮蔽表 only）—— isBuiltinThirdPartyWholeText 应恒 false
const MULTI_BRANDS = [
  'Li Auto', 'Mercedes-Benz', 'Land Rover', 'Range Rover',
  'Rolls-Royce', 'Aston Martin', 'Alfa Romeo',
]

// ═══════════════════════════════════════════════════════════════
// A. 汽车品牌全豁免
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. 汽车品牌 = isUntranslatable 恒 true + 整词豁免名单口径')
out.push('═'.repeat(60))

for (const b of BARE_BRANDS) {
  assert(isUntranslatable(b, emptyGlossary) === true, `A-豁免: ${b}`)
  assert(isBuiltinThirdPartyWholeText(b) === true, `A-单词品牌进整词豁免名单: ${b}`)
}
for (const b of MULTI_BRANDS) {
  assert(isUntranslatable(b, emptyGlossary) === true, `A-豁免: ${b}`)
  // 多词/连字符品牌只进遮蔽表（BUILTIN_THIRD_PARTY_ALL_KEYS），不进整词豁免名单
  assert(isBuiltinThirdPartyWholeText(b) === false, `A-多词品牌不进整词豁免名单(走遮蔽表/ALL_KEYS): ${b}`)
}

// ═══════════════════════════════════════════════════════════════
// B. 风险负样本：通用词/多义词品牌不误豁免（用户「有风险的不收」）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('B. 风险负样本（有风险的不收）')
out.push('═'.repeat(60))

// 注：Mini/Smart 是 TECH_TERM_EXEMPT 既有技术词豁免（单技术词独立节点豁免，
// 与本次汽车品牌改动无关），不做负样本断言。
const NEGATIVE = [
  'Ford', 'Ram', 'Genesis', 'Seat', 'Polestar', 'Lucid',
  'One', 'Auto', 'Tank', 'Ranger', 'Car', 'Fiat',
  'The car stopped', 'Capture every moment', 'Read speed up to 2050MB/s',
]
for (const n of NEGATIVE) {
  assert(isUntranslatable(n, emptyGlossary) === false, `B-不误豁免: ${n}`)
}

// ═══════════════════════════════════════════════════════════════
// C. 遮蔽往返（正文提及品牌 → 遮蔽保留原文）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('C. 遮蔽往返')
out.push('═'.repeat(60))

{
  const identityMap = new Map<string, string>([...BARE_BRANDS, ...MULTI_BRANDS].map(b => [b, b] as [string, string]))
  const src = ['Compatible with Tesla Model 3 and BYD vehicles']
  const masked = maskGlossaryTerms(src, identityMap)
  const cnt = (masked.texts[0].match(/__GLOSSARY_\d+__/g) || []).length
  assert(cnt === 2, 'C-遮蔽: Tesla/BYD 命中 2 占位符', `got ${cnt}: ${masked.texts[0]}`)
  const rt = unmaskGlossaryTerms(masked.texts, masked.termMap)
  assert(rt.texts[0] === src[0], 'C-遮蔽: unmask 同形还原', rt.texts[0])
}

// ═══════════════════════════════════════════════════════════════
// D. 端到端：品牌条目零重试零漏翻
// ═══════════════════════════════════════════════════════════════
const mockCalls: Array<{ body: string }> = []
let responseQueue: string[] = []
function enqueueResponse(c: string) { responseQueue.push(c) }
;(globalThis as Record<string, unknown>).XMLHttpRequest = class {
  status = 200; responseText = ''; timeout = 0
  onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null
  open() {}; setRequestHeader() {}
  send(body?: string) {
    mockCalls.push({ body: body || '' })
    const content = responseQueue.shift() ?? ''
    this.responseText = JSON.stringify({ choices: [{ message: { content } }] })
    setTimeout(() => this.onload && this.onload(), 0)
  }
}
const config: LLMConfig = {
  apiUrl: 'https://mock.local/v1/chat/completions', apiKey: 'test', model: 'test-model',
  translationStyle: '', translationStyleCustom: '', scenePreset: '',
  enableProofread: false, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '',
}

// ═══════════════════════════════════════════════════════════════
// E. 车型代号豁免（v12.60：单字母+数字车型，i6/i8/L6…）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('E. 车型代号豁免（i6/i8/L6/a1…）')
out.push('═'.repeat(60))

const MODEL_CODES = ['i6', 'i8', 'L6', 'L7', 'a1', 'M6', 'L6 / L7 / L8 / L9 / MEGA / i6 / i8']
for (const c of MODEL_CODES) {
  assert(isUntranslatable(c, emptyGlossary) === true, `E-车型豁免: ${c}`)
}
// 风险负样本：裸 "MEGA" 不应豁免（数字型号才豁免；MEGA 是理想 MPV 车型名但裸词形态模糊）
assert(isUntranslatable('MEGA', emptyGlossary) === false, 'E-裸 MEGA 不误豁免')

// ═══════════════════════════════════════════════════════════════
// F. 单位斜杠丢失修复（v12.60：200MB  s → 200MB/s）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('F. 单位斜杠丢失修复')
out.push('═'.repeat(60))

{
  assert(restoreStorageUnitFormatting(['200MB/s'], ['200MB  s'])[0] === '200MB/s', 'F1 斜杠丢失修复: 200MB  s → 200MB/s')
  assert(restoreStorageUnitFormatting(['900MB/s'], ['900 MB/s'])[0] === '900MB/s', 'F2 既有空格修复不回归: 900 MB/s → 900MB/s')
  // 负样本：源文非 /s 单位不误改 "MB s"（保留原文，避免误伤合法词）
  assert(restoreStorageUnitFormatting(['256MB storage'], ['256MB space s'])[0] === '256MB space s', 'F3 源文无 /s 时不误改 MB s')
}

async function main() {
  out.push('')
  out.push('═'.repeat(60))
  out.push('D. 端到端：品牌条目不标漏翻、零重试')
  out.push('═'.repeat(60))

  clearUiLogs()
  mockCalls.length = 0
  responseQueue = []
  // 品牌条目走 S1 短路（LLM 仍会在输入中看到它们并原样回显——真实 LLM 行为），
  // 真实句子走 LLM（返回西语）。isUntranslatable 在检测层把品牌条目豁免，不标漏翻。
  enqueueResponse('{"translations":[{"i":1,"text":"ZEEKR"},{"i":2,"text":"Guarda cada momento"},{"i":3,"text":"Mercedes-Benz"}]}')
  const untranslated = new Set<number>()
  const r = await translateBatch(
    ['ZEEKR', 'Capture every moment', 'Mercedes-Benz'],
    'es', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated)
  assert(r[0] === 'ZEEKR', 'D-1 ZEEKR 短路原文落地', JSON.stringify(r[0]))
  assert(r[1] === 'Guarda cada momento', 'D-2 真实句子正常翻译', JSON.stringify(r[1]))
  assert(r[2] === 'Mercedes-Benz', 'D-3 Mercedes-Benz 短路原文落地', JSON.stringify(r[2]))
  assert(mockCalls.length === 1, 'D-4 品牌条目不触发任何重试（仅 1 次 API）', `实际 ${mockCalls.length}`)
  assert(untranslated.size === 0, 'D-5 零漏翻上报', `got ${[...untranslated]}`)

  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))
  console.log(out.join('\n'))
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })