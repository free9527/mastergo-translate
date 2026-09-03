// ═══════════════════════════════════════════════════════════════
// v12.14 同词多™逐实例恢复测试
// 背景（2026-09-03 zh-TW 实机实锤）：
//   源文 "CFexpress™ 4.0 ... CFexpress™ 2.0"（同词双™）→ 译文第二个 CFexpress 丢™。
//   根因 = v12.6 去重修复的反向缺陷：v12.6 为治 CFexpress™™ 散弹把同词同符号去重
//   「锚第一个实例」，第二个实例的™随之丢失。v12.14 升级为游标逐实例消费：
//   restore 与 checkTrademarkIntegrity（硬锁⑥层）同语义改造，严格对齐无冲突。
// A 段：restoreTrademarkSymbols 逐实例恢复（正反样例 + 回归守护）
// B 段：checkTrademarkIntegrity（经 validatePolishOutput 第⑥层）逐实例校验
// C 段：20 语种冒烟（用户报告的 zh-TW 实机例句，逐语种模拟同词双™场景）
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
// A 段：restoreTrademarkSymbols 逐实例恢复
// ─────────────────────────────────────────────────────────────
console.log('\n[A] restoreTrademarkSymbols 逐实例恢复')

// A1: 用户实机事故例句——同词双™（CFexpress™ ×2），译文两个实例都要恢复™
const srcUser = 'The Lexar® Professional SILVER CFexpress™ 4.0 Type A Card delivers speeds more than twice as fast as our previous Professional SILVER CFexpress™ 2.0 Type A cards.'
const transUser = 'Lexar® Professional SILVER CFexpress™ 4.0 Type A 記憶卡的速度比上一代 Lexar Professional SILVER CFexpress 2.0 Type A 記憶卡快逾兩倍。'
const restoredUser = restoreTrademarkSymbols([srcUser], [transUser])[0]
const tmCountUser = (restoredUser.match(/™/g) || []).length
assert(tmCountUser === 2, 'A1-1 实机例句：两个 CFexpress 实例都有™', restoredUser)
assert(restoredUser.includes('CFexpress™ 4.0'), 'A1-2 第一个实例 CFexpress™ 4.0', restoredUser)
assert(restoredUser.includes('CFexpress™ 2.0'), 'A1-3 第二个实例 CFexpress™ 2.0（事故点）', restoredUser)
assert((restoredUser.match(/®/g) || []).length === 1, 'A1-4 Lexar® 单®（译文只有一个 Lexar 实例）', restoredUser)
assert(hasTrademarkSpam(restoredUser) === false, 'A1-5 恢复后无散弹')

// A2: v12.6 事故回归守护——译文已自带第一个™时，第二个实例恢复后绝不能出 CFexpress™™
const transA2 = 'Lexar® Professional SILVER CFexpress™ 4.0 記憶卡比上一代 CFexpress™ 2.0 記憶卡快兩倍。'
const restoredA2 = restoreTrademarkSymbols([srcUser], [transA2])[0]
assert(!restoredA2.includes('™™'), 'A2-1 v12.6 回归：绝不产生 CFexpress™™', restoredA2)
assert((restoredA2.match(/™/g) || []).length === 2, 'A2-2 双实例各自™（不叠加不丢失）', restoredA2)

// A3: 散弹剥离后逐实例重插（LLM 全丢™场景——剥光后两个实例都要补回）
const transA3 = 'Lexar Professional SILVER CFexpress 4.0 Type A 記憶卡比上一代 CFexpress 2.0 記憶卡快兩倍。'
const restoredA3 = restoreTrademarkSymbols([srcUser], [transA3])[0]
assert((restoredA3.match(/™/g) || []).length === 2, 'A3-1 全丢™场景：两个实例都补回', restoredA3)
assert((restoredA3.match(/®/g) || []).length >= 1, 'A3-2 Lexar® 至少恢复一处', restoredA3)

