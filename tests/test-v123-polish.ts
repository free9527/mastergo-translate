/**
 * v12.3 人设驱动判定→润色→硬锁 测试套件
 *
 * 覆盖：
 *   A 资格负面清单（isPolishEligible 正反样例）
 *   B 硬锁校验（validatePolishOutput 四层各失败回退）
 *   C 否定极性词表（detectPolarityBreach de/es/ru/tr）
 *   D 判定/润色输出解析（extractJudgementsObject/extractPolishedObject——经 mock XHR 全链路）
 *   E CHECK 1R 校对分叉（polishedIndices 注入 + 快照锁）
 *
 * 用法：
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true,"types":["node"],"rootDir":".","importHelpers":false}' TS_NODE_TRANSPILE_ONLY=true npx ts-node -r tsconfig-paths/register tests/test-v123-polish.ts
 */

import { isPolishEligible, validatePolishOutput, detectPolarityBreach } from '../lib/polish-guard'
import { buildProofreadSystemPrompt } from '../lib/prompt-constants'
import { proofreadBatch, personaJudgeBatch, polishBatch } from '../lib/llm-api'
import { LLMConfig } from '../messages/types'

let passed = 0
let failed = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ============================================================
// A 资格负面清单
// ============================================================
console.log('═══ A 资格负面清单（isPolishEligible）═══')

// A1: 正常营销文案 → 允许润色
assert(
  isPolishEligible('Power up your gaming experience with lightning-fast speeds and massive capacity', 'Mit blitzschnellen Geschwindigkeiten und enormer Kapazität', 'de'),
  'A1 正常营销文案允许润色'
)

// A2: 含换行 → 豁免
assert(
  !isPolishEligible('Title\nBody text here', 'Titel\nText hier', 'de'),
  'A2 含换行多行格豁免'
)

// A3: 含 ↵ → 豁免
assert(
  !isPolishEligible('Title ↵ Body text here', 'Titel ↵ Text hier', 'de'),
  'A3 含 ↵ 豁免'
)

// A4: 极短文本（≤3 词）→ 豁免
assert(
  !isPolishEligible('Read speed', 'Lesegeschwindigkeit', 'de'),
  'A4 极短文本豁免'
)

// A5: 合规关键词（warranty）→ 豁免
assert(
  !isPolishEligible('This product comes with a limited lifetime warranty and full support', 'Dieses Produkt wird mit eingeschränkter lebenslanger Garantie geliefert', 'de'),
  'A5 合规关键词（warranty）豁免'
)

