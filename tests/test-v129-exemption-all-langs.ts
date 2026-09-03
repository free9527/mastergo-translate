// ============================================================
// v12.9 违禁词豁免全语种对齐 + 润色违禁词硬锁
// ============================================================
// 背景（2026-08-27 用户拍板三条）：
//   ① 测试素材里已出现的常用表达都没出过问题 = 合规白名单
//      （「最大+速度/数字」「社内テスト」「厳格なテスト」等是存储行业标准上限表述，
//        非景品表示法绝对化宣称）
//   ② test 是绝对违禁词、最高级是违禁词（裸词红线不豁免——'テスト'/'最高'/'最速' 保留词表）
//   ③ 术语库的表达都经过检验，不用怀疑（钦定值命中由 App.vue 锁定徽章通道消化，
//      prohibitedLocked 退出待确认面板——画布徽章保留，面板卡片消失）
//
// 覆盖：
//   A ja 豁免正例（实机 5 张卡 + 测试素材三产品线官方 ja 文案形态）转绿
//   B ja 红线反例（裸 最大/最高/テスト 宣称）仍命中
//   C 数字锚定（最大# → 最大2TB/最大12,000回；无数字锚点不豁免）
//   D zh 对齐补漏 + en 回归（既有豁免不受影响）
//   E 通用化机制（无豁免表语种零影响 / 豁免缓存正确）
//   F 润色两道防线（术语库子串篡改回退【新增回归锁】+ 第⑧层违禁词回检）
// ============================================================

import { detectProhibited } from '../lib/prohibited-check'
import { validatePolishOutput } from '../lib/polish-guard'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}
/** 命中词列表（便捷） */
function hits(text: string, lang: string): string[] {
  return detectProhibited(text, lang).map(h => h.word)
}

// ────────────────────────────────────────────────────────────
console.log('\nA. ja 豁免正例（实机 5 张卡 + 素材形态 → 全部转绿）')

// A1-A3 实机截图三张术语库锁定卡（豁免后连锁定徽章都不再有——先决条件是不命中）
assert(hits('書き込み速度最大', 'ja').length === 0, 'A1 書き込み速度最大（术语库 Write speed up to 钦定值）')
assert(hits('読み出し速度最大', 'ja').length === 0, 'A2 読み出し速度最大（术语库 Read speed up to 钦定值）')
assert(hits('厳格なテスト済み', 'ja').length === 0, 'A3 厳格なテスト済み（术语库 Rigorously Tested 钦定值）')
assert(hits('厳格なテストに合格', 'ja').length === 0, 'A3b 厳格なテストに合格（DIAMOND 素材文案——「厳格なテストに」豁免）')

// A4-A5 实机截图两张非锁定卡（豁免后不再产生校对改写卡）
assert(hits('持続書き込み速度最大', 'ja').length === 0, 'A4 持続書き込み速度最大（Sustained write speed up to 自由译文）')
assert(
  hits('* 速度は社内テストに基づくものです。実際のパフォーマンスは異なる場合があります。', 'ja').length === 0,
  'A5 社内テスト脚注（Speeds based on internal testing 自由译文）'
)

// A6-A11 测试素材三产品线官方 ja 文案形态（ARMOR GOLD / DIAMOND / PLAY PRO）
assert(hits('最大ライト速度210MB/s', 'ja').length === 0, 'A6 最大ライト速度（素材官方写法）')
assert(hits('最大リード速度280MB/s', 'ja').length === 0, 'A7 最大リード速度（素材官方写法）')
assert(hits('最大リード速度3700 MB/s*', 'ja').length === 0, 'A8 最大リード速度带星号（DIAMOND 素材）')
assert(hits('最大持続書き込み速度3200 MB/s*', 'ja').length === 0, 'A9 最大持続書き込み速度（DIAMOND 素材）')
assert(hits('社内テストに基づいています。実際のパフォーマンスは異なる場合があります。', 'ja').length === 0, 'A10 社内テストに基づく（素材脚注）')
assert(hits('広範なテストが実施されています', 'ja').length === 0, 'A11 広範なテスト（品质ラボ文案）')

