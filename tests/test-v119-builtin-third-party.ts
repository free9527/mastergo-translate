/**
 * v11.9 第三方型号内置化 + 术语库合并升级测试
 *
 * 背景（v11.8 遗留风险收口）：
 *   v11.8 把第三方型号做成术语库 CSV identity 行——但那是把「保护机制」放在用户
 *   可覆盖/可删除的 CSV 里：用户替换/精简术语库后，S1 短路 / S2 遮蔽 / 漏翻豁免
 *   三层防线静默失效。v11.9：
 *   A. 第三方词条下沉为代码内置层（lib/third-party-models.ts），buildGlossaryMaps
 *      三方合并（内置 ∪ 用户产品名 ∪ 用户专属），内置撞 key 优先；
 *   B. 专属 CSV 删除 16 行第三方词条（用户术语库纯化）——防线不得削弱（兜底核心）；
 *   C. 版本升级从「整体覆盖」改为「合并升级」：默认优先 + 用户自定义保留追加 +
 *      版本戳写回（修复 v11.8 及以前升级分支从不写回版本号 → 每次启动重复升级的既有 bug）。
 *
 * 覆盖：
 *   A. 内置层完整性：16 事故词条 + 新增高频型号全在；identity（'*' 值 === source）
 *   B. 纯化后用户库：专属 CSV 不再含 16 词条；merge 逻辑复刻 App.vue 三方合并
 *   C. 三方合并优先级：内置撞 key 胜出（用户删行/改值都不影响防线）
 *   D. 防线功能（内置层承载，用户库零第三方词条）：
 *      isUntranslatable 豁免 / maskGlossaryTerms 遮蔽往返 / S1 短路端到端
 *   E. 合并升级（lib/glossary-store.ts 纯函数直接测）：
 *      用户自定义保留 / 默认同 key 覆盖用户旧值 / 版本戳写回 / 不重复升级 /
 *      存量为空回落默认 / save 封装写版本戳
 *   F. 回归：非 identity 句不豁免、isModelListOrCode 不受影响、版本号 ≥6
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { translateBatch, isUntranslatable } from '../lib/llm-api'
import { maskGlossaryTerms, unmaskGlossaryTerms } from '../lib/entity-masker'
import { DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '../lib/default-glossary'
import { BUILTIN_THIRD_PARTY_ENTRIES } from '../lib/third-party-models'
import { loadGlossaryWithMerge, mergeGlossaryOnUpgrade, saveGlossaryWithVersion, GlossaryStorage } from '../lib/glossary-store'
import { GLOSSARY_VERSION, STORAGE_KEY_GLOSSARY_VERSION } from '../lib/constants'
import { clearUiLogs } from '../lib/ui-debug-log'
import { GlossaryEntry, LLMConfig } from '../messages/types'

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
// Mock XHR：队列式脚本化响应（与 test-v105/v118 同款）
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

const INCIDENT_16 = [
  'Steam Deck', 'Legion Go', 'ROG ALLY', 'G Cloud', 'Osmo 360',
  'Antigravity A1', 'Luna Ultra', 'Pocket 4P', 'Pocket 4', 'Pocket 3',
  'Pocket 2', 'Action 6', 'Mavic 4 Pro', 'Mavic 3', 'Mavic 2 Pro', 'Steam',
]
const NEW_PROACTIVE = [
  'iPhone 16 Pro', 'iPhone 15', 'iPad Pro', 'MacBook Air',
  'Galaxy S25 Ultra', 'Galaxy Z Fold7', 'Osmo Pocket 3', 'Mini 4 Pro',
  'GoPro Hero 13', 'Insta360 X5', 'A7 IV', 'EOS R5 Mark II', 'Z6 III',
  'MX Master 3S', 'BlackWidow V4 Pro', 'Switch 2',
]
const NEW_V1110 = [
  'Hero 13 Black', 'Hero 7 Black', 'Hero 13', 'Hero 7', 'GoPro Max',
  'Osmo Action 3', 'Action 5 Pro', 'Action 4', 'Action 3', 'Action 2',
  'Pocket 1', 'Mini 2', 'Mini 4', 'Mini 2 SE', 'Osmo Nano',
  'Switch Lite', 'Ace Pro 2', 'Ace Pro', 'GO Ultra', 'GO 4',
]

/** 复刻 ui/App.vue buildGlossaryMaps 的三方合并（内置优先，first-wins） */
function buildMergedMap(userEntries: GlossaryEntry[], targetLang: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const b of BUILTIN_THIRD_PARTY_ENTRIES) {
    map.set(b.source, b.translations['*'] || b.source)
  }
  for (const g of userEntries) {
    const tgtVal = g.translations[targetLang]
    if (!tgtVal) continue
    if (!map.has(g.source)) map.set(g.source, tgtVal)
    for (const [lang, srcVal] of Object.entries(g.translations)) {
      if (lang === targetLang) continue
      if (srcVal && !map.has(srcVal)) map.set(srcVal, tgtVal)
    }
  }
  return map
}

