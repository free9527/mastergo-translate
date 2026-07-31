/**
 * 决策验证：扩充拉丁词表后的最终方案
 *
 * 关键改变：
 * 1. 拉丁功能词表大幅扩充（每语言 40+ 高频词，含营销/技术文案常用词）
 * 2. 目标语言功能词反向校验：译文含目标语言功能词 → 已翻译，不算漏翻
 * 3. 混杂批次中拉丁变体条目：检查是否含英文功能词，有则判漏翻
 */
import { detectSingleTextLanguage, isUntranslatable } from '../lib/llm-api'

// ═══════════════════════════════════════════════════════════════
// 字符集分类
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

// ═══════════════════════════════════════════════════════════════
// 简繁特征字
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// 扩充拉丁功能词表（每语言 40+ 高频词，覆盖营销/技术文案）
// ═══════════════════════════════════════════════════════════════
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
    'laufwerk', 'karte', 'speicher', 'schnell', 'übertragung', 'lesen', 'schreiben', 'extrem',
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

/** 检测拉丁文本最可能的语言 */
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

/** 检查文本是否含指定语言的功能词 */
function hasFunctionWords(text: string, lang: string): boolean {
  const dict = LATIN_FUNCTION_WORDS[lang]
  if (!dict) return false
  const words = text.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/).filter(w => w.length >= 2)
  let count = 0
  for (const w of words) {
    if (dict.has(w)) count++
  }
  return count >= 1 && count / words.length >= 0.05  // 至少 1 个功能词，占比 >= 5%
}

// ═══════════════════════════════════════════════════════════════
// 逐条必要性分类
// ═══════════════════════════════════════════════════════════════
type Necessity =
  | { kind: 'translate' }
  | { kind: 'variant'; conversion: 's2t' | 't2s' | 'pt' }
  | { kind: 'verify' }

function classifyNecessity(src: string, targetLang: string): Necessity {
  const srcScript = getScriptClass(src)
  const targetScript = getTargetScript(targetLang)

  if (srcScript !== targetScript) {
    return { kind: 'translate' }
  }

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

// ═══════════════════════════════════════════════════════════════
// 漏翻检测（最终版）
// ═══════════════════════════════════════════════════════════════
function detectUntranslatedTextFinal(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang: string,
  glossaryMap?: Map<string, string>,
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
        // 必须翻译：源文==译文 → 漏翻
        if (normalize(src) === normalize(trans)) {
          // 反向校验：译文含目标语言功能词 → 已翻译，不算漏翻
          if (getTargetScript(targetLang) === 'latin' && hasFunctionWords(trans, targetLang)) {
            break
          }
          untranslated.add(i)
        }
        break

      case 'variant':
        if (necessity.conversion === 's2t') {
          if (hasSimplifiedOnlyChars(trans)) untranslated.add(i)
        } else if (necessity.conversion === 't2s') {
          if (hasTraditionalOnlyChars(trans)) untranslated.add(i)
        } else if (necessity.conversion === 'pt') {
          // 葡语变体：检查是否混入英文（英文功能词）
          if (hasFunctionWords(trans, 'en') && !hasFunctionWords(trans, 'pt')) {
            untranslated.add(i)
          }
        }
        break

      case 'verify':
        // 校验模式：源文==译文是正确结果，跳过
        break
    }
  }

  return untranslated
}

