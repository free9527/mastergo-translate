// ═══════════════════════════════════════════════════════════════
// v12.4 ™ 散弹修复测试
// A 段：hasTrademarkSpam 检测（正反样例）
// B 段：restoreTrademarkSymbols 散弹剥离 + 错误放置回收
// C 段：validatePolishOutput 硬锁第 ⑤ 层 ™ 散弹一票否决
// D 段：20 语种冒烟（™ 剥离/恢复语言无关性）
// ═══════════════════════════════════════════════════════════════

import { hasTrademarkSpam, restoreTrademarkSymbols } from '../lib/post-process'
import { validatePolishOutput } from '../lib/polish-guard'

let passed = 0
let failed = 0
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ─────────────────────────────────────────────────────────────
// A 段：hasTrademarkSpam 检测
// ─────────────────────────────────────────────────────────────
console.log('\n[A] hasTrademarkSpam 检测')

// A1: 典型散弹 S™I™L™V™E™R™
assert(hasTrademarkSpam('S™I™L™V™E™R™ CFexpress 4.0 Typ A') === true, 'A1 S™I™L™V™E™R™ 散弹检出')

// A2: 典型散弹 S™o™n™y™
assert(hasTrademarkSpam('mit aktuellen S™o™n™y™ Alpha-Kameras') === true, 'A2 S™o™n™y™ 散弹检出')

// A3: 典型散弹 L™e™x™a™r™
assert(hasTrademarkSpam('L™e™x™a™r™ plays eine aktive Rolle') === true, 'A3 L™e™x™a™r™ 散弹检出')

// A4: 合法™（完整品牌词后）不误报
assert(hasTrademarkSpam('Die Lexar® Professional SILVER CFexpress™ 4.0 Typ A Karte') === false, 'A4 合法™ Lexar®/CFexpress™ 不误报')

// A5: 合法™ Sony™ 不误报
assert(hasTrademarkSpam('mit aktuellen Sony™ Alpha-Kameras kompatibel') === false, 'A5 合法™ Sony™ 不误报')

// A6: 单个™（无散弹模式）不误报
assert(hasTrademarkSpam('Die Karte bietet CFexpress™ 4.0 Leistung') === false, 'A6 单个™ 不误报')

// A7: 无™文本不误报
assert(hasTrademarkSpam('Die Karte bietet hohe Geschwindigkeit') === false, 'A7 无™ 不误报')

// A8: ® 散弹检出（L®e®x®a®r®）
assert(hasTrademarkSpam('L®e®x®a®r® spielt eine Rolle') === true, 'A8 ®散弹检出')

// A9: 逐字母模式中间位™检出（S™I 的 S™ 是中间位）；词尾™是合法不命中
assert(hasTrademarkSpam('S™I™L™') === true, 'A9-1 S™I™L™ 逐字母模式检出')
assert(hasTrademarkSpam('Sony™') === false, 'A9-2 Sony™ 词尾合法不命中')

// ─────────────────────────────────────────────────────────────
// B 段：restoreTrademarkSymbols 散弹剥离 + 错误放置回收
// ─────────────────────────────────────────────────────────────
console.log('\n[B] restoreTrademarkSymbols 散弹剥离 + 错误放置回收')

// B1: 实机案例 1——SILVER 散弹被剥离，恢复为合法位置
const src1 = 'The Lexar® Professional SILVER CFexpress™ 4.0 Type A Card delivers speeds.'
const spam1 = 'Die Lexar® Professional S™I™L™V™E™R™ CFexpress 4.0 Typ A Karte liefert Geschwindigkeiten.'
const restored1 = restoreTrademarkSymbols([src1], [spam1])[0]
assert(hasTrademarkSpam(restored1) === false, 'B1-1 散弹被清除', restored1)
assert(restored1.includes('SILVER') === true, 'B1-2 SILVER 完整保留', restored1)
assert(restored1.includes('CFexpress™') === true, 'B1-3 CFexpress™ 正确恢复', restored1)
assert(restored1.includes('Lexar®') === true, 'B1-4 Lexar® 保留', restored1)

