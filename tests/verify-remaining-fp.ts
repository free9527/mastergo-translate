/**
 * 用真实代码验证剩余 4 条误判的实际路径
 */
import { detectUntranslatedText, detectTargetLanguageFeatures, isUntranslatable } from '../lib/llm-api'

// 从 llm-api.ts 导入的 containsLanguageFunctionWords 不导出，
// 所以我们通过 detectUntranslatedText 的行为来反推

const cases = [
  {
    label: 'FR: "5 Years Service" → "Service de 5 ans"',
    source: '5 Years Service\n',
    target: 'Service de 5 ans',
    lang: 'fr',
  },
  {
    label: 'IT: "Lexar DiskMaster..." → 意大利语译文',
    source: 'Lexar DiskMaster\nFirmware upgrades\nHealth monitoring\nPerformance optimization\nData security',
    target: 'Lexar DiskMaster\n Aggiornamenti del firmware\n Controllo dello stato di salute\n Ottimizzazione delle prestazioni\n Sicurezza dei dati',
    lang: 'it',
  },
  {
    label: 'IT: "5 Years Service" → "5 anni di assistenza"',
    source: '5 Years Service\n',
    target: '5 anni di assistenza',
    lang: 'it',
  },
  {
    label: 'PL: "5 Years Service" → "5-letni serwis"',
    source: '5 Years Service\n',
    target: '5-letni serwis',
    lang: 'pl',
  },
]

console.log('=== 用真实代码验证剩余误判 ===\n')

for (const c of cases) {
  const feature = detectTargetLanguageFeatures(c.target, c.lang)
  const detected = detectUntranslatedText([c.source], [c.target], c.lang, new Map())
  const isUntrans = isUntranslatable(c.source)

  // 提取所有 ASCII-only 词（模拟 extractNonTargetWords）
  const allTokens = c.target.split(/[\s,.;:!?()\[\]{}\-\/\\]+/).filter(w => w.length >= 2)
  const asciiWords = allTokens.filter(w => /^[a-zA-Z]+$/.test(w))
  const totalWords = c.target.split(/\s+/).filter(w => w.length > 0)

  console.log(`--- ${c.label} ---`)
  console.log(`  长度: ${c.target.length} 字符`)
  console.log(`  特征字符: ${feature.hasFeatures ? '✓' : '✗'} (${(feature.featureRatio * 100).toFixed(2)}%)`)
  console.log(`  源文 isUntranslatable: ${isUntrans}`)
  console.log(`  检测结果: ${detected.size > 0 ? '❌ 误判' : '✅ 通过'}`)
  console.log(`  ASCII 词: ${asciiWords.join(', ')}`)
  console.log(`  总词数: ${totalWords.length}, ASCII 词数: ${asciiWords.length}`)

  // 分析维度1
  const normalize = (t: string) => t.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  console.log(`  维度1（归一化相同）: ${normalize(c.source) === normalize(c.target)}`)
  console.log('')
}

// 关键测试：如果源文和译文完全相同（真正漏翻），短文本是否会被放过？
console.log('\n=== 真正漏翻的短文本 ===\n')

const realUntranslated = [
  { source: '5 Years Service\n', target: '5 Years Service\n', lang: 'fr', label: 'FR: 完全没翻译' },
  { source: '5 Years Service\n', target: '5 Years Service\n', lang: 'it', label: 'IT: 完全没翻译' },
  { source: '5 Years Service\n', target: '5 Years Service\n', lang: 'pl', label: 'PL: 完全没翻译' },
]

for (const c of realUntranslated) {
  const detected = detectUntranslatedText([c.source], [c.target], c.lang, new Map())
  console.log(`${c.label}: ${detected.size > 0 ? '✅ 正确标记' : '❌ 漏检!'}`)
}