// ═══════════════════════════════════════════════════════════════
// UI badge
// ═══════════════════════════════════════════════════════════════
function uiBadgeFinal(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (sourceText !== translatedText) return false
  if (isUntranslatable(sourceText, undefined)) return false

  const necessity = classifyNecessity(sourceText, targetLang)

  switch (necessity.kind) {
    case 'translate':
      // 反向校验：含目标语言功能词 → 不显示
      if (getTargetScript(targetLang) === 'latin' && hasFunctionWords(translatedText, targetLang)) {
        return false
      }
      return true
    case 'variant':
      if (necessity.conversion === 's2t') return hasSimplifiedOnlyChars(translatedText)
      if (necessity.conversion === 't2s') return hasTraditionalOnlyChars(translatedText)
      if (necessity.conversion === 'pt') {
        return hasFunctionWords(translatedText, 'en') && !hasFunctionWords(translatedText, 'pt')
      }
      return false
    case 'verify':
      return false
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试场景
// ═══════════════════════════════════════════════════════════════
interface Scenario {
  id: string; name: string; targetLang: string
  texts: string[]; translations: string[]
  expected: { backend: number[]; ui: number[] }
  note?: string
}

const scenarios: Scenario[] = [
  { id: 'A1', name: 'en→en', targetLang: 'en', texts: ['High speed performance', 'Ideal for gaming'], translations: ['High speed performance', 'Ideal for gaming'], expected: { backend: [], ui: [] } },
  { id: 'A2', name: 'zh-CN→zh-CN', targetLang: 'zh-CN', texts: ['高速性能', '理想用于游戏'], translations: ['高速性能', '理想用于游戏'], expected: { backend: [], ui: [] } },
  { id: 'A3', name: 'ja→ja', targetLang: 'ja', texts: ['高速パフォーマンス', 'ゲームに最適'], translations: ['高速パフォーマンス', 'ゲームに最適'], expected: { backend: [], ui: [] } },
  { id: 'A4', name: 'pt-BR→pt-BR', targetLang: 'pt-BR', texts: ['Alto desempenho', 'Ideal para jogos e criação'], translations: ['Alto desempenho', 'Ideal para jogos e criação'], expected: { backend: [], ui: [] } },
  { id: 'A5', name: 'es→es', targetLang: 'es', texts: ['Alto rendimiento', 'Ideal para juegos y creación'], translations: ['Alto rendimiento', 'Ideal para juegos y creación'], expected: { backend: [], ui: [] } },
  { id: 'A6', name: 'de→de', targetLang: 'de', texts: ['Hohe Geschwindigkeit', 'Ideal für Gaming und Erstellung'], translations: ['Hohe Geschwindigkeit', 'Ideal für Gaming und Erstellung'], expected: { backend: [], ui: [] } },
  { id: 'A7', name: 'fr→fr', targetLang: 'fr', texts: ['Haute performance', 'Idéal pour le jeu et la création'], translations: ['Haute performance', 'Idéal pour le jeu et la création'], expected: { backend: [], ui: [] } },
  { id: 'A8', name: 'it→it', targetLang: 'it', texts: ['Alte prestazioni', 'Ideale per il gioco e la creazione'], translations: ['Alte prestazioni', 'Ideale per il gioco e la creazione'], expected: { backend: [], ui: [] } },
  { id: 'A9', name: 'ko→ko', targetLang: 'ko', texts: ['고속 성능', '게임 및 콘텐츠 제작에 이상적'], translations: ['고속 성능', '게임 및 콘텐츠 제작에 이상적'], expected: { backend: [], ui: [] } },
  { id: 'B1', name: 'zh-CN→zh-TW（正确）', targetLang: 'zh-TW', texts: ['高速性能表现', '让游戏更流畅'], translations: ['高速性能表現', '讓遊戲更流暢'], expected: { backend: [], ui: [] } },
  { id: 'B2', name: 'zh-CN→zh-TW（摆烂）', targetLang: 'zh-TW', texts: ['高速性能表现', '让游戏更流畅'], translations: ['高速性能表现', '让游戏更流畅'], expected: { backend: [0, 1], ui: [0, 1] } },
  { id: 'B3', name: 'zh-TW→zh-CN（正确）', targetLang: 'zh-CN', texts: ['高速性能表現', '讓遊戲更流暢'], translations: ['高速性能表现', '让游戏更流畅'], expected: { backend: [], ui: [] } },
  { id: 'B4', name: 'zh-TW→zh-CN（摆烂）', targetLang: 'zh-CN', texts: ['高速性能表現', '讓遊戲更流暢'], translations: ['高速性能表現', '讓遊戲更流暢'], expected: { backend: [0, 1], ui: [0, 1] } },
  { id: 'B5', name: 'pt→pt-BR（写法相同）', targetLang: 'pt-BR', texts: ['Resistente a baixas temperaturas', 'Proteção contra água'], translations: ['Resistente a baixas temperaturas', 'Proteção contra água'], expected: { backend: [], ui: [] } },
  { id: 'C1', name: 'en→ja（正确）', targetLang: 'ja', texts: ['High speed performance'], translations: ['高速パフォーマンス'], expected: { backend: [], ui: [] } },
  { id: 'C2', name: 'en→ja（摆烂）', targetLang: 'ja', texts: ['High speed performance'], translations: ['High speed performance'], expected: { backend: [0], ui: [0] } },
  { id: 'C3', name: 'en→pt-BR（正确）', targetLang: 'pt-BR', texts: ['High speed performance'], translations: ['Desempenho de alta velocidade'], expected: { backend: [], ui: [] } },
  { id: 'C4', name: 'en→de（正确）', targetLang: 'de', texts: ['High speed performance'], translations: ['Hohe Geschwindigkeit'], expected: { backend: [], ui: [] } },
  { id: 'C5', name: 'en→de（摆烂）', targetLang: 'de', texts: ['High speed performance'], translations: ['High speed performance'], expected: { backend: [0], ui: [0] } },
  { id: 'C6', name: 'de→en（正确）', targetLang: 'en', texts: ['Hohe Geschwindigkeit'], translations: ['High speed'], expected: { backend: [], ui: [] } },
  { id: 'C7', name: 'de→en（摆烂）', targetLang: 'en', texts: ['Hohe Geschwindigkeit'], translations: ['Hohe Geschwindigkeit'], expected: { backend: [0], ui: [0] } },
  { id: 'D1', name: 'pt-BR 混 en → pt-BR', targetLang: 'pt-BR', texts: ['Alto desempenho para jogos', 'High speed performance', 'Ideal para jogos e criação'], translations: ['Alto desempenho para jogos', 'High speed performance', 'Ideal para jogos e criação'], expected: { backend: [1], ui: [1] } },
  { id: 'D2', name: 'zh-TW 混 zh-CN → zh-TW', targetLang: 'zh-TW', texts: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'], translations: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'], expected: { backend: [1], ui: [1] } },
  { id: 'D3', name: 'zh-CN 混 zh-TW → zh-CN', targetLang: 'zh-CN', texts: ['高速性能表现', '高速性能表現', '让游戏更流畅'], translations: ['高速性能表现', '高速性能表現', '让游戏更流畅'], expected: { backend: [1], ui: [1] } },
  { id: 'D4', name: 'de 混 en → de', targetLang: 'de', texts: ['Hohe Geschwindigkeit für Gaming', 'High speed performance', 'Ideal für Gaming und Erstellung'], translations: ['Hohe Geschwindigkeit für Gaming', 'High speed performance', 'Ideal für Gaming und Erstellung'], expected: { backend: [1], ui: [1] } },
  { id: 'E1', name: '品牌名', targetLang: 'ja', texts: ['Lexar ARES', 'High speed'], translations: ['Lexar ARES', '高速'], expected: { backend: [], ui: [] } },
  { id: 'E2', name: '数字+单位', targetLang: 'pt-BR', texts: ['2050MB/s', '1000GB'], translations: ['2050MB/s', '1000GB'], expected: { backend: [], ui: [] } },
  { id: 'E3', name: '空字符串', targetLang: 'ja', texts: ['', 'Hello'], translations: ['', 'こんにちは'], expected: { backend: [], ui: [] } },
  { id: 'E4', name: '术语库同形', targetLang: 'pt-BR', texts: ['SSD', 'NVMe'], translations: ['SSD', 'NVMe'], expected: { backend: [], ui: [] } },
  { id: 'E5', name: '单条短文本', targetLang: 'pt-BR', texts: ['Alto'], translations: ['Alto'], expected: { backend: [], ui: [] } },
]

console.log('═══════════════════════════════════════════════════════════════')
console.log('最终方案（扩充词表）原型验证')
console.log('═══════════════════════════════════════════════════════════════\n')

let backendPass = 0, backendFail = 0
let uiPass = 0, uiFail = 0

for (const s of scenarios) {
  const backendResult = detectUntranslatedTextFinal(s.texts, s.translations, s.targetLang, undefined)
  const backendIndices = [...backendResult].sort((a, b) => a - b)

  const uiIndices: number[] = []
  for (let i = 0; i < s.texts.length; i++) {
    if (uiBadgeFinal(s.texts[i], s.translations[i], s.targetLang)) uiIndices.push(i)
  }

  const backendMatch = JSON.stringify(backendIndices) === JSON.stringify(s.expected.backend)
  const uiMatch = JSON.stringify(uiIndices) === JSON.stringify(s.expected.ui)

  if (backendMatch) backendPass++; else backendFail++
  if (uiMatch) uiPass++; else uiFail++

  const status = backendMatch && uiMatch ? '✅' : '❌'
  console.log(`${status} ${s.id}: ${s.name}`)
  console.log(`   后端: [${backendIndices}] 期望: [${s.expected.backend}] ${backendMatch ? '✓' : '✗'}`)
  console.log(`   UI:   [${uiIndices}] 期望: [${s.expected.ui}] ${uiMatch ? '✓' : '✗'}`)
  if (s.note) console.log(`   说明: ${s.note}`)
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`后端: ${backendPass} 通过 / ${backendFail} 失败`)
console.log(`UI:   ${uiPass} 通过 / ${uiFail} 失败`)
console.log('═══════════════════════════════════════════════════════════════')
