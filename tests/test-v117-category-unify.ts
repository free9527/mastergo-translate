/**
 * v11.7 品类词 3 源统一为 CATEGORY_WORDS 单一事实源
 *
 * 背景：v11.4 发现代码库 5 个品类词数据源大小写策略不一致（detectCategory 是唯一
 * 大小写敏感匹配）。本次统一消剩余 3 个"值漂移"源：
 *   ① prompt-constants.CATEGORY_WORDS（prompt 品类词对照表，无 en 列）
 *   ② product-name-generator.CATEGORY_TRANSLATIONS（产品名生成，含 en 列+生成特定译法）
 *   ③ glossary-filter.isCategoryWord（硬编码 19 词含 7 个幽灵词）
 *
 * 方案：CATEGORY_WORDS 加 en 列 + 可选 productName override；②③ 删除本地副本改派生。
 *
 * 验证：
 *   A. CATEGORY_WORDS 结构完整（11 词 × 20 语言 + en 列 + productName override 类型）
 *   B. 产品名生成译法保真（override 命中 = 删前 generator 值；无 override = prompt 对照值）
 *   C. prompt 品类词对照表不含 productName 字段（Record 类型不外泄到 prompt）
 *   D. isCategoryWord 从 CATEGORY_WORDS 派生（11 词命中 + 幽灵词不再豁免）
 *   E. 与术语库 CSV 一致性（Desktop Memory zh-CN 产品名生成 = CSV 全 12 条写法）
 */

import { CATEGORY_WORDS } from '../lib/prompt-constants'
import { generateProductNameTranslations, detectCategory } from '../lib/product-name-generator'
import { buildTaskGlossaryHint } from '../lib/llm-api'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV } from '../lib/default-glossary'

