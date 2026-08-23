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
const BUILTIN_THIRD_PARTY_TERMS_INTERNAL: string[] = [
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
  // ── v11.13 实机兼容列表补录（2026-08-14 用户兼容性列表事故）──
  // 收录原则同上：形态规则（含数字型号/型号列表）接不住的才靠收录兜底。
  // 'MAX 360' 不收——BRAND_GRADE_RE 的 \bMAX\b 已短路豁免（Lexar 等级词）。
  // 'Bones' / 'Switch NS' / 裸 'Mini' 不进本表——无数字裸词进遮蔽表会子串过遮蔽
  //   （遮蔽匹配无词边界，'Mini' 会切碎 'Mini 3 Pro' 既有词条），
  //   由下方整词豁免名单承接（只豁免不遮蔽）；'Mini' 作为列表段由
  //   isModelListOrCode 的配套段名单（BUILTIN_MODEL_SEGMENT_SET）承接。
  'Hero11 Black', 'Hero10 Black', 'Mavic Pro', 'Mavic Mini', 'Mini 5 Pro', 'Mini2',
  'Mini 3 Pro',
  'Avata 360', 'Lito 1', 'Lito X1',
]

/**
 * 整词豁免名单（v11.13）：整条文本精确匹配命中即豁免翻译。
 *
 * 与 BUILTIN_THIRD_PARTY_TERMS 的关键区别：本名单【不进遮蔽表】。
 * 收录的都是裸品牌词/无数字短型号（DJI/GoPro/Nintendo/Bones/Switch NS…），
 * 若进遮蔽表做子串匹配，正文里每一次提及都会被遮蔽，大面积过遮蔽、挤占遮蔽配额。
 * 但实机兼容性列表中它们常以【独立文本节点】出现（整条文本就是这个词），
 * 此时整词匹配豁免零过遮蔽风险。
 *
 * 接入点：isUntranslatable（S1 短路 + 漏翻豁免）+ isSuspectMisspelledWord
 * （Nintendo/Lenovo/Logitech 形态上踩中 /^[A-Za-z]{6,}$/ 疑似错词，须前置豁免）。
 *
 * 收录原则（事故驱动，宁漏勿滥）：
 *   ✅ 已发生实机事故的裸品牌词，按事故补录
 *   ⛔ 不预先铺开词典（Sony/Canon…未出事故不收）
 *   ⛔ 过短/多义 token 不收（'X2' 是影像格式名；裸 X5/X4/X3/X2 靠 isModelListOrCode
 *      形态规则豁免即可，无需收录）
 */
const BUILTIN_THIRD_PARTY_WHOLE_TEXT_TERMS: string[] = [
  // v11.13 实机事故裸品牌（2026-08-14 兼容性列表）
  'DJI', 'GoPro', 'Insta360', 'Nintendo', 'Lenovo', 'ASUS', 'Logitech',
  // 无数字型号形态（isModelListOrCode 单段要求含数字，永远接不住）
  'Bones',
  // 收录即遮蔽会切碎既有词条的型号（子串嵌套：'Hero 7 Black' ⊂ 'Hero 7 Black'…
  // 无嵌套但遮蔽有连带风险——'Hero 7' 已在遮蔽表，'Hero 7 Black' 整词豁免即可）
  'Hero 7 Black',
]

/**
 * 整词豁免判断：整条文本（归一化后）精确命中名单。
 * 归一化与 normalizeGlossaryKey 同口径：小写 + 去 ®™© + 去首尾空白。
 */
const WHOLE_TEXT_EXEMPT_SET = new Set(
  BUILTIN_THIRD_PARTY_WHOLE_TEXT_TERMS.map(t =>
    t.toLowerCase().replace(/[®™©]/g, '').trim()
  )
)

