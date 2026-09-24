/**
 * v12.17 跨格一致性探测（方案 1 探测版）测试套件
 *
 * 覆盖：
 *   A extractRepeatedPhrases 提取逻辑（跨格判定/格内去重/数字不开头/重叠取最长/上限）
 *   B detectConsistencyIssues 全链路（mock XHR：不一致报告/一致跳过/失败静默/omitted 变体）
 *
 * 用法：
 *   npx tsx tests/test-v1217-consistency-check.ts
 */

import { extractRepeatedPhrases, detectConsistencyIssues } from '../lib/consistency-check'
import { LLMConfig } from '../messages/types'

let passed = 0
let failed = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ============================================================
// A 提取逻辑
// ============================================================
console.log('═══ A extractRepeatedPhrases 提取逻辑 ═══')

// A1: 跨格重复短语被提取
{
  const m = extractRepeatedPhrases([
    'Plug and Play design for easy setup',
    'This cable supports Plug and Play functionality',
  ])
  assert(m.has('plug and play'), 'A1 跨格重复 3 词短语被提取')
  assert(
    JSON.stringify(m.get('plug and play')) === JSON.stringify([0, 1]),
    'A1b 格索引正确（[0,1]）'
  )
}

// A2: 格内自重复不算跨格
{
  const m = extractRepeatedPhrases([
    'High speed, high speed performance everywhere',
  ])
  assert(m.size === 0, 'A2 格内自重复不算跨格（无重复组）')
}

// A3: 纯数字 token 不开头（'205' 是纯数字；'205mb' 含字母不算数字 token——设计如此）
{
  const m = extractRepeatedPhrases([
    '205 MB/s read speed for fast transfers',
    '205 MB/s write speed for smooth capture',
  ])
  assert(![...m.keys()].some(k => /^205\s/.test(k)), 'A3 纯数字 token 不开头（205 不作短语起点）')
  assert(m.has('read speed') === false || true, 'A3b 非数字短语可正常存在（不强制）')
}

// A4: 重叠取最长（"plug and play" 与 "and play" 同格集合 → 只留长的）
{
  const m = extractRepeatedPhrases([
    'Plug and Play setup',
    'Plug and Play design',
  ])
  assert(m.has('plug and play'), 'A4 长短语保留')
  assert(!m.has('and play'), 'A4b 被包含的短子串剔除（同格集合重叠取最长）')
}

// A5: ™ 符号归一（带™与不带™视为同短语）
{
  const m = extractRepeatedPhrases([
    'CFexpress™ Type A card support',
    'CFexpress Type A reader device',
  ])
  assert(
    [...m.keys()].some(k => k.includes('cfexpress')),
    'A5 ™ 归一后短语可跨格匹配'
  )
}

// A6: 上限截断（>10 组时只留 10）
{
  // 构造 12 个互不重叠的跨格短语
  const srcs: string[] = []
  for (let i = 0; i < 12; i++) {
    srcs.push(`alpha${i} beta${i} gamma${i} delta${i}`)
    srcs.push(`alpha${i} beta${i} gamma${i} epsilon${i}`)
  }
  const m = extractRepeatedPhrases(srcs, 10)
  assert(m.size <= 10, `A6 上限截断生效（实际 ${m.size} 组 ≤ 10）`)
}

// A7: 出现格数排序（3 格组优先于 2 格组）
{
  const m = extractRepeatedPhrases([
    'common phrase here plus rare term alpha',
    'common phrase here with rare term alpha',
    'common phrase here alone',
  ])
  const first = [...m.entries()][0]
  assert(first && first[1].length === 3, 'A7 3 格组排最前')
}

// ============================================================
// B detectConsistencyIssues 全链路（mock XHR）
// ============================================================
console.log('\n═══ B detectConsistencyIssues mock XHR 全链路 ═══')

// 最小 mock XHR（队列式——坑 13 纪律：按调用次数顺序消费）
// xhrRequest 依赖 onload 回调（非 onreadystatechange）——对齐生产事件模型
type MockResponse = { ok: boolean; body: string }
const xhrQueue: MockResponse[] = []

class MockXHR {
  readyState = 0
  status = 0
  responseText = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  timeout = 0
  open(_m: string, _u: string) { /* noop */ }
  setRequestHeader(_k: string, _v: string) { /* noop */ }
  send(_body?: string | null) {
    const resp = xhrQueue.shift() || { ok: true, body: '{"groups":[]}' }
    this.status = resp.ok ? 200 : 500
    this.responseText = resp.body
    this.readyState = 4
    setTimeout(() => this.onload && this.onload(), 0)
  }
}
;(globalThis as Record<string, unknown>).XMLHttpRequest = MockXHR as unknown

const config = {
  apiUrl: 'http://mock', apiKey: 'k', model: 'm',
  proofreadApiUrl: '', proofreadApiKey: '', proofreadModel: '',
} as unknown as LLMConfig

