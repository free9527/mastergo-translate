/**
 * test-v1247-canonical-word-order.ts — v12.47 钦定词序对齐（alignToGlossaryWordOrder）
 *
 * 背景（2026-09-29 PLAY X 实机）：画布 `Lexar PLAY X PCIe 4.0 M.2 NVMe SSD`（词序 PCIe 4.0 M.2）
 * 与产品名库钦定 `Lexar PLAY X M.2 PCIe 4.0 NVMe SSD`（词序 M.2 PCIe 4.0）词序不同 →
 * S1 cleanKey 短路漏配 → v11.2 检出「新产品名」→ 代码生成译名沿用画布词序 →
 * 与公司钦定风格（141 条归纳 M.2 PCIe 4.0）漂移。
 *
 * v12.47 修复：真新品译名生成前 alignToGlossaryWordOrder 对齐术语库同结构钦定词序。
 * 本测试断真实不变量（非实现细节）：
 *   A. productStructureKey 结构归一（词序抹平 + 品类剥离）
 *   B. alignToGlossaryWordOrder 对齐行为（有钦定→对齐，无钦定→原样，非产品名→原样）
 *   C. 端到端：词序变体经对齐后生成译名 = 钦定风格
 *   D. 安全性：不同产品不误对齐、无品类词不崩、空输入兜底
 */
import { productStructureKey, alignToGlossaryWordOrder, generateProductNameTranslations, detectCategory } from '../lib/product-name-generator'

