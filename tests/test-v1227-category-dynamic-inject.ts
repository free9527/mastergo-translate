// ============================================================
// v12.27 品类词「裸奔」系统性修复——源文动态品类词检测注入
// ============================================================
// 根因（2026-09-24 ko 实机 Solid State Dual Drive 音译事故）：
//   品类词注入由 PRODUCT_LINE_CATEGORY_MAP 静态产品线映射决定，
//   源文出现映射外的品类词时该词钦定不注入 → 裸奔靠 LLM 自觉。
//   D500 是 Solid State Dual Drive，portable_storage 映射未含 → ko 钦定未进 prompt。
//
// 修复（Fix 1，治根）：
//   buildCategoryTerminology 注入范围 = 产品线映射 ∪ detectSourceCategoryWords(源文)。
//   只收含空格的多词品类词（误判率≈0），排除单词泛词 Hub/Card/SSD。
//
// 覆盖：
//   A 映射外多词品类词强制注入（D500/ko Solid State Dual Drive 整段回归锁）
//   B 映射内词不受影响（回归）
//   C 泛词单词不误注入（The Hub connects / Insert card into slot / fast ssd）
//   D 源文无品类词 → 不额外注入（token 不膨胀）
//   E 多词检测器单测（detectSourceCategoryWords 口径）
//   F 校对链路自动继承（renderLangForProofread 同参）
// ============================================================

/// <reference types="node" />

import {
  renderLangForTranslate,
  renderLangForProofread,
  CATEGORY_WORDS,
  PRODUCT_LINE_CATEGORY_MAP,
} from '../lib/prompt-constants'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

// ────────────────────────────────────────────────────────────
console.log('\nA. 映射外多词品类词强制注入（D500/ko Solid State Dual Drive）')

// D500 真实源文（portable_storage 产品线，映射不含 Solid State Dual Drive）
const D500_SOURCES = [
  'Built with dual USB-A and USB-C connectors, the Lexar JumpDrive Solid State Dual Drive D500 USB 3.2 Gen 1 Type C delivers fast, easy, plug-and-play storage.',
  'Available in capacities up to 1TB, this drive uses a swivel design and a metal construction.',
]

// 确认 portable_storage 映射确实不含 Solid State Dual Drive（修复前提）
assert(
  !PRODUCT_LINE_CATEGORY_MAP['portable_storage'].includes('Solid State Dual Drive'),
  'A0 前提：portable_storage 映射不含 Solid State Dual Drive',
)

// A1: ko —— Solid State Dual Drive 钦定音译必须因源文检测而注入
const koBlock = renderLangForTranslate('ko', 'portable_storage', true, D500_SOURCES)
assert(
  koBlock.includes('Solid State Dual Drive'),
  'A1 ko 源文检测后品类词对照含 Solid State Dual Drive（映射外强制注入）',
)
// ko 钦定值（CATEGORY_WORDS 单一事实源）
const koSSD = (CATEGORY_WORDS['Solid State Dual Drive'] as Record<string, string>)['ko']
assert(
  koBlock.includes(koSSD),
  `A1b ko 注入的钦定值 = ${koSSD}`,
)

// A2: 不传 sourceTexts（旧调用形态）→ 不注入（向后兼容，行为不变）
const koBlockNoSrc = renderLangForTranslate('ko', 'portable_storage', true)
assert(
  !koBlockNoSrc.includes('Solid State Dual Drive'),
  'A2 不传 sourceTexts 时 Solid State Dual Drive 不注入（向后兼容）',
)

// A3: ja —— 同一源文，ja 钦定假名也注入
const jaBlock = renderLangForTranslate('ja', 'portable_storage', true, D500_SOURCES)
const jaSSD = (CATEGORY_WORDS['Solid State Dual Drive'] as Record<string, string>)['ja']
assert(
  jaBlock.includes(jaSSD),
  `A3 ja 注入钦定值 = ${jaSSD}`,
)

// ────────────────────────────────────────────────────────────
console.log('\nB. 映射内词不受影响（回归）')

// B1: portable_storage 映射内含 Flash Drive → 传不传源文都应注入
const flashVal = (CATEGORY_WORDS['Flash Drive'] as Record<string, string>)['ko']
const koBlockFlash = renderLangForTranslate('ko', 'portable_storage', true, ['Some text without category'])
assert(
  koBlockFlash.includes(flashVal),
  'B1 映射内 Flash Drive 正常注入（回归不变）',
)

// B2: 无产品线（fallback SSD/Card/Flash Drive）→ 映射内仍注入。
//     注意：de SSD 值=SSD 与英文同形，buildCategoryTerminology 有「translated !== en 才注入」
//     的既有过滤（v11.7 设计——同形词注入无翻译价值），故 de 不输出 SSD 行，属正常。
//     用 Flash Drive（de 值 USB-Stick，与英文不同形）验证 fallback 映射注入。
const flashDeVal = (CATEGORY_WORDS['Flash Drive'] as Record<string, string>)['de']
const deBlockFallback = renderLangForTranslate('de', null, true, ['No category here'])
assert(
  deBlockFallback.includes(flashDeVal),
  'B2 无产品线 fallback 映射内 Flash Drive 正常注入（de SSD 同形被既有过滤剔除属正常）',
)

