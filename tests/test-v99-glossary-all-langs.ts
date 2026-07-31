/**
 * v9.9 术语库全语言覆盖测试
 *
 * 根因：buildGlossaryMap() 原逻辑仅在手动指定非 EN 源语言时补充该语言列的 key，
 *       sourceLang='auto'（默认）时葡/德/法等源文完全脱离术语库 5 层防线。
 *       实测：pt-BR 源文 "Cartão Lexar® Professional SILVER PLUS SDXC™ UHS-I"
 *       被 LLM 自由发挥为 "Lexar®プロフェッショナル SILVER PLUS SDXC™ UHS-I カード"，
 *       而非术语库 ja 译文 "Lexar Professional SILVER PLUS SDXC UHS-I カード"。
 *
 * 修复1（App.vue buildGlossaryMap）：无条件注册全部语言列 key（本测试模拟该逻辑）。
 * 修复2（llm-api.ts 术语合规校验）：整条源文命中术语库 → 译文锁定为术语库值。
 */

import { maskGlossaryTerms } from '../lib/entity-masker'
import { enforceGlossaryTerms, cleanKey } from '../lib/post-process'
import { buildTaskGlossaryHint, isUntranslatable, detectUntranslatedText } from '../lib/llm-api'
import { isMarketingTerm } from '../messages/types'

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
// 模拟术语库数据（真实 CSV 第 103 行）
// ═══════════════════════════════════════════════════════════════
const ENTRY = {
  source: 'Lexar Professional SILVER PLUS SDXC UHS-I Card',
  translations: {
    'zh-CN': 'Lexar Professional SILVER PLUS SDXC UHS-I 存储卡',
    ja: 'Lexar Professional SILVER PLUS SDXC UHS-I カード',
    ko: 'Lexar Professional SILVER PLUS SDXC UHS-I 카드',
    de: 'Lexar Professional SILVER PLUS SDXC UHS-I Karte',
    pt: 'Cartão Lexar Professional SILVER PLUS SDXC UHS-I',
    'pt-BR': 'Cartão Lexar Professional SILVER PLUS SDXC UHS-I',
    th: 'เมมโมรี่การ์ด Lexar Professional SILVER PLUS SDXC UHS-I',
    ar: 'بطاقة ذاكرة Lexar Professional SILVER PLUS SDXC UHS-I',
  },
}
// 第二条术语：验证撞 key 守卫
const ENTRY2 = {
  source: 'Lexar ARMOR GOLD SDXC UHS-II Card',
  translations: {
    ja: 'Lexar ARMOR GOLD SDXC UHS-II カード',
    de: 'Lexar ARMOR GOLD SDXC UHS-II Karte',
  },
}

/** 模拟修复后的 buildGlossaryMap（无条件全语言列注册） */
function buildGlossaryMapV99(glossary: typeof ENTRY[], targetLang: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const g of glossary) {
    const t = g.translations[targetLang]
    if (t) map.set(g.source, t)
  }
  for (const g of glossary) {
    const tgtVal = g.translations[targetLang]
    if (!tgtVal) continue
    for (const [lang, srcVal] of Object.entries(g.translations)) {
      if (lang === targetLang) continue
      if (srcVal && !map.has(srcVal)) {
        map.set(srcVal, tgtVal)
      }
    }
  }
  return map
}

function buildNorm(map: Map<string, string>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [k, v] of map) {
    const ck = cleanKey(k)
    if (ck.length >= 3 && !m.has(ck)) m.set(ck, v)
  }
  return m
}

const glossary = [ENTRY, ENTRY2]
const JA_WRONG = 'Lexar®プロフェッショナル SILVER PLUS SDXC™ UHS-I カード'

// ═══════════════════════════════════════════════════════════════
// A. 全语言列注册验证（auto 源语言场景的核心修复）
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. 全语言列 key 注册（auto 源语言不再漏术语）')
out.push('═'.repeat(60))

const mapJa = buildGlossaryMapV99(glossary, 'ja')

