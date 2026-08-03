/**
 * v11.2 新产品名检测 + 生成译名并入测试
 *
 * 覆盖：
 *  A. 检测单元（®修复 / 系列可选槽 / 整条候选 / 品类指纹门 / 新颖性门）
 *  B. 生成译名并入（翻译路径 S1 短路语义 — 首轮即厂形译文）
 *  C. 入库语义（整条去® + 20 语种 + zh-TW 简繁兜底）
 *  D. NF100 端到端链路（检测→生成→短路→译文形态）
 *
 * 输出：tests/tmp-v112-test-out.txt，末行 "v11.2 测试：N 通过，M 失败"
 */

import { detectAdhocProductTerms, detectAdhocProductTermStrings, parseProductName, stripTrademark } from '../lib/new-product-detect'
import { generateProductNameTranslations, detectCategory, zhCNtoZhTW, TARGET_LANGS } from '../lib/product-name-generator'
import { writeFileSync } from 'fs'

let pass = 0
let fail = 0
const out: string[] = []

function ok(cond: boolean, name: string, extra?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${extra ? '  | ' + extra : ''}`) }
}

const emptyGlossary = new Map<string, string>()

// ═══════════════════════════════════════════════════════════════
// A. 检测单元
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('A. 检测单元')

// A1: 新系列名（含规格）→ 检出整条
const a1 = detectAdhocProductTermStrings(['Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD'], emptyGlossary)
ok(a1.includes('Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD'), 'A1 新系列名检出整条', JSON.stringify(a1))

// A2: 全新系列名 VELOCIS → 检出整条
const a2 = detectAdhocProductTermStrings(['Lexar VELOCIS DDR5 6000MHz Desktop Memory'], emptyGlossary)
ok(a2.includes('Lexar VELOCIS DDR5 6000MHz Desktop Memory'), 'A2 全新系列名检出整条', JSON.stringify(a2))

// A3: 【v11.2 翻转】纯型号（NM790）+ 品类词 → 应检出（CSV 42/140 主力形态）
const a3 = detectAdhocProductTermStrings(['Lexar NM790 PCIe 4.0 SSD'], emptyGlossary)
ok(a3.includes('Lexar NM790 PCIe 4.0 SSD'), 'A3 纯型号+品类词应检出（v11.2翻转）', JSON.stringify(a3))

// A4: 已收录产品名 → 新颖性门拒绝
const withPlay = new Map<string, string>([['Lexar PLAY microSDXC UHS-I Card', 'Lexar PLAY microSDXC UHS-I 存储卡']])
const a4 = detectAdhocProductTermStrings(['Lexar PLAY microSDXC UHS-I Card'], withPlay)
ok(a4.length === 0, 'A4 已收录不重复检出', JSON.stringify(a4))

// A5: 营销文案（无 Lexar 锚点）→ 不检出
const a5 = detectAdhocProductTermStrings(['High Speed', 'Engineered for High-Speed Performance'], emptyGlossary)
ok(a5.length === 0, 'A5 营销文案不检出', JSON.stringify(a5))

// A6: 含动词/功能词的句子 → 形态门拒绝
const a6 = detectAdhocProductTermStrings(['Lexar delivers High Speed performance'], emptyGlossary)
ok(a6.length === 0, 'A6 含动词句子不检出', JSON.stringify(a6))

// A7: 【v11.2 品类指纹门】裸系列名（无品类词）→ 不检出
const a7 = detectAdhocProductTermStrings(['Lexar THOR Ultra'], emptyGlossary)
ok(a7.length === 0, 'A7 裸系列名无品类词不检出', JSON.stringify(a7))

// A8: 【v11.2 ®修复】带®的完整产品名 → 检出（®是强信号）
const a8 = detectAdhocProductTermStrings(['Lexar® THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD'], emptyGlossary)
ok(a8.includes('Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD'), 'A8 带®产品名检出（去®入库）', JSON.stringify(a8))

// A9: 【v11.2 ®修复+纯型号】Lexar® NF100（复盘源头用例）→ 检出
const a9 = detectAdhocProductTermStrings(['Lexar® NF100 2.5-inch SATA III SSD'], emptyGlossary)
ok(a9.includes('Lexar NF100 2.5-inch SATA III SSD'), 'A9 Lexar® NF100 检出（复盘用例）', JSON.stringify(a9))

// A10: Professional 锚点 + ® → 检出
const a10 = detectAdhocProductTermStrings(['Lexar® Professional VELOCIS PRO CFexpress Type B Card'], emptyGlossary)
ok(a10.length > 0 && a10[0].startsWith('Lexar Professional'), 'A10 Professional锚点+®检出', JSON.stringify(a10))

// A11: 单 token 描述词系列（Fast）→ 拒绝
const a11 = parseProductName('Lexar Fast SSD')
ok(a11 === null || a11.valid === false, 'A11 描述词系列拒绝')

// A12: 规格开头形态（DDR4 内存线）→ 检出（series=''，modelLed）
const a12 = detectAdhocProductTermStrings(['Lexar DDR4 UDIMM Desktop Memory'], emptyGlossary)
ok(a12.includes('Lexar DDR4 UDIMM Desktop Memory'), 'A12 规格开头（DDR4内存线）检出', JSON.stringify(a12))

// A13: 功能词门 — 含 for 的"伪产品名"不检出
const a13 = detectAdhocProductTermStrings(['Lexar SSD for gaming'], emptyGlossary)
ok(a13.length === 0, 'A13 含功能词伪产品名不检出', JSON.stringify(a13))

// ── v11.2.1: 全品线扫描缺口修复 ──
// A14: ™在规格token上（真实新品）
const a14 = detectAdhocProductTermStrings(['Lexar® Professional SILVER GO microSDXC™ UHS-I Card'], emptyGlossary)
ok(a14.includes('Lexar Professional SILVER GO microSDXC UHS-I Card'), 'A14 ™在规格token检出（去®™入库）', JSON.stringify(a14))

// A15: 斜杠双格式
const a15 = detectAdhocProductTermStrings(['Lexar BLUE PLUS microSDHC/microSDXC UHS-I Card'], emptyGlossary)
ok(a15.length > 0, 'A15 斜杠双格式检出', JSON.stringify(a15))

// A16: 单字母系列修饰（PLAY X / THOR Z）
const a16a = detectAdhocProductTermStrings(['Lexar PLAY X M.2 PCIe 4.0 NVMe SSD'], emptyGlossary)
const a16b = detectAdhocProductTermStrings(['Lexar THOR Z RGB DDR5 Desktop Memory'], emptyGlossary)
ok(a16a.length > 0 && a16b.length > 0, 'A16 单字母系列修饰检出（PLAY X / THOR Z RGB）', JSON.stringify([a16a, a16b]))

// A17: with 配件话术（with Heatsink / with Hub / (EOL)）
const a17a = detectAdhocProductTermStrings(['Lexar EQ790 with Heatsink M.2 2280 PCIe Gen4x4 NVMe SSD'], emptyGlossary)
const a17b = detectAdhocProductTermStrings(['Lexar Professional Go Portable SSD with Hub'], emptyGlossary)
const a17c = detectAdhocProductTermStrings(['Lexar JumpDrive M900 USB 3.1 Flash Drive (EOL)'], emptyGlossary)
ok(a17a.length > 0 && a17b.length > 0 && a17c.length > 0, 'A17 with配件话术+(EOL)检出', JSON.stringify([a17a.length, a17b.length, a17c.length]))

// A18: 括号规格 (6Gb/s)
const a18 = detectAdhocProductTermStrings(['Lexar NM100 M.2 2280 SATA III (6Gb/s) SSD'], emptyGlossary)
ok(a18.length > 0, 'A18 括号规格(6Gb/s)检出', JSON.stringify(a18))

// A19: Type A/B 单字母规格后缀（功能词豁免）
const a19a = detectAdhocProductTermStrings(['Lexar CFexpress Type A USB-C Reader'], emptyGlossary)
const a19b = detectAdhocProductTermStrings(['Lexar microSD/SD USB-A/C Card Reader'], emptyGlossary)
ok(a19a.length > 0 && a19b.length > 0, 'A19 Type A/USB-A 规格后缀检出', JSON.stringify([a19a.length, a19b.length]))

// A20: 【v11.2.1 P1】已知系列新子型号检出（整条不在术语库）
const a20g = new Map<string, string>([['Lexar ARES DDR4 Desktop Memory', 'x']])
const a20 = detectAdhocProductTermStrings(['Lexar ARES PCIe Gen4x4 M.2 2280 NVMe SSD'], a20g)
ok(a20.includes('Lexar ARES PCIe Gen4x4 M.2 2280 NVMe SSD'), 'A20 已知系列新子型号检出（ARES案例）', JSON.stringify(a20))

// A21: 系列+容量（TITAN 2TB → 容量剥离，TITAN 为系列）
const a21p = parseProductName('Lexar TITAN 2TB M.2 2280 PCIe Gen5x4 NVMe SSD')
const a21 = detectAdhocProductTermStrings(['Lexar TITAN 2TB M.2 2280 PCIe Gen5x4 NVMe SSD'], emptyGlossary)
ok(a21p?.series === 'TITAN' && a21.length > 0, 'A21 系列+容量检出（容量剥离）', JSON.stringify([a21p, a21]))

// A22: 裸已知系列仍不检出（新颖性门2本意保留）
const a22g = new Map<string, string>([['Lexar THOR DDR4 UDIMM Desktop Memory', 'x']])
const a22 = detectAdhocProductTermStrings(['Lexar THOR'], a22g)
ok(a22.length === 0, 'A22 裸已知系列不检出（门2本意）', JSON.stringify(a22))

// ═══════════════════════════════════════════════════════════════
// B. 生成译名并入（翻译路径 S1 短路语义）
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('B. 生成译名并入')

// B1: NF100 检出后生成 fr 译名 = 品类前置厂形
const nfTerm = 'Lexar NF100 2.5-inch SATA III SSD'
const nfParsed = parseProductName(nfTerm)
ok(nfParsed !== null && nfParsed.valid === true, 'B1a NF100 parseProductName valid')
ok(nfParsed?.series === '' && nfParsed?.modelLed === true, 'B1b NF100 纯型号形态 series空/modelLed', JSON.stringify(nfParsed))
const nfGen = generateProductNameTranslations(nfTerm, nfParsed?.series || '')
ok(nfGen.translations['fr'] === 'SSD Lexar NF100 2.5-inch SATA III', 'B2 NF100 fr 品类前置', nfGen.translations['fr'])
ok(nfGen.translations['zh-CN'] === 'Lexar NF100 2.5-inch SATA III 固态硬盘', 'B3 NF100 zh-CN 品类后置', nfGen.translations['zh-CN'])
ok(nfGen.translations['de'] === 'Lexar NF100 2.5-inch SATA III SSD', 'B4 NF100 de 品类后置', nfGen.translations['de'])
ok(nfGen.translations['vi'] === 'Ổ Cứng SSD Lexar NF100 2.5-inch SATA III', 'B5 NF100 vi 内置前置', nfGen.translations['vi'])

// B6: 生成译名并入 glossaryMap 后 S1 短路语义（整条 key 命中）
const simGlossary = new Map<string, string>()
simGlossary.set(nfTerm, nfGen.translations['fr'])
const lookupKey = 'Lexar® NF100 2.5-inch SATA III SSD'.toLowerCase().replace(/[®™©]/g, '').trim()
let shortCircuitVal: string | undefined
for (const [k, v] of simGlossary.entries()) {
  if (k.toLowerCase().replace(/[®™©]/g, '').trim() === lookupKey) { shortCircuitVal = v; break }
}
ok(shortCircuitVal === 'SSD Lexar NF100 2.5-inch SATA III', 'B6 带®源文短路命中厂形译文', String(shortCircuitVal))

// ═══════════════════════════════════════════════════════════════
// C. 入库语义（整条去® + 20 语种 + zh-TW 简繁兜底）
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('C. 入库语义')

// C1: 入库 key 不含 ®
const c1 = detectAdhocProductTerms(['Lexar® THOR Ultra PCIe 5.0 NVMe SSD'], emptyGlossary)
ok(c1.length === 1 && !c1[0].term.includes('®'), 'C1 入库 key 无®', JSON.stringify(c1))

// C2: 生成 20 语种非空
const c2gen = generateProductNameTranslations('Lexar THOR Ultra PCIe 5.0 NVMe SSD', 'THOR Ultra')
ok(Object.keys(c2gen.translations).length === 20 && TARGET_LANGS.every(l => c2gen.translations[l]), 'C2 生成20语种非空')

// C3: zh-TW 简繁兜底（生成器 zh-TW≠zh-CN 时直接用；本例表内已有 固態硬碟）
const c3gen = generateProductNameTranslations('Lexar VELOCIS DDR5 6000MHz Desktop Memory', 'VELOCIS')
ok(c3gen.translations['zh-TW'].includes('記憶體'), 'C3 zh-TW 台式内存用繁体記憶體', c3gen.translations['zh-TW'])

// C4: zh-TW 与 zh-CN 不同形（品类词已繁化）
ok(c3gen.translations['zh-TW'] !== c3gen.translations['zh-CN'], 'C4 zh-TW ≠ zh-CN')

// C5: zhCNtoZhTW 简繁转换仍工作（其他品类）
ok(zhCNtoZhTW('Lexar X 移动固态硬盘') === 'Lexar X 行動固態硬碟', 'C5 简繁转换 移动固态硬盘')

// C6: 系列名含®也能剥离
ok(stripTrademark('Lexar®') === 'Lexar' && stripTrademark('THOR™') === 'THOR', 'C6 stripTrademark 工具')

// ═══════════════════════════════════════════════════════════════
// D. NF100 端到端链路
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('D. NF100 端到端链路')

const NF_SRC = 'Lexar® NF100 2.5-inch SATA III SSD'
// D1: 检测
const d1 = detectAdhocProductTerms([NF_SRC], emptyGlossary)
ok(d1.length === 1, 'D1 检出 1 个产品名', JSON.stringify(d1))
ok(d1[0]?.term === 'Lexar NF100 2.5-inch SATA III SSD', 'D2 术语=整条去®', d1[0]?.term)
// D2: 生成
const dGen = generateProductNameTranslations(d1[0].term, d1[0].series)
ok(dGen.category === 'SSD', 'D3 品类识别=SSD', String(dGen.category))
// D3: 各语种形态
ok(dGen.translations['ja'] === 'Lexar NF100 2.5-inch SATA III SSD', 'D4 ja 保留SSD', dGen.translations['ja'])
ok(dGen.translations['es'] === 'Unidad de estado sólido (SSD) Lexar NF100 2.5-inch SATA III', 'D5 es 全称前置', dGen.translations['es'])
ok(dGen.translations['ar'].startsWith('SSD داخلي'), 'D6 ar 品类前置RTL', dGen.translations['ar'])
ok(dGen.translations['nl'] === 'Interne SSD Lexar NF100 2.5-inch SATA III', 'D7 nl 内置全称', dGen.translations['nl'])

// ═══════════════════════════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push(`v11.2 测试：${pass} 通过，${fail} 失败`)

writeFileSync('tests/tmp-v112-test-out.txt', out.join('\n'), 'utf-8')
console.log(out.join('\n'))
if (fail > 0) process.exit(1)
