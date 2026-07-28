/**
 * 精确诊断：剩余误判到底卡在哪个检测环节
 * 直接调用真实代码的 detectUntranslatedText，逐步分析路径
 */
import { detectTargetLanguageFeatures, isUntranslatable } from '../lib/llm-api'

// 从 llm-api.ts 复制 LANG_FUNCTION_WORDS（完整版）
const LANG_FUNCTION_WORDS: Record<string, Set<string>> = {
  'de': new Set(['und', 'oder', 'mit', 'für', 'von', 'zu', 'auf', 'bei', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'hat', 'haben', 'wird', 'werden', 'kann', 'muss', 'soll', 'nicht', 'auch', 'nach', 'über', 'unter', 'zwischen', 'durch', 'ohne', 'gegen', 'seit', 'während', 'weil', 'dass', 'wenn', 'als', 'dann', 'noch', 'schon', 'nur', 'mehr', 'sehr', 'hier', 'dort', 'in', 'im', 'am', 'zum', 'zur', 'aus', 'ab', 'an', 'um', 'ins', 'vom', 'beim', 'des', 'dem', 'den', 'einen', 'einem', 'einer', 'sich', 'wie', 'so', 'auch', 'aber', 'doch', 'denn', 'vor', 'hinter', 'neben', 'über', 'bis', 'ab', 'seit', 'vor']),
  'fr': new Set(['et', 'ou', 'mais', 'donc', 'car', 'que', 'qui', 'dans', 'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'entre', 'vers', 'chez', 'contre', 'depuis', 'pendant', 'avant', 'après', 'selon', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'est', 'sont', 'a', 'ont', 'être', 'avoir', 'en', 'ne', 'pas', 'plus', 'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'tout', 'toute', 'tous', 'fait', 'faire', 'peut', 'peuvent', 'doit', 'aussi', 'très', 'bien', 'comme', 'plus', 'moins', 'alors', 'donc', 'si']),
  'es': new Set(['y', 'o', 'pero', 'que', 'porque', 'con', 'para', 'por', 'desde', 'hasta', 'entre', 'sin', 'sobre', 'según', 'durante', 'antes', 'después', 'mientras', 'cuando', 'como', 'si', 'aunque', 'sino', 'también', 'muy', 'más', 'menos', 'aquí', 'ahí', 'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'tiene', 'tienen']),
  'it': new Set(['e', 'o', 'ma', 'che', 'perché', 'con', 'per', 'da', 'fra', 'tra', 'senza', 'su', 'secondo', 'durante', 'prima', 'dopo', 'mentre', 'quando', 'come', 'se', 'anche', 'molto', 'più', 'meno', 'qui', 'là', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'è', 'sono', 'ha', 'hanno']),
  'pl': new Set(['i', 'lub', 'ale', 'że', 'bo', 'z', 'na', 'do', 'od', 'w', 'przy', 'przez', 'między', 'bez', 'przeciw', 'gdy', 'kiedy', 'jak', 'czy', 'też', 'bardzo', 'tu', 'tam', 'ten', 'ta', 'to', 'jest', 'są', 'ma', 'mieć', 'być']),
  'nl': new Set(['en', 'of', 'maar', 'dus', 'met', 'voor', 'van', 'tot', 'op', 'bij', 'door', 'over', 'onder', 'tussen', 'zonder', 'tegen', 'sinds', 'tijdens', 'na', 'omdat', 'als', 'wanneer', 'dan', 'nog', 'ook', 'zeer', 'hier', 'daar', 'de', 'het', 'een', 'is', 'zijn', 'heeft', 'hebben', 'in', 'te', 'niet', 'aan', 'uit', 'om', 'er', 'al', 'wel', 'geen', 'moet', 'kan', 'wordt', 'zou', 'deze', 'dit', 'dat', 'wie', 'wat', 'waar', 'hoe', 'toch', 'eens', 'weer']),
  'sv': new Set(['och', 'eller', 'men', 'så', 'för', 'med', 'till', 'på', 'i', 'av', 'från', 'om', 'vid', 'hos', 'genom', 'mellan', 'utan', 'mot', 'sedan', 'under', 'efter', 'innan', 'eftersom', 'när', 'som', 'då', 'än', 'också', 'mycket', 'här', 'där', 'den', 'det', 'en', 'ett', 'är', 'har', 'blir']),
  'tr': new Set(['ve', 'ile', 'için', 'gibi', 'kadar', 'ama', 'fakat', 'çünkü', 'eğer', 'ise', 'ancak', 'bile', 'daha', 'en', 'çok', 'az', 'şu', 'bu', 'bir', 'var', 'olan', 'olarak', 'üzere', 'doğru', 'göre', 'rağmen']),
}

function checkFunctionWords(text: string, lang: string): { has: boolean; matched: string[]; ratio: number } {
  const words = LANG_FUNCTION_WORDS[lang]
  if (!words) return { has: false, matched: [], ratio: 0 }
  const textWords = text.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/]+/).filter(w => w.length >= 2)
  const matched: string[] = []
  for (const w of textWords) {
    if (words.has(w)) matched.push(w)
  }
  const ratio = textWords.length > 0 ? matched.length / textWords.length : 0
  return { has: matched.length >= 1 && ratio >= 0.03, matched, ratio }
}