// A12-A14 术语库其他 ja 钦定值（最大限に 搭配）
assert(hits('高性能ヒートシンク搭載でDDR5の性能を最大限に発揮', 'ja').length === 0, 'A12 最大限に発揮（DDR5 Heatsink 术语库值）')
assert(hits('あなたの可能性を最大限に引き出す', 'ja').length === 0, 'A13 最大限に引き出す（Unleash Potential 术语库值）')
assert(hits('主流のカメラにおける最大動作温度は-15℃～60℃', 'ja').length === 0, 'A14 最大動作温度（ARMOR GOLD 温度规格）')

// ────────────────────────────────────────────────────────────
console.log('\nC. 数字锚定（最大# —— 有数字豁免，无数字不豁免）')

assert(hits('最大12,000回の挿抜に対応', 'ja').length === 0, 'C1 最大12,000回（千分位逗号）')
assert(hits('最大2TBの大容量', 'ja').length === 0, 'C2 最大2TB（容量）')
assert(hits('最大5メートルの落下にも耐える', 'ja').length === 0, 'C3 最大5メートル（跌落）')
assert(hits('最大370ニュートン（通常のSDカードの37倍）', 'ja').length === 0, 'C4 最大370ニュートン（耐压）')
assert(hits('最大30000 TBW', 'ja').length === 0, 'C5 最大30000TBW（寿命）')
assert(hits('最大の性能を実現', 'ja').length > 0, 'C6 红线：最大の性能（无数字锚点，仍命中）')

// ────────────────────────────────────────────────────────────
console.log('\nB. ja 红线反例（裸宣称不豁免，仍命中）')

assert(hits('最大の性能を実現！', 'ja').length > 0, 'B1 最大の性能（裸绝对化宣称）')
assert(hits('最高の転送速度', 'ja').length > 0, 'B2 最高の転送速度（最高级红线）')
assert(hits('最速のカード', 'ja').length > 0, 'B3 最速のカード（最高级红线）')
assert(hits('当店テスト品質保証', 'ja').length > 0, 'B4 裸テスト宣称（test 绝对违禁词）')
assert(hits('厳格なテストを実施', 'ja').length > 0, 'B4b 裸「厳格なテストを実施」（动词形态无「済み」锚，仍命中——v1112 B27 对齐）')
assert(hits('一番のメモリカード', 'ja').length > 0, 'B5 一番（排名绝对化）')
assert(hits('No.1の性能', 'ja').length > 0, 'B6 No.1（排名绝对化）')
assert(hits('完璧な性能', 'ja').length > 0, 'B7 完璧（绝对化）')
assert(hits('世界最強のカード', 'ja').length > 0, 'B8 最強（最高级红线）')

// ────────────────────────────────────────────────────────────
console.log('\nD. zh 对齐补漏 + en 回归（既有豁免不受影响）')

assert(hits('最大读取速度 2050MB/s', 'zh-CN').length === 0, 'D1 zh 最大读取速度（v12.9 补漏）')
assert(hits('最大写入速度 1650MB/s', 'zh-CN').length === 0, 'D2 zh 最大写入速度（v12.9 补漏）')
assert(hits('最大容量2TB', 'zh-CN').length === 0, 'D3 zh 最大容量（既有豁免）')
assert(hits('读取速度最高可达2050MB/s', 'zh-CN').length === 0, 'D4 zh 最高可达（既有豁免不回退）')
assert(hits('最佳性能', 'zh-CN').length > 0, 'D5 zh 红线：最佳（裸宣称仍命中）')
assert(hits('Limited Lifetime Warranty', 'en').length === 0, 'D6 en 既有豁免不回退（v12.3.3）')
assert(hits('Video Performance Guarantee 200', 'en').length === 0, 'D7 en VPG 豁免不回退（v12.3.3）')
assert(hits('lifetime warranty', 'en').length > 0, 'D8 en 红线：裸 lifetime warranty 仍命中')
assert(hits('speed test', 'en').length > 0, 'D9 en 红线：speed test 仍命中')

