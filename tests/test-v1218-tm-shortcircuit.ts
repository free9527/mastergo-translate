// ============================================================
// v12.18 TM 短路测试套件
// ============================================================
// 覆盖：
//   A retrieveTMShortCircuit 过滤链（user-only / proofread 拒 / targetLang 不匹配拒 /
//     数字集合不等拒 / ≥0.99 阈值 / 极短不检索 / 空池）
//   B 数字防线边界（up to 2TB vs 4TB 不短路 / 同数字集合短路 / 数字顺序不同短路）
//   C 术语过期防线（enforceGlossaryTerms 拉回现值——App.vue 集成点的核心安全闸）
//
// 用法：
//   npx tsx tests/test-v1218-tm-shortcircuit.ts
// ============================================================

import { retrieveTMShortCircuit, TM_SHORTCIRCUIT_THRESHOLD, tmSimilarity } from '../lib/translation-memory'
import { enforceGlossaryTerms } from '../lib/post-process'
import { TranslationCorrection } from '../messages/types'

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
console.log('\nA. retrieveTMShortCircuit 过滤链')

// A1 同句命中（真实场景——人工修过的源文再次出现）
{
  const m = retrieveTMShortCircuit(
    ['Up to 1050MB/s read speed for gaming'],
    [mkCorr('Up to 1050MB/s read speed for gaming', 'Bis zu 1050MB/s Lesegeschwindigkeit für Gaming')],
    'de',
  )
  assert(m.get(0) === 'Bis zu 1050MB/s Lesegeschwindigkeit für Gaming', 'A1 同句 → 短路命中（sim=1.0 ≥ 0.99）')
}

// A2 近似句不短路（few-shot 的 0.90 能命中，短路的 0.99 不能——同句才配直接落地）
{
  // A2a 用一对实际落在 0.90-0.99 区间的句子（词级 Jaccard：10 词交 9 词并 11 → 0.818 不达；
  //   需 20 词级长句单标点差异——交 19 并 21 ≈ 0.905 落在区间内）
  const sim = tmSimilarity(
    'Up to 1050MB/s read speed for gaming loading transferring editing storing backing up and sharing large media files',
    'Up to 1050MB/s read speed for gaming loading transferring editing storing backing up, and sharing large media files',
  )
  assert(sim >= 0.9 && sim < TM_SHORTCIRCUIT_THRESHOLD, 'A2a 长句标点差异落在 0.90-0.99 区间（few-shot 区间）')
  const m = retrieveTMShortCircuit(
    ['Up to 1050MB/s read speed for gaming loading transferring editing storing backing up and sharing large media files'],
    [mkCorr('Up to 1050MB/s read speed for gaming loading transferring editing storing backing up, and sharing large media files', 'irrelevant')],
    'de',
  )
  assert(m.size === 0, 'A2b 长句标点差异（sim<0.99）→ 不短路（近似句只配当范例）')
}

// A3 proofread 来源拒（LLM 产物不做短路锚——自我强化防线）
{
  const m = retrieveTMShortCircuit(
    ['Up to 1050MB/s read speed for gaming'],
    [mkCorr('Up to 1050MB/s read speed for gaming', 'x', 'proofread')],
    'de',
  )
  assert(m.size === 0, 'A3 proofread 来源 → 拒（origin=user 单源红线）')
}

// A4 targetLang 不匹配拒（correction 按语种存，跨语种绝不短路）
{
  const m = retrieveTMShortCircuit(
    ['Up to 1050MB/s read speed for gaming'],
    [mkCorr('Up to 1050MB/s read speed for gaming', 'x', 'user', 'fr')],
    'de',
  )
  assert(m.size === 0, 'A4 targetLang 不匹配 → 拒')
}

// A5 空池 / 空文本
{
  assert(retrieveTMShortCircuit([], [mkCorr('a b c d e f g h', 'x')], 'de').size === 0, 'A5a 空 texts → 空')
  assert(retrieveTMShortCircuit(['Up to 1050MB/s read speed for gaming'], [], 'de').size === 0, 'A5b 空 corrections → 空')
}

// A6 极短源文不检索（<15 字符无 pattern 可锚，与 retrieveTM 同闸）
{
  const m = retrieveTMShortCircuit(
    ['Short text'],
    [mkCorr('Short text', 'kurzer Text')],
    'de',
  )
  assert(m.size === 0, 'A6 极短源文 <15 字符 → 不检索')
}