// A4: 不同词同符号不受影响（microSDHC™/microSDXC™ 各自恢复——v12.6 注释明示场景）
const srcA4 = 'Supports microSDHC™ and microSDXC™ cards with microSDHC™ UHS-I speeds.'
const transA4 = '支援 microSDHC 和 microSDXC 記憶卡，具備 microSDHC UHS-I 速度。'
const restoredA4 = restoreTrademarkSymbols([srcA4], [transA4])[0]
assert(restoredA4.includes('microSDHC™ UHS-I'), 'A4-1 microSDHC 第二实例™恢复', restoredA4)
assert(restoredA4.includes('microSDXC™'), 'A4-2 microSDXC™ 恢复', restoredA4)
assert((restoredA4.match(/™/g) || []).length === 3, 'A4-3 三个™实例全部恢复', restoredA4)

// A5: 译文实例数少于源文（LLM 合并重复产品名）→ v12.14 不变量：™序列恒等于源文——
//   未锚定实例以「词+™」原子补插在已确认实例后（用户拍板：™词不可翻译+™恒在品牌词后，
//   漏™不可接受；补插是唯一不依赖 LLM 配合的归位手段）。输出无散弹、无词中间™。
const srcA5 = 'The CFexpress™ 4.0 Card outperforms CFexpress™ 2.0 and CFexpress™ 1.0 cards.'
const transA5 = 'CFexpress 4.0 記憶卡效能超越前代產品。'  // 译文只提一次产品名
const restoredA5 = restoreTrademarkSymbols([srcA5], [transA5])[0]
const a5TmCount = (restoredA5.match(/™/g) || []).length
assert(a5TmCount === 3, 'A5-1 不变量：™数==源文实例数（3个，未锚定原子补插）', restoredA5)
assert(hasTrademarkSpam(restoredA5) === false && !restoredA5.includes('™™'), 'A5-2 无散弹无™™', restoredA5)
assert(!/[A-Za-z]™[a-z]/.test(restoredA5), 'A5-3 无词中间™（确认位白名单清场）', restoredA5)
assert(restoredA5.includes('CFexpress 4.0 記憶卡'), 'A5-4 译文原文段完整保留（补插不破坏译文主体）', restoredA5)

// A6: 同词不同符号互不干扰（Lexar® 与 CompactFlash® + CFexpress™ 混合）
const srcA6 = 'Lexar® is a member of the CompactFlash® Association, advancing CFexpress™ standards for CFexpress™ cards.'
const transA6 = 'Lexar 是 CompactFlash Association 的成員，推動 CFexpress 標準與 CFexpress 記憶卡發展。'
const restoredA6 = restoreTrademarkSymbols([srcA6], [transA6])[0]
assert((restoredA6.match(/®/g) || []).length === 2, 'A6-1 两个®（Lexar®/CompactFlash®）', restoredA6)
assert((restoredA6.match(/™/g) || []).length === 2, 'A6-2 两个 CFexpress™', restoredA6)

// A7: 单™场景回归（v12.4 B 段行为不变）
const srcA7 = 'The Lexar® Professional SILVER CFexpress™ 4.0 Type A Card delivers speeds.'
const transA7 = 'Die Lexar Professional SILVER CFexpress 4.0 Typ A Karte liefert Geschwindigkeiten.'
const restoredA7 = restoreTrademarkSymbols([srcA7], [transA7])[0]
assert(restoredA7.includes('Lexar®') && restoredA7.includes('CFexpress™'), 'A7 单™单® 正常恢复', restoredA7)

// A8: 逐字母散弹防护不回归——同词双™但译文是逐字母大写形态，插入位被 isSpamPosition 拦截
const srcA8 = 'CFexpress™ technology powers CFexpress™ cards.'
const transA8 = 'C™F™express™ technology powers CFEXPRESS cards.'  // 散弹形态
const restoredA8 = restoreTrademarkSymbols([srcA8], [transA8])[0]
assert(hasTrademarkSpam(restoredA8) === false, 'A8 散弹先剥离再恢复，无残留散弹', restoredA8)

// ─────────────────────────────────────────────────────────────
// B 段：checkTrademarkIntegrity（validatePolishOutput 第⑥层）逐实例校验
// ─────────────────────────────────────────────────────────────
console.log('\n[B] 硬锁⑥层 ™完整性逐实例校验')

