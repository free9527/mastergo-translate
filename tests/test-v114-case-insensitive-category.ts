/**
 * v11.4 产品名检测大小写形态统一修复测试
 *
 * 根因：detectCategory 是代码库唯一大小写敏感的品类匹配（无 i flag），
 *   系列名首字母大写规则拒绝品牌 camelCase 形态（nCARD/eSeries）。
 *   nCARD 虽停产，但未来新品/设计稿手写变体（'Lexar NQ790 ssd'）同类问题从根因覆盖。
 *
 * 修复：
 *   1. detectCategory 双遍匹配——官方写法精确匹配直通（既有行为零变化）；
 *      大小写不一致命中须过品名语境守卫（结尾词 + 前 token 含大写/数字）
 *   2. core-strip 正则 i flag（剥掉源文实际写法的小写品类词）
 *   3. 系列 token 允许 /^[a-z][A-Z]/ 品牌 camelCase 形态
 *
 * 覆盖：
 *  A. detectCategory 大小写不敏感（含守卫防误伤）
 *  B. core-strip 大小写不敏感（译名不重复品类词）
 *  C. 系列名 camelCase 品牌形态
 *  D. nCARD 端到端全链路
 *  E. 回归零影响（官方写法直通）
 *
 * 输出：tests/tmp-v114-test-out.txt，末行 "v11.4 测试：N 通过，M 失败"
 */

import { detectCategory, generateProductNameTranslations } from '../lib/product-name-generator'
import {
  parseProductName,
  detectAdhocProductTerms,
  detectFallbackCandidates,
} from '../lib/new-product-detect'
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
// A. detectCategory 大小写不敏感 + 品名语境守卫
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('A. detectCategory 大小写不敏感')

// A1: 小写 card 结尾 + 前 token NM（大写）→ Card
ok(detectCategory('Lexar nCARD NM card') === 'Card', 'A1 小写 card 检出', String(detectCategory('Lexar nCARD NM card')))

// A2: 小写 ssd 结尾 + 前 token NM790（含数字）→ SSD
ok(detectCategory('Lexar NM790 ssd') === 'SSD', 'A2 小写 ssd 检出', String(detectCategory('Lexar NM790 ssd')))

// A3: 多词品类小写 desktop memory 结尾 → Desktop Memory
ok(detectCategory('Lexar THOR DDR5 desktop memory') === 'Desktop Memory', 'A3 小写 desktop memory 检出', String(detectCategory('Lexar THOR DDR5 desktop memory')))

// A4: 混合大小写 Portable ssd（Portable 大写 + ssd 小写）→ Portable SSD
ok(detectCategory('Lexar SL500 Portable ssd') === 'Portable SSD', 'A4 混合 Portable ssd 检出', String(detectCategory('Lexar SL500 Portable ssd')))

// A5: 小写 reader 结尾 → Reader
ok(detectCategory('Lexar CFexpress reader') === 'Reader', 'A5 小写 reader 检出', String(detectCategory('Lexar CFexpress reader')))

// A6: 句中 card（非结尾）→ null（守卫 1 拦截）
ok(detectCategory('Insert card into slot') === null, 'A6 句中 card 不误判', String(detectCategory('Insert card into slot')))

// A7: card reader 双品类词连用（card 非结尾）→ null（守卫 1 拦截）
ok(detectCategory('card reader') === null, 'A7 双词连用不误判', String(detectCategory('card reader')))

// A8: 混合大小写双品类 ssd enclosure → null（守卫 1：大小写命中不在结尾；
//    官方写法也未命中——设计如此，非品名形态不走代码检出）
ok(detectCategory('Lexar E300 ssd enclosure') === null, 'A8 混合双词不检（守卫拦）', String(detectCategory('Lexar E300 ssd enclosure')))

// ═══════════════════════════════════════════════════════════════
// B. core-strip 大小写不敏感
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push('B. core-strip 大小写不敏感')

// B1: nCARD 生成 zh-CN —— core 剥掉小写 card，译名不重复
const b1 = generateProductNameTranslations('Lexar nCARD NM card', 'nCARD NM')
ok(b1.translations['zh-CN'] === 'Lexar nCARD NM 存储卡', 'B1 zh-CN 译名正确', b1.translations['zh-CN'])

// B2: nCARD 生成 fr —— 品类前置
ok(b1.translations['fr'] === 'Carte Lexar nCARD NM', 'B2 fr 译名正确', b1.translations['fr'])

// B3: 回归——官方写法生成不变
const b3 = generateProductNameTranslations('Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD', 'THOR Ultra')
ok(b3.translations['fr'] === 'SSD Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe'
  && b3.translations['zh-CN'] === 'Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe 固态硬盘',
  'B3 官方写法生成不变', b3.translations['fr'])

// ═══════════════════════════════════════════════════════════════
// C. 系列名 camelCase 品牌形态
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push('C. 系列名 camelCase 品牌形态')

// C1: nCARD（n+CARD 品牌形态）→ valid
const c1 = parseProductName('Lexar nCARD NM card')
ok(c1 !== null && c1.valid && c1.series === 'nCARD NM', 'C1 nCARD 系列检出', JSON.stringify(c1))

