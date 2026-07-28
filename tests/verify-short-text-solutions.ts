/**
 * 验证短文案方案
 */
import { detectUntranslatedText, detectTargetLanguageFeatures } from '../lib/llm-api'

// 功能词列表（从 llm-api.ts 复制）
const LANG_FUNCTION_WORDS: Record<string, Set<string>> = {
  'fr': new Set(['et', 'ou', 'mais', 'donc', 'car', 'que', 'qui', 'dans', 'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'entre', 'vers', 'chez', 'contre', 'depuis', 'pendant', 'avant', 'après', 'selon', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'est', 'sont', 'a', 'ont', 'être', 'avoir', 'en', 'ne', 'pas', 'plus', 'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'tout', 'toute', 'tous', 'fait', 'faire', 'peut', 'peuvent', 'doit', 'aussi', 'très', 'bien', 'comme', 'plus', 'moins', 'alors', 'donc', 'si']),
  'es': new Set(['y', 'o', 'pero', 'que', 'porque', 'con', 'para', 'por', 'desde', 'hasta', 'entre', 'sin', 'sobre', 'según', 'durante', 'antes', 'después', 'mientras', 'cuando', 'como', 'si', 'aunque', 'sino', 'también', 'muy', 'más', 'menos', 'aquí', 'ahí', 'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'tiene', 'tienen']),
  'it': new Set(['e', 'o', 'ma', 'che', 'perché', 'con', 'per', 'da', 'fra', 'tra', 'senza', 'su', 'secondo', 'durante', 'prima', 'dopo', 'mentre', 'quando', 'come', 'se', 'anche', 'molto', 'più', 'meno', 'qui', 'là', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'è', 'sono', 'ha', 'hanno']),
  'pl': new Set(['i', 'lub', 'ale', 'że', 'bo', 'z', 'na', 'do', 'od', 'w', 'przy', 'przez', 'między', 'bez', 'przeciw', 'gdy', 'kiedy', 'jak', 'czy', 'też', 'bardzo', 'tu', 'tam', 'ten', 'ta', 'to', 'jest', 'są', 'ma', 'mieć', 'być']),
}

function checkFunctionWords(text: string, lang: string): boolean {
  const words = LANG_FUNCTION_WORDS[lang]
  if (!words) return false
  const textWords = text.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/]+/).filter(w => w.length >= 2)
  let matchCount = 0
  for (const w of textWords) {
    if (words.has(w)) matchCount++
  }
  return matchCount >= 1 && matchCount / textWords.length >= 0.03
}

// 测试用例
const testCases = [
  {
    label: 'FR: "5 Years Service" → "Service de 5 ans"',
    source: '5 Years Service\n',
    target: 'Service de 5 ans',
    lang: 'fr',
  },
  {
    label: 'IT: "Lexar DiskMaster..." → "Lexar DiskMaster..."',
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

console.log('=== 短文案误判分析 ===\n')

for (const tc of testCases) {
  console.log(`--- ${tc.label} ---`)
  console.log(`  文本长度: ${tc.target.length} 字符`)
  console.log(`  特征字符: ${detectTargetLanguageFeatures(tc.target, tc.lang).hasFeatures ? '✓' : '✗'}`)
  console.log(`  功能词: ${checkFunctionWords(tc.target, tc.lang) ? '✓' : '✗'}`)

  const detected = detectUntranslatedText([tc.source], [tc.target], tc.lang, new Map())
  console.log(`  当前检测: ${detected.size > 0 ? '❌ 误判' : '✅ 通过'}`)
  console.log('')
}

// 测试方案 2：短文本豁免（< 30 字符）
console.log('\n=== 方案 2 验证：短文本豁免（< 30 字符）===\n')

for (const tc of testCases) {
  const isShort = tc.target.length < 30
  console.log(`${tc.label}:`)
  console.log(`  长度: ${tc.target.length} 字符, 豁免: ${isShort ? '✓' : '✗'}`)

  if (isShort) {
    console.log(`  方案 2 结果: ✅ 豁免（不再检测）`)
  } else {
    const detected = detectUntranslatedText([tc.source], [tc.target], tc.lang, new Map())
    console.log(`  方案 2 结果: ${detected.size > 0 ? '❌ 仍误判' : '✅ 通过'}`)
  }
  console.log('')
}

// 测试方案 3：短文本降低阈值
console.log('\n=== 方案 3 验证：短文本降低阈值（< 30 字符 → 阈值 0.90）===\n')

for (const tc of testCases) {
  const isShort = tc.target.length < 30
  console.log(`${tc.label}:`)
  console.log(`  长度: ${tc.target.length} 字符, 短文本: ${isShort ? '✓' : '✗'}`)

  // 模拟方案 3 的逻辑
  if (isShort) {
    console.log(`  方案 3 结果: ✅ 短文本放宽阈值到 0.90`)
  } else {
    console.log(`  方案 3 结果: 使用原阈值 0.65`)
  }
  console.log('')
}

// 测试真实漏翻场景（确保不误放）
console.log('\n=== 真实漏翻场景验证 ===\n')

const untranslatedScenarios = [
  {
    label: 'FR: LLM 完全没翻译（长文本）',
    source: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    target: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    lang: 'fr',
  },
  {
    label: 'IT: LLM 完全没翻译（短文本）',
    source: '5 Years Service\n',
    target: '5 Years Service\n',
    lang: 'it',
  },
]

for (const tc of untranslatedScenarios) {
  const isShort = tc.target.length < 30
  const detected = detectUntranslatedText([tc.source], [tc.target], tc.lang, new Map())

  console.log(`${tc.label}:`)
  console.log(`  长度: ${tc.target.length} 字符, 短文本: ${isShort ? '✓' : '✗'}`)
  console.log(`  当前检测: ${detected.size > 0 ? '✅ 正确标记' : '❌ 漏检'}`)

  if (isShort) {
    console.log(`  方案 2 结果: ❌ 会放过（短文本豁免）`)
  } else {
    console.log(`  方案 2 结果: ✅ 仍能检测（长文本不豁免）`)
  }
  console.log('')
}
