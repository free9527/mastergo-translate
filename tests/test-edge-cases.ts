/**
 * 边界情况补充测试：验证反向校验和词表覆盖
 */
import { detectSingleTextLanguage, isUntranslatable } from '../lib/llm-api'

// 复制 test-proposal-final.ts 的核心函数（简化版，只测边界）
// ═══════════════════════════════════════════════════════════════
type ScriptClass = 'latin' | 'cjk' | 'ja' | 'ko' | 'th' | 'ar' | 'ru'

function getScriptClass(text: string): ScriptClass {
  if (!text) return 'latin'
  let cjk = 0, latin = 0, hiragana = 0, katakana = 0, hangul = 0, thai = 0, arabic = 0, cyrillic = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 0x4E00 && code <= 0x9FFF) cjk++
    else if (code >= 0x3040 && code <= 0x309F) hiragana++
    else if (code >= 0x30A0 && code <= 0x30FF) katakana++
    else if (code >= 0xAC00 && code <= 0xD7AF) hangul++
    else if (code >= 0x0E00 && code <= 0x0E7F) thai++
    else if (code >= 0x0600 && code <= 0x06FF) arabic++
    else if (code >= 0x0400 && code <= 0x04FF) cyrillic++
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latin++
  }
  if (hiragana + katakana > 0 && (hiragana + katakana) >= cjk * 0.15) return 'ja'
  if (hangul > 0 && hangul >= (cjk + hangul) * 0.1) return 'ko'
  if (thai > latin * 0.5) return 'th'
  if (arabic > latin * 0.5) return 'ar'
  if (cyrillic > latin * 0.5) return 'ru'
  if (cjk > latin) return 'cjk'
  return 'latin'
}

function getTargetScript(targetLang: string): ScriptClass {
  if (targetLang === 'ja') return 'ja'
  if (targetLang === 'ko') return 'ko'
  if (targetLang === 'th') return 'th'
  if (targetLang === 'ar') return 'ar'
  if (targetLang === 'ru') return 'ru'
  if (targetLang.startsWith('zh')) return 'cjk'
  return 'latin'
}

const SIMPLIFIED_ONLY_CHARS = new Set(
  '让这说会对开关时间问题现发现实义经验证号国际学习体台湾龙们为产众优亿仅从人什今们他她它们见页车马门问闻间开关买卖读书读写话语言讲谈议论认记忆讨让训议讲谢谢请诸课'.split('')
)
const TRADITIONAL_ONLY_CHARS = new Set(
  '讓這說會對開關時間問題現發現實義經驗證號國際學習體臺灣龍們為產眾優億僅從人什今們他她它們見頁車馬門問聞間開關買賣讀書讀寫話語言講談議論認記憶討讓訓議講謝謝請諸課'.split('')
)

function hasSimplifiedOnlyChars(text: string): boolean {
  for (const ch of text) if (SIMPLIFIED_ONLY_CHARS.has(ch)) return true
  return false
}

function hasTraditionalOnlyChars(text: string): boolean {
  for (const ch of text) if (TRADITIONAL_ONLY_CHARS.has(ch)) return true
  return false
}