// B1: 润色把第二个™润没了 → 必须拦截回退（v12.14 新防线——旧版只校验第一个实例会漏放）
const polishedLost = 'Lexar® Professional SILVER CFexpress™ 4.0 Type A 記憶卡的速度比上一代 CFexpress 2.0 Type A 記憶卡快逾兩倍。'
const vB1 = validatePolishOutput(srcUser, polishedLost, 'zh-TW')
assert(vB1.ok === false, 'B1-1 第二实例丢™ 被拦截', vB1.reason)
assert((vB1.reason || '').includes('™完整性'), 'B1-2 拦截原因为™完整性', vB1.reason)

// B2: 双实例™齐全 → 放行
const polishedOk = 'Lexar® Professional SILVER CFexpress™ 4.0 Type A 記憶卡的速度比上一代 CFexpress™ 2.0 Type A 記憶卡快逾兩倍。'
const vB2 = validatePolishOutput(srcUser, polishedOk, 'zh-TW')
assert(vB2.ok === true, 'B2 双实例™齐全 放行', vB2.reason)

// B3: 双实例都丢™ → 拦截（报第一个缺失实例即可）
const polishedNone = 'Lexar Professional SILVER CFexpress 4.0 Type A 記憶卡比上一代 CFexpress 2.0 記憶卡快兩倍。'
const vB3 = validatePolishOutput(srcUser, polishedNone, 'zh-TW')
assert(vB3.ok === false, 'B3 全丢™ 被拦截', vB3.reason)

// B4: 单™源文回归——v12.6 既有行为不变
const vB4 = validatePolishOutput(srcA7, 'Die Lexar® Professional SILVER CFexpress™ 4.0 Typ A Karte liefert hohe Geschwindigkeiten.', 'de')
assert(vB4.ok === true, 'B4 单™单® 源文正常放行', vB4.reason)

// B5: 游标语序——源文同词双™但语序不影响校验（译文实例按出现顺序消费）
const vB5 = validatePolishOutput(srcUser, polishedOk, 'zh-TW')
assert(vB5.ok === true && (polishedOk.match(/™/g) || []).length === 2, 'B5 游标消费语义稳定')

// ─────────────────────────────────────────────────────────────
// C 段：20 语种冒烟（用户实机例句结构，逐语种模拟同词双™恢复）
//   形式层验证：restore 逻辑语言无关（词锚定+游标消费），20 语种全部应恢复双™
// ─────────────────────────────────────────────────────────────
console.log('\n[C] 20 语种冒烟——同词双™逐实例恢复')

