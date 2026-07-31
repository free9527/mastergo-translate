/**
 * lang-detect.ts — 语言检测单一事实源（v10.0 架构复盘优化 #1）
 *
 * 背景（arch-review-2026-07）：语言检测曾有三套并行实现，改一处漏一处，
 * v9.3 和 v9.11 两次踩同一个坑（逐条 detectSingleTextLanguage 拉丁恒 'en'）。
 * 本模块收口全部"这段文本是什么语言/什么字符集"的判定：
 *
 *   detectSourceLanguage     — 批次级源语言检测（有拉丁细分，最完整）
 *   detectSingleTextLanguage — 逐条便捷包装（委托批次级，消除死代码）
 *   detectLatinLang          — 逐条拉丁细分（功能词投票，≥2 票采纳）
 *   getScriptClass / getTargetScript — 字符集分类（不猜拉丁具体语言）
 *   isSameScriptLanguagePair — 同语系变体语言对（zh 简繁 / pt 欧巴葡）
 *   hasFunctionWords         — 文本是否含指定语言功能词（反向校验）
 *
 * 词表唯一性：LATIN_FUNCTION_WORDS / LATIN_DISTINCTIVE_WORDS / LATIN_DISTINCTIVE_CHARS
 * 只在本文件定义一次。任何新增语言检测需求，改这里，不要在别处新建检测器。
 */

// ═══════════════════════════════════════════════════════════════
// 词表（唯一定义处）
// ═══════════════════════════════════════════════════════════════

/** 拉丁独占特征字符：某语言独占字符出现 ≥2 次 → 强信号直接判定 */
export const LATIN_DISTINCTIVE_CHARS: Record<string, RegExp> = {
  pt: /[ãõÃÕ]/,       // 葡语几乎独占（西语无 ãõ，除借词）
  es: /[ñÑ¿¡]/,       // 西语独占
  de: /[ßẞ]/,         // 德语独占（äöü 与瑞典语等共享，不作信号）
}

/**
 * 拉丁独占区分词（批次级检测用）——保守判定：最高票 ≥3 且 ≥2 倍第二名才采纳。
 * 只收各语言独占的高区分度词（es/pt 共享 17+ 功能词如 que/para/por/de/a/se，
 * 直接投票会误判，故此处只收独占词）；平局/弱信号一律回退 'en'（保守方向）。
 * 与 LATIN_FUNCTION_WORDS 互补：那边是逐条投票（≥2 票，含内容词）。
 * 注意：pt 投票无法区分 pt 与 pt-BR（两变体共享几乎全部词汇），统一返回 'pt'。
 */
export const LATIN_DISTINCTIVE_WORDS: Record<string, Set<string>> = {
  en: new Set(['the', 'of', 'and', 'to', 'in', 'is', 'are', 'for', 'with', 'on', 'at', 'by', 'be', 'has', 'have', 'it', 'its', 'not', 'can', 'will', 'from', 'this', 'that', 'your', 'you', 'an', 'or', 'as', 'up', 'our', 'we']),
  pt: new Set(['é', 'são', 'tem', 'têm', 'sem', 'até', 'não', 'muito', 'um', 'uma', 'ao', 'à', 'do', 'da', 'na', 'no', 'estão', 'isso', 'contra', 'baixas', 'resistente', 'proteção']),
  es: new Set(['el', 'la', 'los', 'las', 'es', 'son', 'está', 'están', 'y', 'pero', 'muy', 'tiene', 'tienen', 'al', 'del', 'un', 'una', 'con', 'sin', 'hasta', 'ñandú']),
  de: new Set(['und', 'oder', 'mit', 'für', 'von', 'zu', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'nicht', 'auch', 'auf', 'bei', 'nach', 'über', 'wird', 'werden', 'kann', 'sich']),
  fr: new Set(['et', 'ou', 'mais', 'que', 'qui', 'dans', 'sur', 'avec', 'sans', 'pour', 'par', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'est', 'sont', 'ne', 'pas', 'plus', 'ce', 'cette']),
  it: new Set(['che', 'per', 'con', 'da', 'fra', 'tra', 'senza', 'su', 'il', 'lo', 'gli', 'le', 'un', 'uno', 'è', 'sono', 'ha', 'hanno', 'di', 'del', 'della', 'nel', 'alla', 'anche', 'più']),
  nl: new Set(['en', 'of', 'maar', 'met', 'voor', 'van', 'tot', 'op', 'bij', 'het', 'een', 'zijn', 'heeft', 'niet', 'aan', 'uit', 'om', 'ook', 'deze', 'dit', 'dat', 'wordt', 'tegen']),
}