const LATIN_FUNCTION_WORDS: Record<string, Set<string>> = {
  en: new Set([
    'the', 'of', 'and', 'to', 'in', 'is', 'are', 'for', 'with', 'on', 'at', 'by', 'be', 'has', 'have',
    'it', 'its', 'not', 'can', 'will', 'from', 'this', 'that', 'your', 'you', 'an', 'or', 'as', 'up', 'our', 'we',
    'high', 'speed', 'performance', 'ideal', 'gaming', 'content', 'creation', 'design', 'portable', 'durable',
    'ultimate', 'gear', 'fast', 'transfer', 'read', 'write', 'storage', 'drive', 'card', 'memory',
  ]),
  es: new Set([
    'el', 'la', 'los', 'las', 'es', 'son', 'está', 'están', 'y', 'pero', 'muy', 'tiene', 'tienen',
    'al', 'del', 'un', 'una', 'con', 'sin', 'hasta', 'para', 'juegos', 'creación', 'contenido',
    'alto', 'alta', 'rendimiento', 'ideal', 'diseño', 'portátil', 'duradero', 'velocidad', 'lectura',
    'transferencia', 'almacenamiento', 'unidad', 'tarjeta', 'memoria', 'rápido', 'rápida', 'extremo',
  ]),
  pt: new Set([
    'é', 'são', 'tem', 'têm', 'sem', 'até', 'não', 'muito', 'um', 'uma', 'ao', 'à', 'do', 'da', 'na', 'no',
    'estão', 'isso', 'contra', 'para', 'jogos', 'criação', 'conteúdo', 'alto', 'alta', 'desempenho',
    'ideal', 'design', 'portátil', 'durável', 'velocidade', 'leitura', 'transferência', 'armazenamento',
    'unidade', 'cartão', 'memória', 'rápido', 'rápida', 'extremo', 'e', 'com', 'os', 'as', 'seus', 'suas',
  ]),
  de: new Set([
    'und', 'oder', 'mit', 'für', 'von', 'zu', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'nicht',
    'auch', 'auf', 'bei', 'nach', 'über', 'wird', 'werden', 'kann', 'sich', 'ideal', 'hohe', 'geschwindigkeit',
    'leistung', 'gaming', 'erstellung', 'inhalte', 'design', 'tragbar', 'robust', 'langlebig', 'speicher',
    'laufwerk', 'karte', 'schnell', 'übertragung', 'lesen', 'schreiben', 'extrem',
  ]),
  fr: new Set([
    'et', 'ou', 'mais', 'que', 'qui', 'dans', 'sur', 'avec', 'sans', 'pour', 'par', 'le', 'la', 'les',
    'un', 'une', 'des', 'du', 'est', 'sont', 'ne', 'pas', 'plus', 'ce', 'cette', 'idéal', 'haute',
    'performance', 'vitesse', 'jeu', 'création', 'contenu', 'design', 'portable', 'durable', 'stockage',
    'lecture', 'écriture', 'transfert', 'mémoire', 'carte', 'disque', 'rapide', 'extrême',
  ]),
  it: new Set([
    'che', 'per', 'con', 'da', 'fra', 'tra', 'senza', 'su', 'il', 'lo', 'gli', 'le', 'un', 'uno', 'è',
    'sono', 'ha', 'hanno', 'di', 'del', 'della', 'nel', 'alla', 'anche', 'più', 'ideale', 'alte',
    'prestazioni', 'velocità', 'gioco', 'creazione', 'contenuti', 'design', 'portatile', 'resistente',
    'archiviazione', 'lettura', 'scrittura', 'trasferimento', 'memoria', 'scheda', 'unità', 'veloce', 'estremo',
  ]),
  nl: new Set([
    'en', 'of', 'maar', 'met', 'voor', 'van', 'tot', 'op', 'bij', 'het', 'een', 'zijn', 'heeft', 'niet',
    'aan', 'uit', 'om', 'ook', 'deze', 'dit', 'dat', 'wordt', 'tegen', 'ideaal', 'hoge', 'snelheid',
    'prestaties', 'gaming', 'creatie', 'inhoud', 'ontwerp', 'draagbaar', 'duurzaam', 'opslag', 'schijf',
    'kaart', 'geheugen', 'snel', 'overdracht', 'lezen', 'schrijven', 'extreem',
  ]),
  pl: new Set([
    'i', 'lub', 'ale', 'z', 'do', 'na', 'w', 'o', 'po', 'za', 'przez', 'dla', 'to', 'są', 'jest', 'nie',
    'tak', 'jak', 'co', 'czy', 'też', 'tylko', 'idealny', 'wysoka', 'wydajność', 'szybkość', 'gry',
    'tworzenie', 'treści', 'design', 'przenośny', 'trwały', 'pamięć', 'dysk', 'karta', 'szybki',
    'transfer', 'odczyt', 'zapis', 'ekstremalny',
  ]),
  sv: new Set([
    'och', 'eller', 'men', 'med', 'för', 'av', 'till', 'på', 'i', 'är', 'en', 'ett', 'som', 'inte', 'att',
    'om', 'kan', 'har', 'de', 'den', 'det', 'perfekt', 'hög', 'hastighet', 'prestanda', 'spel', 'skapande',
    'innehåll', 'design', 'bärbar', 'hållbar', 'lagring', 'enhet', 'kort', 'minne', 'snabb', 'överföring',
    'läsning', 'skrivning', 'extrem',
  ]),
  tr: new Set([
    've', 'veya', 'ama', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'ki', 'mi', 'mı', 'mu', 'mü', 'ne', 'o',
    'çok', 'daha', 'en', 'gibi', 'kadar', 'ideal', 'yüksek', 'hız', 'performans', 'oyun', 'içerik',
    'oluşturma', 'tasarım', 'taşınabilir', 'dayanıklı', 'depolama', 'sürücü', 'kart', 'bellek', 'hızlı',
    'aktarım', 'okuma', 'yazma', 'aşırı',
  ]),
  id: new Set([
    'dan', 'atau', 'tetapi', 'dengan', 'untuk', 'dari', 'ke', 'di', 'pada', 'dalam', 'yang', 'tidak',
    'adalah', 'itu', 'ini', 'juga', 'akan', 'ada', 'bisa', 'dapat', 'ideal', 'tinggi', 'kecepatan',
    'kinerja', 'gaming', 'pembuatan', 'konten', 'desain', 'portabel', 'tahan', 'lama', 'penyimpanan',
    'drive', 'kartu', 'memori', 'cepat', 'transfer', 'baca', 'tulis', 'ekstrem',
  ]),
  vi: new Set([
    'và', 'hoặc', 'nhưng', 'với', 'cho', 'từ', 'đến', 'trong', 'cứng', 'là', 'không', 'có', 'được',
    'này', 'kia', 'cũng', 'sẽ', 'đang', 'rất', 'lý', 'tưởng', 'cao', 'tốc', 'độ', 'hiệu', 'suất',
    'chơi', 'game', 'tạo', 'nội', 'dung', 'thiết', 'kế', 'di', 'động', 'bền', 'lưu', 'trữ', 'ổ',
    'thẻ', 'nhớ', 'nhanh', 'truyền', 'đọc', 'ghi', 'cực', 'kỳ',
  ]),
}

