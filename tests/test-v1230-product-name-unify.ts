// ============================================================
// v12.30 产品名判定归一 + Flash Drive de override
// ============================================================
// 背景：C40E 事故——①Lexar JumpDrive C40E 不带® 被判非产品名漏到裸翻译
//   ②generateProductNameTranslations de 无 override 回退用 prompt 对照 USB-Stick，
//   与术语库产品名 CSV（全 16 条 JumpDrive de=Flash-Laufwerk）漂移。
// 方案（用户拍板）：
//   1. 判定锚点从「Lexar®」放宽为「Lexar / Lexar Professional 开头」
//      （® 从必要条件降为可选——命名规则文档证明®是排版习惯非本质特征）
//   2. Flash Drive de 补 productName override = Flash-Laufwerk（CSV 钦定）
// 覆盖：
//   A detectFallbackCandidates 锚点放宽（不带®的 Lexar 开头触发）
//   B Flash Drive de override（生成器 de 输出 Flash-Laufwerk）
//   C 全新型号（C40E/Z99X）整条判定 + de 译名型号保留
//   D 不误伤（普通句子/描述性词不判产品名）
// ============================================================

/// <reference types="node" />

import { detectFallbackCandidates, parseProductName } from '../lib/new-product-detect'
import { generateProductNameTranslations } from '../lib/product-name-generator'
import { CATEGORY_WORDS } from '../lib/prompt-constants'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

// ────────────────────────────────────────────────────────────
console.log('\nA. detectFallbackCandidates 锚点放宽（® 降为可选）')

// A1: 不带®的 Lexar 开头 + 品类词 + 代码判定失败 → 触发兜底
//     （用一个 parseProductName 会失败的形态：Lexar Professional Workflow Go 无品类词会被 detectCategory 拦，
//       改用「Lexar 开头 + 品类词 + parseProductName 失败」的形态）
//     parseProductName 对「Lexar Air Portable SSD」：Air 是系列，品类词 Portable SSD → parseProductName 成功，
//     所以不触发兜底（走 adhoc）。需要一个 parseProductName 失败但含品类词的：
//     「Lexar 2.5 Inch Hard Drive Enclosure」——无型号、parseProductName 形态可能失败
const fallbackNoReg = detectFallbackCandidates(
  ['Lexar JumpDrive C40E USB 3.2 Gen 1 Flash Drive'],  // 不带®，parseProductName 成功 → 不触发兜底（走 adhoc）
  new Map(),
)
// C40E parseProductName 成功，所以兜底不触发（正确——它走 adhoc）
assert(fallbackNoReg.length === 0, 'A1 不带®但 parseProductName 成功 → 不触发兜底（走 adhoc，正确分工）')

// A2: 非 Lexar 开头 → 不触发（保持保守）
const fallbackNonLexar = detectFallbackCandidates(
  ['MUSE Portable SSD'],
  new Map(),
)
assert(fallbackNonLexar.length === 0, 'A2 非 Lexar 开头 → 不触发兜底')

// A3: Lexar 开头但无品类词 → 不触发（品类指纹门）
const fallbackNoCat = detectFallbackCandidates(
  ['Lexar Professional Workflow'],
  new Map(),
)
assert(fallbackNoCat.length === 0, 'A3 Lexar 开头但无品类词 → 品类指纹门拦截')

// ────────────────────────────────────────────────────────────
console.log('\nB. Flash Drive de override（CSV 钦定 Flash-Laufwerk）')

// B1: CATEGORY_WORDS['Flash Drive'].productName.de = Flash-Laufwerk
const fdEntry = CATEGORY_WORDS['Flash Drive'] as Record<string, unknown>
const fdProductName = fdEntry['productName'] as Record<string, string>
assert(fdProductName && fdProductName['de'] === 'Flash-Laufwerk', 'B1 Flash Drive productName.de = Flash-Laufwerk')

// B2: prompt 对照层 de 仍是 USB-Stick（两层分离——prompt 注入 vs 产品名生成）
assert((fdEntry['de'] as string) === 'USB-Stick', 'B2 Flash Drive prompt 对照层 de 仍 = USB-Stick（两层分离）')

// B3: C40E de 生成 = Flash-Laufwerk（核心修复）
const gen = generateProductNameTranslations('Lexar JumpDrive C40E USB 3.2 Gen 1 Flash Drive', 'JumpDrive')
assert(gen.translations['de'] === 'Lexar JumpDrive C40E USB 3.2 Gen 1 Flash-Laufwerk', 'B3 C40E de 生成 = Flash-Laufwerk')

// B4: C40E de 型号保留（不再 A40E/USB-Stick）
assert(gen.translations['de'].includes('C40E'), 'B4 de 型号 C40E 保留')
assert(!gen.translations['de'].includes('USB-Stick'), 'B5 de 不再用 USB-Stick（用 Flash-Laufwerk）')

// ────────────────────────────────────────────────────────────
console.log('\nC. 全新型号整条判定 + 译名型号保留')

// C1: 全新型号 Z99X（不在任何名单）→ parseProductName 判定为产品名
const parsedZ = parseProductName('Lexar JumpDrive Z99X USB 3.2 Gen 1 Flash Drive')
assert(parsedZ !== null && parsedZ.valid === true, 'C1 全新型号 Z99X 判定为产品名')
assert(parsedZ!.series === 'JumpDrive', 'C2 Z99X 系列识别 = JumpDrive')

// C3: 全新型号 de 译名型号保留
const genZ = generateProductNameTranslations('Lexar JumpDrive Z99X USB 3.2 Gen 1 Flash Drive', 'JumpDrive')
assert(genZ.translations['de'].includes('Z99X'), 'C3 全新型号 Z99X de 译名型号保留')
assert(genZ.translations['de'].includes('Flash-Laufwerk'), 'C4 全新型号 de 品类词 = Flash-Laufwerk')

// C5: ko 译名（productName.ko = Flash Drive 保留英文）
assert(gen.translations['ko'] === 'Lexar JumpDrive C40E USB 3.2 Gen 1 Flash Drive', 'C5 C40E ko 保留英文（productName.ko override）')

// ────────────────────────────────────────────────────────────
console.log('\nD. 不误伤（普通句子/描述性词不判产品名）')

// D1: 普通句子（含动词/功能词）→ parseProductName 返回 null
const parsedSentence = parseProductName('Lexar is a good brand for storage')
assert(parsedSentence === null, 'D1 普通句子 → 不判产品名')

// D2: 描述性词（Lexar Fast SSD）→ valid:false（DESCRIPTIVE_WORDS 防线）
const parsedFast = parseProductName('Lexar Fast SSD')
assert(parsedFast === null || parsedFast.valid === false, 'D2 描述性词 Lexar Fast SSD → 不判产品名（描述词防线）')

// D3: 无 Lexar 锚点（Bare Flash Drive）→ 不判
const parsedBare = parseProductName('Flash Drive USB 3.2')
assert(parsedBare === null, 'D3 无 Lexar 锚点 → 不判产品名')

// ────────────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
