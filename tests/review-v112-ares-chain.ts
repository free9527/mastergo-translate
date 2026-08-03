/**
 * v11.2 边界用例：Lexar ARES PCIe Gen4x4 M.2 2280 NVMe SSD
 *
 * 用户测试输入：已知系列名 ARES + 全新子型号（无型号代码的纯规格组合）。
 * CSV 中有 ARES 系列 6 条，但无此精确组合。
 *
 * 场景 A：空术语库（系列名新颖性门不拦）
 * 场景 B：真实 CSV 级术语库（含 ARES 系列 6 条，无本组合）
 */
import { writeFileSync } from 'fs'
import { detectAdhocProductTerms, parseProductName } from '../lib/new-product-detect'
import { generateProductNameTranslations } from '../lib/product-name-generator'
import { maskGlossaryTerms, maskEntities } from '../lib/entity-masker'

const SRC = 'Lexar ARES PCIe Gen4x4 M.2 2280 NVMe SSD'
const out: string[] = []
const p = (s: string) => out.push(s)

p('输入: ' + JSON.stringify(SRC))
p('')

// ── 解析 ──
const parsed = parseProductName(SRC)
p('parseProductName = ' + JSON.stringify(parsed))
p('')

// ── 场景 A：空术语库 ──
p('【场景A】空术语库')
const detA = detectAdhocProductTerms([SRC], new Map())
p('检测 = ' + JSON.stringify(detA))
if (detA.length > 0) {
  const gen = generateProductNameTranslations(detA[0].term, detA[0].series)
  p('生成 20 语种:')
  for (const [l, v] of Object.entries(gen.translations)) p('  ' + l.padEnd(6) + ' = ' + v)
}
p('')

// ── 场景 B：真实 CSV 级术语库（含 ARES 系列，无本组合）──
p('【场景B】术语库含 ARES 系列 6 条（无本组合）')
const csvGlossary = new Map<string, string>([
  ['Lexar ARES DDR4 Desktop Memory', 'Lexar ARES DDR4 台式电脑内存'],
  ['Lexar ARES DDR5 OC Desktop Memory', 'Lexar ARES DDR5 OC 台式电脑内存'],
  ['Lexar ARES PRO M.2 2280 PCIe 5.0 NVMe SSD', 'Lexar ARES PRO M.2 2280 PCIe 5.0 NVMe 固态硬盘'],
  ['Lexar ARES RGB 2nd Gen DDR5 Desktop Memory', 'Lexar ARES RGB 2nd Gen DDR5 台式电脑内存'],
  ['Lexar ARES RGB DDR4 Desktop Memory', 'Lexar ARES RGB DDR4 台式电脑内存'],
  ['Lexar ARES RGB DDR5 Desktop Memory', 'Lexar ARES RGB DDR5 台式电脑内存'],
])
const detB = detectAdhocProductTerms([SRC], csvGlossary)
p('检测 = ' + JSON.stringify(detB))
if (detB.length > 0) {
  const gen = generateProductNameTranslations(detB[0].term, detB[0].series)
  const fr = gen.translations['fr']
  csvGlossary.set(detB[0].term, fr)
  p('并入 fr 译名: ' + fr)

  // S1 短路
  const lookupKey = SRC.toLowerCase().replace(/[®™©]/g, '').trim()
  for (const [k, v] of csvGlossary.entries()) {
    if (k.toLowerCase().replace(/[®™©]/g, '').trim() === lookupKey) {
      p('S1 短路命中: "' + k + '" → "' + v + '"')
      break
    }
  }
} else {
  // 未检出 → 走遮蔽+LLM 路径
  const { texts: gm } = maskGlossaryTerms([SRC], csvGlossary)
  p('术语遮蔽后: ' + JSON.stringify(gm[0]))
  const { texts: em, entityMap } = maskEntities(gm)
  p('实体遮蔽后: ' + JSON.stringify(em[0]))
  p('entityMap: ' + JSON.stringify([...entityMap.entries()]))
  p('→ LLM 看到的是零件拼装，ARES 裸露（已知系列名，LLM 大概率保留但不保证）')
}

writeFileSync('tests/tmp-ares-chain.txt', out.join('\n'), 'utf-8')
console.log(out.join('\n').split('').map(c => {
  const code = c.codePointAt(0)!
  return code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : c
}).join(''))