// 各语言列的源文都能命中 ja 译文
const sourcesToJa: Array<[string, string]> = [
  ['pt-BR 列源文', 'Cartão Lexar Professional SILVER PLUS SDXC UHS-I'],
  ['de 列源文', 'Lexar Professional SILVER PLUS SDXC UHS-I Karte'],
  ['zh-CN 列源文', 'Lexar Professional SILVER PLUS SDXC UHS-I 存储卡'],
  ['th 列源文', 'เมมโมรี่การ์ด Lexar Professional SILVER PLUS SDXC UHS-I'],
  ['ar 列源文', 'بطاقة ذاكرة Lexar Professional SILVER PLUS SDXC UHS-I'],
  ['EN 源文（主 key）', 'Lexar Professional SILVER PLUS SDXC UHS-I Card'],
]
for (const [label, src] of sourcesToJa) {
  const hit = mapJa.get(src)
  assert(hit === ENTRY.translations.ja, `${label} → ja 译文命中`, hit ? `got ${hit.slice(0, 40)}` : '未命中')
}

// 带商标符号的源文 → cleanKey 归一化后命中（短路路径）
const normJa = buildNorm(mapJa)
const withSymbols = 'Cartão Lexar® Professional SILVER PLUS SDXC™ UHS-I'
const shortCircuit = normJa.get(cleanKey(withSymbols))
assert(shortCircuit === ENTRY.translations.ja, '带®™的 pt 源文 cleanKey 短路命中', shortCircuit ? `got ${shortCircuit.slice(0, 40)}` : '未命中')

// ═══════════════════════════════════════════════════════════════
// B. 撞 key 守卫（先到者胜，行为确定）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('B. 撞 key 守卫')
out.push('═'.repeat(60))

// 同一源文值不会被后注册的同值覆盖（此例验证 EN key 优先于其他语言列）
const mapDe = buildGlossaryMapV99(glossary, 'de')
assert(mapDe.get(ENTRY.source) === ENTRY.translations.de, '目标语言 de：EN key 指向 de 译文')
assert(mapDe.get(ENTRY.translations.ja) === ENTRY.translations.de, 'ja 列源文也能命中 de 译文（跨语言 key）')
// 目标语言列不做 key：de 译文 "…Karte" 不应成为 key 指向自己
assert(mapDe.get(ENTRY.translations.de) === undefined, '目标语言列不做 key（无 target→target 自映射）')

// ═══════════════════════════════════════════════════════════════
// C. 三层防线在 auto 场景下恢复有效（pt-BR → ja）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('C. auto 场景防线有效性（pt-BR → ja）')
out.push('═'.repeat(60))

// 防线1 短路（已验证）→ 防线3 遮蔽
const masked = maskGlossaryTerms([withSymbols], mapJa)
assert(masked.texts[0] === '__GLOSSARY_0__', '防线3 遮蔽：pt 源文整条被 __GLOSSARY_0__ 替换', masked.texts[0])
assert(masked.termMap.get('__GLOSSARY_0__') === ENTRY.translations.ja, '防线3 termMap 指向 ja 译文')

// 防线5 校准：LLM 自由发挥的错误译文被整条替换
const enforced = enforceGlossaryTerms([withSymbols], [JA_WRONG], mapJa, undefined, normJa)
assert(enforced[0] === ENTRY.translations.ja, '防线5 校准：LLM 错误译文被整条替换为术语库值', enforced[0].slice(0, 50))

// ═══════════════════════════════════════════════════════════════
// D. 术语合规校验（llm-api.ts 新增硬约束，模拟其逻辑）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('D. 术语合规校验：整条命中 → 译文锁定术语库值')
out.push('═'.repeat(60))

function glossaryComplianceLock(texts: string[], results: string[], norm: Map<string, string>): string[] {
  return results.map((r, i) => {
    const expected = norm.get(cleanKey(texts[i] || ''))
    if (expected && r !== expected) return expected
    return r
  })
}

// D1: LLM 自由发挥 → 锁定
const locked = glossaryComplianceLock([withSymbols], [JA_WRONG], normJa)
assert(locked[0] === ENTRY.translations.ja, 'D1 LLM 错误译文被锁定为术语库值')

