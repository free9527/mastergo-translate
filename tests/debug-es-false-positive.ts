/**
 * 精确定位 ES 漏翻误报的根因
 */

import { detectUntranslatedText, detectTargetLanguageFeatures } from '../lib/llm-api'

// 模拟 detectUntranslatedText 内部逻辑，逐步骤排查
const src = 'Vitesse de lecture élevée'
const trans = 'Alta velocidad de lectura'
const targetLang = 'es'

console.log('=== 逐步排查维度2检测 ===\n')
console.log(`源文: "${src}"`)
console.log(`译文: "${trans}"`)
console.log(`目标: ${targetLang}\n`)

// 1. 特征检测
const featureCheck = detectTargetLanguageFeatures(trans, targetLang)
console.log(`1. detectTargetLanguageFeatures("${trans}", "${targetLang}")`)
console.log(`   hasFeatures: ${featureCheck.hasFeatures}`)
console.log(`   details: ${featureCheck.details}`)

// 2. 功能词检测
const ES_FUNCTION_WORDS = new Set(['y', 'o', 'pero', 'que', 'porque', 'con', 'para', 'por', 'desde', 'hasta', 'entre', 'sin', 'sobre', 'según', 'durante', 'antes', 'después', 'mientras', 'cuando', 'como', 'si', 'aunque', 'sino', 'también', 'muy', 'más', 'menos', 'aquí', 'ahí', 'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'tiene', 'tienen'])

const words = trans.toLowerCase().split(/\s+/)
const matchedWords = words.filter(w => ES_FUNCTION_WORDS.has(w))
console.log(`\n2. 功能词检测`)
console.log(`   分词: ${JSON.stringify(words)}`)
console.log(`   匹配到的功能词: ${JSON.stringify(matchedWords)}`)
console.log(`   containsLanguageFunctionWords: ${matchedWords.length > 0}`)

// 3. 实际检测
console.log(`\n3. detectUntranslatedText 实际结果:`)
const detected = detectUntranslatedText([src], [trans], targetLang, new Map())
console.log(`   漏翻: ${detected.size > 0 ? '是' : '否'}`)
console.log(`   索引: ${JSON.stringify(Array.from(detected))}`)

// 4. 测试更多西班牙语无声调句子
console.log(`\n4. 更多无声调西班牙语测试:`)
const testPairs = [
  ['High speed reading', 'Lectura a alta velocidad'],
  ['Fast data transfer', 'Transferencia rapida de datos'],
  ['Solid state drive', 'Unidad de estado solido'],
  ['High speed reading', 'Lectura a alta velocidad'],
]

for (const [s, t] of testPairs) {
  const d = detectUntranslatedText([s], [t], 'es', new Map())
  const fc = detectTargetLanguageFeatures(t, 'es')
  const ws = t.toLowerCase().split(/\s+/)
  const fw = ws.filter(w => ES_FUNCTION_WORDS.has(w))
  console.log(`   "${s}" → "${t}"`)
  console.log(`     hasFeatures=${fc.hasFeatures}, functionWords=${JSON.stringify(fw)}, detected=${d.size > 0 ? '漏翻' : '正常'}`)
}
