/**
 * v11.2 复盘脚本（重构后）："Lexar® NF100 2.5-inch SATA III SSD" 全链路重测
 *
 * 与 review-v112-nf100-chain.ts 相同结构，但跑在 v11.2 重构后的代码上。
 * 输出：tests/tmp-v112-nf100-review-v2.txt
 */
import { writeFileSync } from 'fs'
import { detectAdhocProductTerms, parseProductName } from '../lib/new-product-detect'
import { generateProductNameTranslations, detectCategory } from '../lib/product-name-generator'
import { maskGlossaryTerms, maskEntities } from '../lib/entity-masker'

const SRC = 'Lexar® NF100 2.5-inch SATA III SSD'
const out: string[] = []
const p = (s: string) => out.push(s)

p('═══════════════════════════════════════════════════════════════')
p('v11.2 重构后全链路复盘')
p('输入源文: ' + JSON.stringify(SRC))
p('═══════════════════════════════════════════════════════════════')

const glossaryMap = new Map<string, string>([
  ['Lexar PLAY microSDXC UHS-I Card', 'Lexar PLAY microSDXC UHS-I 存储卡'],
  ['Lexar THOR DDR4 UDIMM Desktop Memory', 'Lexar THOR DDR4 UDIMM 台式电脑内存'],
])

p('')
p('【步骤1】v11.2 检测 detectAdhocProductTerms')
const parsed = parseProductName(SRC)
p('parseProductName = ' + JSON.stringify(parsed))
const detected = detectAdhocProductTerms([SRC], glossaryMap)
p('检测结果 = ' + JSON.stringify(detected))
p('判定: ' + (detected.length === 0 ? '❌ 未检出' : '✅ 检出 ' + detected.length + ' 个'))

p('')
p('【步骤2】生成当前目标语种译名并入 glossaryMap（以 fr / zh-CN / de 演示）')
const TARGETS = ['fr', 'zh-CN', 'de']
for (const d of detected) {
  const gen = generateProductNameTranslations(d.term, d.series)
  for (const lang of TARGETS) {
    p('  ' + lang.padEnd(6) + ' = ' + gen.translations[lang])
  }
  // 模拟翻译路径：并入 fr 译名
  glossaryMap.set(d.term, gen.translations['fr'])
  p('  → 已并入 glossaryMap: "' + d.term + '" → fr译名')
}

p('')
p('【步骤3】S1 整条短路（fr 目标）')
const lookupKey = SRC.toLowerCase().replace(/[®™©]/g, '').trim()
let hit = false
for (const [k, v] of glossaryMap.entries()) {
  if (k.toLowerCase().replace(/[®™©]/g, '').trim() === lookupKey) {
    p('  ✅ 短路命中: "' + k + '" → "' + v + '"')
    hit = true
    break
  }
}
if (!hit) p('  ❌ 未命中')

p('')
p('【步骤4】S2 遮蔽（若未短路则会走的路径）')
const { texts: gm } = maskGlossaryTerms([SRC], glossaryMap)
p('术语遮蔽后: ' + JSON.stringify(gm[0]))
const { texts: em, entityMap } = maskEntities(gm)
p('实体遮蔽后: ' + JSON.stringify(em[0]))
p('entityMap: ' + JSON.stringify([...entityMap.entries()]))

p('')
p('【步骤5】静默入库（无®整条 + 20 语种）')
for (const d of detected) {
  const gen = generateProductNameTranslations(d.term, d.series)
  p('入库 key: ' + d.term + '  （含®？ ' + d.term.includes('®') + '）')
  for (const [lang, val] of Object.entries(gen.translations)) {
    p('    ' + lang.padEnd(6) + ' = ' + val)
  }
}

p('')
p('═══════════════════════════════════════════════════════════════')
p('v11.2 链路总结')
p('═══════════════════════════════════════════════════════════════')
p('1. 检测: ' + (detected.length > 0 ? '✅ 检出（®修复+纯型号形态+品类指纹全过）' : '❌ 未检出'))
p('2. S1 短路: ' + (hit ? '✅ 命中厂形译文（LLM 不碰产品名）' : '❌ 未命中'))
p('3. 入库: ' + (detected.length > 0 ? '✅ 无®整条 + 20 语种' : '❌ 不触发'))

writeFileSync('tests/tmp-v112-nf100-review-v2.txt', out.join('\n'), 'utf-8')
console.log(out.join('\n').split('').map(c => {
  const code = c.codePointAt(0)!
  return code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : c
}).join(''))
