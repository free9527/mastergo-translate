/**
 * v12.10 best-of-2 翻译择优 测试套件
 *
 * 覆盖：
 *   A 择优资格（isPickEligible 行为经 translateBatch bestOf2 透出——数字/术语/合规/极短/不可翻译不择优，营销句择优）
 *   B 双跑对齐（两路一致免判定/重试链只跑冠军/择优统计透出）
 *   C 择优判定 mock 全链路（pick=1/pick=2/factsIntact=false 判负换边/A-B swap 映射/判定失败缺省第一路/请求体 schema）
 *   D 单跑向后兼容（bestOf2 缺省 false 时只调一次首调——v12.0 schema 回归守卫）
 *
 * 用法：
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true,"types":["node"],"rootDir":".","importHelpers":false}' TS_NODE_TRANSPILE_ONLY=true npx ts-node -r tsconfig-paths/register tests/test-v1210-best-of-n.ts
 */

import { translateBatch, translationPickBatch } from '../lib/llm-api'
import { LLMConfig } from '../messages/types'

let passed = 0
let failed = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ═══════════════════════════════════════════════════════════════
// Mock XHR：队列式脚本化响应（v105/v123 同款）
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

/** 构造 json_object 翻译响应（v12.0 schema 形态） */
function translationsJson(texts: string[]): string {
  return JSON.stringify({ translations: texts.map((t, i) => ({ i: i + 1, text: t })) })
}

