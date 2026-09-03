// ============================================================
// v12.13 翻译记忆（TM few-shot）+ deprecated 术语标记 测试套件
// ============================================================
// 覆盖：
//   A tmSimilarity 相似度判定（词级 Jaccard / 数字集合防线 / CJK bigram / 泰文）
//   B retrieveTM 过滤链（user-only / proofread 拒 / targetLang 不匹配拒 /
//     数字集合不等拒 / 相似度阈值 / ≤2 条上限 / 极短不检索 / 同源去重）
//   C translateBatch 注入（TM 非空替换静态 few-shot / 空时保持现状 /
//     forceTranslate 不注入 / 不传参数快照锁）
//   D deprecated 术语标记（CSV 解析 / 序列化往返 / buildGlossaryMaps 不注册）
//
// 用法：
//   npx tsx tests/test-v1213-translation-memory.ts
// ============================================================

// Node.js 环境注意：本文件 C 段用「队列式 mock XHR」替换全局 XMLHttpRequest——
// 不 import xhr2 polyfill（v123 套件同款；fetchWithRetry 只要求全局构造器存在即可被替换）

import { tmSimilarity, retrieveTM, MAX_TM_PER_BATCH } from '../lib/translation-memory'
import { parseGlossaryCSVText, serializeGlossaryCSV } from '../lib/parse-csv'
import { translateBatch } from '../lib/llm-api'
import { TranslationCorrection, LLMConfig } from '../messages/types'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

function mkCorr(source: string, target: string, origin: 'user' | 'proofread' = 'user', targetLang = 'de'): TranslationCorrection {
  return { source, targetLang, originalTranslation: target + '-orig', correctedTranslation: target, correctedAt: Date.now(), origin }
}

// ────────────────────────────────────────────────────────────
console.log('\nA. tmSimilarity 相似度判定')

// A1 同句（真实场景——历史人工修过的源文再次出现，sim=1.0）
assert(tmSimilarity('Up to 1050MB/s read speed for gaming', 'Up to 1050MB/s read speed for gaming') === 1, 'A1 同句 → 1.0（真实命中场景）')
// A1b 一词之差不达 0.9 阈值（词级 Jaccard 对换词场景天然收紧——保守方向防锚错句）
assert(tmSimilarity('Up to 1050MB/s read speed for gaming', 'Up to 1050MB/s read speed for your gaming session') < 0.9, 'A1b 一词之差 <0.9（保守防锚错）')
// A2 完全不同
assert(tmSimilarity('Up to 1050MB/s read speed', 'Wireless controller with Bluetooth') < 0.5, 'A2 完全不同 <0.5')
// A3 数字集合不等 → 0（规格错位防线：up to 2TB 绝不锚 up to 4TB）
assert(tmSimilarity('Up to 2TB capacity for all your games', 'Up to 4TB capacity for all your games') === 0, 'A3 数字不等 → 0（规格错位防线）')
// A4 数字集合相等但位置不同（数字防线不误伤）
assert(tmSimilarity('Read speed 1050MB/s and write 1000MB/s', 'Write 1000MB/s and read speed 1050MB/s') > 0.5, 'A4 数字集合相等（顺序不同）不拦截')
// A5 CJK bigram（无空格分词自适应）
assert(tmSimilarity('读取速度高达1050MB/s体验流畅游戏', '读取速度高达1050MB/s体验更流畅游戏') > 0.8, 'A5 CJK bigram 高相似')
// A6 泰文 bigram
assert(tmSimilarity('ความเร็วสูงสุด1050เมกะไบต์ต่อวินาที', 'ความเร็วสูงสุด1050เมกะไบต์ต่อวินาทีเลย') > 0.8, 'A6 泰文 bigram 高相似')
// A7 空串
assert(tmSimilarity('', 'anything here now') === 0, 'A7 空串 → 0')

// ────────────────────────────────────────────────────────────
console.log('\nB. retrieveTM 过滤链')

const texts = ['Up to 1050MB/s read speed for gaming', 'Something completely different here now']