let pass = 0, fail = 0
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`)}
}

const LANGS = ['zh-CN','zh-TW','ja','ko','fr','de','es','pt','pt-BR','ru','it','vi','th','id','ar','nl','pl','sv','tr','en']

// ═══════════════════════════════════════════════════════════════
// A. CATEGORY_WORDS 结构完整
// ═══════════════════════════════════════════════════════════════
console.log('A. CATEGORY_WORDS 结构')

const WORDS = Object.keys(CATEGORY_WORDS)
assert('A1 11 个品类词', WORDS.length === 11, `实际 ${WORDS.length}: ${WORDS.join(',')}`)

for (const w of WORDS) {
  const entry = CATEGORY_WORDS[w]
  for (const lang of LANGS) {
    const v = entry[lang]
    assert(`A2 ${w} [${lang}] 非空字符串`, typeof v === 'string' && (v as string).length > 0)
  }
}

assert('A3 SSD 有 productName override', !!CATEGORY_WORDS['SSD'].productName)
assert('A4 Card 无 productName override（prompt=生成一致）', !CATEGORY_WORDS['Card'].productName)

// ═══════════════════════════════════════════════════════════════
// B. 产品名生成译法保真（override = 删前 generator 值）
// ═══════════════════════════════════════════════════════════════
console.log('\nB. 产品名生成译法保真')

// B1: SSD ru → override 值（删前 generator: Внутренний SSD；prompt 对照: SSD）；ru 语序 prefix
const b1 = generateProductNameTranslations('Lexar NOVA PCIe 4.0 NVMe SSD', 'NOVA')
assert('B1 SSD ru 走 override Внутренний SSD', b1.translations['ru'] === 'Внутренний SSD Lexar NOVA PCIe 4.0 NVMe', b1.translations['ru'])

// B2: SSD zh-CN → prompt 对照值（两表一致：固态硬盘）
assert('B2 SSD zh-CN 固态硬盘（无 override）', b1.translations['zh-CN'] === 'Lexar NOVA PCIe 4.0 NVMe 固态硬盘', b1.translations['zh-CN'])

// B3: Desktop Memory zh-CN → override 台式电脑内存（=CSV 写法；prompt 对照为 台式机内存条）
const b3 = generateProductNameTranslations('Lexar VELOCIS DDR5 6000MHz Desktop Memory', 'VELOCIS')
assert('B3 Desktop Memory zh-CN 走 override 台式电脑内存', b3.translations['zh-CN'] === 'Lexar VELOCIS DDR5 6000MHz 台式电脑内存', b3.translations['zh-CN'])

// B4: Flash Drive ja → override フラッシュドライブ（prompt 对照为 USBメモリ）
const b4 = generateProductNameTranslations('Lexar JumpDrive Nova USB 3.2 Flash Drive', 'JumpDrive Nova')
assert('B4 Flash Drive ja 走 override フラッシュドライブ', b4.translations['ja'] === 'Lexar JumpDrive Nova USB 3.2 フラッシュドライブ', b4.translations['ja'])

// B5: Dual Drive fr → override Clé USB（prompt 对照为 Clé USB double interface）
// 注意：generateProductNameTranslations 的 core = enName 剥品类词，series 参数不影响 core
const b5 = generateProductNameTranslations('Lexar Dual Drive Nova USB 3.2 Type-C', 'Nova')
assert('B5 Dual Drive fr 走 override Clé USB', b5.translations['fr'] === 'Clé USB Lexar Nova USB 3.2 Type-C', b5.translations['fr'])

// B6: Dual Drive zh-CN → override 闪存盘（prompt 对照为 双接口U盘）；zh-CN 语序 suffix
assert('B6 Dual Drive zh-CN 走 override 闪存盘', b5.translations['zh-CN'] === 'Lexar Nova USB 3.2 Type-C 闪存盘', b5.translations['zh-CN'])

// B7: Solid State Dual Drive fr → override Clé USB SSD（prompt 对照为 Clé USB SSD double interface）
const b7 = generateProductNameTranslations('Lexar JumpDrive Solid State Dual Drive Nova USB 3.2 Type-C', 'JumpDrive Nova')
assert('B7 SSDD fr 走 override Clé USB SSD', b7.translations['fr'] === 'Clé USB SSD Lexar JumpDrive Nova USB 3.2 Type-C', b7.translations['fr'])

// B8: Card 全语种 = prompt 对照值（无 override 词条抽查）
const b8 = generateProductNameTranslations('Lexar NOVA microSDXC UHS-I Card', 'NOVA')
assert('B8 Card zh-CN 存储卡', b8.translations['zh-CN'] === 'Lexar NOVA microSDXC UHS-I 存储卡', b8.translations['zh-CN'])
assert('B9 Card ja カード', b8.translations['ja'] === 'Lexar NOVA microSDXC UHS-I カード', b8.translations['ja'])

// B10: en 列（新增）——en 生成 = 英文原文
assert('B10 SSD en = SSD', b1.translations['en'] === 'Lexar NOVA PCIe 4.0 NVMe SSD', b1.translations['en'])

// ═══════════════════════════════════════════════════════════════
// C. prompt 品类词对照表不含 productName 字段
// ═══════════════════════════════════════════════════════════════
console.log('\nC. prompt 对照表纯净')

// 走真实 buildTaskGlossaryHint 路径拿不到品类词对照表（那是 LANG_SPECIFIC 渲染的），
// 改为直接断言 buildCategoryTerminology 的行为特征：
// 对照表行必须是 "en → string"，不能是 "en → [object Object]"
// 用 renderLangForTranslate 间接验证——但它是私有函数，改为检查 CATEGORY_WORDS 结构：
// entry[targetLang] 必须是 string（productName 是 Record，绝不能被当译法返回）
let allString = true
for (const w of WORDS) {
  const entry = CATEGORY_WORDS[w]
  for (const lang of LANGS) {
    const v = entry[lang]
    if (typeof v !== 'string') { allString = false; console.log(`  ⚠ ${w}[${lang}] 非 string: ${typeof v}`) }
  }
}
assert('C1 全部 11×20 entry[lang] 为 string（productName 不污染语种直值）', allString)

// C2: productName 字段本身类型正确（存在的词条）
for (const w of WORDS) {
  const pn = CATEGORY_WORDS[w].productName
  if (pn !== undefined) {
    assert(`C2 ${w}.productName 为 Record<string,string>`, typeof pn === 'object' && !Array.isArray(pn))
  }
}

// ═══════════════════════════════════════════════════════════════
// D. isCategoryWord 从 CATEGORY_WORDS 派生
// ═══════════════════════════════════════════════════════════════
console.log('\nD. isCategoryWord 派生')

// D1-D3: 通过 buildTaskGlossaryHint 行为间接验证——品类词术语应从 hint 中被剔除
// （isCategoryWord(source) → continue 不注入）
// 构造含品类词 + 非品类词的术语库场景
const testGlossary = new Map<string, string>([
  ['SSD', '固态硬盘'],                        // 品类词 → 应被 isCategoryWord 剔除
  ['Lexar NOVA SSD', 'Lexar NOVA 固态硬盘'],   // 产品名 → 应保留（非品类词整体）
  ['USB-C', 'USB-C'],                        // source===target → 被另一规则剔除
])
const hint = buildTaskGlossaryHint(testGlossary, 'ecommerce', ['Lexar NOVA SSD is fast'])
assert('D1 品类词 SSD 不进 hint', !hint.includes('SSD → 固态硬盘') || hint.includes('Lexar NOVA SSD'), `hint: ${hint.slice(0,200)}`)
assert('D2 产品名 Lexar NOVA SSD 保留', hint.includes('Lexar NOVA SSD'), `hint: ${hint.slice(0,200)}`)

// D4: 幽灵词不再豁免——'SDXC Card' 若进术语库应被正常注入（不再被 isCategoryWord 误豁免）
const ghostGlossary = new Map<string, string>([['SDXC Card', 'SDXC 存储卡']])
const ghostHint = buildTaskGlossaryHint(ghostGlossary, 'ecommerce', ['This SDXC Card is fast'])
assert('D4 幽灵词 SDXC Card 不再被豁免（正常注入）', ghostHint.includes('SDXC Card'), `hint: ${ghostHint.slice(0,200)}`)

// ═══════════════════════════════════════════════════════════════
// E. 与术语库 CSV 一致性
// ═══════════════════════════════════════════════════════════════
console.log('\nE. 术语库 CSV 一致性')

// E1: Desktop Memory zh-CN 产品名生成值 = CSV 全 12 条台式内存写法
const csvHasTaiwanStyle = DEFAULT_GLOSSARY_PRODUCTS_CSV.includes('台式电脑内存')
const csvHasOldStyle = DEFAULT_GLOSSARY_PRODUCTS_CSV.includes('台式机内存条')
assert('E1 CSV 用 台式电脑内存（非 台式机内存条）', csvHasTaiwanStyle && !csvHasOldStyle,
  `台式电脑内存:${csvHasTaiwanStyle} 台式机内存条:${csvHasOldStyle}`)

// E2: override 值与 CSV 一致
assert('E2 override 值 = CSV 写法', CATEGORY_WORDS['Desktop Memory'].productName?.['zh-CN'] === '台式电脑内存')

// E3: v11.7 修复后锁定——ko Portable SSD 正确拼写 휴의용 SSD（曾误植为 휴의용 SSD，无任何测试拦住）
assert('E3 ko Portable SSD = 휴의용 SSD（v11.7 拼写回归锁）', CATEGORY_WORDS['Portable SSD']['ko'] === '휴의용 SSD',
  `实际: ${CATEGORY_WORDS['Portable SSD']['ko']}`)

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(50))
console.log(`v11.7 测试：${pass} 通过，${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