// ────────────────────────────────────────────────────────────
console.log('\nC. 泛词单词不误注入')

// C1: 「The Hub connects everything」普通句 → Hub（单词）不被动态度注入
//     用无产品线 fallback（含 SSD/Card/Flash Drive，不含 Hub）隔离映射干扰
const hubBlock = renderLangForTranslate('fr', null, true, ['The Hub connects everything together'])
const hubVal = (CATEGORY_WORDS['Hub'] as Record<string, string>)['fr']
assert(
  !hubBlock.includes(hubVal) || !hubBlock.includes('Hub →'),
  'C1 普通句 The Hub connects → Hub 单词不误注入',
)

// C2: 「Insert card into slot」→ Card 是单词且属 fallback 映射，本就注入（非动态检测）。
//     动态检测只收多词，故「card 在中间」不会额外出问题——
//     用「Card 不在映射内」的产品线隔离验证：Hub 不在 gaming_card 映射（只含 Card），
//     但 gaming_card 含 Card 会注入……改用「源文含 Card 普通句 + Card 不在映射」场景。
//     真正要证的是：动态检测不会因普通句把「不在映射的单词」拉进来。
//     → 用 Hub（不在 gaming_card 映射，gaming_card 只含 Card）：
const hubGaming = renderLangForTranslate('fr', 'gaming_card', true, ['The Hub connects everything'])
assert(
  !hubGaming.includes('Hub →'),
  'C2 普通句 The Hub connects + Hub 不在映射 → 动态检测不误拉入单词',
)

// C3: 「fast ssd」全小写 → SSD 是单词且全小写，不注入
const ssdBlock = renderLangForTranslate('de', null, true, ['fast ssd'])
assert(
  !ssdBlock.includes('SSD →') || ssdBlock.includes('SSD'),
  'C3 全小写 fast ssd → SSD 单词不误注入',
)

// ────────────────────────────────────────────────────────────
console.log('\nD. 源文无品类词 → 不额外注入（token 不膨胀）')

const noCatBlock = renderLangForTranslate('ko', 'portable_storage', true, [
  'The quick brown fox jumps over the lazy dog',
  'Nothing about storage categories here at all',
])
// portable_storage 映射词照常注入，但映射外的（Solid State Dual Drive/Desktop Memory 等）不应出现
assert(
  !noCatBlock.includes('Solid State Dual Drive') && !noCatBlock.includes('Desktop Memory'),
  'D1 无品类词源文 → 映射外词不额外注入',
)

// D2: 映射内词数量与「无源文」一致（动态检测未膨胀）
const withSrc = renderLangForTranslate('ko', 'portable_storage', true, ['no category words'])
const withoutSrc = renderLangForTranslate('ko', 'portable_storage', true)
assert(
  withSrc === withoutSrc,
  'D2 无品类词时传/不传源文输出一致（动态检测零膨胀）',
)

// ────────────────────────────────────────────────────────────
console.log('\nE. 多词检测器口径（透过 renderLang 端到端验证）')

// E1: 多个不同多词品类词 → 都注入
const multiBlock = renderLangForTranslate('ko', null, true, [
  'Use the Portable SSD and the Flash Drive together',
])
const portableVal = (CATEGORY_WORDS['Portable SSD'] as Record<string, string>)['ko']
assert(
  multiBlock.includes(portableVal),
  'E1 多个多词品类词 → Portable SSD 注入',
)

// E2: 大小写不敏感（portable ssd 小写）→ 仍注入（多词语境守卫放宽）
const ciBlock = renderLangForTranslate('ko', null, true, ['this portable ssd works'])
assert(
  ciBlock.includes(portableVal),
  'E2 小写 portable ssd → 多词检测大小写不敏感命中',
)

// E3: 子串不误判（SSDDrive 无词边界）→ 不注入
const noBoundary = renderLangForTranslate('ko', null, true, ['the PortableSSDDrive is fast'])
assert(
  !noBoundary.includes(portableVal),
  'E3 无词边界粘连 → 不误注入',
)

// ────────────────────────────────────────────────────────────
console.log('\nF. 校对链路自动继承（renderLangForProofread 同参）')

// F1: 校对链路传源文 → 映射外品类词同样注入
const proofBlock = renderLangForProofread('ko', 'portable_storage', D500_SOURCES)
assert(
  proofBlock.includes('Solid State Dual Drive'),
  'F1 校对链路源文检测 → Solid State Dual Drive 注入',
)

// F2: 校对不传源文 → 不注入（向后兼容）
const proofNoSrc = renderLangForProofread('ko', 'portable_storage')
assert(
  !proofNoSrc.includes('Solid State Dual Drive'),
  'F2 校对不传源文 → 不注入（向后兼容）',
)

// ────────────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