// B1 正常命中（user 源 + targetLang 匹配 + 高相似）
{
  const corrs = [mkCorr('Up to 1050MB/s read speed for gaming', 'Bis zu 1050MB/s Lesegeschwindigkeit')]
  const r = retrieveTM(texts, corrs, 'de')
  assert(r.length === 1 && r[0].target === 'Bis zu 1050MB/s Lesegeschwindigkeit', 'B1 user 源同句命中（真实场景——历史人工修过的源文再次出现，sim=1.0）')
}
// B2 proofread 源 → 拒（收窄裁决：LLM 产物非人工背书）
{
  const corrs = [mkCorr('Up to 1050MB/s read speed for gaming', 'Bis zu 1050MB/s', 'proofread')]
  assert(retrieveTM(texts, corrs, 'de').length === 0, 'B2 proofread 源拒绝')
}
// B3 targetLang 不匹配 → 拒
{
  const corrs = [mkCorr('Up to 1050MB/s read speed for gaming', 'Bis zu 1050MB/s', 'user', 'fr')]
  assert(retrieveTM(texts, corrs, 'de').length === 0, 'B3 targetLang 不匹配拒绝')
}
// B4 数字集合不等 → 拒（规格错位防线端到端）
{
  const corrs = [mkCorr('Up to 4TB capacity for all your games and saves', 'Bis zu 4TB')]
  assert(retrieveTM(['Up to 2TB capacity for all your games and saves'], corrs, 'de').length === 0, 'B4 数字不等拒绝（2TB≠4TB）')
}
// B5 相似度低于阈值 → 拒
{
  const corrs = [mkCorr('Portable SSD with USB 3.2 Gen 2 interface inside', 'Tragbare SSD')]
  assert(retrieveTM(texts, corrs, 'de').length === 0, 'B5 低相似拒绝')
}
// B6 ≤MAX_TM_PER_BATCH 上限
{
  const corrs = [
    mkCorr('Up to 1050MB/s read speed for gaming', 'T1'),
    mkCorr('Something completely different here now', 'T2'),
    mkCorr('Massive capacity for all your games library', 'T3'),
    mkCorr('Extra storage space for every gaming need', 'T4'),
  ]
  const r = retrieveTM([...texts, 'Massive capacity for all your games library', 'Extra storage space for every gaming need'], corrs, 'de')
  assert(r.length === MAX_TM_PER_BATCH, `B6 上限 ${MAX_TM_PER_BATCH} 条（实际 ${r.length}）`)
}
// B7 极短源文不检索
{
  const corrs = [mkCorr('Read speed', 'Lesegeschwindigkeit')]
  assert(retrieveTM(['Read speed'], corrs, 'de').length === 0, 'B7 极短源文不检索（correction 侧 <15 字符）')
}
// B8 同源去重（同一句多次修正只注入一条——取最新相似度最高）
{
  const corrs = [
    mkCorr('Up to 1050MB/s read speed for gaming', 'TV1'),
    mkCorr('Up to 1050MB/s read speed for gaming', 'TV2'),
  ]
  const r = retrieveTM(texts, corrs, 'de')
  assert(r.length === 1, 'B8 同源去重（同 source 只一条）')
}
// B9 空 correctedTranslation → 拒
{
  const corrs = [mkCorr('Up to 1050MB/s read speed for gaming', '')]
  assert(retrieveTM(texts, corrs, 'de').length === 0, 'B9 空译文拒绝')
}
// B10 缺省 origin 按 user 兼容（旧记录无 origin 字段）
{
  const c = mkCorr('Up to 1050MB/s read speed for gaming', 'Legacy')
  delete (c as Partial<TranslationCorrection>).origin
  assert(retrieveTM(texts, [c], 'de').length === 1, 'B10 缺省 origin 按 user 兼容')
}

// ────────────────────────────────────────────────────────────
console.log('\nC. translateBatch 注入（mock XHR）')

