// ============================================================
// 内置·第三方品牌设备/型号名（代码内置，v11.9）
// ============================================================
//
// 背景（v11.8 实机事故）：第三方设备/型号名被 LLM 加戏
// （"Kameramodell: Luna Ultra" / "Handheld-Konsole Legion Go" / Steam→"Dampf"）。
// v11.8 的修法是把它们做成术语库 identity 行——但那是把「保护机制」放在用户
// 可覆盖/可删除的 CSV 里：用户替换或精简术语库后，三层防线（S1 短路 / S2 遮蔽 /
// isUntranslatable 豁免）静默失效。v11.9 把第三方词条从用户术语库下沉为
// 代码内置层，由 buildGlossaryMaps() 三方合并（内置第三方 ∪ 用户产品名 ∪
// 用户专属），内置只进内存、不进 clientStorage，撞 source 时内置优先。
//
// 收录原则（宁漏勿滥，事故/高频驱动）：
//   ✅ 具体型号名（含数字/专有 token 的多词组合）——歧义极低
//   ⚠️ 裸词仅在「已发生实机事故」时收录（Steam，与 PLAY/Honor 裸词行同型先例）
//   ⛔ 高频普通词裸形态一律不收（Pocket / Action / Legion / Luna / Air / Mini / Max …）
//      —— 遮蔽是子串匹配，收裸词 = 大面积过遮蔽（错保留 < 错翻译，宁漏勿滥）
//
// 维护：新第三方型号事故 → 往这里加词（不是加到术语库 CSV）。

import { GlossaryEntry } from '@messages/types'

/** 内置第三方型号名（全语言 identity：任何目标语言下都原样保留） */
const BUILTIN_THIRD_PARTY_TERMS: string[] = [
  // ── v11.8 实机事故词条（原专属 CSV identity 行，v11.9 下沉）──
  'Steam Deck', 'Legion Go', 'ROG ALLY', 'G Cloud',
  'Osmo 360', 'Antigravity A1', 'Luna Ultra',
  'Pocket 4P', 'Pocket 4', 'Pocket 3', 'Pocket 2', 'Action 6',
  'Mavic 4 Pro', 'Mavic 3', 'Mavic 2 Pro',
  'Steam',
  // ── v11.10 实机兼容列表补录（2026-08-13 用户实机格式驱动）──
  // 收录原则同上：数字结尾的具体型号形态，避让裸词/子串嵌套（遮蔽无边界保护）。
  // GoPro：连写 Black 整收（防 'Hero 13' 遮蔽后裸留 Black 被翻成「黑色」），
  //        另收裸数字代（防用户不带 Black 写）；'GoPro Max' 带品牌避让裸 'Max'。
  'Hero 13 Black', 'Hero 12 Black', 'Hero 11 Black', 'Hero 10 Black',
  'Hero 9 Black', 'Hero 8 Black', 'Hero 7 Black',
  'Hero 13', 'Hero 12', 'Hero 11', 'Hero 10', 'Hero 9', 'Hero 8', 'Hero 7',
  'GoPro Max',
  // DJI Action 代际补全（'Osmo Action 5 Pro' 已在下方，此处补 3 与裸数字代）
  'Osmo Action 3', 'Action 5 Pro', 'Action 4', 'Action 3', 'Action 2',
  // 其余实机缺口
  'Pocket 1', 'Mini 2', 'Mini 4', 'Mini 2 SE', 'Osmo Nano',
  'Switch Lite', 'Ace Pro 2', 'GO Ultra', 'GO 4',
  // ── v11.9 高频兼容场景预先收录（具体型号形态）──
  // 掌机
  'ROG ALLY X', 'Switch 2', 'Switch OLED', 'Nintendo Switch',
  // 苹果
  'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone Air',
  'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16e', 'iPhone 16',
  'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15',
  'iPad Pro', 'iPad Air', 'iPad mini',
  'MacBook Pro', 'MacBook Air', 'Apple Watch Ultra', 'AirPods Pro',
  // 三星
  'Galaxy S25 Ultra', 'Galaxy S25 Edge', 'Galaxy S25',
  'Galaxy S24 Ultra', 'Galaxy S24', 'Galaxy S23 Ultra', 'Galaxy S23',
  'Galaxy Z Fold7', 'Galaxy Z Fold6', 'Galaxy Z Flip7', 'Galaxy Z Flip6',
  'Galaxy Tab S10', 'Galaxy Tab S9', 'Galaxy Buds3 Pro', 'Galaxy Buds3',
  // 影像（DJI / GoPro / Insta360）
  'Osmo Pocket 3', 'Osmo Action 5 Pro', 'Osmo Action 4',
  'Mavic 3 Pro', 'Mini 4 Pro', 'Mini 3', 'Air 3S', 'Air 3',
  'Avata 2', 'Ronin 4D', 'RS 4 Pro', 'RS 4',
  'Inspire 3', 'Mic 2', 'Mic Mini', 'Ace Pro',
  'GoPro Hero 13', 'GoPro Hero 12', 'GoPro MAX',
  'Insta360 X5', 'Insta360 X4', 'Insta360 Ace Pro 2', 'Insta360 Ace Pro',
  'Insta360 GO 3S', 'Insta360 GO 3',
  // 索尼 / 佳能 / 尼康（相机产品线）
  'A7R V', 'A7 IV', 'A7C II', 'A7S III', 'FX3', 'FX30',
  'ZV-E10 II', 'ZV-E10', 'ZV-1 II', 'A9 III', 'A6700',
  'WH-1000XM5', 'WF-1000XM5',
  'EOS R5 Mark II', 'EOS R5', 'EOS R6 Mark II', 'EOS R6',
  'EOS R50', 'EOS R8', 'EOS R1', 'EOS R3',
  'PowerShot G7 X Mark III', 'Z9', 'Z8', 'Z6 III', 'Zf',
  // 外设（Logitech / Razer / Keychron）
  'MX Master 3S', 'MX Keys S', 'MX Anywhere 3S',
  'G PRO X Superlight 2', 'G PRO X Superlight', 'G502 X', 'G PRO X',
  'BlackWidow V4 Pro', 'DeathAdder V3 Pro', 'Viper V3 Pro',
  'Huntsman V3 Pro', 'Basilisk V3 Pro', 'Blade 16',
  'Keychron K2', 'Keychron K8', 'Keychron Q1',
]

/** 展开为 GlossaryEntry（全语言 identity：translations 全列 = source） */
function identityEntry(source: string): GlossaryEntry {
  return { source, translations: { '*': source } }
}

/**
 * 内置第三方词条（GlossaryEntry[]）。
 * translations 用通配键 '*' 存 identity 值——由 buildGlossaryMaps() 识别并
 * 对任意目标语言注册（该键永不等于真实语言代码，不会与自然 key 冲突）。
 */
export const BUILTIN_THIRD_PARTY_ENTRIES: GlossaryEntry[] =
  BUILTIN_THIRD_PARTY_TERMS.map(identityEntry)