/** 纯化后的专属 CSV 词条（模拟 v11.9 后用户库：第三方词条已删） */
function parseExclusiveEntries(): GlossaryEntry[] {
  const lines = DEFAULT_GLOSSARY_EXCLUSIVE_CSV.split('\n').filter(l => l.trim())
  const header = lines[0].split(',')
  return lines.slice(1).map(line => {
    const cols = line.split(',')
    const translations: Record<string, string> = {}
    for (let i = 1; i < header.length; i++) {
      if (cols[i]?.trim()) translations[header[i].trim()] = cols[i].trim()
    }
    return { source: cols[0].trim(), translations }
  })
}

const userExclusive = parseExclusiveEntries()
/** de 视图：内置 ∪ 用户专属（用户库已无第三方词条） */
const deMerged = buildMergedMap(userExclusive, 'de')

// ═══════════════════════════════════════════════════════════════
// A. 内置层完整性
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. 内置层完整性（lib/third-party-models.ts）')
out.push('═'.repeat(60))

{
  const sources = new Set(BUILTIN_THIRD_PARTY_ENTRIES.map(b => b.source))
  const missing16 = INCIDENT_16.filter(t => !sources.has(t))
  assert(missing16.length === 0, 'A1 v11.8 事故 16 词条全在内置层', missing16.join(','))
  const missingNew = NEW_PROACTIVE.filter(t => !sources.has(t))
  assert(missingNew.length === 0, 'A2 v11.9 新增高频型号全在内置层', missingNew.join(','))
  const missingV1110 = NEW_V1110.filter(t => !sources.has(t))
  assert(missingV1110.length === 0, 'A2b v11.10 兼容列表补录全在内置层', missingV1110.join(','))
  const nonIdentity = BUILTIN_THIRD_PARTY_ENTRIES.filter(b => b.translations['*'] !== b.source)
  assert(nonIdentity.length === 0, 'A3 内置层全 identity（* 值 === source）', nonIdentity.map(b => b.source).join(','))
  // 无高危裸词（宁漏勿滥红线；v11.9 初版曾误收 Flip/Neo 被本断言抓出后删除）
  const bareRisks = ['Pocket', 'Action', 'Legion', 'Luna', 'Air', 'Mini', 'Max', 'Flip', 'Neo', 'Go', 'Ultra', 'Pro', 'Mic', 'Hero', 'Black', 'Ace', 'Switch']
  const leaked = bareRisks.filter(w => sources.has(w))
  assert(leaked.length === 0, 'A4 无高危裸词收录（宁漏勿滥）', leaked.join(','))
  // 子串嵌套护栏（遮蔽无边界保护）：新词条不得是既有词条的子串——
  // 短词在 cleanKey 收集阶段会遮蔽长词条目内部，LLM 看到被切碎的占位符后可能重排/漏还原。
  // 已知豁免：v11.8/v11.9 及本次补录的型号世代组合（事故词条在库，回归测试锁行为）。
  const KNOWN_NESTED = new Set([
    'Mavic 3', 'Action 4', 'Air 3', 'Ace Pro', 'Ace Pro 2', 'Action 3', 'Action 5 Pro',
    'FX3', 'RS 4', 'Steam', 'Hero 9', 'Hero 8', 'Hero 7', 'Hero 13', 'Hero 12', 'Hero 11',
    'Hero 10', 'Mini 2', 'Mini 4', 'ZV-E10', 'EOS R5', 'EOS R6', 'G PRO X', 'G PRO X Superlight',
    'ROG ALLY', 'Pocket 4', 'Pocket 3', 'iPhone 17', 'iPhone 17 Pro', 'iPhone 16', 'iPhone 16 Pro',
    'iPhone 15', 'iPhone 15 Pro', 'Galaxy S25', 'Galaxy S24', 'Galaxy S23', 'Galaxy Buds3',
    'Insta360 GO 3', 'Insta360 Ace Pro',
  ])
  const sorted = [...sources].sort((a, b) => a.length - b.length)
  const nested: string[] = []
  for (const s of sorted) {
    for (const longer of sorted) {
      if (longer.length <= s.length) continue
      if (longer.includes(s) && !KNOWN_NESTED.has(s)) { nested.push(`${s} ⊂ ${longer}`); break }
    }
  }
  assert(nested.length === 0, 'A6 新增词条无子串嵌套（防切碎既有型号）', nested.join(','))
  // identity 收录 vs 同形源文豁免的对冲验证（v11.10 决策依据，防未来误改）：
  // 'GO 4' 全大写+数字，不在词表也走 isModelListOrCode 豁免；'Hero 7 Black' 因 Black
  // 全小写使大写占比 3/5=0.6 < 1 且不 >=0.5+数字同段，不豁免——必须靠词表收录兜底。
  assert(isUntranslatable('GO 4', new Map()) === true, 'A7 全大写型号走 isModelListOrCode 也豁免（收录是对冲非必须）')
  assert(isUntranslatable('Hero 7 Black', new Map()) === false, 'A7b Hero 7 Black 裸写不豁免（Black 拉低大写占比），靠词表遮蔽兜底')
  assert(BUILTIN_THIRD_PARTY_ENTRIES.length >= 60, 'A5 内置层规模 ≥60', `got ${BUILTIN_THIRD_PARTY_ENTRIES.length}`)
}