// C2: eSeries（e+Series 品牌形态）→ valid
const c2 = parseProductName('Lexar eSeries Card')
ok(c2 !== null && c2.valid && c2.series === 'eSeries', 'C2 eSeries 系列检出', JSON.stringify(c2))

// C3: pro（全小写普通词，非 camelCase）→ 拒绝
const c3 = parseProductName('Lexar pro card')
ok(c3 === null || !c3.valid, 'C3 pro 全小写拒绝', JSON.stringify(c3))

// C4: fast（DESCRIPTIVE_WORDS 描述词）→ 拒绝
const c4 = parseProductName('Lexar fast SSD')
ok(c4 === null || !c4.valid, 'C4 fast 描述词拒绝', JSON.stringify(c4))

// C5: 回归——THOR Ultra 官方写法不变
const c5 = parseProductName('Lexar THOR Ultra SSD')
ok(c5 !== null && c5.valid && c5.series === 'THOR Ultra', 'C5 THOR Ultra 回归', JSON.stringify(c5))

// ═══════════════════════════════════════════════════════════════
// D. nCARD 端到端全链路
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push('D. nCARD 端到端')

// D1: v11.2 代码路径直接检出（不再裸奔）
const d1 = detectAdhocProductTerms(['Lexar® nCARD NM card'], emptyGlossary)
ok(d1.length === 1 && d1[0].term === 'Lexar nCARD NM card', 'D1 nCARD 代码检出', JSON.stringify(d1))

// D2: 生成 20 语种（抽查 zh-CN/fr/ja）
const d2 = generateProductNameTranslations(d1[0].term, d1[0].series)
ok(d2.translations['zh-CN'] === 'Lexar nCARD NM 存储卡'
  && d2.translations['fr'] === 'Carte Lexar nCARD NM'
  && d2.translations['ja'] === 'Lexar nCARD NM カード',
  'D2 生成译名正确', `${d2.translations['zh-CN']} / ${d2.translations['fr']} / ${d2.translations['ja']}`)

// D3: v11.3 兜底不再触发（v11.2 已检出）
const d3 = detectFallbackCandidates(['Lexar® nCARD NM card'], emptyGlossary)
ok(d3.length === 0, 'D3 兜底不触发（代码已检出）', JSON.stringify(d3))

// D4: 未来形态 nCARD2（camelCase 系列 + 小写 card）→ 检出
const d4 = detectAdhocProductTerms(['Lexar® nCARD2 card'], emptyGlossary)
ok(d4.length === 1 && d4[0].series === 'nCARD2', 'D4 未来 camelCase 新品检出', JSON.stringify(d4))

// ═══════════════════════════════════════════════════════════════
// E. 回归零影响（官方写法直通）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push('E. 回归零影响')

// E1: THOR Ultra 官方写法检出不变
const e1 = detectAdhocProductTerms(['Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD'], emptyGlossary)
ok(e1.length === 1 && e1[0].term === 'Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD', 'E1 THOR Ultra 检出不变')

// E2: NF100 纯型号形态检出不变
const e2 = detectAdhocProductTerms(['Lexar® NF100 2.5-inch SATA III SSD'], emptyGlossary)
ok(e2.length === 1 && e2[0].term === 'Lexar NF100 2.5-inch SATA III SSD', 'E2 NF100 检出不变')

// E3: ARES 已知系列新子型号检出不变
const e3 = detectAdhocProductTerms(['Lexar ARES PCIe Gen4x4 M.2 2280 NVMe SSD'], emptyGlossary)
ok(e3.length === 1, 'E3 ARES 新子型号检出不变')

// E4: SUPER 兜底触发不变（DESCRIPTIVE_WORDS 误杀场景）
const e4 = detectFallbackCandidates(['Lexar® SUPER PCIe Gen5x4 NVMe SSD'], emptyGlossary)
ok(e4.length === 1, 'E4 SUPER 兜底触发不变')

// E5: MUSE 正常路径检出、兜底不触发不变
const e5a = detectAdhocProductTerms(['Lexar® MUSE Portable SSD'], emptyGlossary)
const e5b = detectFallbackCandidates(['Lexar® MUSE Portable SSD'], emptyGlossary)
ok(e5a.length === 1 && e5b.length === 0, 'E5 MUSE 路径不变')

// E6: 说明书句子不误判（detectCategory null → parseProductName 拒绝 → 走正常翻译）
const e6cat = detectCategory('Insert card into slot')
const e6parse = parseProductName('Insert card into slot')
const e6 = detectAdhocProductTerms(['Insert card into slot'], emptyGlossary)
ok(e6cat === null && (e6parse === null || !e6parse.valid) && e6.length === 0, 'E6 说明书句子不误判')

out.push('')
out.push(`v11.4 测试：${pass} 通过，${fail} 失败`)
writeFileSync('tests/tmp-v114-test-out.txt', out.join('\n'), 'utf-8')
console.log(out.join('\n'))
process.exit(fail > 0 ? 1 : 0)
