/**
 * UI 层漏翻标记验证：sourceText == translatedText 时，showUntranslatedBadge 是否误报？
 * 模拟 App.vue 的 computeUntranslatedBadge 逻辑
 */
import { isUntranslatable } from '../lib/llm-api'

// 复制 App.vue 的 detectSingleTextLanguage（简化版）
function detectSingleTextLanguage(text: string): string {
  if (!text) return 'en'
  let cjkChars = 0, latinChars = 0, hiragana = 0, katakana = 0, hangul = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 0x4E00 && code <= 0x9FFF) cjkChars++
    else if (code >= 0x3040 && code <= 0x309F) hiragana++
    else if (code >= 0x30A0 && code <= 0x30FF) katakana++
    else if (code >= 0xAC00 && code <= 0xD7AF) hangul++
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latinChars++
  }
  if (hiragana + katakana > 0 && (hiragana + katakana) >= cjkChars * 0.15) return 'ja'
  if (hangul > 0 && hangul >= (cjkChars + hangul) * 0.1) return 'ko'
  return cjkChars > latinChars ? 'zh-CN' : 'en'
}

function isSameScriptLanguagePair(src: string, tgt: string): boolean {
  const SAME_SCRIPT_PAIRS = [
    ['zh-CN', 'zh-TW'], ['zh-CN', 'zh-HK'],
    ['pt', 'pt-BR'],
  ]
  return SAME_SCRIPT_PAIRS.some(([s, t]) =>
    (s === src && t === tgt) || (t === src && s === tgt)
  )
}

function computeUntranslatedBadge(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (sourceText !== translatedText) return false
  const srcLang = detectSingleTextLanguage(sourceText)
  if (isSameScriptLanguagePair(srcLang, targetLang)) return false
  return !isUntranslatable(sourceText, undefined)
}

const SAMPLES: Record<string, string[]> = {
  'en':    ['High speed performance'],
  'zh-CN': ['高速性能'],
  'zh-TW': ['高速性能'],
  'ja':    ['高速パフォーマンス'],
  'ko':    ['고속 성능'],
  'de':    ['Hohe Geschwindigkeit'],
  'fr':    ['Haute performance'],
  'es':    ['Alto rendimiento'],
  'pt':    ['Alto desempenho'],
  'pt-BR': ['Alto desempenho'],
  'it':    ['Alte prestazioni'],
  'nl':    ['Hoge snelheid'],
  'pl':    ['Wysoka wydajność'],
  'sv':    ['Hög hastighet'],
  'tr':    ['Yüksek hız'],
  'vi':    ['Hiệu suất cao'],
  'th':    ['ประสิทธิภาพสูง'],
  'ar':    ['أداء عالي'],
  'ru':    ['Высокая производительность'],
  'id':    ['Kinerja tinggi'],
}

console.log('语言      | 逐条检测 | UI误报漏翻 | 判定')
console.log('----------|----------|------------|-----')
for (const [lang, texts] of Object.entries(SAMPLES)) {
  const src = texts[0]
  const badge = computeUntranslatedBadge(src, src, lang)
  const det = detectSingleTextLanguage(src)
  console.log(`${lang.padEnd(9)} | ${det.padEnd(8)} | ${badge ? '⚠️ 是' : '✅ 否'}         | ${badge ? '❌ 误报' : '✅ 通过'}`)
}