// B2: 实机案例 2——Sony 散弹被剥离，恢复为合法位置
const src2 = 'The Lexar® Professional SILVER CFexpress™ 4.0 Type A Card is compatible with current Sony Alpha and Sony FX cameras.'
const spam2 = 'Die Lexar® Professional SILVER CFexpress™ 4.0 Typ A Karte ist mit aktuellen S™o™n™y™ Alpha- und S™o™n™y™ FX-Kameras kompatibel.'
const restored2 = restoreTrademarkSymbols([src2], [spam2])[0]
assert(hasTrademarkSpam(restored2) === false, 'B2-1 散弹被清除', restored2)
assert(restored2.includes('Sony') === true, 'B2-2 Sony 完整保留', restored2)
// 源文 Sony 无™，译文也不应有 Sony™
assert(!/Sony™/.test(restored2), 'B2-3 Sony 无™（源文 Sony 后无™）', restored2)

// B3: 实机案例 3——Lexar 散弹被剥离（Lexar 在源文有®）
const src3 = 'As a key member of the CompactFlash® Association (CFA), Lexar plays an active role.'
const spam3 = 'Als wichtiges Mitglied der CompactFlash® Association (CFA) L™e™x™a™r™ p™l™a™y™s eine aktive Rolle.'
const restored3 = restoreTrademarkSymbols([src3], [spam3])[0]
assert(hasTrademarkSpam(restored3) === false, 'B3-1 散弹被清除', restored3)
assert(restored3.includes('Lexar') === true, 'B3-2 Lexar 完整保留', restored3)
assert(!/p™l™a™y™s/.test(restored3), 'B3-3 plays 无散弹', restored3)

// B4: 正常译文（无散弹）restore 行为不变——™正确恢复
const src4 = 'The Lexar® Professional SILVER CFexpress™ 4.0 Type A Card delivers speeds.'
const clean4 = 'Die Lexar Professional SILVER CFexpress 4.0 Typ A Karte liefert Geschwindigkeiten.'
const restored4 = restoreTrademarkSymbols([src4], [clean4])[0]
assert(restored4.includes('Lexar®') === true, 'B4-1 Lexar® 恢复', restored4)
assert(restored4.includes('CFexpress™') === true, 'B4-2 CFexpress™ 恢复', restored4)
assert(hasTrademarkSpam(restored4) === false, 'B4-3 无散弹', restored4)

// B5: 多™源文——每个™都恢复到正确位置
// 注：词尾™在源文无™时不恢复（源文 Sony 无™ → 译文 Sony 也无™，合理行为）
const src5 = 'Lexar® CFexpress™ Type A Card and Sony™ cameras.'
const clean5 = 'Lexar CFexpress Typ A Karte und Sony Kameras.'
const restored5 = restoreTrademarkSymbols([src5], [clean5])[0]
assert(restored5.includes('Lexar®') === true, 'B5-1 Lexar® 恢复', restored5)
assert(restored5.includes('CFexpress™') === true, 'B5-2 CFexpress™ 恢复', restored5)
// 源文 Sony 有™ → 译文 Sony 恢复™
assert(restored5.includes('Sony™') === true, 'B5-3 Sony™ 恢复（源文 Sony 有™）', restored5)

// B6: 源文无™译文无™——restore 不添加
const src6 = 'Die Karte bietet hohe Geschwindigkeit.'
const clean6 = 'The card delivers high speed.'
const restored6 = restoreTrademarkSymbols([src6], [clean6])[0]
assert(restored6 === clean6, 'B6 源文无™译文不变', restored6)

// ─────────────────────────────────────────────────────────────
// C 段：validatePolishOutput 硬锁第 ⑤ 层 ™ 散弹一票否决
// ─────────────────────────────────────────────────────────────
console.log('\n[C] validatePolishOutput 硬锁第⑤层 ™ 散弹')