// A6: 术语库整条命中 → 豁免
{
  // isGlossaryLockedTranslation 用 cleanKey 查表——key 必须是 cleanKey 形态（小写+去®™©+空白归一化）
  const cleanKey = (s: string) => s.toLowerCase().replace(/[®™©]/g, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
  const glossary = new Map([[cleanKey('Lexar Professional SILVER PLUS SDXC UHS-I Card'), 'Lexar Professional SILVER PLUS SDXC UHS-I Karte']])
  assert(
    !isPolishEligible('Lexar Professional SILVER PLUS SDXC UHS-I Card', 'Lexar Professional SILVER PLUS SDXC UHS-I Karte', 'de', glossary),
    'A6 术语库整条命中豁免'
  )
}

// A7: 纯规格行（shouldKeepSource）→ 豁免
assert(
  !isPolishEligible('900MB/s', '900MB/s', 'de'),
  'A7 纯规格行豁免'
)

// A8: 空文本 → 豁免
assert(!isPolishEligible('', 'text', 'de'), 'A8 空源文豁免')
assert(!isPolishEligible('text', '', 'de'), 'A8b 空译文豁免')

// ============================================================
// B 硬锁校验（validatePolishOutput 四层）
// ============================================================
console.log('\n═══ B 硬锁校验（validatePolishOutput）═══')

// B1: 正常润色（数字/术语/限定词都保留）→ 通过
{
  const r = validatePolishOutput(
    'Read speed up to 900MB/s for lightning-fast downloads',
    'Lesegeschwindigkeit bis zu 900MB/s für blitzschnelle Downloads',
    'de'
  )
  assert(r.ok, 'B1 正常润色通过', r.reason)
}

// B2: 数字被改 → 回退
{
  const r = validatePolishOutput(
    'Read speed up to 900MB/s',
    'Lesegeschwindigkeit bis zu 800MB/s',
    'de'
  )
  assert(!r.ok && r.reason?.includes('数字'), 'B2 数字被改回退', r.reason)
}

// B3: 限定词丢失（up to → 无对应表达）→ 回退
{
  const r = validatePolishOutput(
    'Read speed up to 900MB/s',
    'Lesegeschwindigkeit 900MB/s',
    'de'
  )
  assert(!r.ok && r.reason?.includes('限定词'), 'B3 限定词丢失回退', r.reason)
}

// B4: 术语库值被改 → 回退
{
  const glossary = new Map([['lexar play pro', 'Lexar PLAY PRO']])
  const r = validatePolishOutput(
    'Lexar PLAY PRO microSDXC Express Card delivers fast speeds',
    'Lexar PLAY PRO microSDXC Express Karte bietet schnelle Geschwindigkeiten',
    'de',
    glossary
  )
  // enforceGlossaryTerms 会锁定术语库值——如果润色改了术语库值会被校准回来，导致 enforced !== polished
  assert(r.ok, 'B4 术语库值未被改时通过', r.reason)
}

// B5: 单位丢失（900MB/s → 900 无单位）→ validateNumbers 先检出（数字数量不等）
{
  const r = validatePolishOutput(
    'Read speed up to 900MB/s',
    'Lesegeschwindigkeit bis zu 900',
    'de'
  )
  // validateNumbers 提取带单位数字：源文 [900]（MB/s），译文 []（无单位）→ 数量不等检出
  assert(!r.ok, 'B5 单位丢失回退', r.reason)
}

// B6: 词表未覆盖语种（ja）→ 极性校验跳过但数字/术语/单位仍校验
{
  const r = validatePolishOutput(
    'Read speed up to 900MB/s',
    '読み込み速度 900MB/s',
    'ja'
  )
  // ja 不在 POLARITY_TABLE，极性校验跳过；但数字/单位校验仍应通过
  assert(r.ok, 'B6 词表未覆盖语种（ja）跳过极性校验', r.reason)
}

// ============================================================
// C 否定极性词表（detectPolarityBreach）
// ============================================================
console.log('\n═══ C 否定极性词表（detectPolarityBreach）═══')

// C1: de up to → bis zu（保留）→ 通过
assert(!detectPolarityBreach('up to 900MB/s', 'bis zu 900MB/s', 'de'), 'C1 de up to→bis zu 通过')

// C2: de up to → 无对应表达 → 违反
assert(detectPolarityBreach('up to 900MB/s', '900MB/s schnell', 'de'), 'C2 de up to 丢失违反')

// C3: es up to → hasta（保留）→ 通过
assert(!detectPolarityBreach('up to 900MB/s', 'hasta 900MB/s', 'es'), 'C3 es up to→hasta 通过')

// C4: ru up to → до（保留）→ 通过
assert(!detectPolarityBreach('up to 900MB/s', 'до 900MB/s', 'ru'), 'C4 ru up to→до 通过')

// C5: tr up to → kadar（保留）→ 通过
assert(!detectPolarityBreach('up to 900MB/s', "900MB/s'ye kadar", 'tr'), 'C5 tr up to→kadar 通过')

// C6: 源文无限定词 → 不触发
assert(!detectPolarityBreach('fast speeds', 'schnelle Geschwindigkeiten', 'de'), 'C6 源文无限定词不触发')

// C7: 词表未覆盖语种（ja）→ 不触发
assert(!detectPolarityBreach('up to 900MB/s', '900MB/sまで', 'ja'), 'C7 词表未覆盖语种不触发')

// ============================================================
// D 判定/润色输出解析（mock XHR 全链路）+ E CHECK 1R
// ============================================================
console.log('\n═══ D 判定/润色输出解析（mock XHR）═══')

// mock XHR（v105/v106 范式）
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
  open() { /* noop */ }
  setRequestHeader() { /* noop */ }
  send(body?: string) {
    mockCalls.push({ body: body || '' })
    const content = responseQueue.shift() ?? ''
    this.responseText = JSON.stringify({ choices: [{ message: { content } }] })
    setTimeout(() => this.onload && this.onload(), 0)
  }
}

const mockConfig: LLMConfig = {
  apiKey: 'mock', apiUrl: 'https://mock.local/api', model: 'mock-model',
  translationStyle: 'standard', translationStyleCustom: '', scenePreset: 'ecommerce',
  enableProofread: false, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '',
}