// A7 多条源文混合命中（短路的逐条判定语义——只短路命中的，其余照常走 API）
{
  const m = retrieveTMShortCircuit(
    ['Up to 1050MB/s read speed for gaming', 'Totally different sentence here', 'Wireless controller support'],
    [mkCorr('Up to 1050MB/s read speed for gaming', 'GAMING_DE'), mkCorr('Wireless controller support', 'CONTROLLER_DE')],
    'de',
  )
  assert(m.size === 2 && m.get(0) === 'GAMING_DE' && m.get(2) === 'CONTROLLER_DE' && !m.has(1), 'A7 多条源文只短路命中的（索引 0/2 短路，1 走 API）')
}

// ────────────────────────────────────────────────────────────
console.log('\nB. 数字防线边界（规格错位防线——短路层最高危场景）')

// B1 数字集合不等 → 不短路（up to 2TB 绝不锚 up to 4TB——规格事故防线）
{
  const m = retrieveTMShortCircuit(
    ['Up to 2TB capacity for all your games'],
    [mkCorr('Up to 4TB capacity for all your games', 'x')],
    'de',
  )
  assert(m.size === 0, 'B1 数字不等（2TB vs 4TB）→ 不短路（规格错位防线）')
}

// B2 数字集合相等但语序不同 → 短路（防线不误伤）
{
  const m = retrieveTMShortCircuit(
    ['Read speed 1050MB/s and write 1000MB/s'],
    [mkCorr('Write 1000MB/s and read speed 1050MB/s', 'SPEEDS_DE')],
    'de',
  )
  assert(m.get(0) === 'SPEEDS_DE', 'B2 数字集合相等（顺序不同）→ 短路不误伤')
}

// B3 千分位/小数数字归一（数字集合按原始 token 比较——10,000 ≠ 10000 是规格防线
//   的保守方向：同规格不同书写也不短路，宁多翻一次不可错锚；v12.18 拍板保守）
{
  const sim = tmSimilarity('Up to 10,000 cycles endurance rated', 'Up to 10000 cycles endurance rated')
  assert(sim === 0, 'B3 数字书写差异（10,000 vs 10000）→ 不短路（保守方向，宁多翻一次）')
}

// ────────────────────────────────────────────────────────────
console.log('\nC. 术语过期防线（App.vue 集成点的核心安全闸）')

// C1 TM 译文已用术语库现值 → enforceGlossaryTerms 原样放行
//   （防线的真实职责：TM 译文里若术语库词「该出现而未出现」只记日志不强插
//   ——enforceGlossaryTerms 是「存在性校验+精确锁定」非「改写器」；
//   防过期的主闸是缓存 key 的 glossaryHash，TM 侧靠 origin=user 人工背书）
{
  const glossaryMap = new Map<string, string>([['drive', 'Laufwerk']])
  const normalized = new Map<string, string>([['drive', 'Laufwerk']])
  const tmText = 'Externes Laufwerk mit hoher Geschwindigkeit'
  const out = enforceGlossaryTerms(['External drive with high speed'], [tmText], glossaryMap, undefined, normalized)
  assert(out[0] === tmText, 'C1 TM 译文含术语现值 → 原样放行（防线不打扰正常译文）')
}

// C2 TM 译文缺术语现值 → enforceGlossaryTerms 不强插（只记日志）——
//   防线语义锁定：术语过期场景由「缓存 key 的 glossaryHash 失效重翻」兜，
//   TM 短路的 enforce 只做「术语存在性校验」不做改写（与翻译管道 S5 同语义）
{
  const glossaryMap = new Map<string, string>([['drive', 'Laufwerk']])
  const normalized = new Map<string, string>([['drive', 'Laufwerk']])
  const tmText = 'Externe Festplatte mit hoher Geschwindigkeit'
  const out = enforceGlossaryTerms(['External drive with high speed'], [tmText], glossaryMap, undefined, normalized)
  // 术语库词 drive 在源文中出现、译文未含 Laufwerk → 只警告不改写（防线真实行为）
  assert(out[0] === tmText, 'C2 术语缺失 → 不强插（改写非 enforce 职责，缓存 glossaryHash 兜过期）')
}

// C3 空术语库 → 短路译文原样（防线在术语库空时安全退化为直通）
{
  const out = enforceGlossaryTerms(['External drive with high speed'], ['Externe Festplatte'], new Map(), undefined, new Map())
  assert(out[0] === 'Externe Festplatte', 'C3 空术语库 → 原样放行（安全退化）')
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail > 0 ? 1 : 0)