// D2: LLM 恰好输出术语库值 → 不动
const alreadyRight = glossaryComplianceLock([withSymbols], [ENTRY.translations.ja], normJa)
assert(alreadyRight[0] === ENTRY.translations.ja, 'D2 正确译文不受影响')

// D3: 非术语文本 → 不动（不误伤）
const plainText = 'Resistente a altas temperaturas'
const plainTrans = '高温に強い'
const untouched = glossaryComplianceLock([plainText], [plainTrans], normJa)
assert(untouched[0] === plainTrans, 'D3 非术语文本不受影响')

// D4: 嵌入句（源文整条不命中）→ 不在此层强制（由遮蔽/enforce 负责）
const embedded = 'O Cartão Lexar Professional SILVER PLUS SDXC UHS-I é ideal'
const embeddedTrans = '理想的なカードです'
const notForced = glossaryComplianceLock([embedded], [embeddedTrans], normJa)
assert(notForced[0] === embeddedTrans, 'D4 嵌入句不在此层强制（保守边界）')

// ═══════════════════════════════════════════════════════════════
// E. 全 20 语言目标方向抽查（同步修复验证）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('E. 多目标方向抽查（任意源 → 任意目标）')
out.push('═'.repeat(60))

// pt 源文 → de 目标（非 ja 方向也覆盖）
const ptSource = 'Cartão Lexar Professional SILVER PLUS SDXC UHS-I'
const hitDe = mapDe.get(ptSource)
assert(hitDe === ENTRY.translations.de, 'pt 源文 → de 目标命中', hitDe || '未命中')

// de 源文 → ja 目标
const deSource = 'Lexar Professional SILVER PLUS SDXC UHS-I Karte'
const hitJa2 = mapJa.get(deSource)
assert(hitJa2 === ENTRY.translations.ja, 'de 源文 → ja 目标命中', hitJa2 || '未命中')

// ═══════════════════════════════════════════════════════════════
// v9.10 双视图拆分回归（R1/R4/R5/R6）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('v9.10 双视图拆分（R1/R4/R5/R6）')
out.push('═'.repeat(60))

/** 模拟 v9.10 buildGlossaryMaps 双视图 */
function buildGlossaryMapsV910(glossary: typeof ENTRY[], targetLang: string) {
  const en = new Map<string, string>()
  for (const g of glossary) {
    const t = g.translations[targetLang]
    if (t) en.set(g.source, t)
  }
  const full = new Map<string, string>(en)
  for (const g of glossary) {
    const tgtVal = g.translations[targetLang]
    if (!tgtVal) continue
    for (const [lang, srcVal] of Object.entries(g.translations)) {
      if (lang === targetLang) continue
      if (srcVal && !full.has(srcVal)) full.set(srcVal, tgtVal)
    }
  }
  return { full, en }
}

// 含营销术语 + 全球统一术语 + 普通产品名的混合术语库
const MARKETING_ENTRY = {
  source: '4X Faster than USB 3.0',
  translations: { ja: 'USB 3.0の4倍の速度', de: '4x schneller als USB 3.0' },
}
const UNIFIED_ENTRY = {
  source: 'SILVER',
  translations: { ja: 'SILVER', de: 'SILVER' },
}
const glossaryV910 = [ENTRY, ENTRY2, MARKETING_ENTRY, UNIFIED_ENTRY]
const dualJa = buildGlossaryMapsV910(glossaryV910, 'ja')

// F. 双视图结构验证
assert(dualJa.en.has(ENTRY.source), 'F1 en 视图含 EN source')
assert(!dualJa.en.has(ENTRY.translations['pt-BR']), 'F2 en 视图不含非 EN 列 key')
assert(dualJa.full.has(ENTRY.translations['pt-BR']), 'F3 full 视图含非 EN 列 key')
assert(dualJa.full.get(ENTRY.translations['pt-BR']) === ENTRY.translations.ja, 'F4 full 非 EN key 指向 ja 译文')