// ═══════════════════════════════════════════════════════════════
// B. 纯化后用户库
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('B. 专属 CSV 纯化（16 词条已删，用户库不再承载第三方防线）')
out.push('═'.repeat(60))

{
  const leaked = INCIDENT_16.filter(t => userExclusive.some(g => g.source === t))
  assert(leaked.length === 0, 'B1 专属 CSV 已删除全部 16 条第三方词条', leaked.join(','))
  // 删除不影响用户自有词条：老第三方品牌行（Apple/Samsung/DJI…）仍在用户库
  const legacyKept = ['Apple', 'Samsung', 'DJI', 'GoPro'].filter(t => userExclusive.some(g => g.source === t))
  assert(legacyKept.length === 4, 'B2 用户库原有第三方品牌行不受影响', legacyKept.join(','))
}

// ═══════════════════════════════════════════════════════════════
// C. 三方合并优先级（内置撞 key 胜出）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('C. 合并优先级（内置 > 用户，first-wins）')
out.push('═'.repeat(60))

{
  // 用户库里有人（旧版本缓存/手动）塞了冲突值：内置必须赢
  const hostile: GlossaryEntry[] = [
    { source: 'Steam Deck', translations: { de: 'Dampf Deck' } },
    { source: 'Mavic 3', translations: { de: 'Drohne 3' } },
  ]
  const merged = buildMergedMap(hostile, 'de')
  assert(merged.get('Steam Deck') === 'Steam Deck', 'C1 撞 key：内置 identity 胜出（Steam Deck）', merged.get('Steam Deck'))
  assert(merged.get('Mavic 3') === 'Mavic 3', 'C2 撞 key：内置 identity 胜出（Mavic 3）', merged.get('Mavic 3'))
  // 用户独有词条不受影响
  const withUser: GlossaryEntry[] = [
    { source: 'Lexar NM790', translations: { de: 'Lexar NM790 DE' } },
  ]
  const merged2 = buildMergedMap(withUser, 'de')
  assert(merged2.get('Lexar NM790') === 'Lexar NM790 DE', 'C3 用户独有词条正常注册')
}

// ═══════════════════════════════════════════════════════════════
// D. 防线功能（内置层承载）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('D. 三层防线（用户库零第三方词条，全靠内置层）')
out.push('═'.repeat(60))

for (const t of INCIDENT_16) {
  assert(isUntranslatable(t, deMerged) === true, `D-豁免: ${t}`)
}
assert(isUntranslatable('Steam Decks', deMerged) === true, 'D-豁免: Steam Decks（lemma 复数）')
assert(isUntranslatable('iPhone 16 Pro', deMerged) === true, 'D-豁免: iPhone 16 Pro（新增型号）')
assert(isUntranslatable('Capture every moment', deMerged) === false, 'D-不误判: 营销句')
assert(isUntranslatable('Read speed up to 2050MB/s', deMerged) === false, 'D-不误判: 规格句')