// v12.10 en 绝对化词语境锚定豁免（2026-08-28 用户拍板 A 方案——与 ja「最大+速度/数字」同纪律）
assert(hits('Ultimate Performance for AI PC', 'en').length === 0, 'D10 en Ultimate Performance 标题锚定豁免（实机卡）')
assert(hits('Unleashing ultimate performance', 'en').length === 0, 'D10b en Unleashing ultimate performance 句内锚定豁免（实机卡）')
assert(hits('The perfect match for AI PCs', 'en').length === 0, 'D11 en perfect match 固定搭配豁免（实机卡）')
assert(hits('Best Match for AI PCs', 'en').length === 0, 'D12 en Best Match 标题锚定豁免（实机卡）')
assert(hits('The NM1090 PRO SSD offers superior Gen 5 performance', 'en').length === 0, 'D13 en superior Gen 规格语境豁免（实机卡）')
assert(hits('Ultimate performance!', 'en').length > 0, 'D14 en 红线：裸 ultimate 宣称仍命中（无锚）')
assert(hits('This is the best SSD', 'en').length > 0, 'D15 en 红线：裸 best 宣称仍命中（无 Best Match 锚）')
assert(hits('superior performance for gaming', 'en').length > 0, 'D16 en 红线：裸 superior 宣称仍命中（无 Gen 锚）')

// ────────────────────────────────────────────────────────────
console.log('\nE. 通用化机制（无豁免表语种零影响）')

assert(hits('beste Leistung', 'de').length > 0, 'E1 de 无豁免表，beste 仍命中（词表工作）')
assert(hits('maximum speed', 'de').length === 0, 'E2 de "maximum" 本就不在词表（无为而治）')
assert(hits('mejor rendimiento', 'es').length > 0, 'E3 es 无豁免表，mejor 仍命中')
// E4: ja 豁免不影响其他词表——ko 的 테스트 裸词仍命中
assert(hits('완벽한 성능', 'ko').length > 0, 'E4 ko 无豁免表，완벽 仍命中')

// ────────────────────────────────────────────────────────────
console.log('\nG. v12.11 亚马逊官方清单增补（en +19 / pt-BR +1 / it +2）')

// G1-G19 en 新词命中（OEC 清单落位，全部无合法语义歧义）
assert(hits('Unbeatable speed for gaming', 'en').includes('unbeatable'), 'G1 unbeatable 命中')
assert(hits('Amazing performance', 'en').includes('amazing'), 'G2 amazing 命中')
assert(hits('Premium quality memory card', 'en').includes('premium'), 'G3 premium 命中')
assert(hits('Award winning design', 'en').includes('award winning'), 'G4 award winning 命中')
assert(hits('Proven reliability', 'en').includes('proven'), 'G5 proven 命中（ASA 审查词）')
assert(hits('Best seller in storage', 'en').includes('best seller'), 'G6 best seller 命中（重叠取最长——只报 best seller 不报 best）')
assert(hits('Bestselling microSD card', 'en').includes('bestselling'), 'G7 bestselling 命中')
assert(hits('Big discount today', 'en').includes('discount'), 'G8 discount 命中')
assert(hits('Wholesale price available', 'en').includes('wholesale'), 'G9 wholesale 命中')
assert(hits('Free shipping included', 'en').includes('free shipping'), 'G10 free shipping 命中')
assert(hits('Buy one get one free', 'en').includes('buy one get one'), 'G11 buy one get one 命中')
assert(hits('Money back if not satisfied', 'en').includes('money back'), 'G12 money back 命中（重叠取最长——不报 guarantee 系）')
assert(hits('100% waterproof design', 'en').includes('100% waterproof'), 'G13 100% waterproof 命中')
assert(hits('Unbreakable housing', 'en').includes('unbreakable'), 'G14 unbreakable 命中')
assert(hits('Indestructible metal body', 'en').includes('indestructible'), 'G15 indestructible 命中')
assert(hits('Works with all devices', 'en').includes('works with all'), 'G16 works with all 命中')
assert(hits('Universal compatibility guaranteed', 'en').includes('universal compatibility'), 'G17 universal compatibility 命中')
assert(hits('Lasts forever, never fails', 'en').includes('lasts forever') && hits('Lasts forever, never fails', 'en').includes('never fails'), 'G18 lasts forever + never fails 双命中')
assert(hits('Enterprise grade reliability', 'en').includes('enterprise grade'), 'G19 enterprise grade 命中')