// G. R1 修复验证：场景过滤用 EN 视图 → 营销术语被分类器识别
assert(isMarketingTerm(MARKETING_ENTRY.source), 'G1 营销术语 EN source 被分类器识别')
const hintWebsite = buildTaskGlossaryHint(dualJa.en, 'website', ['Some text with 4X Faster than USB 3.0'])
assert(!hintWebsite.includes('4X Faster'), 'G2 非电商场景：营销术语不注入 hint（EN 视图生效）')
const hintEcom = buildTaskGlossaryHint(dualJa.en, 'ecommerce', ['Some text with 4X Faster than USB 3.0'])
assert(hintEcom.includes('4X Faster'), 'G3 电商场景：营销术语正常注入')

// H. R4 修复验证：noTranslateTerms 仅 EN 视图
const CROSS_LANG_HOMOGRAPH = {
  source: 'Lexar NM Card',
  translations: { ja: 'Lexar NM カード', th: 'Lexar NM Card' },  // th 列值恰与 EN source 同形
}
const dualHomo = buildGlossaryMapsV910([CROSS_LANG_HOMOGRAPH], 'ja')
const noTranslateHomo = new Set<string>()
for (const [src, tgt] of dualHomo.en) { if (src === tgt && src.length >= 4) noTranslateHomo.add(src) }
assert(!noTranslateHomo.has('Lexar NM Card'), 'H1 EN 视图：src!==tgt 不进 noTranslateTerms（修 R4 防整句不翻）')
const noTranslateUnified = new Set<string>()
for (const [src, tgt] of dualJa.en) { if (src === tgt && src.length >= 4) noTranslateUnified.add(src) }
assert(noTranslateUnified.has('SILVER'), 'H2 EN 列 src===tgt 正常进 noTranslateTerms')

// I. R5 修复验证：isUntranslatable 豁免仅 EN 视图
const FULL_WITH_HOMOGRAPH = new Map<string, string>()
FULL_WITH_HOMOGRAPH.set('SILVER', 'SILVER')
FULL_WITH_HOMOGRAPH.set('SomeLangSameValue', 'SomeLangSameValue')  // 模拟某语言列同形值
const EN_ONLY = new Map<string, string>()
EN_ONLY.set('SILVER', 'SILVER')
assert(isUntranslatable('SILVER', EN_ONLY) === true, 'I1 EN 视图：src===tgt 术语豁免')
assert(isUntranslatable('SomeLangSameValue', EN_ONLY) === false, 'I2 EN 视图：非 EN key 不被豁免（修 R5）')
assert(isUntranslatable('SomeLangSameValue', FULL_WITH_HOMOGRAPH) === true, 'I3 对照：全语言视图会误判豁免（证明 R5 真实存在）')

// J. R6 修复验证：校对路径合规校验（整条命中 → 锁死）
function proofreadComplianceLock(sources: string[], results: string[], norm: Map<string, string>): string[] {
  return results.map((r, i) => {
    if (!(sources[i] || '').trim()) return r
    const expected = norm.get(cleanKey(sources[i]))
    if (expected && r !== expected) return expected
    return r
  })
}
const normFull = buildNorm(dualJa.full)
const proofSources = [withSymbols]
const proofWrong = ['Lexar®プロフェッショナル SILVER PLUS SDXC™ UHS-I カード']
const proofLocked = proofreadComplianceLock(proofSources, proofWrong, normFull)
assert(proofLocked[0] === ENTRY.translations.ja, 'J1 校对路径：整条命中术语库 → 译文锁死（修 R6）')

// K. detectUntranslatedText EN 视图豁免（集成验证）
const ptSrc = ['Cartão Lexar Professional SILVER PLUS SDXC UHS-I']
const ptTransJa = ['Cartão Lexar Professional SILVER PLUS SDXC UHS-I']  // 未翻译（==源文）
const untransDetected = detectUntranslatedText(ptSrc, ptTransJa, 'ja', dualJa.full, undefined, dualJa.en)
assert(untransDetected.size === 1, 'K1 漏翻检测：EN 视图豁免下，未翻译的 pt 源文被正确检出', `got ${untransDetected.size}`)

// ═══════════════════════════════════════════════════════════════
// 输出
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push(`结果：${pass} 通过，${fail} 失败`)
out.push('═'.repeat(60))

require('fs').writeFileSync(__dirname + '/tmp-v99-test-out.txt', out.join('\n'), 'utf8')
console.log(`v9.9+v9.10 测试：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