let pass = 0, fail = 0
function assert(cond: boolean, name: string, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`) }
}

// 模拟术语库 source key（含钦定词序 PLAY X + 其他品类）
const GLOSSARY_SOURCES = [
  'Lexar PLAY X M.2 PCIe 4.0 NVMe SSD',           // 钦定词序（80 行）
  'Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD',
  'Lexar PLAY microSDXC UHS-I Card',
  'Lexar Professional 1066x SDXC UHS-I Card SILVER Series',
  'Lexar JumpDrive V40 USB 2.0 Flash Drive',
]

console.log('\n═══ A. productStructureKey 结构归一 ═══')
// A1: 词序变体归一后同 key（核心性质——PLAY X 实机缺口）
const k1 = productStructureKey('Lexar PLAY X PCIe 4.0 M.2 NVMe SSD')
const k2 = productStructureKey('Lexar PLAY X M.2 PCIe 4.0 NVMe SSD')
assert(k1 !== null && k1 === k2, 'A1 词序变体结构归一后同 key', `k1=${k1} k2=${k2}`)

// A2: ®™© 符号被剥离（归一继承 cleanKey 语义）
const kR = productStructureKey('Lexar® PLAY X PCIe 4.0 M.2 NVMe SSD')
assert(kR === k1, 'A2 ® 符号剥离后与无®同 key', `kR=${kR}`)

// A3: 非产品名形态（无品类词）返回 null
assert(productStructureKey('Lexar PLAY X') === null, 'A3 无品类词返回 null')
assert(productStructureKey('Just a marketing sentence') === null, 'A3b 普通句子返回 null')

// A4: 不同产品不同 key（系列不同）
const kThor = productStructureKey('Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD')
assert(kThor !== null && kThor !== k1, 'A4 不同产品（THOR）不同 key')

// A5: 品类词进入 key（SSD vs Card 不同品类不同 key，防跨品类误判）
const kCard = productStructureKey('Lexar PLAY microSDXC UHS-I Card')
assert(kCard !== null && kCard !== k1, 'A5 不同品类（Card）不同 key')

console.log('\n═══ B. alignToGlossaryWordOrder 对齐行为 ═══')
// B1: 词序变体 → 对齐为钦定词序（核心修复）
const aligned = alignToGlossaryWordOrder('Lexar PLAY X PCIe 4.0 M.2 NVMe SSD', GLOSSARY_SOURCES)
assert(aligned === 'Lexar PLAY X M.2 PCIe 4.0 NVMe SSD', 'B1 词序变体对齐为钦定词序', `got ${aligned}`)

// B2: 已是钦定词序 → 不被对齐覆盖（v12.47.1：完全同形 key 跳过——S1 短路已管钦定译文，
//   align 只负责「词序变体」对齐，同形条目原样保留避免无意义替换）
const alignedIdem = alignToGlossaryWordOrder('Lexar PLAY X M.2 PCIe 4.0 NVMe SSD', GLOSSARY_SOURCES)
assert(alignedIdem === 'Lexar PLAY X M.2 PCIe 4.0 NVMe SSD', 'B2 钦定词序幂等（同形跳过对齐）')

// B3: 真新品（术语库无同结构）→ 原样保留源文词序
const novel = alignToGlossaryWordOrder('Lexar NEWMODEL SATA III 2.5-inch SSD', GLOSSARY_SOURCES)
assert(novel === 'Lexar NEWMODEL SATA III 2.5-inch SSD', 'B3 真新品保留源文词序')

// B4: 非产品名 → 原样（不崩）
const nonProduct = alignToGlossaryWordOrder('Buy now and save big', GLOSSARY_SOURCES)
assert(nonProduct === 'Buy now and save big', 'B4 非产品名原样返回')

// B5: ® 变体也能对齐（归一在函数内部）
const alignedR = alignToGlossaryWordOrder('Lexar® PLAY X PCIe 4.0 M.2 NVMe SSD', GLOSSARY_SOURCES)
assert(alignedR === 'Lexar PLAY X M.2 PCIe 4.0 NVMe SSD', 'B5 ® 变体对齐为钦定（去®）', `got ${alignedR}`)

// B6: 不同产品不被误对齐（THOR 词序变体 → 对齐 THOR 钦定，不是 PLAY X）
const thorVariant = alignToGlossaryWordOrder('Lexar THOR Ultra PCIe Gen5x4 M.2 2280 NVMe SSD', GLOSSARY_SOURCES)
assert(thorVariant === 'Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD', 'B6 THOR 词序变体对齐 THOR 钦定', `got ${thorVariant}`)

console.log('\n═══ C. 端到端：对齐后生成译名 = 钦定风格 ═══')
// C1: PLAY X 词序变体 → 对齐后 es 译名词序 = 钦定（M.2 PCIe 4.0 在前，品类词 es prefix 前置）
const alignedName = alignToGlossaryWordOrder('Lexar PLAY X PCIe 4.0 M.2 NVMe SSD', GLOSSARY_SOURCES)
const gen = generateProductNameTranslations(alignedName, 'PLAY X')
assert(
  gen.translations['es'].includes('M.2 PCIe 4.0'),
  'C1 es 译名含钦定词序 M.2 PCIe 4.0',
  `es=${gen.translations['es']}`,
)
assert(
  !gen.translations['es'].includes('PCIe 4.0 M.2'),
  'C1b es 译名不含画布词序 PCIe 4.0 M.2',
  `es=${gen.translations['es']}`,
)
// C2: es 品类词前置（prefix，与 CSV 钦定 Unidad de estado sólido (SSD) Lexar… 一致）
assert(
  gen.translations['es'].startsWith('Unidad de estado sólido (SSD)'),
  'C2 es 品类词前置（钦定语序）',
  `es=${gen.translations['es']}`,
)
// C3: 真新品（含 M.2↔PCIe 反词序）→ 词序归一到钦定（v12.48：不再保留源文反词序）
//   v12.47 时断言「真新品保留源文词序」——v12.48 规格词序归一下沉后，M.2↔PCIe 反词序
//   会被纠正为钦定 M.2 PCIe 4.0，与画布录入词序解耦。真新品只是没有钦定译文可短路，
//   但规格词序仍按钦定规则输出。
const novelGen = generateProductNameTranslations('Lexar NEWMODEL PCIe 4.0 M.2 NVMe SSD', 'NEWMODEL')
assert(
  novelGen.translations['es'].includes('M.2 PCIe 4.0'),
  'C3 真新品反词序也归一为钦定 M.2 PCIe 4.0（v12.48）',
  `es=${novelGen.translations['es']}`,
)
assert(
  !novelGen.translations['es'].includes('PCIe 4.0 M.2'),
  'C3b 真新品不含源文反词序 PCIe 4.0 M.2',
  `es=${novelGen.translations['es']}`,
)

console.log('\n═══ D. 安全性边界 ═══')
// D1: 空字符串不崩
assert(alignToGlossaryWordOrder('', GLOSSARY_SOURCES) === '', 'D1 空字符串原样')
// D2: 空术语库不崩（真新品全部保留源文）
assert(alignToGlossaryWordOrder('Lexar PLAY X PCIe 4.0 M.2 NVMe SSD', []) === 'Lexar PLAY X PCIe 4.0 M.2 NVMe SSD', 'D2 空术语库原样')
// D3: 大小写变体对齐（detectCategory 大小写不敏感 + 归一 toLowerCase）
const alignedCase = alignToGlossaryWordOrder('Lexar PLAY X PCIe 4.0 M.2 NVMe ssd', GLOSSARY_SOURCES)
assert(alignedCase === 'Lexar PLAY X M.2 PCIe 4.0 NVMe SSD', 'D3 品类词小写变体仍对齐', `got ${alignedCase}`)
// D4: detectCategory 对词序变体仍识别 SSD（品类在结尾）
assert(detectCategory('Lexar PLAY X PCIe 4.0 M.2 NVMe SSD') === 'SSD', 'D4 词序变体品类识别 SSD')

console.log(`\n═══ 结果: ${pass} 通过 / ${fail} 失败 ═══`)
if (fail > 0) process.exit(1)