/**
 * v11.13: 裸品牌词加入遮蔽表——兼容性列表/正文中提及第三方品牌时，
 * 遮蔽为 __GLOSSARY_N__ 强制保留原文写法，这正是要的效果（品牌名任何语言都不译）。
 * ⚠️ 覆盖风险（有意为之的取舍，可靠性优先）：裸品牌词进遮蔽表后，正文中所有
 * 提及（'I use a GoPro camera'）都会被遮蔽保留原文。品牌名遮蔽"保留"永远是对的；
 * 子串嵌套由 maskGlossaryTerms 长度降序 + 重叠防护保证先锚长词
 * （'GoPro Hero 13 Black' 先锚 'Hero 13 Black'，剩余 'GoPro' 再锚——不切碎）。
 * v11.9 的'宁漏勿滥'针对的是【无事故预先铺开】；v11.13 这批词全部实机事故驱动。
 * ⛔ 遮蔽表与整词豁免的边界（名单即边界，改一处必须同步另一处）：
 *   - 只豁免不遮蔽：Bones / Hero 7 Black（切碎既有词条/子串风险）
 *   - 只豁免+遮蔽：DJI/GoPro/Insta360/Nintendo/Lenovo/ASUS/Logitech（裸品牌）
 *   - 只进段名单（不豁免不遮蔽）：Mini / Switch NS（无数字裸词段，切碎既有词条）
 */
const MASK_ONLY_WHOLE_TEXT = new Set([
  'DJI', 'GoPro', 'Insta360', 'Nintendo', 'Lenovo', 'ASUS', 'Logitech',
])
const BUILTIN_THIRD_PARTY_TERMS_COMBINED: string[] = [
  ...BUILTIN_THIRD_PARTY_TERMS_INTERNAL,
  ...BUILTIN_THIRD_PARTY_WHOLE_TEXT_TERMS.filter(t => MASK_ONLY_WHOLE_TEXT.has(t)),
]

/**
 * 型号段名单（v11.13）：只用于 isModelListOrCode 的段判定，不进遮蔽表、
 * 不做整词豁免。收录的是兼容性列表中实际出现的【无数字裸词段】——
 * isModelListOrCode 单段规则要求含数字或全大写，永远接不住它们。
 * 风险边界：段名单只在【整条文本全是型号段】的列表语境生效，
 * 正文子串/单条文本不受影响（'Mini' 单条仍不豁免——无数字形态规则接不住，
 * 但实机列表中它永远与兄弟型号同段出现）。
 */
const BUILTIN_MODEL_SEGMENT_SET: Set<string> = new Set(
  ['Mini', 'Switch NS'].map(t => t.toLowerCase().replace(/[®™©]/g, '').trim())
)

/** 段判定专用：归一化段是否命中型号段名单 */
export function isBuiltinModelSegment(seg: string): boolean {
  const key = (seg || '').toLowerCase().replace(/[®™©]/g, '').trim()
  return key.length > 0 && BUILTIN_MODEL_SEGMENT_SET.has(key)
}

export function isBuiltinThirdPartyWholeText(text: string): boolean {
  const key = (text || '').toLowerCase().replace(/[®™©]/g, '').trim()
  return key.length > 0 && WHOLE_TEXT_EXEMPT_SET.has(key)
}

/** 展开为 GlossaryEntry（全语言 identity：translations 全列 = source） */
function identityEntry(source: string): GlossaryEntry {
  return { source, translations: { '*': source } }
}

/** 归一化 key（与 normalizeGlossaryKey 同口径：小写 + 去®™© + trim） */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[®™©]/g, '').trim()
}

/**
 * 内置第三方词条（GlossaryEntry[]）。
 * translations 用通配键 '*' 存 identity 值——由 buildGlossaryMaps() 识别并
 * 对任意目标语言注册（该键永不等于真实语言代码，不会与自然 key 冲突）。
 */
export const BUILTIN_THIRD_PARTY_ENTRIES: GlossaryEntry[] =
  BUILTIN_THIRD_PARTY_TERMS_COMBINED.map(identityEntry)

/**
 * 内置词条全集归一化 key（遮蔽表 ∪ 整词豁免名单）。
 * 供 isUntranslatable 豁免查询 与 isModelListOrCode 段判定——
 * 收录（无论遮蔽表还是豁免名单）即钦定型号的形态认证。
 */
export const BUILTIN_THIRD_PARTY_ALL_KEYS: Set<string> = new Set(
  [
    ...BUILTIN_THIRD_PARTY_TERMS_COMBINED,
    ...BUILTIN_THIRD_PARTY_WHOLE_TEXT_TERMS,
  ].map(normKey)
)