// G20-G27 拒收词回归锁（宁漏勿滥红线——普通词/CTA 不收录，不得命中）
assert(hits('new generation controller', 'en').length === 0, 'G20 拒收回归：new（普通词不收）')
assert(hits('free up space for more games', 'en').length === 0, 'G21 拒收回归：free（普通词不收；free up 非 free shipping/gift）')
assert(hits('on sale now', 'en').length > 0 && !hits('on sale now', 'en').includes('sale'), 'G22 拒收回归：on sale 命中（既有词）但 sale 裸词不命中（拒收）')
assert(hits('Click here to learn more', 'en').length === 0, 'G23 拒收回归：CTA click here（不收）')
assert(hits('Buy now and enjoy', 'en').length === 0, 'G24 拒收回归：CTA buy now（不收）')
assert(hits('Seller refurbished model', 'en').length === 0, 'G25 边界：seller 不命中 best seller（词边界+空格弹性）')
assert(hits('Work with all your devices', 'en').length === 0, 'G26 边界：work with all（动词原形）不命中 works with all（第三人称形态）')
assert(hits('Performance for All', 'en').length === 0, 'G27 边界：for all 不命中 works with all（锚词 works 缺失）')

// G28-G30 既有豁免不被新词误伤（豁免表与新词交叉回归）
assert(hits('Ultimate Performance for AI PC', 'en').length === 0, 'G28 既有豁免不回退：Ultimate Performance for（v12.10）')
assert(hits('Video Performance Guarantee 200', 'en').length === 0, 'G29 既有豁免不回退：VPG（v12.3.3）')
assert(hits('Limited Lifetime Warranty', 'en').length === 0, 'G30 既有豁免不回退：LLW（v12.3.3）')

// G31-G34 pt-BR/it A+ 历史拦截补缺
assert(hits('testes rigorosos de qualidade', 'pt-BR').includes('testes'), 'G31 pt-BR testes 命中（BR 站真实拦截）')
assert(hits('Garanzia a vita limitata', 'it').includes('garanzia'), 'G32 it Garanzia 名词形态命中（IT 站真实拦截）')
assert(hits('Unità certificata per la velocità', 'it').includes('certificata'), 'G33 it certificata 命中（IT 站真实拦截）')
assert(hits('USB-IF certification compliant', 'it').length === 0, 'G34 it 边界：certification（完整合规词）不命中 certificata——拒收截断形态的意义')

// ────────────────────────────────────────────────────────────
console.log('\nF. 润色两道防线（术语库子串篡改 + 第⑧层违禁词回检）')

const glossary = new Map<string, string>([
  ['write speed up to', '書き込み速度最大'],
])

// F1 润色试图改术语库子串 → 回退（validatePolishOutput 第②层 enforceGlossaryTerms）
//   源文整条命中术语库时 isPolishEligible 已豁免（防线 1），此处测的是「译文嵌术语库子串」场景
{
  const src = 'Blazing write speed up to 2000MB/s for pro shooting'
  const prePolish = 'プロ撮影のための書き込み速度最大2000MB/s'
  // 润色把「最大」改成「最速」（引入违禁词 + 篡改规格表述）
  const polished = 'プロ撮影のための最速書き込み2000MB/s'
  const v = validatePolishOutput(src, polished, 'ja', glossary, prePolish)
  assert(!v.ok, 'F1 润色改规格表述（最大→最速）→ 回退')
}

// F2 第⑧层：润色引入新违禁词（润色前干净，润色后含违禁词）→ 回退
{
  const src = 'Delivers fast performance for everyday use'
  const prePolish = '日常使いに高速なパフォーマンスを発揮します'
  const polished = '日常使いに最高のパフォーマンスを発揮します' // 润色引入「最高」
  const v = validatePolishOutput(src, polished, 'ja', undefined, prePolish)
  assert(!v.ok && (v.reason || '').includes('违禁词'), 'F2 润色引入「最高」→ 第⑧层回退')
}