/**
 * 拉丁功能词表（逐条细分用，扩充版：每语言 40+ 高频词，覆盖营销/技术文案常用词）。
 * 与 LATIN_DISTINCTIVE_WORDS 互补：那边是批次级保守裁决，这边是逐条投票（≥2 票采纳）。
 */
export const LATIN_FUNCTION_WORDS: Record<string, Set<string>> = {
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

// ═══════════════════════════════════════════════════════════════
// 字符集分类（最保守层：不猜拉丁具体语言）
// ═══════════════════════════════════════════════════════════════

export type ScriptClass = 'latin' | 'cjk' | 'ja' | 'ko' | 'th' | 'ar' | 'ru'

/** 字符集分类（比具体语言检测更保守，不猜拉丁语具体语言） */
export function getScriptClass(text: string): ScriptClass {
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

/** 目标语言 → 字符集映射 */
export function getTargetScript(targetLang: string): ScriptClass {
  if (targetLang === 'ja') return 'ja'
  if (targetLang === 'ko') return 'ko'
  if (targetLang === 'th') return 'th'
  if (targetLang === 'ar') return 'ar'
  if (targetLang === 'ru') return 'ru'
  if (targetLang.startsWith('zh')) return 'cjk'
  return 'latin'
}

/**
 * 目标字符集存在性正则（v10.2）——判定"译文是否属于目标脚本"。
 * 与 getTargetScript 配套：latin 无强特征正则返回 null（拉丁脚本判定走功能词）。
 * 用途：截断/漏翻等代码校验只问"目标脚本字符在不在"（零误判），不问长度（跨语系失效）。
 */
export const TARGET_SCRIPT_PATTERNS: Partial<Record<ScriptClass, RegExp>> = {
  ja: /[぀-ゟ゠-ヿ一-鿿]/,   // 平假名+片假名+CJK汉字
  ko: /[가-힯]/,           // 谚文音节
  cjk: /[一-鿿]/,          // CJK统一汉字（zh 目标）
  th: /[฀-๿]/,            // 泰文
  ar: /[؀-ۿ]/,            // 阿拉伯字母
  ru: /[Ѐ-ӿ]/,            // 西里尔
}

// ═══════════════════════════════════════════════════════════════
// 批次级源语言检测（最完整实现：字符统计 + 拉丁细分）
// ═══════════════════════════════════════════════════════════════

export function detectSourceLanguage(texts: string[]): string {
  let cjkChars = 0, latinChars = 0, hiragana = 0, katakana = 0, hangul = 0, thai = 0, arabic = 0, cyrillic = 0
  for (const t of texts) {
    for (const ch of t) {
      const code = ch.charCodeAt(0)
      if (code >= 0x4E00 && code <= 0x9FFF) cjkChars++           // CJK统一汉字
      else if (code >= 0x3040 && code <= 0x309F) hiragana++       // 平假名
      else if (code >= 0x30A0 && code <= 0x30FF) katakana++       // 片假名
      else if (code >= 0xAC00 && code <= 0xD7AF) hangul++         // 韩文
      else if (code >= 0x0E00 && code <= 0x0E7F) thai++           // 泰文
      else if (code >= 0x0600 && code <= 0x06FF) arabic++         // 阿拉伯文
      else if (code >= 0x0400 && code <= 0x04FF) cyrillic++       // 西里尔
      else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latinChars++
    }
  }
  // 日文：假名占比显著（混有汉字）
  if (hiragana + katakana > 0 && (hiragana + katakana) >= cjkChars * 0.15) return 'ja'
  // 韩文：谚文占比显著
  if (hangul > 0 && hangul >= (cjkChars + hangul) * 0.1) return 'ko'
  // 泰文
  if (thai > latinChars * 0.5) return 'th'
  // 阿拉伯文
  if (arabic > latinChars * 0.5) return 'ar'
  // 西里尔（俄语等）
  if (cyrillic > latinChars * 0.5) return 'ru'
  // 中文 vs 拉丁文本
  if (cjkChars > latinChars) return 'zh-CN'

  // v9.3: 拉丁文本细分判定（en/es/pt/de/fr/it/nl）
  // 背景：此前所有拉丁文本一律返回 'en'，导致 pt→pt-BR 同语系豁免成为死代码
  // （detectUntranslatedText 的 ['pt','pt-BR'] 配对永远配不上），且 de→de 等同语言
  // 校对场景的"源==目标跳过"防线对拉丁语全部失效。
  // 判定策略：独占区分词投票 + 独占特征字符强信号，保守裁决——
  // 平局/弱信号一律回退 'en'（=维持现状行为），宁可误判为 en 也不可误判为其他拉丁语。
  const joined = texts.join(' ').toLowerCase()

  // 特征字符强信号：某语言独占字符出现 ≥2 次 → 直接判定（一票顶十票）
  for (const [lang, pattern] of Object.entries(LATIN_DISTINCTIVE_CHARS)) {
    const charMatches = joined.match(new RegExp(pattern.source, 'g'))
    if (charMatches && charMatches.length >= 2) return lang
  }

  // 区分词投票
  const words = joined.split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/).filter(w => w.length >= 2)
  const votes: Record<string, number> = {}
  for (const w of words) {
    for (const [lang, dict] of Object.entries(LATIN_DISTINCTIVE_WORDS)) {
      if (dict.has(w)) votes[lang] = (votes[lang] || 0) + 1
    }
  }

  // 保守裁决：最高票 ≥3 且严格大于第二名 ≥2 倍才采纳，否则回退 'en'
  let topLang = 'en'
  let topVotes = 0
  let secondVotes = 0
  for (const [lang, count] of Object.entries(votes)) {
    if (count > topVotes) { secondVotes = topVotes; topVotes = count; topLang = lang }
    else if (count > secondVotes) { secondVotes = count }
  }
  if (topVotes >= 3 && topVotes >= secondVotes * 2 && topLang !== 'en') return topLang
  return 'en'
}

/**
 * 逐条拉丁语言细分（功能词投票，保守：≥2 票才采纳）。
 * 用于 classifyNecessity（verify 判定）与 F3b 逐条守卫。
 * 与 detectSourceLanguage 的批次级拉丁细分互补：那边是整批保守裁决（≥3 票 + 2 倍），
 * 这边是单条快速投票（≥2 票），词表用 LATIN_FUNCTION_WORDS（含内容词，区分度更高）。
 */
export function detectLatinLang(text: string): string | null {
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

// ═══════════════════════════════════════════════════════════════
// 逐条检测（v10.0：委托批次级，消除"拉丁恒 en"死代码）
// ═══════════════════════════════════════════════════════════════

/**
 * 单条文本源语言检测。
 *
 * v10.0 架构复盘修复：原实现是独立的字符统计（拉丁文本恒返回 'en'，v9.3/v9.11
 * 两次踩坑的死代码）。现委托批次级 detectSourceLanguage —— 单条文本作为
 * 单元素批次走同一套保守裁决（拉丁区分词 ≥3 票才细分，否则回退 'en'）。
 *
 * 注意：单条文本的拉丁细分天然弱信号（一条文本通常 <3 个区分词），
 * 因此本函数对拉丁单条多数情况仍返回 'en' —— 这不是缺陷，是刻意的保守：
 * 逐条拉丁细分请用 detectLatinLang（功能词投票，≥2 票），批次级标注请用
 * detectSourceLanguage。带缓存：避免同一条文本被重复计算。
 */
const langDetectionCache = new Map<string, string>()
export function detectSingleTextLanguage(text: string): string {
  const cached = langDetectionCache.get(text)
  if (cached !== undefined) return cached
  const result = detectSourceLanguage([text || ''])
  langDetectionCache.set(text, result)
  if (langDetectionCache.size > 10000) {
    const firstKey = langDetectionCache.keys().next().value
    if (firstKey !== undefined) langDetectionCache.delete(firstKey)
  }
  return result
}

// ═══════════════════════════════════════════════════════════════
// 辅助判定
// ═══════════════════════════════════════════════════════════════

/** 检查文本是否含指定语言的功能词（用于反向校验：译文里混入源语功能词=漏翻信号） */
export function hasFunctionWords(text: string, lang: string): boolean {
  const dict = LATIN_FUNCTION_WORDS[lang]
  if (!dict) return false
  const words = text.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/).filter(w => w.length >= 2)
  let count = 0
  for (const w of words) {
    if (dict.has(w)) count++
  }
  return count >= 1 && count / words.length >= 0.05
}

/**
 * 检测是否为同语系变体语言对（共享字符集，放宽漏翻检测）
 * v8.5: CN→TW/HK、PT→PT-BR 等场景
 * v9.3: pt 与 pt-BR 任一侧出现即视为同语系对（区分词投票无法区分欧葡/巴葡，
 *       且 pt-BR→pt 反向场景同样适用）
 */
export function isSameScriptLanguagePair(src: string, tgt: string): boolean {
  const SAME_SCRIPT_PAIRS = [
    ['zh-CN', 'zh-TW'], ['zh-CN', 'zh-HK'],
    ['pt', 'pt-BR'],
  ]
  if ((src === 'pt' || src === 'pt-BR') && (tgt === 'pt' || tgt === 'pt-BR')) return true
  return SAME_SCRIPT_PAIRS.some(([s, t]) =>
    (s === src && t === tgt) || (t === src && s === tgt)
  )
}