const langSimulations: Array<{ lang: string; trans: string }> = [
  { lang: 'de',    trans: 'Die Lexar® Professional SILVER CFexpress™ 4.0 Typ A Karte ist mehr als doppelt so schnell wie unsere bisherigen Professional SILVER CFexpress 2.0 Typ A Karten.' },
  { lang: 'es',    trans: 'La tarjeta Lexar® Professional SILVER CFexpress™ 4.0 Type A ofrece velocidades más del doble que nuestras anteriores tarjetas Professional SILVER CFexpress 2.0 Type A.' },
  { lang: 'fr',    trans: 'La carte Lexar® Professional SILVER CFexpress™ 4.0 Type A offre des vitesses deux fois supérieures à celles de nos anciennes cartes Professional SILVER CFexpress 2.0 Type A.' },
  { lang: 'it',    trans: 'La scheda Lexar® Professional SILVER CFexpress™ 4.0 Type A offre velocità più che doppie rispetto alle precedenti schede Professional SILVER CFexpress 2.0 Type A.' },
  { lang: 'pt',    trans: 'O cartão Lexar® Professional SILVER CFexpress™ 4.0 Type A oferece velocidades mais do que o dobro dos nossos cartões anteriores Professional SILVER CFexpress 2.0 Type A.' },
  { lang: 'pt-BR', trans: 'O cartão Lexar® Professional SILVER CFexpress™ 4.0 Type A oferece velocidades mais de duas vezes maiores que nossos cartões anteriores Professional SILVER CFexpress 2.0 Type A.' },
  { lang: 'nl',    trans: 'De Lexar® Professional SILVER CFexpress™ 4.0 Type A-kaart levert snelheden die meer dan twee keer zo hoog zijn als onze vorige Professional SILVER CFexpress 2.0 Type A-kaarten.' },
  { lang: 'pl',    trans: 'Karta Lexar® Professional SILVER CFexpress™ 4.0 Type A zapewnia prędkości ponad dwa razy wyższe niż nasze poprzednie karty Professional SILVER CFexpress 2.0 Type A.' },
  { lang: 'ru',    trans: 'Карта Lexar® Professional SILVER CFexpress™ 4.0 Type A обеспечивает скорость более чем в два раза выше, чем наши предыдущие карты Professional SILVER CFexpress 2.0 Type A.' },
  { lang: 'sv',    trans: 'Lexar® Professional SILVER CFexpress™ 4.0 Type A-kortet ger hastigheter mer än dubbelt så höga som våra tidigare Professional SILVER CFexpress 2.0 Type A-kort.' },
  { lang: 'tr',    trans: 'Lexar® Professional SILVER CFexpress™ 4.0 Type A Kart, önceki Professional SILVER CFexpress 2.0 Type A kartlarımızdan iki katından daha hızlıdır.' },
  { lang: 'vi',    trans: 'Thẻ Lexar® Professional SILVER CFexpress™ 4.0 Type A mang lại tốc độ nhanh hơn gấp đôi so với thẻ Professional SILVER CFexpress 2.0 Type A thế hệ trước.' },
  { lang: 'ja',    trans: 'Lexar® Professional SILVER CFexpress™ 4.0 Type A カードは、従来の Professional SILVER CFexpress 2.0 Type A カードの2倍以上の速度を実現します。' },
  { lang: 'ko',    trans: 'Lexar® Professional SILVER CFexpress™ 4.0 Type A 카드는 이전 Professional SILVER CFexpress 2.0 Type A 카드보다 두 배 이상 빠른 속도를 제공합니다.' },
  { lang: 'zh-CN', trans: 'Lexar® Professional SILVER CFexpress™ 4.0 Type A 存储卡的速度比我们上一代 Professional SILVER CFexpress 2.0 Type A 存储卡快两倍以上。' },
  { lang: 'zh-TW', trans: 'Lexar® Professional SILVER CFexpress™ 4.0 Type A 記憶卡的速度比上一代 Lexar Professional SILVER CFexpress 2.0 Type A 記憶卡快逾兩倍。' },
  { lang: 'th',    trans: 'การ์ด Lexar® Professional SILVER CFexpress™ 4.0 Type A ให้ความเร็วมากกว่าสองเท่าของการ์ด Professional SILVER CFexpress 2.0 Type A รุ่นก่อน' },
  { lang: 'ar',    trans: 'توفر بطاقة Lexar® Professional SILVER CFexpress™ 4.0 Type A سرعات تفوق ضعف سرعة بطاقاتنا السابقة Professional SILVER CFexpress 2.0 Type A.' },
  { lang: 'en',    trans: 'The Lexar® Professional SILVER CFexpress™ 4.0 Type A Card delivers speeds more than twice as fast as our previous Professional SILVER CFexpress 2.0 Type A cards.' },
  { lang: 'id',    trans: 'Kartu Lexar® Professional SILVER CFexpress™ 4.0 Type A menghadirkan kecepatan lebih dari dua kali lipat kartu Professional SILVER CFexpress 2.0 Type A kami sebelumnya.' },
]

for (const { lang, trans } of langSimulations) {
  const restored = restoreTrademarkSymbols([srcUser], [trans])[0]
  const tmCount = (restored.match(/™/g) || []).length
  const secondOk = restored.includes('CFexpress™ 2.0')
  assert(tmCount === 2 && secondOk && !restored.includes('™™') && !hasTrademarkSpam(restored),
    `C-${lang} 双™逐实例恢复（第二实例 CFexpress™ 2.0）`,
    restored)
}

// ─────────────────────────────────────────────────────────────
console.log(`\nv12.14 结果: ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
