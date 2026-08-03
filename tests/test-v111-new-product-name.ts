/**
 * v11.1 新产品名检测 + 20 语种生成测试
 *
 * 覆盖：
 *  A. 检测单元（产品名形态门/锚点门/新颖性门）
 *  B. 品类识别
 *  C. 20 语种生成（语序模板 + 品类译法 + 越南语特例）
 *  D. 简→繁转换
 *
 * 输出：tests/tmp-v111-test-out.txt，末行 "v11.1 测试：N 通过，M 失败"
 */

import { detectAdhocProductTerms, detectAdhocProductTermStrings, parseProductName } from '../lib/new-product-detect'
import { generateProductNameTranslations, detectCategory, zhCNtoZhTW, TARGET_LANGS } from '../lib/product-name-generator'
import { writeFileSync } from 'fs'

let pass = 0
let fail = 0
const out: string[] = []

function ok(cond: boolean, name: string, extra?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${extra ? '  | ' + extra : ''}`) }
}

// ═══════════════════════════════════════════════════════════════
// A. 检测单元
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('A. 检测单元')

const emptyGlossary = new Map<string, string>()
const withPlayGlossary = new Map<string, string>([['Lexar PLAY microSDXC UHS-I Card', 'Lexar PLAY microSDXC UHS-I 存储卡']])

// A1: 新系列名（含规格）→ 检出整条（v11.2 候选术语=整条原文）
const a1 = detectAdhocProductTermStrings(['Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD'], emptyGlossary)
ok(a1.includes('Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD'), 'A1 检测新系列名 THOR Ultra（整条）', JSON.stringify(a1))

// A2: 全新系列名 VELOCIS → 检出整条
const a2 = detectAdhocProductTermStrings(['Lexar VELOCIS DDR5 6000MHz Desktop Memory'], emptyGlossary)
ok(a2.includes('Lexar VELOCIS DDR5 6000MHz Desktop Memory'), 'A2 检测全新系列名 VELOCIS（整条）', JSON.stringify(a2))

// A3: 【v11.2 语义翻转】纯型号（NM790）+ 品类词 → 检出（CSV 42/140 主力形态）
const a3 = detectAdhocProductTermStrings(['Lexar NM790 PCIe 4.0 SSD'], emptyGlossary)
ok(a3.includes('Lexar NM790 PCIe 4.0 SSD'), 'A3 纯型号+品类词检出（v11.2翻转）', JSON.stringify(a3))

// A4: 已收录系列（PLAY）→ 新颖性门拒绝
const a4 = detectAdhocProductTermStrings(['Lexar PLAY microSDXC UHS-I Card'], withPlayGlossary)
ok(a4.length === 0, 'A4 已收录 PLAY 不重复检出', JSON.stringify(a4))

// A5: 营销短文本（无 Lexar 锚点）→ 不检出
const a5 = detectAdhocProductTermStrings(['High Speed', 'Engineered for High-Speed Performance'], emptyGlossary)
ok(a5.length === 0, 'A5 营销文案不检出', JSON.stringify(a5))

// A6: 含动词/功能词的句子 → 形态门拒绝
const a6 = detectAdhocProductTermStrings(['Lexar delivers High Speed performance'], emptyGlossary)
ok(a6.length === 0, 'A6 含动词句子不检出', JSON.stringify(a6))

// A7: 【v11.2 品类指纹门】裸系列名（无品类词）→ 不检出
const a7g = new Map<string, string>([['Lexar THOR Ultra', 'Lexar THOR Ultra']])
const a7 = detectAdhocProductTermStrings(['Lexar THOR Ultra'], a7g)
ok(a7.length === 0, 'A7 裸系列名无品类词不检出（v11.2品类指纹门）', JSON.stringify(a7))

// A8: 系列串含已知词但组合是新的（THOR Ultra）→ 检出整条（含品类词 SSD）
const a8 = detectAdhocProductTermStrings(['Lexar THOR Ultra PCIe 5.0 NVMe SSD'], emptyGlossary)
ok(a8.includes('Lexar THOR Ultra PCIe 5.0 NVMe SSD'), 'A8 THOR Ultra 组合检出（整条）', JSON.stringify(a8))

// A9: Professional 锚点
const a9 = detectAdhocProductTermStrings(['Lexar Professional VELOCIS PRO CFexpress Type B Card'], emptyGlossary)
ok(a9.length > 0 && a9[0].startsWith('Lexar Professional'), 'A9 Professional 锚点检出', JSON.stringify(a9))

// A10: 单 token 描述词系列（Fast）→ 拒绝
const a10 = parseProductName('Lexar Fast SSD')
ok(a10 === null || a10.valid === false, 'A10 描述词系列拒绝')

// ═══════════════════════════════════════════════════════════════
// B. 品类识别
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('B. 品类识别')

ok(detectCategory('Lexar NM790 M.2 2280 PCIe Gen 4x4 NVMe SSD') === 'SSD', 'B1 内置 SSD')
ok(detectCategory('Lexar SL500 Portable SSD') === 'Portable SSD', 'B2 移动 SSD')
ok(detectCategory('Lexar THOR DDR4 UDIMM Desktop Memory') === 'Desktop Memory', 'B3 台式内存')
ok(detectCategory('Lexar JumpDrive M22 USB Flash Drive') === 'Flash Drive', 'B4 U盘')
ok(detectCategory('Lexar Professional SILVER SDXC UHS-I Card') === 'Card', 'B5 存储卡')
ok(detectCategory('Lexar CFexpress Type A USB-C Reader') === 'Reader', 'B6 读卡器')
ok(detectCategory('Lexar E300 M.2 SSD Enclosure') === 'Enclosure', 'B7 硬盘盒（SSD 不误判品类）')
ok(detectCategory('Lexar THOR Ultra') === null, 'B8 无品类词返回 null')

// ═══════════════════════════════════════════════════════════════
// C. 20 语种生成
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('C. 20 语种生成')

const gen = generateProductNameTranslations('Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD', 'THOR Ultra')
ok(gen.category === 'SSD', 'C1 品类识别为 SSD')
ok(Object.keys(gen.translations).length === 20, 'C2 生成 20 语种', String(Object.keys(gen.translations).length))
ok(TARGET_LANGS.every(l => gen.translations[l]), 'C3 全部语种非空')
// 系列名保留
ok(gen.translations['de'].includes('THOR Ultra'), 'C4 de 系列名保留')
ok(gen.translations['ja'].includes('THOR Ultra'), 'C5 ja 系列名保留')
ok(gen.translations['zh-CN'].includes('THOR Ultra'), 'C6 zh-CN 系列名保留（营销名留空）')
// 语序：de/ja/ko/zh 后置，fr 前置
ok(gen.translations['de'].endsWith('SSD'), 'C7 de 品类后置', gen.translations['de'])
ok(gen.translations['fr'].startsWith('SSD'), 'C8 fr 品类前置', gen.translations['fr'])
// 品类译法
ok(gen.translations['zh-CN'].endsWith('固态硬盘'), 'C9 zh-CN 内置=固态硬盘', gen.translations['zh-CN'])
ok(gen.translations['es'].startsWith('Unidad de estado sólido'), 'C10 es 内置全称', gen.translations['es'])
ok(gen.translations['ja'].endsWith('SSD'), 'C11 ja 保留 SSD', gen.translations['ja'])
// 规格保留
ok(gen.translations['ko'].includes('PCIe Gen5x4 NVMe'), 'C12 ko 规格保留', gen.translations['ko'])

// Portable SSD 越南语后置
const gen2 = generateProductNameTranslations('Lexar VELOCIS Portable SSD', 'VELOCIS')
ok(gen2.translations['vi'].includes('SSD Di Động'), 'C13 vi 移动 SSD 后置', gen2.translations['vi'])
ok(gen2.translations['vi'].indexOf('Lexar') < gen2.translations['vi'].indexOf('SSD Di'), 'C14 vi 移动盘 Lexar 在前', gen2.translations['vi'])

// 内置 SSD 越南语前置
const gen3 = generateProductNameTranslations('Lexar VELOCIS NVMe SSD', 'VELOCIS')
ok(gen3.translations['vi'].startsWith('Ổ Cứng SSD'), 'C15 vi 内置 SSD 前置', gen3.translations['vi'])

// 外设越南语保留英文
const gen4 = generateProductNameTranslations('Lexar VELOCIS USB-C Reader', 'VELOCIS')
ok(gen4.translations['vi'] === 'Lexar VELOCIS USB-C Reader', 'C16 vi 外设保留英文', gen4.translations['vi'])

// U盘各国专属叫法
const gen5 = generateProductNameTranslations('Lexar JumpDrive Nova USB 3.2 Flash Drive', 'JumpDrive Nova')
ok(gen5.translations['nl'].startsWith('USB-stick'), 'C17 nl U盘=USB-stick', gen5.translations['nl'])
ok(gen5.translations['pl'].startsWith('Pendrive'), 'C18 pl U盘=Pendrive', gen5.translations['pl'])
ok(gen5.translations['sv'].startsWith('USB-minne'), 'C19 sv U盘=USB-minne', gen5.translations['sv'])
ok(gen5.translations['zh-CN'].endsWith('闪存盘'), 'C20 zh-CN U盘=闪存盘', gen5.translations['zh-CN'])

// ═══════════════════════════════════════════════════════════════
// D. 简→繁转换
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('D. 简→繁转换')

ok(zhCNtoZhTW('Lexar THOR Ultra 移动固态硬盘') === 'Lexar THOR Ultra 行動固態硬碟', 'D1 移动固态硬盘→行動固態硬碟', zhCNtoZhTW('Lexar THOR Ultra 移动固态硬盘'))
ok(zhCNtoZhTW('Lexar VELOCIS 固态硬盘') === 'Lexar VELOCIS 固態硬碟', 'D2 固态硬盘→固態硬碟')
ok(zhCNtoZhTW('Lexar Nova 闪存盘') === 'Lexar Nova 隨身碟', 'D3 闪存盘→隨身碟')
ok(zhCNtoZhTW('Lexar X 存储卡') === 'Lexar X 記憶卡', 'D4 存储卡→記憶卡')

// ═══════════════════════════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push(`v11.1 测试：${pass} 通过，${fail} 失败`)

writeFileSync('tests/tmp-v111-test-out.txt', out.join('\n'), 'utf-8')
console.log(out.join('\n'))
if (fail > 0) process.exit(1)