function detectLatinLang(text: string): string | null {
  const words = text.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/).filter(w => w.length >= 2)
  const votes: Record<string, number> = {}
  for (const w of words) {
    for (const [lang, dict] of Object.entries(LATIN_FUNCTION_WORDS)) {
      if (dict.has(w)) votes[lang] = (votes[lang] || 0) + 1
    }
  }
  let topLang: string | null = null
  let topVotes = 0
  for (const [lang, count] of Object.entries(votes)) {
    if (count > topVotes) { topVotes = count; topLang = lang }
  }
  return topVotes >= 2 ? topLang : null
}

function hasFunctionWords(text: string, lang: string): boolean {
  const dict = LATIN_FUNCTION_WORDS[lang]
  if (!dict) return false
  const words = text.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/).filter(w => w.length >= 2)
  let count = 0
  for (const w of words) {
    if (dict.has(w)) count++
  }
  return count >= 1 && count / words.length >= 0.05
}

type Necessity =
  | { kind: 'translate' }
  | { kind: 'variant'; conversion: 's2t' | 't2s' | 'pt' }
  | { kind: 'verify' }

function classifyNecessity(src: string, targetLang: string): Necessity {
  const srcScript = getScriptClass(src)
  const targetScript = getTargetScript(targetLang)
  if (srcScript !== targetScript) return { kind: 'translate' }
  if (srcScript === 'cjk') {
    if (targetLang === 'zh-TW' || targetLang === 'zh-HK') return { kind: 'variant', conversion: 's2t' }
    if (targetLang === 'zh-CN') return { kind: 'variant', conversion: 't2s' }
    return { kind: 'translate' }
  }
  if (srcScript === 'latin') {
    if (targetLang === 'pt' || targetLang === 'pt-BR') return { kind: 'variant', conversion: 'pt' }
    const srcLang = detectLatinLang(src)
    if (srcLang && srcLang === targetLang) return { kind: 'verify' }
    return { kind: 'translate' }
  }
  return { kind: 'verify' }
}

