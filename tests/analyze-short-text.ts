/**
 * 分析剩余 4 条"误判"的真实场景
 * 关键问题：在实际使用中（源文=英文，译文=目标语言），这些还会被误判吗？
 */
import { detectUntranslatedText, detectTargetLanguageFeatures, isUntranslatable } from '../lib/llm-api'

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

// 真实场景：源文=英文，译文=目标语言
const realScenarios = [
  {
    label: 'FR: "5 Years Service" → "Service de 5 ans"',
    source: '5 Years Service\n',
    target: 'Service de 5 ans',
    lang: 'fr',
  },
  {
    label: 'ES: "New Creative Experience..." → "Nueva experiencia creativa..."',
    source: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    target: 'Nueva experiencia creativa\n Aumenta las velocidades de renderizado, convirtiendo las ideas en realidad al instante.',
    lang: 'es',
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

console.log('=== 真实场景分析（源文=英文，译文=目标语言）===\n')

for (const s of realScenarios) {
  console.log(`--- ${s.label} ---`)

  // 1. 特征检测
  const feature = detectTargetLanguageFeatures(s.target, s.lang)
  console.log(`  特征字符: ${feature.hasFeatures ? '✓ 有' : '✗ 无'}`)

  // 2. 功能词检测
  const hasFW = checkFunctionWords(s.target, s.lang)
  console.log(`  功能词: ${hasFW ? '✓ 有' : '✗ 无'}`)

  // 3. isUntranslatable（源文）
  const untranslatable = isUntranslatable(s.source)
  console.log(`  源文 isUntranslatable: ${untranslatable}`)

  // 4. detectUntranslatedText（真实场景）
  const detected = detectUntranslatedText([s.source], [s.target], s.lang, new Map())
  console.log(`  检测结果: ${detected.size > 0 ? '❌ 标记漏翻' : '✅ 通过'}`)

  // 5. 维度分析
  const normalize = (t: string) => t.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const dim1Catch = normalize(s.source) === normalize(s.target)
  console.log(`  维度1（归一化相同）: ${dim1Catch ? '是' : '否'}`)

  if (!dim1Catch && !untranslatable) {
    if (!feature.hasFeatures) {
      if (hasFW) {
        console.log(`  维度2路径: 无特征 → 有功能词 → ✅ 确认已翻译`)
      } else {
        console.log(`  维度2路径: 无特征 → 无功能词 → 进入英文占比检查`)
      }
    } else {
      console.log(`  维度2路径: 有特征 → ✅ 直接通过`)
    }
  }

  console.log('')
}

// 额外测试：LLM 完全没翻译的场景（确保不会漏检）
console.log('\n=== 真实漏翻场景（确保不误放）===\n')

const realUntranslated = [
  {
    label: 'FR: LLM 完全没翻译',
    source: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    target: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    lang: 'fr',
  },
  {
    label: 'ES: LLM 完全没翻译',
    source: '5 Years Service\n',
    target: '5 Years Service\n',
    lang: 'es',
  },
  {
    label: 'IT: LLM 只改了几个标点',
    source: 'Lexar DiskMaster\nFirmware upgrades\nHealth monitoring\nPerformance optimization\nData security',
    target: 'Lexar DiskMaster,\nFirmware upgrades,\nHealth monitoring,\nPerformance optimization,\nData security',
    lang: 'it',
  },
]

for (const s of realUntranslated) {
  const detected = detectUntranslatedText([s.source], [s.target], s.lang, new Map())
  const status = detected.size > 0 ? '✅ 正确标记漏翻' : '❌ 漏检！'
  console.log(`${s.label}: ${status}`)
}
