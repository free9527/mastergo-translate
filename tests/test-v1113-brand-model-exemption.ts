/**
 * v11.13 第三方品牌/型号实机事故回归测试（2026-08-14 用户兼容性列表）
 *
 * 实机现象：兼容性列表中的第三方品牌/型号被标「翻译失败」「漏翻」「疑似拼写错误」，
 * 或直接发给 LLM 被翻译加戏。根因三重：
 *   RC1 代码 bug：text-normalizer.ts 把扫描文本换行符 → ' ↵ '（U+21B5），
 *       但 isModelListOrCode 只按斜杠/换行切分且段字符集不含 ↵ → 多行型号列表豁免整锅失败。
 *   RC2 覆盖缺口：裸品牌词（DJI/Nintendo/Lenovo/Logitech…）v11.9 刻意不收遮蔽表
 *       （宁漏勿滥），但作为独立文本节点出现时形态判定链全军覆没。
 *   RC3 错词误伤：Nintendo/Lenovo/Logitech 踩中 /^[A-Za-z]{6,}$/ 疑似错词形态。
 *
 * 修复：
 *   1. isModelListOrCode 切分符加 ↵（对齐 text-normalizer 既成事实）
 *   2. third-party-models.ts 新增整词豁免名单（只豁免不进遮蔽表，零过遮蔽）
 *   3. 内置表补录型号缺口（Bones/Switch NS 走整词豁免名单）
 *
 * 覆盖：
 *   A. 原稿逐条回归 —— 每一条都必须被 isUntranslatable 豁免
 *   B. 整词豁免名单正反样例（精确匹配，不豁免子串/句子）
 *   C. 疑似错词不误伤（Nintendo/Lenovo/Logitech 不再标错词）
 *   D. 防回归：形态负样本仍不误判豁免
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { isUntranslatable, isSuspectMisspelledWord } from '../lib/llm-api'
import { isBuiltinThirdPartyWholeText } from '../lib/third-party-models'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

const emptyGlossary = new Map<string, string>()
const ARROW = '↵'  // ↵

// ═══════════════════════════════════════════════════════════════
// A. 用户原稿逐条回归（2026-08-14 实机兼容性列表）
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. 用户原稿逐条豁免（每一条都必须 isUntranslatable=true）')
out.push('═'.repeat(60))

// 注意：扫描文本经 text-normalizer 后换行符已变 ' ↵ '，这里用真实 ↵ 模拟检测器实际看到的样子
const MANUSCRIPT: Array<[string, string]> = [
  ['Luna Ultra', '已收录型号'],
  ['DJI', '裸品牌（整词豁免）'],
  ['Insta360', '裸品牌含数字'],
  ['GoPro', '裸品牌'],
  [`Hero 13 Black / Hero 12 Black / Hero11 Black/Mini${ARROW}Hero10 Black / Bones / Hero 9 / Hero 8 `, 'Hero 多行列表（含 ↵ 行断）'],
  [`Pocket 4P / Pocket 4 / Pocket 3 / Pocket 2 / Action 6${ARROW}Action 5 Pro / Action 4 / Action 3 / Action 2 / Osmo Nano`, 'Pocket/Action 多行列表'],
  [`Mavic 4 Pro / Mavic 3 /Mavic 2 Pro / Mavic Pro${ARROW}Mavic Mini / Air 3 / Mini 5 Pro / Mini 4 Pro${ARROW}Mini 3 Pro / Mini2 / Avata 2 / Avata 360${ARROW}Lito 1 / Lito X1`, 'Mavic/Mini/Avata 四行列表'],
  ['Antigravity A1', '已收录型号'],
  [`X5 / X4 / X3 / X2${ARROW}${ARROW}`, '裸 X 系列 + 双 ↵ 结尾'],
  ['Osmo 360', '已收录型号'],
  ['MAX 360', 'BRAND_GRADE MAX 短路'],
  [`Switch NS${ARROW} / Switch Lite`, 'Switch 双行（↵ 行断）'],
  ['Legion Go', '已收录型号'],
  ['Steam Deck', '已收录型号'],
  ['ROG ALLY', '已收录型号'],
  ['G Cloud', '已收录型号'],
  ['Nintendo', '裸品牌（曾误判疑似错词）'],
  ['Lenovo', '裸品牌（曾误判疑似错词）'],
  ['Steam', '已收录裸词'],
  ['ASUS', '全大写裸品牌'],
  ['Logitech', '裸品牌（曾误判疑似错词）'],
]
for (const [text, label] of MANUSCRIPT) {
  assert(isUntranslatable(text, emptyGlossary) === true, `A-原稿豁免: ${label}`, JSON.stringify(text.slice(0, 50)))
}

// ═══════════════════════════════════════════════════════════════
// B. 整词豁免名单：精确匹配，不豁免子串/句子
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('B. 整词豁免名单边界（宁漏勿滥：只豁免整条，不豁免子串）')
out.push('═'.repeat(60))

const WHOLE_POSITIVE = ['DJI', 'dji', ' DJI ', 'GoPro', 'Insta360', 'Nintendo', 'Lenovo', 'ASUS', 'Logitech', 'Bones', 'Hero 7 Black']
for (const t of WHOLE_POSITIVE) {
  assert(isBuiltinThirdPartyWholeText(t) === true, `B-整词命中: ${JSON.stringify(t)}`)
}
// Switch NS / Mini 是段名单（isBuiltinModelSegment），不是整词豁免——单独验证
import { isBuiltinModelSegment } from '../lib/third-party-models'
assert(isBuiltinModelSegment('Switch NS') === true, 'B-段名单命中: Switch NS')
assert(isBuiltinModelSegment('Mini') === true, 'B-段名单命中: Mini')
assert(isBuiltinThirdPartyWholeText('Switch NS') === false, 'B-Switch NS 不是整词豁免（走段名单）')
const WHOLE_NEGATIVE: Array<[string, string]> = [
  ['DJI drone', '含品牌但还有更多内容 → 不豁免'],
  ['I love Nintendo games', '品牌出现在句中 → 不豁免'],
  ['GoPro Hero 13', '品牌+型号组合 → 不豁免（走遮蔽/术语库）'],
  ['Nintendo Switch OLED', '整词不含此条 → 不豁免（走术语库）'],
  ['X2', 'X2 未收录（影像格式名，靠形态规则）'],
]
for (const [t, label] of WHOLE_NEGATIVE) {
  assert(isBuiltinThirdPartyWholeText(t) === false, `B-不豁免: ${label}`, JSON.stringify(t))
}
// 子串出现在句中时 isUntranslatable 也不应豁免（走正常翻译链）
assert(isUntranslatable('I love Nintendo games', emptyGlossary) === false, 'B-句中品牌不豁免 isUntranslatable')
assert(isUntranslatable('DJI drone compatible', emptyGlossary) === false, 'B-品牌+描述不豁免 isUntranslatable')

// ═══════════════════════════════════════════════════════════════
// C. 疑似错词不误伤品牌
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('C. 疑似错词判定：品牌不误伤，真错词仍标')
out.push('═'.repeat(60))

const NOT_MISSPELLED = ['Nintendo', 'Lenovo', 'Logitech', 'Insta360', 'GoPro']
for (const t of NOT_MISSPELLED) {
  assert(isSuspectMisspelledWord(t, emptyGlossary) === false, `C-品牌不标错词: ${t}`)
}
const STILL_MISSPELLED = ['Panasionic', 'Transfser', 'Performence']  // Spede 仅5字符，不达 ≥6 阈值，修正为 Performence（11字符）
for (const t of STILL_MISSPELLED) {
  assert(isSuspectMisspelledWord(t, emptyGlossary) === true, `C-真错词仍标: ${t}`)
}

// ═══════════════════════════════════════════════════════════════
// D. 防回归：形态负样本仍不误判豁免
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('D. 形态负样本（↵ 修复不得扩大豁免范围）')
out.push('═'.repeat(60))

const NEGATIVE: Array<[string, string]> = [
  [`4K/8K video recording${ARROW}high speed`, '↵ 分隔但含小写描述词'],
  [`Read speed up to 2050MB/s${ARROW}Write speed up to 1800MB/s`, '↵ 分隔的真实句子'],
  ['SUPER FAST SPEED', '全大写无数字单段（v10.5 原负样本）'],
  [`High Speed Transfer${ARROW}Ultra Fast Performance`, '↵ 分隔的描述短语'],
  [`高速传输${ARROW}极速体验`, 'CJK 文本'],
]
for (const [t, label] of NEGATIVE) {
  assert(isUntranslatable(t, emptyGlossary) === false, `D-不误判: ${label}`, JSON.stringify(t.slice(0, 40)))
}

// ═══════════════════════════════════════════════════════════════
console.log(out.join('\n'))
console.log(`\n${'═'.repeat(60)}`)
console.log(`结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