{
  const src = ['Compatible with Steam Deck and iPhone 16 Pro']
  const masked = maskGlossaryTerms(src, deMerged)
  const cnt = (masked.texts[0].match(/__GLOSSARY_\d+__/g) || []).length
  assert(cnt === 2, 'D-遮蔽: 内置词条嵌入式命中 2 占位符', `got ${cnt}: ${masked.texts[0]}`)
  const rt = unmaskGlossaryTerms(masked.texts, masked.termMap)
  assert(rt.texts[0] === src[0], 'D-遮蔽: unmask 同形还原', rt.texts[0])

  // 长度优先不被 bare Steam 切
  const src2 = ['Works on Steam Deck']
  const masked2 = maskGlossaryTerms(src2, deMerged)
  const cnt2 = (masked2.texts[0].match(/__GLOSSARY_\d+__/g) || []).length
  assert(cnt2 === 1, 'D-遮蔽: Steam Deck 整体 1 占位符（不被 Steam 切）', `got ${cnt2}: ${masked2.texts[0]}`)
}

// ═══════════════════════════════════════════════════════════════
// E. 合并升级（lib/glossary-store.ts）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('E. 合并升级 + 版本戳写回')
out.push('═'.repeat(60))

function makeMemStorage(seed?: Record<string, unknown>): GlossaryStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = seed || {}
  return {
    data,
    async getAsync(k: string) { return data[k] ?? null },
    async setAsync(k: string, v: unknown) { data[k] = v },
  }
}

const DEFAULTS: GlossaryEntry[] = [
  { source: 'Lexar NM790', translations: { de: 'Lexar NM790' } },
  { source: 'Lexar PLAY', translations: { de: 'Lexar PLAY' } },
]

{
  // E1: 合并升级 — 用户自定义保留 + 默认同 key 覆盖用户旧值
  const stored: GlossaryEntry[] = [
    { source: 'Lexar NM790', translations: { de: '用户改过的旧值' } },  // 同 key：默认覆盖
    { source: '我的自定义术语', translations: { de: 'Benutzer Begriff' } },  // 自定义：保留
    { source: '  lexar play  ', translations: { de: '大小写空格变体' } },  // normKey 同 key：默认覆盖
  ]
  const { merged, customCount } = mergeGlossaryOnUpgrade(DEFAULTS, stored)
  assert(customCount === 1, 'E1 用户自定义 1 条计入', `got ${customCount}`)
  assert(merged.length === 3, 'E2 合并后 = 2 默认 + 1 自定义', `got ${merged.length}`)
  assert(merged[0].translations.de === 'Lexar NM790', 'E3 默认同 key 覆盖用户旧值', merged[0].translations.de)
  assert(merged.some(m => m.source === '我的自定义术语'), 'E4 用户自定义词条保留追加')
  assert(!merged.some(m => m.source.trim().toLowerCase() === 'lexar play' && m.translations.de === '大小写空格变体'),
    'E5 normKey（大小写/空格）命中默认 → 用户变体被覆盖')
}