const TECH_TERM_EXEMPT = new Set([
  'ssd', 'nvme', 'pcie', 'dram', 'nand', 'slc', 'tlc', 'qlc', 'mlc',
  'iops', 'mb', 'gb', 'tb', 'kb', 'mbps', 'gbps', 'mhz', 'ghz',
  'gen', 'nm', 'uhd', 'os', 'cpu', 'gpu', 'rgb', 'pmic',
  'm.2', 'sata', 'cfexpress', 'cfe', 'sdxc', 'sdhc', 'microsd',
  'ddr', 'ddr4', 'ddr5', 'dimm', 'sodimm',
  'lexar', 'amd', 'intel', 'ryzen', 'microsoft', 'directstorage',
  'aipc', 'smart', 'bit', 'workflow',
  'pro', 'max', 'plus', 'mini', 'ultra', 'elite',
  'fw', 'hw', 'sw', 'usb', 'hdmi', 'dp', 'lan', 'wan',
  'uhs', 'vpg', 'mtbf', 'tbw',
])

function extractNonTargetWords(text: string): string[] {
  const allTokens = text.split(/[\s,.;:!?()\[\]{}\-\/\\]+/).filter(w => w.length >= 2)
  const asciiWords = allTokens.filter(w => /^[a-zA-Z]+$/.test(w))
  return asciiWords.filter(w => !TECH_TERM_EXEMPT.has(w.toLowerCase()))
}

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

console.log('=== 精确诊断：每条误判卡在哪个环节 ===\n')

for (const c of cases) {
  console.log(`--- ${c.label} ---`)

  // Step 1: 维度1
  const normalize = (t: string) => t.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const dim1 = normalize(c.source) === normalize(c.target)
  console.log(`  维度1 归一化相同: ${dim1} ${dim1 ? '→ ❌ 标记漏翻' : '→ 通过'}`)
  if (dim1) { console.log(''); continue }

  // Step 2: isUntranslatable
  const untranslatable = isUntranslatable(c.source)
  console.log(`  isUntranslatable: ${untranslatable} ${untranslatable ? '→ ✅ 跳过' : '→ 继续'}`)
  if (untranslatable) { console.log(''); continue }

  // Step 3: 特征检测
  const feature = detectTargetLanguageFeatures(c.target, c.lang)
  console.log(`  特征字符: ${feature.hasFeatures ? '✓ 有' : '✗ 无'}`)

  if (!feature.hasFeatures) {
    // Step 4: 功能词
    const fw = checkFunctionWords(c.target, c.lang)
    console.log(`  功能词: ${fw.has ? '✓ 有' : '✗ 无'} (匹配: [${fw.matched.join(', ')}], 占比: ${(fw.ratio * 100).toFixed(1)}%)`)

    if (fw.has) {
      console.log(`  → ✅ 有功能词 → 确认已翻译 → 不会误判`)
    } else {
      // Step 5: 英文占比
      const nonTarget = extractNonTargetWords(c.target)
      const totalWords = c.target.split(/\s+/).filter(w => w.length > 0)
      const ratio = totalWords.length > 0 ? nonTarget.length / totalWords.length : 0
      console.log(`  非目标词: ${nonTarget.length}/${totalWords.length} = ${(ratio * 100).toFixed(1)}%`)
      console.log(`  非目标词列表: [${nonTarget.join(', ')}]`)
      console.log(`  → ❌ 无功能词 → 进入英文占比检查 → ${ratio > 0.70 ? '超过 70% → 标记漏翻' : '低于 70% → 通过'}`)
    }
  } else {
    console.log(`  → ✅ 有特征字符 → 直接通过`)
  }

  console.log('')
}

// 分析：哪些语言的功能词列表缺失了常见词？
console.log('\n=== 功能词缺失分析 ===\n')

const missingWords = {
  'it': {
    text: 'Lexar DiskMaster\n Aggiornamenti del firmware\n Controllo dello stato di salute\n Ottimizzazione delle prestazioni\n Sicurezza dei dati',
    missing: ['del', 'dello', 'dei', 'delle', 'di', 'della', 'le', 'la', 'in', 'un', 'una', 'con', 'che', 'non', 'anche', 'come'],
  },
  'pl': {
    text: '5-letni serwis',
    missing: ['letni', 'serwis', 'rok', 'lat', 'gwarancja', 'obsługa', 'serwis'],
  },
  'fr': {
    text: 'Service de 5 ans',
    missing: ['de', 'des', 'ans', 'service', 'ans'],
  },
}

for (const [lang, info] of Object.entries(missingWords)) {
  const fw = checkFunctionWords(info.text, lang)
  console.log(`${lang}: 功能词匹配=[${fw.matched.join(', ')}], 占比=${(fw.ratio * 100).toFixed(1)}%`)
  console.log(`  建议补充: ${info.missing.join(', ')}`)
  console.log('')
}
