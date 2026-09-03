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
import { proofreadBatch, personaJudgeBatch, polishBatch, polishVerifyBatch } from '../lib/llm-api'
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

// B6: ja（v12.6 已入词表）→ 极性校验生效：up to 限定词保留时数字/术语/单位/极性全通过
{
  const r = validatePolishOutput(
    'Read speed up to 900MB/s',
    '読み込み速度 最大900MB/s',
    'ja'
  )
  assert(r.ok, 'B6 ja up to→最大 保留极性全通过', r.reason)
}

// B7: ja 限定词丢失 → 极性校验一票否决回退（v12.6 新增）
{
  const r = validatePolishOutput(
    'Read speed up to 900MB/s',
    '読み込み速度 900MB/s',
    'ja'
  )
  assert(!r.ok, 'B7 ja up to 丢失极性回退', r.reason)
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

// C7: ja up to → まで（保留）→ 通过（v12.6 ja 已入词表）
assert(!detectPolarityBreach('up to 900MB/s', '900MB/sまで', 'ja'), 'C7 ja up to→まで 通过')

// C7b: ja up to → 无任何限定表达 → 违反（v12.6 新增）
assert(detectPolarityBreach('up to 900MB/s', '900MB/s高速', 'ja'), 'C7b ja up to 丢失违反')

// C7c: ja compatible with → 互換（保留）→ 通过（v12.6 新增）
assert(!detectPolarityBreach('compatible with Intel XMP 3.0', 'Intel XMP 3.0と互換', 'ja'), 'C7c ja compatible with→互換 通过')

// C7d: ja under → 以下（保留）→ 通过（v12.6 新增）
assert(!detectPolarityBreach('under 30ms', '30ms以下', 'ja'), 'C7d ja under→以下 通过')

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

// D2c: v12.12 按段润色——语义断行保留（拼回 ' ↵ ' 形态）+ 段独立润色
// 源文语义断行（标题 4 词 ≤5 → 语义断行），段2（8 词正文）润色生效、段1 标题不润（极短段 v12.7 规则）
{
  enqueueResponse('{"polished":[{"i":1,"text":"Performansı en üst düzeye çıkarır","changes":[{"issueIndex":0,"before":"c","after":"d"}]}]}')
  const issuesMap = new Map([[0, [
    { type: 'calque' as const, span: 'Performance', suggestion: 'Performans' },
  ]]])
  const results = await polishBatch(
    ['Take It Higher ↵ Performance for the next level of your game'],
    ['Bir Üst Seviye ↵ Performans bir sonraki seviyeye taşır'],
    [0],
    issuesMap,
    'tr',
    mockConfig,
  )
  assert(results[0].polished && results[0].text.includes(' ↵ '), 'D2c 按段润色：语义断行保留（拼回 ↵ 形态）', JSON.stringify(results[0].text))
  assert(results[0].text.split(' ↵ ').length === 2, 'D2c2 按段润色：段数不变（2 段）')
  assert(results[0].text.startsWith('Bir Üst Seviye ↵ '), 'D2c3 极短标题段不润（原译文段保留）')
  assert(results[0].text.includes('Performansı en üst düzeye çıkarır'), 'D2c4 正文段润色生效（LLM 输出写入）')
}

// D2d: v12.12 段数不等 → 整格不润（源文 1 语义段 vs 译文 2 段——tr 短左段被 lenient 误判段边界，
// 对位关系丢失时保守整格不润，结构对齐问题让校对管）
{
  const issuesMap = new Map([[0, [{ type: 'calque' as const, span: 'performance', suggestion: 'performans' }]]])
  const results = await polishBatch(
    ['Take your gaming performance to the ↵ Next Level'],
    ['Oyun performansınızı bir üst ↵ seviyeye taşıyın'],
    [0],
    issuesMap,
    'tr',
    mockConfig,
  )
  assert(!results[0].polished && (results[0].reason || '').includes('段数不等'), 'D2d 段数不等 → 整格不润（保守）', results[0].reason)
  assert(results[0].text.includes('↵'), 'D2d2 整格不润时译文原样保留（含 ↵）')
}

// D3: changes 数量超限 → 回退
{
  enqueueResponse('{"polished":[{"i":1,"text":"bis zu 4-mal schneller","changes":[{"issueIndex":0,"before":"a","after":"b"},{"issueIndex":1,"before":"c","after":"d"}]}]}')
  const issuesMap = new Map([[0, [{ type: 'calque' as const, span: 'Fast', suggestion: 'schneller' }]]])
  const results = await polishBatch(
    ['Fast speeds for gaming'],
    ['beeindruckende schneller Gaming'],
    [0],
    issuesMap,
    'de',
    mockConfig,
  )
  assert(!results[0].polished && (results[0].reason?.includes('changes') || results[0].reason?.includes('段')), 'D3 changes 超限回退', results[0].reason)
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

// D5: 二次判定 factsIntact=false（事实偏移）→ improved 强制 false + 索引透出（v12.10）
// 实锤案例：プロ仕様性能→プロ向け 语义偏移，旧版 verify 只问自然度会放行
{
  enqueueResponse('{"verdicts":[{"i":1,"improved":true,"factsIntact":false,"reason":"プロ向けに意味が変わっている"}]}')
  const factsBreach = new Set<number>()
  const verdicts = await polishVerifyBatch(
    ['CFexpress 4.0 Pro Performance, for All.'],
    ['すべてのユーザーに CFexpress 4.0 のプロ仕様性能を'],
    ['すべてのユーザーへ、プロ向け CFexpress 4.0 の性能を'],
    'ja',
    mockConfig,
    null,
    factsBreach,
  )
  assert(verdicts.get(0) === false, 'D5 factsIntact=false → improved 强制 false（事实偏移一票否决）')
  assert(factsBreach.has(0), 'D5b factsBreachIndices 透出偏移索引（日志区分用）')
}

// D6: 二次判定旧格式（无 factsIntact 字段）→ 缺省 true 放行（向后兼容）
{
  enqueueResponse('{"verdicts":[{"i":1,"improved":true,"reason":"より自然"}]}')
  const verdicts = await polishVerifyBatch(
    ['Fast performance'],
    ['高速なパフォーマンス'],
    ['圧倒的に速いパフォーマンス'],
    'ja',
    mockConfig,
  )
  assert(verdicts.get(0) === true, 'D6 旧格式无 factsIntact → 缺省放行（improved=true 生效）')
}

// D7: 二次判定 improved=true + factsIntact=true → 放行（正常改善路径）
{
  enqueueResponse('{"verdicts":[{"i":1,"improved":true,"factsIntact":true,"reason":"自然で事実も保持"}]}')
  const factsBreach = new Set<number>()
  const verdicts = await polishVerifyBatch(
    ['Room for every shot'],
    ['あらゆるショットを保存できる余裕'],
    ['思う存分撮れる大容量'],
    'ja',
    mockConfig,
    null,
    factsBreach,
  )
  assert(verdicts.get(0) === true, 'D7 improved=true + factsIntact=true → 放行')
  assert(!factsBreach.has(0), 'D7b factsIntact=true 不进 breach 集合')
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

// E4: ja → JA_LAYOUT_NOTE 注入（v12.6 母语调研改行/排版实锤）
{
  const prompt = buildProofreadSystemPrompt({ targetLang: 'ja', productLine: null, useEnInstruction: false })
  assert(prompt.includes('JA 排版自然度'), 'E4 ja 注入 JA_LAYOUT_NOTE')
}

// E5: 非 ja（de）→ JA_LAYOUT_NOTE 不注入（条件注入死文本纪律）
{
  const prompt = buildProofreadSystemPrompt({ targetLang: 'de', productLine: null, useEnInstruction: true })
  assert(!prompt.includes('JA 排版自然度'), 'E5 de 不注入 JA_LAYOUT_NOTE')
}

// 执行
async function main() {
  await runD()
  console.log(`
═══ 结果: ${passed} 通过, ${failed} 失败 ═══`)
  process.exit(failed > 0 ? 1 : 0)
}
main()