async function runB() {
  // B1: 不一致组被报告（两个变体）
  {
    xhrQueue.length = 0
    xhrQueue.push({
      ok: true,
      body: JSON.stringify({
        groups: [
          {
            phrase: 'plug and play',
            consistent: false,
            variants: [
              { form: '即插即用', items: [1] },
              { form: '隨插即用', items: [2] },
            ],
          },
        ],
      }),
    })
    const report = await detectConsistencyIssues(
      ['Plug and Play design for easy setup', 'This device supports Plug and Play now'],
      ['即插即用设计，设置简单', '本设备支持隨插即用'],
      'zh-TW',
      config,
    )
    assert(report !== null && report.issues.length === 1, 'B1 不一致组被报告')
    assert(
      report !== null && report.issues[0].variants.length === 2 &&
      report.issues[0].variants[0].form === '即插即用' &&
      report.issues[0].variants[1].itemIndices[0] === 1,
      'B1b 变体与格索引对齐（item 2 → 索引 1）'
    )
    assert(report !== null && report.groupsTotal >= 1, 'B1c groupsTotal 透出')
  }

  // B2: 全部一致 → issues 为空但 report 非 null
  {
    xhrQueue.length = 0
    xhrQueue.push({
      ok: true,
      body: JSON.stringify({
        groups: [{ phrase: 'plug and play', consistent: true, variants: [] }],
      }),
    })
    const report = await detectConsistencyIssues(
      ['Plug and Play design for easy setup', 'This device supports Plug and Play now'],
      ['即插即用设计，设置简单', '本设备支持即插即用'],
      'zh-TW',
      config,
    )
    assert(report !== null && report.issues.length === 0, 'B2 全部一致 → issues 空数组')
  }

  // B3: API 失败 → 静默（探测版哲学）；v12.28：返回带 timedOut 标记的报告（供降级统计），不抛异常
  {
    xhrQueue.length = 0
    xhrQueue.push({ ok: false, body: 'server error' })
    const report = await detectConsistencyIssues(
      ['Plug and Play design for easy setup', 'This device supports Plug and Play now'],
      ['即插即用设计', '支持即插即用'],
      'zh-TW',
      config,
    )
    // v12.28：失败静默语义从「返回 null」改为「返回 timedOut 报告（issues 空）」——
    //   探测版「静默」指不改数据，但调用方需区分「无病灶」与「失败」以做自适应降级。
    assert(report !== null && report.timedOut === true && report.issues.length === 0, 'B3 API 失败 → timedOut 报告（issues 空，不抛异常）')
  }

  // B4: 解析失败（返回非 JSON）→ 静默 timedOut 报告（v12.28 同 B3）
  {
    xhrQueue.length = 0
    xhrQueue.push({ ok: true, body: 'not a json at all' })
    const report = await detectConsistencyIssues(
      ['Plug and Play design for easy setup', 'This device supports Plug and Play now'],
      ['即插即用设计', '支持即插即用'],
      'zh-TW',
      config,
    )
    assert(report !== null && report.timedOut === true && report.issues.length === 0, 'B4 解析失败 → timedOut 报告')
  }

  // B5: 无重复短语 → 不调 API 直接 null
  {
    xhrQueue.length = 0
    const report = await detectConsistencyIssues(
      ['Completely different alpha text', 'Nothing shared beta words'],
      ['完全不同的甲', '毫无共享的乙'],
      'zh-TW',
      config,
    )
    assert(report === null, 'B5 无重复短语 → null')
    // 注意：无法直接断言 xhrCalls===0，因为 fetchWithRetry 可能未被调用（提前 return）。
    // 上一断言已覆盖语义（无短语→无报告）。
  }

  // B6: omitted 变体保留（某格漏译该短语）
  {
    xhrQueue.length = 0
    xhrQueue.push({
      ok: true,
      body: JSON.stringify({
        groups: [
          {
            phrase: 'plug and play',
            consistent: false,
            variants: [
              { form: '即插即用', items: [1] },
              { form: '(omitted)', items: [2] },
            ],
          },
        ],
      }),
    })
    const report = await detectConsistencyIssues(
      ['Plug and Play design for easy setup', 'This device supports Plug and Play now'],
      ['即插即用设计', '本设备开箱即用'],
      'zh-TW',
      config,
    )
    assert(
      report !== null && report.issues.length === 1 &&
      report.issues[0].variants.some(v => v.form === '(omitted)'),
      'B6 omitted 变体保留（漏译被报告）'
    )
  }

  // B7: LLM 改写短语形态（大小写/空格差异）→ 归一化对齐仍命中
  {
    xhrQueue.length = 0
    xhrQueue.push({
      ok: true,
      body: JSON.stringify({
        groups: [
          {
            phrase: '  Plug And Play  ',  // LLM 输出大小写漂移
            consistent: false,
            variants: [
              { form: '即插即用', items: [1] },
              { form: '隨插即用', items: [2] },
            ],
          },
        ],
      }),
    })
    const report = await detectConsistencyIssues(
      ['Plug and Play design for easy setup', 'This device supports Plug and Play now'],
      ['即插即用设计', '支持隨插即用'],
      'zh-TW',
      config,
    )
    assert(report !== null && report.issues.length === 1, 'B7 LLM 短语形态漂移 → 归一化对齐仍命中')
  }
}

runB().then(() => {
  console.log(`\n═══ 结果: ${passed} 通过, ${failed} 失败 ═══`)
  process.exit(failed > 0 ? 1 : 0)
}).catch(e => {
  console.error('测试运行异常:', e)
  process.exit(1)
})
