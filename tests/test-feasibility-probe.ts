// 可行性测试：consistency 对齐 & JudgmentTable 收敛值不值得做（只读不写，零生产改动）
//   实验①：型号类不一致（ZV-E10 vs ZVE10）现有六层防线覆盖率 → consistency 对齐收益量化
//   实验②：isUntranslatable 5 处调用点 + 含数字 3 处 → 真重复 or 名义重复实语义不同
import { maskGlossaryTerms, unmaskGlossaryTerms } from '../lib/entity-masker'
import { isUntranslatable, shouldSkipBestOf2 } from '../lib/llm-api'
import { shouldKeepSource } from '../lib/keep-source'
import { enforceGlossaryTerms, cleanKey } from '../lib/post-process'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}
const section = (t: string) => console.log(`\n═══ ${t} ═══`)

// ─── 构造测试术语库（含连字符型号 + identity 第三方品牌）───
const glossary = new Map<string, string>([
  ['ZV-E10', 'ZV-E10'],           // identity 型号（连字符）
  ['A7R V', 'A7R V'],
  ['Lexar® Professional SILVER PRO', 'Lexar® Professional SILVER PRO'],
  ['CFexpress', 'CFexpress'],
  ['Apple', 'Apple'],
  ['Samsung', 'Samsung'],
])
const glossaryEn = new Map(glossary)  // 本测试 en 视图与 full 同（identity 词条各语言列同值）

section('实验① consistency 对齐收益量化——型号类不一致现有防线覆盖')

// ①-1: 连字符型号遮蔽往返（ZV-E10 遮蔽后还原是否保形）
{
  const src = ['Works with ZV-E10 camera']
  const masked = maskGlossaryTerms(src, glossary)
  const unmasked = unmaskGlossaryTerms(masked.texts, masked.termMap)
  const shapePreserved = unmasked.texts[0].includes('ZV-E10')
  console.log(`    [观测] ZV-E10 遮蔽: "${masked.texts[0]}" → 还原: "${unmasked.texts[0]}"`)
  assert(shapePreserved, '①-1 连字符型号 ZV-E10 遮蔽→还原保形（现有防线兜住，无需 consistency 对齐）')
}

// ①-2: ZVE10（无连字符变体）是否也被防线兜住（cleanKey [-_]→空格归一）
{
  const ck1 = cleanKey('ZV-E10')
  const ck2 = cleanKey('ZVE10')
  console.log(`    [观测] cleanKey('ZV-E10')="${ck1}" vs cleanKey('ZVE10')="${ck2}"`)
  // 关键：ZV-E10 归一后是 "zv e10"，ZVE10 归一后是 "zve10" —— 两者不同！
  // 这意味着「ZV-E10 vs ZVE10」渲染差异现有防线【不】归一——是 consistency 对齐的潜在收益点
  const covered = ck1 === ck2
  console.log(`    [观测] 连字符归一后${covered ? '相同（防线兜住）' : '不同（防线不兜，consistency 潜在收益点）'}`)
  assert(true, `①-2 [观测非断言] ZV-E10 vs ZVE10 cleanKey 归一：${covered ? '防线兜住' : '防线不兜'}`)
}

// ①-3: enforceGlossaryTerms 对型号变体的校准力
{
  const enforced = enforceGlossaryTerms(['Use ZVE10 now'], ['使用 ZVE10 现在'], glossary)
  console.log(`    [观测] ZVE10 译文校准: "${enforced[0]}"`)
  assert(true, '①-3 [观测非断言] enforceGlossaryTerms 对无连字符变体的处理')
}

section('实验② JudgmentTable 收敛——isUntranslatable 5 处调用点真重复 or 名义重复')

// ②-1: 同一批样本喂不同调用点，比对返回（视图差异是否导致分化）
const samples = [
  'ZV-E10', 'A7R V', 'Apple', 'CFexpress',           // 型号/品牌
  'Fast speeds', '900MB/s', 'Up to 4TB',              // 描述/单位
  'Power up Your Creativity', 'USB-C', '2000',        // 营销/接口/纯数字
]
{
  const viaDirectFull = samples.map(s => isUntranslatable(s, glossary))
  const viaDirectEn = samples.map(s => isUntranslatable(s, glossaryEn))
  const viaKeepSource = samples.map(s => shouldKeepSource(s, { targetLang: 'ja', glossaryEnMap: glossaryEn }))
  const diverge = samples.filter((s, i) => viaDirectFull[i] !== viaKeepSource[i])
  console.log(`    [观测] 样本 isUntranslatable(full/en) vs shouldKeepSource 分歧: ${diverge.length} 条`, diverge)
  // shouldKeepSource 内部就是 isUntranslatable(src, glossaryEnMap)——同视图应一致
  assert(JSON.stringify(viaDirectEn) === JSON.stringify(viaKeepSource),
    '②-1 shouldKeepSource ≡ isUntranslatable(en 视图)（已收口，非真重复）')
}

// ②-2: 含数字 3 处口径比对——条目级 vs 批次级 vs 段级
{
  const itemLevel = (s: string) => /\d/.test(s)          // isPickEligible 条目级（1270）
  const batchLevel = (texts: string[]) => shouldSkipBestOf2(texts)  // 批次级（2097，some 语义）
  const seg = ['Fast 900MB/s', 'Up to 4TB capacity', 'No digits here']
  const itemResults = seg.map(itemLevel)
  const batchResult = batchLevel(seg)
  console.log(`    [观测] 条目级: [${itemResults.join(',')}] vs 批次级(some): ${batchResult}`)
  // 关键：条目级是逐条判定，批次级是「任一条含数字则整批跳过」——两种不同统计口径
  const differentSemantics = batchResult !== itemResults.every(Boolean)
  assert(differentSemantics || batchResult === itemResults.some(Boolean),
    '②-2 含数字判定：条目级(every)≠批次级(some)——口径不同，强行合并=改错统计语义')
}

// ②-3: 5 处调用点视图传参是否统一（v9.10 红线核心）
{
  // 3388 行 isUntranslatable(src) 无 glossaryMap；3468 行 isUntranslatable(s, glossaryMap) 传 full
  // 4176 行 isUntranslatable(src, untranslatableGlossary) 传 en
  const noMap = samples.map(s => isUntranslatable(s))           // 无视图（3388 截断检测）
  const withFull = samples.map(s => isUntranslatable(s, glossary))   // full 视图（3468）
  const withEn = samples.map(s => isUntranslatable(s, glossaryEn))   // en 视图（4176）
  const fullVsEn = samples.filter((s, i) => withFull[i] !== withEn[i])
  const noMapVsEn = samples.filter((s, i) => noMap[i] !== withEn[i])
  console.log(`    [观测] full vs en 分歧: ${fullVsEn.length} 条`, fullVsEn)
  console.log(`    [观测] 无视图 vs en 分歧: ${noMapVsEn.length} 条`, noMapVsEn)
  assert(true, `②-3 [观测非断言] 5 处调用点视图分化：full/en 差 ${fullVsEn.length} 条，无视图/en 差 ${noMapVsEn.length} 条 → ${fullVsEn.length + noMapVsEn.length > 0 ? '证实名义重复实语义不同' : '真重复'}`)
}

section('量化结论（数据驱动拍板）')
console.log('  实验①：ZV-E10 vs ZVE10 cleanKey 归一后' + (cleanKey('ZV-E10') === cleanKey('ZVE10') ? '相同' : '【不同】'))
console.log('  → 若不同：型号渲染差异现有防线不兜，但正确解法=术语库收录变体，非 consistency 事后对齐')
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
