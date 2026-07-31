/**
 * 混杂批次测试：pt-BR 为主 + 混入英文，target=pt-BR
 * 验证：纯度条件是否正确保护英文条目，同时不误伤葡语条目
 */
import { detectSourceLanguage, detectUntranslatedText } from '../lib/llm-api'

const batch = [
  'Alto desempenho',                    // pt
  'Ideal para jogos e criação',         // pt
  'High speed performance',             // en ← 应被检测为漏翻（如果译文=源文）
  'Design durável e portátil',          // pt
  'The ultimate gaming gear',           // en ← 应被检测为漏翻
]

const batchLang = detectSourceLanguage(batch)
console.log(`批次判定: ${batchLang}`)

// 译文 == 源文（模拟同语言扫描）
const result = detectUntranslatedText(batch, [...batch], 'pt-BR', undefined, batchLang)
console.log(`误报漏翻: ${result.size}/${batch.length}`)
for (const i of result) {
  const lang = i === 2 || i === 4 ? 'en' : 'pt'
  console.log(`  [${i}] (${lang}) ${batch[i]}`)
}

console.log('\n期望: 葡语条目(0,1,3)不误报，英文条目(2,4)应报漏翻')
const ptFalsePositives = [0, 1, 3].filter(i => result.has(i))
const enMissed = [2, 4].filter(i => !result.has(i))
console.log(`葡语误报: ${ptFalsePositives.length} ${ptFalsePositives.length ? '❌' : '✅'}`)
console.log(`英文漏检: ${enMissed.length} ${enMissed.length ? '❌' : '✅'}`)