async function runStorageTests() {
  // E6: 升级触发：storedVersion < version → 合并 + 版本戳写回 + 缓存失效回调
  {
    const storage = makeMemStorage({
      [STORAGE_KEY_GLOSSARY_VERSION]: 4,
      'g_products': [{ source: '用户词条A', translations: { de: 'A' } }],
    })
    let upgraded = -1
    const result = await loadGlossaryWithMerge(storage, 'g_products', () => DEFAULTS, 6, c => { upgraded = c })
    assert(result.length === 3, 'E6 升级合并：默认 2 + 用户 1', `got ${result.length}`)
    assert(upgraded === 1, 'E7 升级回调报告自定义条数', `got ${upgraded}`)
    assert(storage.data[STORAGE_KEY_GLOSSARY_VERSION] === 6, 'E8 版本戳已写回（v11.8 既有 bug 修复）',
      `got ${storage.data[STORAGE_KEY_GLOSSARY_VERSION]}`)
    const persisted = storage.data['g_products'] as GlossaryEntry[]
    assert(persisted.length === 3 && persisted.some(e => e.source === '用户词条A'), 'E9 合并结果已持久化')
  }

  // E7→E10: 版本戳已新 → 不重复升级（直接读存量）
  {
    const storedEntries: GlossaryEntry[] = [{ source: '用户词条B', translations: { de: 'B' } }]
    const storage = makeMemStorage({
      [STORAGE_KEY_GLOSSARY_VERSION]: 6,
      'g_products': storedEntries,
    })
    let upgradeCalled = false
    const result = await loadGlossaryWithMerge(storage, 'g_products', () => DEFAULTS, 6, () => { upgradeCalled = true })
    assert(result.length === 1 && result[0].source === '用户词条B', 'E10 版本已新 → 直接读存量不走升级')
    assert(!upgradeCalled, 'E11 不重复触发升级回调（启动幂等）')
  }

  // E12: 存量为空 → 落默认 + 版本戳
  {
    const storage = makeMemStorage({ [STORAGE_KEY_GLOSSARY_VERSION]: 6 })
    const result = await loadGlossaryWithMerge(storage, 'g_empty', () => DEFAULTS, 6)
    assert(result.length === 2 && result[0].source === 'Lexar NM790', 'E12 存量为空回落内置默认')
    assert((storage.data['g_empty'] as GlossaryEntry[]).length === 2, 'E13 默认已持久化')
  }

  // E14: 首次使用（无版本戳无存量）→ 默认 + 版本戳
  {
    const storage = makeMemStorage()
    let upgraded = -1
    const result = await loadGlossaryWithMerge(storage, 'g_first', () => DEFAULTS, 6, c => { upgraded = c })
    assert(result.length === 2 && upgraded === 0, 'E14 首次使用：默认 + 升级回调(0 自定义)')
    assert(storage.data[STORAGE_KEY_GLOSSARY_VERSION] === 6, 'E15 首次使用版本戳写回')
  }

  // E16: save 封装写版本戳
  {
    const storage = makeMemStorage({ [STORAGE_KEY_GLOSSARY_VERSION]: 4 })
    await saveGlossaryWithVersion(storage, 'g_save', [{ source: 'X', translations: { de: 'X' } }], 6)
    assert(storage.data[STORAGE_KEY_GLOSSARY_VERSION] === 6, 'E16 save 封装顺手写回版本戳')
    assert((storage.data['g_save'] as GlossaryEntry[]).length === 1, 'E17 save 内容持久化')
  }
}

// ═══════════════════════════════════════════════════════════════
// F. 回归护栏
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('F. 回归护栏')
out.push('═'.repeat(60))

assert(
  isUntranslatable('EOS R5    /    EOS R6    /    EOS RP', emptyGlossary) === true,
  'F1 isModelListOrCode 豁免不受影响（v10.5 回归）'
)
assert(GLOSSARY_VERSION >= 6, 'F2 GLOSSARY_VERSION ≥6（合并升级语义生效）', `got ${GLOSSARY_VERSION}`)

// ═══════════════════════════════════════════════════════════════
// D2. S1 整条短路端到端（en→de mock，用户库零第三方词条）
// ═══════════════════════════════════════════════════════════════
async function main() {
  await runStorageTests()

  out.push('')
  out.push('═'.repeat(60))
  out.push('D2. S1 整条短路端到端（en→de mock，内置层承载）')
  out.push('═'.repeat(60))

  clearUiLogs()
  mockCalls.length = 0
  enqueueResponse(
    '[1] Steam Deck\n' +
    '[2] Erlebe jeden Moment\n' +
    '[3] iPhone 16 Pro'
  )
  const untranslated = new Set<number>()
  const r = await translateBatch(
    ['Steam Deck', 'Experience every moment', 'iPhone 16 Pro'],
    'de', deMerged, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated)

  assert(r.length === 3, 'D2-1 返回 3 条', `got ${r.length}`)
  assert(r[0] === 'Steam Deck', 'D2-2 Steam Deck 短路原文落地（内置层，CSV 已删）', JSON.stringify(r[0]))
  assert(r[1] === 'Erlebe jeden Moment', 'D2-3 真实句子正常翻译', JSON.stringify(r[1]))
  assert(r[2] === 'iPhone 16 Pro', 'D2-4 iPhone 16 Pro 短路原文落地（新增型号）', JSON.stringify(r[2]))
  assert(mockCalls.length === 1, 'D2-5 零重试', `实际 ${mockCalls.length} 次调用`)
  assert(untranslated.size === 0, 'D2-6 零漏翻上报', `got ${[...untranslated]}`)

  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v119-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v11.9 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v119-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