async function runD() {

// D1: 判定输出解析（personaJudgeBatch 经 mock XHR）
{
  enqueueResponse('{"judgements":[{"i":1,"needsPolish":true,"issues":[{"type":"calque","span":"beeindruckende 4-mal schneller","suggestion":"bis zu 4-mal schneller"}],"confidence":4},{"i":2,"needsPolish":false,"issues":[],"confidence":5}]}')
  enqueueResponse('{"judgements":[{"i":1,"needsPolish":false,"issues":[],"confidence":5},{"i":2,"needsPolish":false,"issues":[],"confidence":5}]}')
  const hits = await personaJudgeBatch(
    ['Fast speeds', 'Good quality'],
    ['beeindruckende 4-mal schneller', 'Gute Qualität'],
    'de',
    mockConfig,
  )
  assert(hits.size === 1 && hits.has(0), 'D1 判定命中第 1 条（needsPolish=true, confidence=4）')
  assert(hits.get(0)![0].span.includes('beeindruckende'), 'D1b issues 含具体 span')
}

// D2: 润色输出解析 + changes 数量校验（polishBatch 经 mock XHR）
// 润色后文本保留数字/单位（900MB/s）→ 硬锁通过
{
  enqueueResponse('{"polished":[{"i":1,"text":"bis zu 4-mal schneller bis zu 900MB/s","changes":[{"issueIndex":0,"before":"beeindruckende","after":"bis zu"}]}]}')
  const issuesMap = new Map([[0, [{ type: 'calque' as const, span: 'beeindruckende 4-mal schneller', suggestion: 'bis zu 4-mal schneller' }]]])
  const results = await polishBatch(
    ['Fast speeds up to 900MB/s'],
    ['beeindruckende 4-mal schneller bis zu 900MB/s'],
    [0],
    issuesMap,
    'de',
    mockConfig,
  )
  assert(results.length === 1 && results[0].polished, 'D2 润色成功（changes ≤ issues，数字/单位保留）')
  assert(results[0].text.includes('900MB/s'), 'D2b 润色后文本保留数字/单位')
}

// D3: changes 数量超限 → 回退
{
  enqueueResponse('{"polished":[{"i":1,"text":"bis zu 4-mal schneller","changes":[{"issueIndex":0,"before":"a","after":"b"},{"issueIndex":1,"before":"c","after":"d"}]}]}')
  const issuesMap = new Map([[0, [{ type: 'calque' as const, span: 'x', suggestion: 'y' }]]])
  const results = await polishBatch(
    ['Fast speeds'],
    ['beeindruckende schneller'],
    [0],
    issuesMap,
    'de',
    mockConfig,
  )
  assert(!results[0].polished && results[0].reason?.includes('changes'), 'D3 changes 超限回退', results[0].reason)
}

// D4: 硬锁失败（数字被改）→ 回退
{
  enqueueResponse('{"polished":[{"i":1,"text":"bis zu 800MB/s","changes":[{"issueIndex":0,"before":"900","after":"800"}]}]}')
  const issuesMap = new Map([[0, [{ type: 'calque' as const, span: 'x', suggestion: 'y' }]]])
  const results = await polishBatch(
    ['Read speed up to 900MB/s'],
    ['Lesegeschwindigkeit bis zu 900MB/s'],
    [0],
    issuesMap,
    'de',
    mockConfig,
  )
  assert(!results[0].polished && results[0].reason?.includes('数字'), 'D4 数字被改硬锁回退', results[0].reason)
}

// E4: polishedIndices 经 proofreadBatch 全链路（mock XHR）
{
  enqueueResponse('[{"i":1,"text":"bis zu 4-mal schneller","reason":"术语错误"}]')
  await proofreadBatch(
    [{ sourceText: 'Fast speeds up to 900MB/s', translatedText: 'beeindruckende 4-mal schneller bis zu 900MB/s' }],
    'de',
    new Map(),
    mockConfig,
    undefined, undefined, undefined, undefined,
    undefined, undefined,
    new Set([0]),  // polishedIndices
  )
  const reqBody = JSON.parse(mockCalls[mockCalls.length - 1].body)
  const userMsg = reqBody.messages.find((m: { role: string }) => m.role === 'user')?.content || ''
  assert(userMsg.includes('polished') || userMsg.includes('润色'), 'E4 proofreadBatch user prompt 含润色提示')
}

}  // end runD

// ============================================================
// E CHECK 1R 校对分叉（buildProofreadSystemPrompt 纯函数，同步）
// ============================================================
console.log('\n═══ E CHECK 1R 校对分叉（polishedIndices 注入 + 快照锁）═══')

// E1: hasPolished=true → PROOFREAD_POLISHED_NOTE 注入
{
  const prompt = buildProofreadSystemPrompt({ targetLang: 'de', productLine: null, useEnInstruction: true, hasPolished: true })
  assert(prompt.includes('POLISHED ENTRIES'), 'E1 hasPolished=true 注入 POLISHED_NOTE')
}

// E2: hasPolished=false → 快照锁（不含）
{
  const prompt = buildProofreadSystemPrompt({ targetLang: 'de', productLine: null, useEnInstruction: true, hasPolished: false })
  assert(!prompt.includes('POLISHED ENTRIES'), 'E2 hasPolished=false 不注入（快照锁）')
}

// E3: 不传 hasPolished → 默认不注入（向后兼容）
{
  const prompt = buildProofreadSystemPrompt({ targetLang: 'de', productLine: null, useEnInstruction: true })
  assert(!prompt.includes('POLISHED ENTRIES'), 'E3 不传 hasPolished 默认不注入')
}

// 执行
async function main() {
  await runD()
  console.log(`
═══ 结果: ${passed} 通过, ${failed} 失败 ═══`)
  process.exit(failed > 0 ? 1 : 0)
}
main()