function detectUntranslatedTextFinal(
  sourceTexts: string[], translatedTexts: string[], targetLang: string, glossaryMap?: Map<string, string>,
): Set<number> {
  const untranslated = new Set<number>()
  const normalize = (s: string) => s.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  for (let i = 0; i < sourceTexts.length; i++) {
    const src = sourceTexts[i] || ''
    const trans = translatedTexts[i] || ''
    if (!src || !trans) continue
    if (isUntranslatable(src, glossaryMap)) continue
    const necessity = classifyNecessity(src, targetLang)
    switch (necessity.kind) {
      case 'translate':
        if (normalize(src) === normalize(trans)) {
          if (getTargetScript(targetLang) === 'latin' && hasFunctionWords(trans, targetLang)) break
          untranslated.add(i)
        }
        break
      case 'variant':
        if (necessity.conversion === 's2t') {
          if (hasSimplifiedOnlyChars(trans)) untranslated.add(i)
        } else if (necessity.conversion === 't2s') {
          if (hasTraditionalOnlyChars(trans)) untranslated.add(i)
        } else if (necessity.conversion === 'pt') {
          if (hasFunctionWords(trans, 'en') && !hasFunctionWords(trans, 'pt')) untranslated.add(i)
        }
        break
      case 'verify':
        break
    }
  }
  return untranslated
}

function uiBadgeFinal(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (sourceText !== translatedText) return false
  if (isUntranslatable(sourceText, undefined)) return false
  const necessity = classifyNecessity(sourceText, targetLang)
  switch (necessity.kind) {
    case 'translate':
      if (getTargetScript(targetLang) === 'latin' && hasFunctionWords(translatedText, targetLang)) return false
      return true
    case 'variant':
      if (necessity.conversion === 's2t') return hasSimplifiedOnlyChars(translatedText)
      if (necessity.conversion === 't2s') return hasTraditionalOnlyChars(translatedText)
      if (necessity.conversion === 'pt') return hasFunctionWords(translatedText, 'en') && !hasFunctionWords(translatedText, 'pt')
      return false
    case 'verify':
      return false
  }
}

// ═══════════════════════════════════════════════════════════════
// 边界测试
// ═══════════════════════════════════════════════════════════════
interface EdgeCase {
  id: string; name: string; targetLang: string
  texts: string[]; translations: string[]
  expectedBackend: number[]; expectedUI: number[]
  note: string
}