async function runC() {

// mock XHR（v105/v106/v123 范式——队列式）
const mockCalls: Array<{ body: string }> = []
const responseQueue: string[] = []
;(globalThis as any).XMLHttpRequest = class {
  status = 200; responseText = ''; timeout = 0
  onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null
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

const okResponse = '{"translations":[{"i":1,"text":"OK"}]}'

// mock 管道注意（坑 13 队列纪律）：'OK' 译文与源文不同 → 触发统一重试（第二次 XHR），
// mockCalls[last] 是重试调用（forceTranslate=true，TM 本来就不注入——C3 行为）。
// C1/C2/C4 断言首调用（mockCalls[0]）；C3 传 forceTranslate=true 首次即重试形态，同样取 [0]。

// C1 TM 非空 → 替换静态 few-shot（含参考译文块，不含静态 [EXAMPLES]）
{
  responseQueue.push(okResponse)
  responseQueue.push(okResponse)  // 统一重试占位（'OK'≠源文触发重试，防队列错位）
  await translateBatch(['Up to 1050MB/s read speed for gaming'], 'de', new Map(), mockConfig,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    new Set(), new Set(), new Set(), new Set(), false, undefined,
    [{ source: 'Up to 1050MB/s read speed for gaming', target: 'Bis zu 1050MB/s Lesegeschwindigkeit für Ihre Gaming-Sessions' }])
  const sys = JSON.parse(mockCalls[0].body).messages.find((m: { role: string }) => m.role === 'system').content
  assert(sys.includes('validated past translations') && sys.includes('Bis zu 1050MB/s'), 'C1 TM 非空注入（参考译文块进首调 system prompt）')
  assert(!sys.includes('[EXAMPLES]\n'), 'C1b TM 替换静态 few-shot（静态块被顶掉）')
}

// C2 TM 空 → 静态 few-shot 保持现状（快照锁）
{
  responseQueue.push(okResponse)
  responseQueue.push(okResponse)  // 统一重试占位
  await translateBatch(['Up to 1050MB/s read speed for gaming'], 'de', new Map(), mockConfig,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    new Set(), new Set(), new Set(), new Set(), false, undefined)
  const sys = JSON.parse(mockCalls[2].body).messages.find((m: { role: string }) => m.role === 'system').content  // C2 段首（C1 占 [0][1]）
  assert(!sys.includes('validated past translations'), 'C2 TM 空 → 无参考译文块（快照锁）')
  assert(sys.includes('[EXAMPLES]'), 'C2b 静态 few-shot 保留')
}

// C3 forceTranslate=true → TM 不注入（重试层不叠加）
{
  responseQueue.push(okResponse)
  await translateBatch(['Up to 1050MB/s read speed for gaming'], 'de', new Map(), mockConfig,
    undefined, undefined, undefined, undefined, undefined, undefined, false, true, undefined,
    new Set(), new Set(), new Set(), new Set(), false, undefined,
    [{ source: 'Up to 1050MB/s read speed for gaming', target: 'X' }])
  const sys = JSON.parse(mockCalls[4].body).messages.find((m: { role: string }) => m.role === 'system').content  // C3 段首（C1/C2 各占 2 次）
  assert(!sys.includes('validated past translations'), 'C3 forceTranslate → TM 不注入')
}

// C4 中文指令目标 → 中文参考块
{
  responseQueue.push(okResponse)
  responseQueue.push(okResponse)  // 统一重试占位
  await translateBatch(['Up to 1050MB/s read speed for gaming'], 'ja', new Map(), mockConfig,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined,
    new Set(), new Set(), new Set(), new Set(), false, undefined,
    [{ source: 'Up to 1050MB/s read speed for gaming', target: '最大1050MB/sの読み出し速度' }])
  const sys = JSON.parse(mockCalls[6].body).messages.find((m: { role: string }) => m.role === 'system').content  // C4 段首（C1-C3 占 [0-5]，C4 首调 [6]）
  assert(sys.includes('人工验收'), 'C4 CJK 目标 → 中文参考块（中文指令路由——与 C1 英文块互补证明指令语言路由）')
}

}  // end runC

// ────────────────────────────────────────────────────────────
console.log('\nD. deprecated 术语标记')

async function main() {
  await runC()

const VALID = new Set(['zh-CN', 'de', 'en'])

// D1 CSV 解析 deprecated 列
{
  const csv = 'source,zh-CN,de,en,deprecated\nFoo Bar,福,Foo DE,Foo,yes\nBar Baz,吧,Bar DE,Bar,\n'
  const entries = parseGlossaryCSVText(csv, VALID)
  assert(entries.length === 2 && entries[0].deprecated === true && entries[1].deprecated === undefined, 'D1 deprecated 列解析（yes→true，空→缺省）')
}
// D2 无 deprecated 列 → 全部缺省（向后兼容）
{
  const csv = 'source,zh-CN,de,en\nFoo Bar,福,Foo DE,Foo\n'
  const entries = parseGlossaryCSVText(csv, VALID)
  assert(entries.length === 1 && entries[0].deprecated === undefined, 'D2 无列向后兼容')
}
// D3 序列化往返（deprecated 列保留）
{
  const csv = 'source,zh-CN,de,en,deprecated\nFoo Bar,福,Foo DE,Foo,yes\nBar Baz,吧,Bar DE,Bar,\n'
  const entries = parseGlossaryCSVText(csv, VALID)
  const out = serializeGlossaryCSV(entries, ['zh-CN', 'de', 'en'])
  const re = parseGlossaryCSVText(out, VALID)
  assert(out.includes('deprecated') && re[0].deprecated === true && re[1].deprecated === undefined, 'D3 序列化往返保留')
}
// D4 全库无 deprecated → 序列化不输出列（干净 CSV）
{
  const entries = [{ source: 'Foo', translations: { de: 'Foo DE' } }]
  assert(!serializeGlossaryCSV(entries, ['de']).includes('deprecated'), 'D4 无废弃不输出列')
}
}  // end main

// ────────────────────────────────────────────────────────────
main().then(() => {
  console.log(`\n═══════════════════════════════════════════`)
  console.log(`v12.13 结果: ${pass} 通过 / ${fail} 失败`)
  if (fail > 0) process.exit(1)
})
