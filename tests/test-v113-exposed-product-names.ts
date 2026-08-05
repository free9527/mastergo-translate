/**
 * 三类"怪异"新品名裸奔验证
 *
 * 验证目标：确认以下三类现有规则不能解决，会裸奔进 LLM：
 *   1. 连字符/小写系列名（Lexar nCARD NM card）
 *   2. 无 Lexar 锚点（MUSE Portable SSD）
 *   3. 未知品类词（Lexar Vault Memory Stick）
 *
 * 同时验证正常形态（SUPER / MUSE 带 Lexar）确实被检出，作为对照。
 *
 * 输出：tests/tmp-v113-exposed-verify.txt，末行 "验证：N 通过，M 失败"
 */

import { detectAdhocProductTerms, detectAdhocProductTermStrings, parseProductName } from '../lib/new-product-detect'
import { detectCategory } from '../lib/product-name-generator'
import { writeFileSync } from 'fs'

let pass = 0
let fail = 0
const out: string[] = []

function ok(cond: boolean, name: string, extra?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${extra ? '  | ' + extra : ''}`) }
}

const emptyGlossary = new Map<string, string>()

out.push('─'.repeat(60))
out.push('对照组：正常形态（应检出）')
out.push('─'.repeat(60))

// C1: Lexar SUPER PCIe Gen5x4 NVMe SSD → 【意外发现】被 DESCRIPTIVE_WORDS 误杀！
// 'super' 在描述词表里（防 "Lexar Fast"），但 SUPER 作为系列名是合法的
const c1Parse = parseProductName('Lexar SUPER PCIe Gen5x4 NVMe SSD')
out.push(`C1 parseProductName('Lexar SUPER ...') = ${JSON.stringify(c1Parse)}`)
const c1 = detectAdhocProductTermStrings(['Lexar SUPER PCIe Gen5x4 NVMe SSD'], emptyGlossary)
ok(c1.length === 0, 'C1 Lexar SUPER 被 DESCRIPTIVE_WORDS 误杀（裸奔）', JSON.stringify(c1))

// C2: Lexar MUSE Portable SSD → 应检出
const c2 = detectAdhocProductTermStrings(['Lexar MUSE Portable SSD'], emptyGlossary)
ok(c2.includes('Lexar MUSE Portable SSD'), 'C2 Lexar MUSE 检出', JSON.stringify(c2))

out.push('')
out.push('─'.repeat(60))
out.push('验证组：三类怪异形态（应裸奔 = 不检出）')
out.push('─'.repeat(60))

// V1: 连字符/小写系列名 — Lexar nCARD NM card
// v11.4 已修复：camelCase 品牌形态（nCARD）+ 小写品类词（card）均检出，不再裸奔
const v1Parse = parseProductName('Lexar nCARD NM card')
out.push(`V1 parseProductName('Lexar nCARD NM card') = ${JSON.stringify(v1Parse)}`)
const v1 = detectAdhocProductTermStrings(['Lexar nCARD NM card'], emptyGlossary)
ok(v1.includes('Lexar nCARD NM card'), 'V1 nCARD 已检出（v11.4 修复，不再裸奔）', JSON.stringify(v1))

// V2: 无 Lexar 锚点 — MUSE Portable SSD
// parseProductName: 第一个 token 'MUSE' ≠ 'lexar' → 锚点门拒 → null
const v2Parse = parseProductName('MUSE Portable SSD')
out.push(`V2 parseProductName('MUSE Portable SSD') = ${JSON.stringify(v2Parse)}`)
const v2 = detectAdhocProductTermStrings(['MUSE Portable SSD'], emptyGlossary)
ok(v2.length === 0, 'V2 无 Lexar 锚点裸奔（不检出）', JSON.stringify(v2))

// V3: 未知品类词 — Lexar Vault Memory Stick
// parseProductName: 可能通过（Vault 是有效系列名），但 detectCategory('Lexar Vault Memory Stick') = null
// → 品类指纹门拒 → 不检出
const v3Parse = parseProductName('Lexar Vault Memory Stick')
out.push(`V3 parseProductName('Lexar Vault Memory Stick') = ${JSON.stringify(v3Parse)}`)
const v3Cat = detectCategory('Lexar Vault Memory Stick')
out.push(`V3 detectCategory('Lexar Vault Memory Stick') = ${JSON.stringify(v3Cat)}`)
const v3 = detectAdhocProductTermStrings(['Lexar Vault Memory Stick'], emptyGlossary)
ok(v3.length === 0, 'V3 未知品类词裸奔（不检出）', JSON.stringify(v3))

// V4: 补充验证 — 'Lexar 360 Portable SSD'（纯数字系列名，应检出）
const v4 = detectAdhocProductTermStrings(['Lexar 360 Portable SSD'], emptyGlossary)
ok(v4.includes('Lexar 360 Portable SSD'), 'V4 纯数字系列名检出（对照）', JSON.stringify(v4))

out.push('')
out.push('─'.repeat(60))
out.push('裸奔后的命运分析')
out.push('─'.repeat(60))

// 对三类裸奔场景，分析实体遮蔽器会保护哪些部分
// 注意：这里只分析 PRODUCT_CODE_RE / PRESERVED_TERMS 的覆盖，不实际调用 maskEntities
// （maskEntities 需要完整 entityMap 上下文，此处只验证正则覆盖范围）

const PRODUCT_CODE_RE = /\b([A-Z]{2,4}\d{2,5}[A-Z]*\s*(?:PRO|PLUS|MAX|OC|RGB|SSD|DDR[45]|PCIe\s*[345]\.0)?)\b/gi

out.push('')
out.push('V1 裸奔: "Lexar nCARD NM card"')
out.push('  - PRODUCT_CODE_RE 匹配: ' + JSON.stringify('Lexar nCARD NM card'.match(PRODUCT_CODE_RE)))
out.push('  - 裸奔部分: "Lexar nCARD"（Lexar 是品牌词术语库有保护，nCARD 可能音译）')

out.push('')
out.push('V2 裸奔: "MUSE Portable SSD"')
out.push('  - PRODUCT_CODE_RE 匹配: ' + JSON.stringify('MUSE Portable SSD'.match(PRODUCT_CODE_RE)))
out.push('  - 裸奔部分: "MUSE"（无 Lexar 锚点，系列名完全裸露，可能被意译为 musée/ミューズ）')

out.push('')
out.push('V3 裸奔: "Lexar Vault Memory Stick"')
out.push('  - PRODUCT_CODE_RE 匹配: ' + JSON.stringify('Lexar Vault Memory Stick'.match(PRODUCT_CODE_RE)))
out.push('  - 裸奔部分: "Vault" + "Memory Stick"（系列名+未知品类词全部裸露）')

out.push('')
out.push(`验证：${pass} 通过，${fail} 失败`)
writeFileSync('tests/tmp-v113-exposed-verify.txt', out.join('\n'), 'utf-8')
console.log(out.join('\n'))
process.exit(fail > 0 ? 1 : 0)