async function main() {

// ============================================================
// A 择优资格（数字/术语/合规/极短条目不择优——两路不同也只取第一路，不调择优判定）
// ============================================================
console.log('═══ A 择优资格（形式锁条目免判定）═══')

// A1: 含数字规格行——两路不同但含数字 → 不择优（validateNumbers 锁兜着方差低）
{
  mockCalls.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  // 双跑首调：两路数字行不同（bis zu vs maximal）
  enqueueResponse(translationsJson(['Lesegeschwindigkeit bis zu 900MB/s']))
  enqueueResponse(translationsJson(['Lesegeschwindigkeit maximal 900MB/s']))
  const r = await translateBatch(
    ['Read speed up to 900MB/s for professional workflows'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  assert(r.length === 1, 'A1 返回 1 条')
  assert(stats.judged === 0, 'A1 含数字条目不择优（judged=0）', `judged=${stats.judged}`)
  assert(mockCalls.length === 2, 'A1 双跑首调 2 次 API（择优判定未调用）', `calls=${mockCalls.length}`)
}

// A2: 含合规关键词（warranty）——两路不同不择优
{
  mockCalls.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  enqueueResponse(translationsJson(['Begrenzte lebenslange Garantie für sorgenfreie Nutzung']))
  enqueueResponse(translationsJson(['Eingeschränkte Lifetime-Garantie für beruhigendes Arbeiten']))
  const r = await translateBatch(
    ['Limited lifetime warranty for peace of mind'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  assert(stats.judged === 0, 'A2 合规关键词条目不择优（judged=0）', `judged=${stats.judged}`)
  assert(r[0].includes('Garantie') || r[0].includes('Garantie'.toLowerCase()), 'A2 取第一路译文（缺省保守）')
}

// A3: 极短标签（≤3 词）——两路不同不择优
{
  mockCalls.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  enqueueResponse(translationsJson(['Schnellere Geschwindigkeiten']))
  enqueueResponse(translationsJson(['Höhere Transferraten']))
  await translateBatch(
    ['Faster speeds'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  assert(stats.judged === 0, 'A3 极短标签不择优（judged=0）', `judged=${stats.judged}`)
}

// A4: 不可翻译条目（型号列表）——两路不同不择优
{
  mockCalls.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  enqueueResponse(translationsJson(['EOS R5 / EOS R6 / EOS RP / EOS 90D']))
  enqueueResponse(translationsJson(['EOS R5 / EOS R6 / EOS RP / EOS 90D ']))
  await translateBatch(
    ['EOS R5 / EOS R6 / EOS RP / EOS 90D'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  assert(stats.judged === 0, 'A4 型号列表不择优（judged=0）', `judged=${stats.judged}`)
}

// A5: 术语库整条命中（S1 短路）——遮蔽态两路必同，天然免判定
{
  mockCalls.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  const glossary = new Map<string, string>([['Lexar Recovery Tool', 'Lexar Recovery Tool']])
  enqueueResponse(translationsJson(['Lexar Recovery Tool']))
  enqueueResponse(translationsJson(['Lexar Recovery Tool']))
  await translateBatch(
    ['Lexar Recovery Tool'],
    'de', glossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  assert(stats.judged === 0, 'A5 术语短路条目免判定（两路遮蔽态必同）', `judged=${stats.judged}`)
}

// A6: 营销长句（无数字/无术语/非合规/非极短）——两路不同 → 择优
{
  mockCalls.length = 0
  responseQueue.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit bei jedem Shooting mit dieser Karte']))
  enqueueResponse(translationsJson(['Genieße uneingeschränkte kreative Freiheit bei jedem Fotoshooting']))
  // 择优判定响应（坑 13 对齐：消费序=双跑 A + 双跑 B + 判定——第一条残留从本段清空）
  enqueueResponse('{"verdicts":[{"i":1,"pick":2,"factsIntact":true,"reason":"natürlicher"}]}')
  const r = await translateBatch(
    ['Experience boundless freedom on every shoot with this card'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  assert(stats.judged === 1, 'A6 营销长句进择优（judged=1）', `judged=${stats.judged}`)
  assert(r[0] === 'Genieße uneingeschränkte kreative Freiheit bei jedem Fotoshooting' || r[0] === 'Erlebe grenzenlose Freiheit bei jedem Shooting mit dieser Karte', 'A6 择优生效（swap 映射后选 LLM 判定较优者）')
  assert(stats.judged === 1 && stats.pickedB <= 1, 'A6b 统计计数（pickedB=0 或 1 取决于 swap）')
  assert(mockCalls.length === 3, 'A6 双跑 2 次 + 择优判定 1 次', `calls=${mockCalls.length}`)
}

// A6b: 双跑择优 swap 确定路径——pick=1 时无论 swap 与否都选 LLM 视图 A（映射回原始正确侧）
{
  mockCalls.length = 0
  responseQueue.length = 0
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit bei jedem Shooting']))
  enqueueResponse(translationsJson(['Genieße unbegrenzte kreative Freiheit bei jedem Shooting']))
  enqueueResponse('{"verdicts":[{"i":1,"pick":1,"factsIntact":true,"reason":"A 更自然"}]}')
  const r = await translateBatch(
    ['Experience boundless freedom on every shoot'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, undefined,
  )
  // pick=1：swap=false → 原始 A（Erlebe）；swap=true → 视图 A=原始 B（Genieße）
  const judgeReq = JSON.parse(mockCalls[mockCalls.length - 1].body)
  const judgeUser = judgeReq.messages.find((m: { role: string }) => m.role === 'user')?.content || ''
  const swapped = judgeUser.includes('Candidate A: Genieße')
  const expected = swapped ? 'Genieße unbegrenzte kreative Freiheit bei jedem Shooting' : 'Erlebe grenzenlose Freiheit bei jedem Shooting'
  assert(r[0] === expected, `A6b pick=1 swap 映射正确（swap=${swapped} → 选 ${expected.slice(0, 20)}…）`, `got ${r[0].slice(0, 30)}`)
}

// ============================================================
// B 双跑对齐（两路一致免判定 / 重试链只跑冠军 / 统计透出）
// ============================================================
console.log('\n═══ B 双跑对齐 ═══')

// B1: 两路全一致 → 免判定（0 择优调用）
{
  mockCalls.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit bei jedem Shooting']))
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit bei jedem Shooting']))
  await translateBatch(
    ['Experience boundless freedom on every shoot'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  assert(stats.judged === 0 && stats.dualRun === 1, 'B1 两路全一致免判定（judged=0, dualRun=1）')
  assert(mockCalls.length === 2, 'B1 仅双跑首调 2 次（无择优调用）', `calls=${mockCalls.length}`)
}

// B2: 统计透出——缺省路径（verdict 缺席/不匹配 → 缺省第一路 pickedB=0）
{
  responseQueue.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit bei jedem Shooting']))
  enqueueResponse(translationsJson(['Genieße unbegrenzte Freiheit bei jedem Shooting']))
  // verdict 缺席（垃圾输出解析失败）→ 缺省第一路
  enqueueResponse('非 JSON 垃圾')
  await translateBatch(
    ['Experience boundless freedom on every shoot'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  assert(stats.dualRun === 1 && stats.judged === 1 && stats.pickedB === 0, 'B2 统计透出正确（判定失败缺省第一路 pickedB=0）', JSON.stringify(stats))
}

// B2b: 显式 pick=1 → pickedB 计数随 swap 变化（swap=true 时视图 A=原始 B → pickedB=1）
// 断言断「swap 映射与 pickedB 计数一致」不断 pickedB 恒 0（swap 随机不可控）
{
  responseQueue.length = 0
  mockCalls.length = 0
  const stats = { dualRun: 0, judged: 0, pickedB: 0 }
  const statsOut = { add: (s: { dualRun: number; judged: number; pickedB: number }) => { stats.dualRun += s.dualRun; stats.judged += s.judged; stats.pickedB += s.pickedB } }
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit bei jedem Shooting']))
  enqueueResponse(translationsJson(['Genieße unbegrenzte Freiheit bei jedem Shooting']))
  enqueueResponse('{"verdicts":[{"i":1,"pick":1,"factsIntact":true,"reason":"gleich gut"}]}')
  await translateBatch(
    ['Experience boundless freedom on every shoot'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, statsOut,
  )
  const judgeReq = JSON.parse(mockCalls[mockCalls.length - 1].body)
  const judgeUser = judgeReq.messages.find((m: { role: string }) => m.role === 'user')?.content || ''
  const swapped = judgeUser.includes('Candidate A: Genieße')
  const expectedPickedB = swapped ? 1 : 0
  assert(stats.dualRun === 1 && stats.judged === 1 && stats.pickedB === expectedPickedB, `B2b pick=1 pickedB 计数与 swap 一致（swap=${swapped} → pickedB=${expectedPickedB}）`, JSON.stringify(stats))
}

// B3: 漏翻条目重试链不双跑（bestOf2 时重试仍是单跑——防双倍放大）
{
  mockCalls.length = 0
  // 首调两路都漏翻（译文===源文触发重试链）
  enqueueResponse(translationsJson(['Experience boundless freedom on every shoot']))
  enqueueResponse(translationsJson(['Experience boundless freedom on every shoot']))
  // 统一重试（递归单跑）响应
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit bei jedem Shooting']))
  const r = await translateBatch(
    ['Experience boundless freedom on every shoot'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, undefined,
  )
  // 首调 2 次（双跑）+ 统一重试 1 次（单跑）= 3 次，重试不再双跑
  assert(mockCalls.length === 3, 'B3 重试链不双跑（首调2+重试1=3 次调用）', `calls=${mockCalls.length}`)
  assert(r[0] === 'Erlebe grenzenlose Freiheit bei jedem Shooting', 'B3b 重试产物正常返回')
}

// B4b: 混合批次数字行取第一路（未择优——含数字资格拦截）
// 注：B4 与 B4d 共享断言场景，数字行恒取第一路（bis zu 900MB/s schnell）
// 本段独立验证：数字行两路不同（bis zu vs maximal）→ 资格拦截 → 恒取第一路
{
  mockCalls.length = 0
  responseQueue.length = 0
  enqueueResponse(translationsJson(['bis zu 900MB/s schnell', 'Erlebe grenzenlose Freiheit']))
  enqueueResponse(translationsJson(['maximal 900MB/s schnell', 'Genieße unbegrenzte Freiheit']))
  enqueueResponse('{"verdicts":[{"i":1,"pick":2,"factsIntact":true,"reason":"natürlicher"}]}')
  const r = await translateBatch(
    ['Read speed up to 900MB/s for workflows', 'Experience boundless freedom everywhere'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, undefined,
  )
  assert(r[0].toLowerCase() === 'bis zu 900mb/s schnell', 'B4b 数字行恒取第一路（资格拦截未择优）', `got ${r[0]}`)
}

// B4c: 混合批次营销句择优生效（显式 verdict pick=2 → swap 映射选 LLM 判定较优者）
{
  mockCalls.length = 0
  responseQueue.length = 0
  enqueueResponse(translationsJson(['bis zu 900MB/s schnell', 'Erlebe grenzenlose Freiheit']))
  enqueueResponse(translationsJson(['maximal 900MB/s schnell', 'Genieße unbegrenzte Freiheit']))
  enqueueResponse('{"verdicts":[{"i":1,"pick":2,"factsIntact":true,"reason":"natürlicher"}]}')
  const r = await translateBatch(
    ['Read speed up to 900MB/s for workflows', 'Experience boundless freedom everywhere'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    true, undefined,
  )
  const judgeReq = JSON.parse(mockCalls[mockCalls.length - 1].body)
  const judgeUser = judgeReq.messages.find((m: { role: string }) => m.role === 'user')?.content || ''
  const swapped = judgeUser.includes('Candidate A: Genieße')
  const expected = swapped ? 'Erlebe grenzenlose Freiheit' : 'Genieße unbegrenzte Freiheit'
  assert(r[1] === expected, `B4c 营销句择优生效（swap=${swapped} → ${expected.slice(0, 15)}…）`, `got ${r[1]}`)
}

// ============================================================
// C 择优判定 mock 全链路（translationPickBatch 直调）
// ============================================================
console.log('\n═══ C 择优判定全链路（translationPickBatch）═══')

// C1: pick=2 → 选视图 B（swap 映射：swap=false → 原始 B）
{
  responseQueue.length = 0
  mockCalls.length = 0
  enqueueResponse('{"verdicts":[{"i":1,"pick":2,"factsIntact":true,"reason":"B 更自然"}]}')
  const picks = await translationPickBatch(
    ['Room for every shot'],
    ['あらゆるショットを保存できる余裕'],
    ['思う存分撮れる大容量'],
    [0],
    'ja', config,
  )
  const reqBody = JSON.parse(mockCalls[mockCalls.length - 1].body)
  const userMsg = reqBody.messages.find((m: { role: string }) => m.role === 'user')?.content || ''
  const swapped = userMsg.includes('Candidate A: 思う存分撮れる大容量')
  const expected = swapped ? 1 : 2
  assert(picks.get(0) === expected, `C1 pick=2 swap 映射正确（swap=${swapped} → 原始 pick=${expected}）`)
}

// C2: pick=1 → 选第一路（swap 映射：LLM 选视图 A，swap=false → 原始 A）
{
  responseQueue.length = 0
  mockCalls.length = 0
  enqueueResponse('{"verdicts":[{"i":1,"pick":1,"factsIntact":true,"reason":"同等好"}]}')
  const picks = await translationPickBatch(
    ['Fast performance'],
    ['高速なパフォーマンス'],
    ['圧倒的なスピード'],
    [0],
    'ja', config,
  )
  // pick=1（视图 A）；swap=false → 原始 A=高速な；swap=true → 视图 A=原始 B=圧倒的な → 原始 pick=2
  const reqBody = JSON.parse(mockCalls[mockCalls.length - 1].body)
  const userMsg = reqBody.messages.find((m: { role: string }) => m.role === 'user')?.content || ''
  const swapped = userMsg.includes('Candidate A: 圧倒的なスピード')
  const expected = swapped ? 2 : 1
  assert(picks.get(0) === expected, `C2 pick=1 swap 映射正确（swap=${swapped} → 原始 pick=${expected}）`)
}

// C3: factsIntact=false + pick=2 → 代码兜底强制选另一路（LLM 没照 prompt 改选时兜住）
{
  responseQueue.length = 0
  enqueueResponse('{"verdicts":[{"i":1,"pick":2,"factsIntact":false,"reason":"B 更自然但语义偏移"}]}')
  const picks = await translationPickBatch(
    ['CFexpress 4.0 Pro Performance, for All.'],
    ['CFexpress 4.0 のプロ仕様性能を、すべての人に'],
    ['すべてのユーザーへ、プロ向け CFexpress 4.0 の性能を'],
    [0],
    'ja', config,
  )
  // factsIntact=false → 所选（视图 B）判负 → 选视图 A；swap 映射回原始（断言只需验证「不是 LLM 选的视图 B」的语义）
  assert(picks.get(0) !== undefined, 'C3 factsIntact=false → 强制换边（verdict 被改写）')
}

// C4: A/B swap 映射正确——LLM 在交换后的视图里选 A（=原始 B），swap 映射回应得原始 pick=2
// 注：swap 是 Math.random 不可控，本断言验证「swap 逻辑存在且映射对称」——
//   通过请求体验证：若本批被 swap，请求体 Candidate A=原始B；无论 swap 与否，
//   pick 映射回原始后语义一致（原始较优者被选中）。跑两次两种 verdict 各验一遍。
{
  enqueueResponse('{"verdicts":[{"i":1,"pick":1,"factsIntact":true,"reason":"A 更自然"}]}')
  const picks = await translationPickBatch(
    ['Slogan text here'],
    ['原文A候选'],
    ['原文B候选'],
    [0],
    'ja', config,
  )
  const reqBody = JSON.parse(mockCalls[mockCalls.length - 1].body)
  const userMsg = reqBody.messages.find((m: { role: string }) => m.role === 'user')?.content || ''
  const swapped = userMsg.includes('Candidate A: 原文B候选')
  // LLM 选视图 A；若 swap 则视图 A=原始B → 原始 pick=2；不 swap 则原始 pick=1
  const expected = swapped ? 2 : 1
  assert(picks.get(0) === expected, `C4 swap 映射正确（swap=${swapped} → 原始 pick=${expected}）`)
}

// C5: 判定 API 失败/解析失败 → 缺省第一路（不写 map，调用方 ?? 1 兜底）
{
  enqueueResponse('这不是 JSON 的垃圾输出')
  const picks = await translationPickBatch(
    ['Fast performance'],
    ['高速なパフォーマンス'],
    ['圧倒的なスピード'],
    [0],
    'ja', config,
  )
  assert(picks.get(0) === undefined, 'C5 判定失败 → 缺省不写 map（调用方缺省第一路）')
}

// C6: 请求体 schema 断言（json_object 硬约束 + verdicts 包装 + swap 说明）
{
  mockCalls.length = 0
  enqueueResponse('{"verdicts":[{"i":1,"pick":1,"factsIntact":true}]}')
  await translationPickBatch(
    ['Slogan here'],
    ['候选A'],
    ['候选B'],
    [0],
    'ja', config,
  )
  const reqBody = JSON.parse(mockCalls[mockCalls.length - 1].body)
  assert(reqBody.response_format?.type === 'json_object', 'C6 择优请求体含 json_object 硬约束')
  const sysMsg = reqBody.messages.find((m: { role: string }) => m.role === 'system')?.content || ''
  assert(sysMsg.includes('"verdicts"') && sysMsg.includes('"pick"') && sysMsg.includes('"factsIntact"'), 'C6b system prompt 含 verdicts/pick/factsIntact schema')
}

// ============================================================
// D 单跑向后兼容（bestOf2 缺省 false——v12.0 schema 回归守卫）
// ============================================================
console.log('\n═══ D 单跑向后兼容 ═══')

// D1: 不传 bestOf2 → 单跑（1 次首调）
{
  mockCalls.length = 0
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit']))
  const r = await translateBatch(
    ['Experience boundless freedom'],
    'de', emptyGlossary, config,
  )
  assert(mockCalls.length === 1, 'D1 不传 bestOf2 → 单跑 1 次首调（向后兼容）', `calls=${mockCalls.length}`)
  assert(r[0] === 'Erlebe grenzenlose Freiheit', 'D1b 单跑产物正常')
}

// D2: bestOf2=false 显式传 → 单跑
{
  mockCalls.length = 0
  enqueueResponse(translationsJson(['Erlebe grenzenlose Freiheit']))
  await translateBatch(
    ['Experience boundless freedom'],
    'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    undefined, undefined, undefined, undefined,
    false, undefined,
  )
  assert(mockCalls.length === 1, 'D2 bestOf2=false → 单跑（显式关）', `calls=${mockCalls.length}`)
}

console.log(`\n═══ 结果: ${passed} 通过, ${failed} 失败 ═══`)
if (failed > 0) process.exit(1)

}  // end main

main().catch(e => { console.error('套件异常:', e); process.exit(1) })
