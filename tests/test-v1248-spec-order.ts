/**
 * test-v1248-spec-order.ts — v12.48 规格槽位词序归一（generateProductNameTranslations core M.2 PCIe 4.0 钦定）
 *
 * 根因（2026-09-29 PLAY X 实机复盘）：画布/录入把规格写反（PCIe 4.0 M.2），
 * v11.2 检出为产品名后代码生成忠实保留源文词序 → 产出非钦定形态。
 * 「按规则翻译」要求输出钦定词序（命名规则文档：接口形态 M.2 在协议形态 PCIe 4.0 前），
 * 与输入端书写差异解耦。
 *
 * 钦定词序实证（audit-spec-order.ts）：产品名库含 M.2+PCIe 的 14 条中 13 条 M.2 在 PCIe 前，
 * 唯一反例 NM1090 PRO 是「PCIe 5.0 NVMe M.2 2280」不同结构（NVMe 插在中间），不在本归一范围。
 */
import { generateProductNameTranslations } from '../lib/product-name-generator'

let pass = 0, fail = 0
function assert(cond: boolean, name: string, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`) }
}

console.log('\n═══ v12.48 规格词序归一 ═══')
// E1: 反词序输入 → 各语种输出钦定 M.2 PCIe 4.0
const g = generateProductNameTranslations('Lexar PLAY X PCIe 4.0 M.2 NVMe SSD', 'PLAY X')
for (const lang of ['es','fr','de','zh-CN','ja','it','pt','ru','nl','pl','sv','tr','ar','th','id','pt-BR','ko','zh-TW','en']) {
  const t = g.translations[lang]
  assert(
    t.includes('M.2 PCIe 4.0') && !t.includes('PCIe 4.0 M.2'),
    `E1-${lang} 输出钦定词序 M.2 PCIe 4.0`,
    `got ${t}`,
  )
}
// E2: 正词序输入幂等（已是钦定则不变）
const g2 = generateProductNameTranslations('Lexar PLAY X M.2 PCIe 4.0 NVMe SSD', 'PLAY X')
assert(g2.translations['es'].includes('M.2 PCIe 4.0'), 'E2 正词序输入幂等', g2.translations['es'])
// E3: 其他规格对不动（USB 3.2 Gen 1 无 M.2/PCIe 不触发）
const g3 = generateProductNameTranslations('Lexar JumpDrive V40 USB 2.0 Flash Drive', 'JumpDrive V40')
assert(g3.translations['es'].includes('USB 2.0'), 'E3 无 M.2/PCIe 的规格对不受影响', g3.translations['es'])
// E4: 大小写变体（pcie 4.0 m.2）也归一
const g4 = generateProductNameTranslations('Lexar PLAY X pcie 4.0 m.2 NVMe SSD', 'PLAY X')
assert(g4.translations['es'].includes('M.2 PCIe 4.0'), 'E4 小写规格变体仍归一', g4.translations['es'])
// E5: NM1090 PRO 结构（PCIe 5.0 NVMe M.2 2280）不被误改——PCIe 与 M.2 不相邻（中间隔 NVMe）
const g5 = generateProductNameTranslations('Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD', 'NM1090 PRO')
assert(
  g5.translations['es'].includes('PCIe 5.0 NVMe M.2 2280'),
  'E5 非相邻规格（PCIe 5.0 NVMe M.2）不误归一',
  g5.translations['es'],
)
console.log(`\n═══ 结果: ${pass} 通过 / ${fail} 失败 ═══`)
if (fail > 0) process.exit(1)