// F3 第⑧层：润色前后违禁词数不变 → 放行（润色前本就含违禁词的条目不背锅）
{
  const src = 'Rigorously tested for quality'
  const prePolish = '品質のため厳格なテスト済み' // 含 テスト（豁免形态，实际不命中——此处构造裸形态）
  const polished = '品質のため厳格なテスト済みです' // 同违禁词数（0→0 或同数）
  const v = validatePolishOutput(src, polished, 'ja', undefined, prePolish)
  assert(v.ok, 'F3 润色前后违禁词数不变（豁免形态 0 命中）→ 放行')
}

// F4 第⑧层缺省：不传 prePolish 时不启用违禁词校验（向后兼容 v12.8 调用形态）
{
  const src = 'Delivers fast performance'
  const polished = '最高のパフォーマンス' // 含「最高」但无 prePolish 基线
  const v = validatePolishOutput(src, polished, 'ja')
  assert(v.ok, 'F4 不传 prePolish → 第⑧层不启用（向后兼容）')
}

// ────────────────────────────────────────────────────────────
console.log('\nH. v12.15 zh「最高+规格」豁免补漏（实机 zh-TW 润色回退实锤驱动）')

// H1-H6 豁免正例（规格语境——数字锚/速度名词锚）
assert(hits('最高寫入速度高達 1650MB/s，持續寫入速度高達 1300MB/s', 'zh-TW').length === 0, 'H1 zh-TW 最高寫入速度高達1650MB/s（实机回退条目——豁免后不再触发硬锁⑧层）')
assert(hits('最高写入速度高达 1650MB/s', 'zh-CN').length === 0, 'H2 zh-CN 最高写入速度（简体同型）')
assert(hits('最高讀取速度 1750MB/s', 'zh-TW').length === 0, 'H3 zh-TW 最高讀取速度')
assert(hits('容量最高達 2TB，可儲存大量連拍照片', 'zh-TW').length === 0, 'H4 zh-TW 最高達#（数字锚定——实机「容量最高達 2TB」）')
assert(hits('容量最高达 2TB', 'zh-CN').length === 0, 'H5 zh-CN 最高达#（简体数字锚）')
assert(hits('耐插拔最高達 12,000 次插入／拔除', 'zh-TW').length === 0, 'H6 zh-TW 最高達 12,000 次（千分位数字锚——实机素材形态）')

// H7-H9 红线反例（裸宣称无规格锚点——仍命中，豁免不开洞）
assert(hits('最高性能，極致體驗', 'zh-TW').length > 0, 'H7 zh-TW 红线：裸「最高性能」（无数字/速度锚）仍命中')
assert(hits('最高品質保證', 'zh-TW').length > 0, 'H8 zh-TW 红线：裸「最高品質」仍命中')
assert(hits('最高速度，業界第一', 'zh-CN').length > 0, 'H9 zh-CN 红线：裸「最高速度」（无讀取/寫入名词锚）仍命中')

// H10 既有豁免交叉回归（v12.15 新条目不破既有）
assert(hits('读取速度最高可达2050MB/s', 'zh-CN').length === 0, 'H10 既有豁免不回退：最高可达（v12.9 既有）')

// H11 第⑧层闭环：豁免后的润色产物不再触发违禁词回退（实机事故形态全链验证）
{
  const src = 'Delivers max write speeds of up to 1650MB/s for pro shooting'
  const prePolish = '寫入速度高達 1650MB/s，為未來創作需求做好準備，支援不中斷連拍'
  const polished = '最高寫入速度高達 1650MB/s，為未來創作需求做好準備，支援不中斷連拍'
  const v = validatePolishOutput(src, polished, 'zh-TW', undefined, prePolish)
  assert(v.ok, 'H11 第⑧层闭环：潤色引入「最高寫入速度」（豁免形态）→ 放行（实机回退条目转绿）' + (v.ok ? '' : ` — ${v.reason}`))
}

// ────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════════════`)
console.log(`v12.9 结果: ${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