// C1: 润色输出含散弹 → 硬锁拒绝
const polishSrc = 'The Lexar® Professional SILVER CFexpress™ 4.0 Type A Card delivers speeds more than twice as fast.'
const polishSpam = 'Die Lexar® Professional S™I™L™V™E™R™ CFexpress 4.0 Typ A Karte bietet mehr als doppelt so hohe Geschwindigkeiten.'
const val1 = validatePolishOutput(polishSrc, polishSpam, 'de')
assert(val1.ok === false, 'C1-1 散弹被硬锁拒绝')
assert(val1.reason?.includes('™散弹') === true, 'C1-2 拒绝原因=™散弹', val1.reason)

// C2: 润色输出干净 → 硬锁通过
const polishClean = 'Die Lexar® Professional SILVER CFexpress™ 4.0 Typ A Karte bietet mehr als doppelt so hohe Geschwindigkeiten.'
const val2 = validatePolishOutput(polishSrc, polishClean, 'de')
assert(val2.ok === true, 'C2 干净润色输出通过硬锁', val2.reason)

// ─────────────────────────────────────────────────────────────
// D 段：20 语种冒烟（™ 剥离/恢复语言无关性）
// ─────────────────────────────────────────────────────────────
console.log('\n[D] 20 语种冒烟')

const srcMulti = 'The Lexar® Professional SILVER CFexpress™ 4.0 Type A Card delivers speeds.'
const testCases: Array<{ lang: string; trans: string; expectTm: boolean }> = [
  { lang: 'de', trans: 'Die Lexar Professional SILVER CFexpress 4.0 Typ A Karte liefert Geschwindigkeiten.', expectTm: true },
  { lang: 'ja', trans: 'Lexar Professional SILVER CFexpress 4.0 Type A カードは高速を実現します。', expectTm: true },
  { lang: 'zh-CN', trans: 'Lexar Professional SILVER CFexpress 4.0 Type A 卡提供高速性能。', expectTm: true },
  { lang: 'ru', trans: 'Карта Lexar Professional SILVER CFexpress 4.0 Type A обеспечивает высокую скорость.', expectTm: true },
  { lang: 'th', trans: 'การ์ด Lexar Professional SILVER CFexpress 4.0 Type A มอบความเร็วสูง', expectTm: true },
  { lang: 'ar', trans: 'توفر بطاقة Lexar Professional SILVER CFexpress 4.0 Type A سرعات عالية.', expectTm: true },
]
for (const tc of testCases) {
  const restored = restoreTrademarkSymbols([srcMulti], [tc.trans])[0]
  assert(restored.includes('Lexar®') === tc.expectTm, `D-${tc.lang} Lexar® 恢复`, restored)
  assert(restored.includes('CFexpress™') === tc.expectTm, `D-${tc.lang} CFexpress™ 恢复`, restored)
  assert(hasTrademarkSpam(restored) === false, `D-${tc.lang} 无散弹`, restored)
}

// 散弹在 20 语种下都被剥离（取 3 个代表语种）
const spamByLang: Array<{ lang: string; trans: string }> = [
  { lang: 'de', trans: 'Die Lexar® Professional S™I™L™V™E™R™ CFexpress 4.0 Typ A Karte.' },
  { lang: 'ja', trans: 'Lexar® Professional S™I™L™V™E™R™ CFexpress 4.0 Type A カード。' },
  { lang: 'ru', trans: 'Карта Lexar® Professional S™I™L™V™E™R™ CFexpress 4.0 Type A.' },
]
for (const tc of spamByLang) {
  const restored = restoreTrademarkSymbols([srcMulti], [tc.trans])[0]
  assert(hasTrademarkSpam(restored) === false, `D-${tc.lang} 散弹被清除`, restored)
  assert(restored.includes('SILVER') === true, `D-${tc.lang} SILVER 完整`, restored)
}

// ─────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`)
console.log(`结果: ${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exit(1)