const edgeCases: EdgeCase[] = [
  // 反向校验：源文==译文但含目标语言功能词（正确翻译，但恰好与源文相同）
  { id: 'F1', name: 'en→de 反向校验', targetLang: 'de', texts: ['Design'], translations: ['Design'], expectedBackend: [], expectedUI: [], note: '"Design" 在德语中也是 Design，含德语功能词？不，单字无功能词。应判漏翻' },
  { id: 'F2', name: 'en→de 含德语功能词', targetLang: 'de', texts: ['Ideal für Gaming'], translations: ['Ideal für Gaming'], expectedBackend: [], expectedUI: [], note: '源文==译文但含 "für"（德语功能词）→ 不算漏翻' },
  { id: 'F3', name: 'en→de 纯英文无功能词', targetLang: 'de', texts: ['High speed performance'], translations: ['High speed performance'], expectedBackend: [0], expectedUI: [0], note: '纯英文，无德语功能词 → 漏翻' },
  // 短文本：无功能词可检测
  { id: 'F4', name: 'de→de 短文本', targetLang: 'de', texts: ['Hohe Geschwindigkeit'], translations: ['Hohe Geschwindigkeit'], expectedBackend: [], expectedUI: [], note: '2 个德语功能词（hohe, geschwindigkeit）→ verify' },
  { id: 'F5', name: 'de→de 极短文本', targetLang: 'de', texts: ['Schnell'], translations: ['Schnell'], expectedBackend: [], expectedUI: [], note: '1 个功能词（schnell）→ 不足 2 票 → translate → 漏翻？' },
  // 混杂批次：拉丁变体 + 英文
  { id: 'F6', name: 'pt 混 en → pt（英文条目含 pt 功能词）', targetLang: 'pt-BR', texts: ['Alto desempenho', 'Fast para jogos'], translations: ['Alto desempenho', 'Fast para jogos'], expectedBackend: [], expectedUI: [], note: '英文条目含 "para"（pt 功能词）→ 不判漏翻？但 "Fast" 是英文' },
  // 简繁混杂：单条文本同时含简繁字
  { id: 'F7', name: '简繁混合单条 → zh-TW', targetLang: 'zh-TW', texts: ['高速性能表现表現'], translations: ['高速性能表现表現'], expectedBackend: [0], expectedUI: [0], note: '含简体字 "现" → 漏翻' },
  { id: 'F8', name: '简繁混合单条 → zh-CN', targetLang: 'zh-CN', texts: ['高速性能表现表現'], translations: ['高速性能表现表現'], expectedBackend: [0], expectedUI: [0], note: '含繁体字 "現" → 漏翻' },
  // 术语/品牌：全球统一
  { id: 'F9', name: '全球统一术语', targetLang: 'de', texts: ['USB 3.2 Gen 2', 'NVMe SSD'], translations: ['USB 3.2 Gen 2', 'NVMe SSD'], expectedBackend: [], expectedUI: [], note: 'isUntranslatable 豁免' },
  // 空/单字符
  { id: 'F10', name: '单字符', targetLang: 'ja', texts: ['A'], translations: ['A'], expectedBackend: [], expectedUI: [], note: '单字符无语言特征，isUntranslatable？' },
]

console.log('═══════════════════════════════════════════════════════════════')
console.log('边界情况补充测试')
console.log('═══════════════════════════════════════════════════════════════\n')

let backendPass = 0, backendFail = 0
let uiPass = 0, uiFail = 0

for (const s of edgeCases) {
  const backendResult = detectUntranslatedTextFinal(s.texts, s.translations, s.targetLang, undefined)
  const backendIndices = [...backendResult].sort((a, b) => a - b)

  const uiIndices: number[] = []
  for (let i = 0; i < s.texts.length; i++) {
    if (uiBadgeFinal(s.texts[i], s.translations[i], s.targetLang)) uiIndices.push(i)
  }

  const backendMatch = JSON.stringify(backendIndices) === JSON.stringify(s.expectedBackend)
  const uiMatch = JSON.stringify(uiIndices) === JSON.stringify(s.expectedUI)

  if (backendMatch) backendPass++; else backendFail++
  if (uiMatch) uiPass++; else uiFail++

  const status = backendMatch && uiMatch ? '✅' : '❌'
  console.log(`${status} ${s.id}: ${s.name}`)
  console.log(`   后端: [${backendIndices}] 期望: [${s.expectedBackend}] ${backendMatch ? '✓' : '✗'}`)
  console.log(`   UI:   [${uiIndices}] 期望: [${s.expectedUI}] ${uiMatch ? '✓' : '✗'}`)
  console.log(`   说明: ${s.note}`)
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`后端: ${backendPass} 通过 / ${backendFail} 失败`)
console.log(`UI:   ${uiPass} 通过 / ${uiFail} 失败`)
console.log('═══════════════════════════════════════════════════════════════')
