/**
 * product-name-generator.ts — 产品名五槽位生成 20 语种（v11.1）
 *
 * 依据：术语素材/Lexar术语库_产品名.csv（141 条真实数据归纳）+
 *       命名规则文档（lexar产品命名规则以及小语种翻译规则.md）。
 * 冲突时以 CSV 现状为准（保证新品名与已有术语库风格统一、可混用）。
 *
 * 五槽位：品牌 Lexar + [Professional] + 系列名 + 型号/规格 + 品类词
 *   - Brand/model/specification values are preserved; known labels and suffixes are localized.
 *   - 品类词：按 CATEGORY_WORDS（v11.7 单一事实源）查译法 × 按 WORD_ORDER 套语序模板
 *
 * 中文营销名槽位：一律留空（ARES→战神/THOR→雷神 内部不一致、Air→小轻块为特例，
 *   均不可安全自动继承；由用户日后补全）。
 */

import { CATEGORY_WORDS } from '@lib/prompt-constants'

// ═══════════════════════════════════════════════════════════════
// 20 语种清单（与 CSV 列一致，source 之外）
// ═══════════════════════════════════════════════════════════════
export const TARGET_LANGS = [
  'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'pt-BR', 'ru',
  'it', 'vi', 'th', 'id', 'ar', 'nl', 'pl', 'sv', 'tr', 'en',
] as const

// ═══════════════════════════════════════════════════════════════
// Base word order; media blocks, accessories and suffixes are rendered separately.
//   'suffix' 品类后置： Lexar + 系列 + 型号/规格 + 品类
//   'prefix' 品类前置： 品类 + Lexar + 系列 + 型号/规格
// ═══════════════════════════════════════════════════════════════
const WORD_ORDER: Record<string, 'prefix' | 'suffix'> = {
  'zh-CN': 'suffix', 'zh-TW': 'suffix', 'ja': 'suffix', 'ko': 'suffix',
  'de': 'suffix', 'en': 'suffix',
  'fr': 'prefix', 'es': 'prefix', 'nl': 'prefix', 'pl': 'prefix', 'sv': 'prefix',
  'tr': 'prefix', 'pt': 'prefix', 'pt-BR': 'prefix', 'it': 'prefix', 'th': 'prefix',
  'id': 'prefix', 'ar': 'prefix', 'ru': 'prefix',
  // vi 特例：按品类在 VI_ORDER_OVERRIDES 处理
}

// ═══════════════════════════════════════════════════════════════
// 品类词 20 语种译法（以 CSV 现状为准）
//   - ja/ko/vi 的 SSD/Portable SSD 保留 "SSD"
//   - ko/vi 的 Flash Drive 保留英文
//   - vi/id 的 Reader/Enclosure/Hub 保留英文
// ═══════════════════════════════════════════════════════════════
// v11.7: 本地 CATEGORY_TRANSLATIONS 已删除——统一从 prompt-constants.CATEGORY_WORDS 派生。
// 产品名生成译法（与 prompt 对照译法不同的词条）走 entry.productName override。
// 差异对照（删前 generator 值 → 现 override 值）：
//   SSD ru Внутренний SSD / vi Ổ Cứng SSD（prompt 对照为 SSD / Ổ SSD）
//   Desktop Memory zh-CN 台式电脑内存（prompt 对照为 台式机内存条）
//   Flash Drive ja フラッシュドライブ / ko Flash Drive（prompt 对照为 USBメモリ / USB メモリ）
//   Dual Drive 全语种 → Flash Drive 简化译法（prompt 对照为独立 Dual Drive 译法）
//   Solid State Dual Drive 拉丁语系 15 语种 → CSV 现状简化译法

/**
 * 取品类词译法：产品名生成优先 entry.productName override，其次语种直值。
 * v11.7 从 CATEGORY_WORDS 单一事实源读取。
 */
function categoryTranslation(category: string, lang: string): string {
  const entry = CATEGORY_WORDS[category]
  if (!entry) return category
  if (entry.productName && entry.productName[lang]) return entry.productName[lang]
  const v = entry[lang]
  return typeof v === 'string' && v ? v : category
}

// 越南语特例：内置 SSD / Card 前置，Portable SSD 后置，外设全保留英文
const VI_PREFIX_CATEGORIES = new Set(['SSD', 'Card', 'Desktop Memory', 'Laptop Memory'])
const VI_KEEP_ENGLISH_CATEGORIES = new Set(['Reader', 'Enclosure', 'Hub'])

// ═══════════════════════════════════════════════════════════════
// 品类识别
// ═══════════════════════════════════════════════════════════════
const CATEGORY_KEYS = Object.keys(CATEGORY_WORDS)
  .sort((a, b) => b.length - a.length) // 最长优先（Solid State Dual Drive > Portable SSD > SSD）

/**
 * 产品名结构归一（v12.47）：剥品类词 → 剩余 token 排序。
 * 根治「词序变体缺口」：画布 `Lexar PLAY X PCIe 4.0 M.2 NVMe SSD` 与术语库钦定
 * `Lexar PLAY X M.2 PCIe 4.0 NVMe SSD`（词序 M.2 PCIe 4.0 ↔ PCIe 4.0 M.2）cleanKey 不同
 * 导致 S1 短路漏配、v11.2 误判「新产品名」重复收录。结构归一后两者同 key。
 *
 * 与通用 cleanKey 的区别：只在「产品名形态」语境用（Lexar 锚点 + 品类词双门），
 * 且只在词序维度归一（token 排序），其余归一（®™©/空白/连字符/大小写）继承 cleanKey。
 * 词序差异的「规格写法」（PCIe 4.0 M.2 ↔ M.2 PCIe 4.0）属同一产品的不同表述，归一安全；
 * 不同产品（系列/型号不同）token 集合必不同，不会误判。
 *
 * @returns 结构归一 key；非产品名形态（无品类词）返回 null（调用方不启用词序匹配）
 */
export function productStructureKey(text: string): string | null {
  const category = detectCategory(text)
  if (!category) return null
  const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const core = text.replace(new RegExp(`\\s*\\b${escaped}\\b\\s*`, 'i'), ' ').replace(/\s+/g, ' ').trim()
  const tokens = core.toLowerCase().replace(/[®™©]/g, '').replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  return tokens.sort().join(' ') + '|' + category.toLowerCase()
}

/**
 * 钦定词序对齐（v12.47）：真新品代码生成译名前，把词序变体对齐到术语库同结构钦定词序。
 *
 * 问题：画布 `Lexar PLAY X PCIe 4.0 M.2 NVMe SSD`（词序 PCIe 4.0 M.2）与公司钦定风格
 *   `M.2 PCIe 4.0`（产品名库 141 条归纳）漂移——直接用源文词序生成译名，产出非钦定形态。
 * 解法：用 productStructureKey 在术语库 source 里找「同结构（token 集合+品类相同）」的钦定 key，
 *   找到则采用钦定 key 的完整词序（含品类词），找不到（真新品/全新规格组合）保留源文词序。
 *
 * 安全边界（实测普查背书）：
 *   - 产品名库 141 条内部 tokenKey 零冲突、跨专属库零冲突 → 同结构 key 唯一指向同一产品
 *   - 只在产品名形态（productStructureKey 非 null）启用，普通句子零影响
 *   - 对齐只发生在「词序不同但 token 集合+品类全同」——即同一产品的不同表述，不跨产品
 *
 * @param enName 英文产品名（含品类词）
 * @param glossarySources 术语库全部 source key（产品名库 ∪ 专属库）
 * @returns 对齐后的英文产品名（词序调整为钦定风格）；无同结构钦定则原样返回
 */
export function alignToGlossaryWordOrder(enName: string, glossarySources: string[]): string {
  const myKey = productStructureKey(enName)
  if (!myKey) return enName
  for (const src of glossarySources) {
    // 完全同形（cleanKey 级）跳过——那种情况 S1 短路已命中钦定译文，无需对齐
    if (src === enName) continue
    if (productStructureKey(src) === myKey) return src
  }
  return enName
}

/**
 * 从英文产品名识别品类（末尾/词边界匹配，最长优先）。返回 null 表示无品类词。
 *
 * v11.4 大小写不敏感化 + 品名语境守卫：
 *   - 第一遍官方写法精确匹配（大小写敏感）直通——既有行为零变化
 *   - 第二遍大小写不敏感匹配，命中时（源文写法与 canonical 不一致，如小写 card）：
 *     守卫 1：命中须落在文本结尾（最后一个词）——CSV 140 条实证品类词恒结尾，
 *       'Insert card into slot'（card 在中间）/ 'SD card reader'（双词连用）排除
 *     守卫 2：前一个 token 含大写字母或数字——品名形态信号
 *       （Lexar/系列/型号/规格必含；'fast ssd'/'old card' 全小写描述排除）
 *   - 返回 canonical key（'Card' 非 'card'），下游 CATEGORY_WORDS 查询不受影响
 */
export function detectCategory(enName: string): string | null {
  // Structural accessories outrank embedded media (Card Reader / Portable SSD with Hub).
  if (/^Lexar[®™©]?\s/i.test(enName)) {
    const primary = enName.split(/\s+with\s+/i)[0].replace(/\s*\(EOL\)\s*$/i, '')
    for (const cat of ['Reader', 'Enclosure', 'Hub', 'Portable SSD']) {
      if (new RegExp('\\b' + cat + '\\b', 'i').test(primary)) return cat
    }
  }
  for (const cat of CATEGORY_KEYS) {
    const escaped = cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 第一遍：官方写法精确匹配（大小写敏感）——既有行为完全不变
    if (new RegExp(`\\b${escaped}\\b`).test(enName)) {
      // 排除 "SSD" 命中 "Portable SSD"/"SSD Enclosure" 里的 SSD
      if (cat === 'SSD' && /\bPortable SSD\b/.test(enName)) continue
      if (cat === 'SSD' && /\bSSD\s+(Enclosure|Hub|Reader)\b/.test(enName)) continue
      return cat
    }
    // 第二遍：大小写不敏感匹配 + 品名语境守卫（v11.4）
    const ciRe = new RegExp(`\\b${escaped}\\b`, 'i')
    const match = ciRe.exec(enName)
    if (match) {
      // 守卫 1：品类词须为文本最后一个词（词边界保证无 trailing 标点粘连）
      const rest = enName.slice(match.index + match[0].length).trim()
      if (rest !== '') continue
      // 守卫 2：前一个 token 须含大写字母或数字（品名形态信号）
      const before = enName.slice(0, match.index).trim().split(/\s+/).pop() ?? ''
      if (!/[A-Z0-9]/.test(before)) continue
      return cat
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// 生成入口
// ═══════════════════════════════════════════════════════════════

export interface GeneratedProductNames {
  /** 识别到的品类（无品类词时为 null） */
  category: string | null
  /** 20 语种译名；category 为 null 时全部为原文保留 */
  translations: Record<string, string>
  /** 中文营销名槽位是否留空（恒 true，本版本不自动继承） */
  zhMarketingNameBlank: boolean
  /** Uncovered structures require review; no information is discarded. */
  reviewReasons: string[]
}

const ACCESSORY_NAMES: Record<string, Record<string, string>> = {
  Heatsink: {
    'zh-CN': 'with Heatsink', 'zh-TW': 'with Heatsink', ja: 'with Heatsink', ko: 'with Heatsink',
    fr: 'avec dissipateur thermique', de: 'mit Kühlkörper', es: 'con disipador de calor',
    pt: 'com dissipador', 'pt-BR': 'com dissipador', ru: 'с радиатором', it: 'con dissipatore di calore',
    vi: 'with Heatsink', th: 'พร้อมฮีตซิงก์', id: 'dengan Heatsink', ar: 'مع مشتت حراري',
    nl: 'met heatsink', pl: 'z radiatorem', sv: 'med kylfläns', tr: 'Soğutuculu', en: 'with Heatsink',
  },
  'Magnetic Set': {
    'zh-CN': '磁吸套装', 'zh-TW': '磁吸套組', ja: 'with Magnetic Set', ko: 'with Magnetic Set',
    fr: 'avec kit magnétique', de: 'mit Magnetset', es: 'con juego magnético',
    pt: 'com kit magnético', 'pt-BR': 'com kit magnético', ru: 'с магнитным креплением', it: 'con set magnetico',
    vi: 'with Magnetic Set', th: 'พร้อมชุดแม่เหล็ก', id: 'dengan Set Magnetik', ar: 'مع مجموعة مغناطيسية',
    nl: 'met magnetische set', pl: 'z zestawem magnetycznym', sv: 'med magnetkit', tr: 'Manyetik Setli', en: 'with Magnetic Set',
  },
  Hub: {
    'zh-CN': '配扩展坞', 'zh-TW': '附擴充埠', ja: 'ハブ搭載', ko: '(허브 포함)',
    fr: 'avec hub', de: 'mit Hub', es: 'con concentrador', pt: 'com Hub', 'pt-BR': 'com Hub',
    ru: 'с хабом', it: 'con concentratore', vi: 'with Hub', th: 'พร้อมฮับ', id: 'dengan Hub',
    ar: 'مع موزع', nl: 'met hub', pl: 'z hubem', sv: 'med hubb', tr: 'Hub ile', en: 'with Hub',
  },
}
const SECOND_GENERATION: Record<string, string> = {
  'zh-CN': '第二代', 'zh-TW': '第二代', ja: '第 2 世代', ko: '2세대', fr: '2e Gen',
  de: 'der 2. Generation', es: 'de 2.ª generación', pt: '2.ª Geração', 'pt-BR': '2ª Geração',
  ru: '2-го поколения', it: 'di seconda generazione', vi: '2nd Gen', th: 'Gen 2', id: 'Gen 2',
  ar: 'الجيل الثاني', nl: '2e generatie', pl: '2. generacji', sv: '2:a generationen', tr: '2. Nesil', en: '2nd Gen',
}

function localizeType(text: string, lang: string): string {
  const type = lang === 'de' ? 'Typ' : lang === 'es' || lang === 'it' ? 'Tipo' : 'Type'
  return text.replace(/\bType(\s+[AB]\b|-C\b)/gi, (_m, suffix: string) => type + suffix.toUpperCase())
}

function seriesSuffix(label: string, lang: string): string {
  if (lang === 'de') return label.toLowerCase() === 'elite legends' ? 'Elite Legends-Serie' : `der ${label}-Serie`
  if (lang === 'fr') return `série ${label}`
  if (lang === 'es' || lang === 'it') return `Serie ${label}`
  if (lang === 'zh-CN' || lang === 'zh-TW') return `${label} 系列`
  if (lang === 'ja') return `${label} シリーズ`
  if (lang === 'ko') return `${label} 시리즈`
  return `${label} Series`
}

function renderDualDrive(body: string, category: string, lang: string): string {
  const solid = category === 'Solid State Dual Drive'
  const localized = localizeType(body, lang)
  const catRe = new RegExp(`\\b${category}\\b`, 'i')
  const core = localized.replace(catRe, ' ').replace(/\s+/g, ' ').trim()
  if (lang === 'de') return solid ? localized.replace(catRe, 'Dual-SSD') : localized
  if (lang === 'it') return solid ? localized.replace(catRe, 'a stato solido Dual Drive') : localized
  if (lang === 'ko' || lang === 'vi') return localized
  if (lang === 'ja') return solid ? localized.replace(catRe, 'ソリッドステートデュアルドライブ') : `${localized} フラッシュドライブ`
  if (lang === 'zh-CN' || lang === 'zh-TW') {
    if (!solid) return `${localized} ${categoryTranslation('Flash Drive', lang)}`
    return `${core} ${lang === 'zh-CN' ? '双接口高速固态U盘' : '雙介面高速固態隨身碟'}`
  }
  if (lang === 'es') return `${solid ? 'SSD doble' : 'Unidad dual'} ${core}`
  if (lang === 'fr') return `${solid ? 'Lecteur double SSD' : 'Lecteur double'} ${core}`
  const names: Record<string, string> = solid ? {
    pt: 'Pen USB SSD', 'pt-BR': 'Pen Drive SSD', ru: 'USB-флеш-накопитель SSD',
    th: 'แฟลชไดร์ฟ SSD', id: 'Flashdisk SSD', ar: 'محرك فلاش SSD USB', nl: 'SSD USB-stick',
    pl: 'Pendrive SSD', sv: 'SSD USB-minne', tr: 'SSD USB Bellek',
  } : {}
  return `${names[lang] || categoryTranslation('Flash Drive', lang)} ${localized}`
}

/**
 * 按规则生成英文产品名的 20 语种译名。
 *
 * @param enName    完整英文产品名（如 "Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD"）
 * @param _series   Legacy caller argument; structural rendering reads the complete name.
 * @returns 20 语种译名表
 */
export function generateProductNameTranslations(
  enName: string,
  _series: string,
): GeneratedProductNames {
  const source = enName.replace(/\s*\(EOL\)/gi, '').replace(/×/g, 'x')
    .replace(/\bGen\s*(\d+)\s*[xX]\s*(\d+)\b/gi, 'Gen$1x$2')
    .replace(/(\bUSB\s+[\d.]+\s+)Gen(\d+x\d+)/gi, '$1Gen $2')
    .replace(/\s+/g, ' ').trim()
  const category = detectCategory(source)
  const translations: Record<string, string> = {}
  const reviewReasons: string[] = []
  if (/\b(?:1st|3rd|[4-9]th|\d{2,}th) Gen\b/i.test(source)) reviewReasons.push('Unsupported generation')

  if (!category) {
    for (const lang of TARGET_LANGS) translations[lang] = source
    return { category, translations, zhMarketingNameBlank: true, reviewReasons: ['No supported category'] }
  }
  let body = source
  const seriesMatch = body.match(/\s+(GOLD|SILVER|BLUE|DIAMOND|Elite Legends)\s+Series$/i)
  const eSeries = body.match(/\s+E-Series?(\s+Plus)?$/i)
  if (seriesMatch) body = body.slice(0, seriesMatch.index).trim()
  if (eSeries) body = body.slice(0, eSeries.index).trim()
  const accessoryMatch = body.match(/\bwith\s+(Heatsink|Magnetic Set|Hub)(?=\s+(?:M\.2|PCIe|NVMe|SSD|Portable SSD)\b|$)/i)
  const accessory = accessoryMatch && Object.keys(ACCESSORY_NAMES).find(k => k.toLowerCase() === accessoryMatch[1].toLowerCase())
  if (accessoryMatch) body = body.replace(accessoryMatch[0], ' ').replace(/\s+/g, ' ').trim()
  if (/\bwith\b/i.test(body)) reviewReasons.push('Unknown accessory: preserve source and review')
  if (/\bSeries\b|\bE-Series?\b/i.test(body)) reviewReasons.push('Unsupported series suffix')
  const generation = /\b2nd Gen\b/i.test(body)
  const categoryRe = new RegExp(`\\b${category}\\b`, 'i')
  const core = body.replace(categoryRe, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b(PCIe\s+[\d.]+)\s+(M\.2)\b/i, (_m, pcie: string) => `M.2 ${pcie.replace(/^pcie/i, 'PCIe')}`)
  const cardReader = category === 'Reader' && /\bCard Reader\b/i.test(body)
  const ssdEnclosure = category === 'Enclosure' && /\bSSD Enclosure\b/i.test(body)
  const dual = category === 'Dual Drive' || category === 'Solid State Dual Drive'
  const cardMedia = category === 'Card' && core.match(/\b(?:CFexpress(?:\s+\d+\.\d+)?\s+Type\s+[AB]|(?:microSD(?:HC|XC)?|SD(?:HC|XC)?)(?:\/(?:microSD(?:HC|XC)?|SD(?:HC|XC)?))?(?:\s+(?:UHS-I{1,2}|Express))?)(?:[™®])?/i)

  if (category === 'Card' && !cardMedia && !/\bNM Card\b/i.test(source)) reviewReasons.push('Unsupported card format')

  for (const lang of TARGET_LANGS) {
    if (lang === 'en') {
      translations[lang] = source.replace(/\b(PCIe\s+[\d.]+)\s+(M\.2)\b/i, (_m, pcie: string) => `M.2 ${pcie.replace(/^pcie/i, 'PCIe')}`)
      continue
    }
    if (lang === 'vi' && VI_KEEP_ENGLISH_CATEGORIES.has(category)) {
      translations[lang] = source
      continue
    }
    let localCore = localizeType(core, lang)
    let cat = categoryTranslation(category, lang)
    if (cardReader) localCore = localCore.replace(/\bCard\s*$/i, '').trim()
    if (ssdEnclosure && ['de', 'es', 'it', 'fr', 'pt', 'pt-BR', 'ru', 'th', 'id', 'ar', 'sv', 'tr'].includes(lang)) {
      localCore = localCore.replace(/\bSSD\s*$/i, '').trim()
      const names: Record<string, string> = { de: 'SSD-Gehäuse', es: 'Receptáculo de SSD', it: 'Custodia per SSD', fr: 'Boîtier SSD', pt: 'Caixa para SSD', 'pt-BR': 'Case para SSD', ru: 'Корпус для SSD', th: 'กล่องใส่ SSD', id: 'Casing SSD', ar: 'علبة SSD', sv: 'SSD-kabinett', tr: 'SSD Kutusu' }
      cat = names[lang]
    }
    if (category === 'Portable SSD' && /\bMagnetic\b/.test(localCore)) {
      const magnetic: Record<string, string> = { 'zh-CN': '磁吸移动固态硬盘', 'zh-TW': '磁吸行動固態硬碟',
        fr: 'SSD portable magnétique', es: 'SSD portátil magnética', it: 'SSD portatile magnetica',
        pt: 'SSD Portátil Magnético', 'pt-BR': 'SSD Portátil Magnético', ar: 'SSD محمول مغناطيسي' }
      if (magnetic[lang]) {
        cat = magnetic[lang]
        localCore = localCore.replace(/\bMagnetic\b/, '').replace(/\s+/g, ' ').trim()
      }
    }
    if (category === 'SSD' && lang === 'it' && (/\bProfessional\b/.test(source) || accessory === 'Heatsink')) cat = 'Unità a stato solido'
    if (generation) localCore = localCore.replace(/\b2nd Gen\b/i, ['ja', 'ko', 'fr', 'vi'].includes(lang) ? SECOND_GENERATION[lang] : '').replace(/\s+/g, ' ').trim()

    let order = WORD_ORDER[lang] || 'suffix'
    if (lang === 'vi') order = VI_PREFIX_CATEGORIES.has(category) ? 'prefix' : 'suffix'
    let text = order === 'prefix' ? `${cat} ${localCore}` : `${localCore} ${cat}`
    if (category === 'Card' && lang === 'it' && cardMedia) {
      const rest = localizeType(core.replace(cardMedia[0], ' ').replace(/\s+/g, ' ').trim(), lang)
      text = `${cat} ${localizeType(cardMedia[0], lang)} ${rest}`
    }
    const driveSize = category === 'Enclosure' && localCore.match(/\b(\d+(?:\.\d+)?) Inch Hard Drive\b/i)
    if (driveSize && (lang === 'es' || lang === 'it')) {
      const name = localCore.replace(driveSize[0], '').replace(/\s+/g, ' ').trim()
      const size = driveSize[1].replace('.', ',')
      text = lang === 'es' ? `Carcasa ${name} para unidades de ${size} pulgadas`
        : `Box esterno ${name} per unità da ${size} pollici`
    }
    if (dual) text = renderDualDrive(body, category, lang)
    if (generation && !['ja', 'ko', 'fr', 'vi'].includes(lang)) text += ` ${SECOND_GENERATION[lang]}`
    if (seriesMatch) text += ` ${seriesSuffix(seriesMatch[1], lang)}`
    if (eSeries) text += ` ${lang === 'de' ? 'der E-Serie' : lang === 'it' ? 'Serie E' : lang === 'es' ? 'Serie-E' : lang === 'fr' ? 'série E' : 'E-Series'}${eSeries[1] ? ' Plus' : ''}`
    if (accessory) {
      const phrase = ACCESSORY_NAMES[accessory][lang]
      const join = ((lang === 'zh-CN' || lang === 'zh-TW') && accessory === 'Magnetic Set') || (lang === 'ko' && accessory === 'Hub') ? '' : ' '
      text = lang === 'ja' && accessory === 'Hub' ? `${phrase} ${text}` : `${text}${join}${phrase}`
    }
    if (lang === 'de') {
      text = text.replace(/\bMagnetic\s+tragbare SSD\b/g, 'magnetische tragbare SSD')
        .replace(/\bUSB Flash-Laufwerk\b/g, 'USB-Flash-Laufwerk')
        .replace(/\bUSB-C Hub\b/g, 'USB-C-Hub')
        .replace(/\bMulti-Card\s+(.+)\s+Kartenleser$/, '$1 Multi-Kartenleser')
        .replace(/\bcard\b/gi, 'Karte')
      if (category === 'Enclosure') text = text.replace(/\b(\d+)\.(\d+) Inch Hard Drive Gehäuse\b/i, '$1,$2-Zoll-Festplattengehäuse')
      if (category === 'Portable SSD' && /\bDual Drive\b/.test(source)) {
        text = text.replace(/\bDual Drive\s+(.+)\s+tragbare SSD$/, 'tragbare Dual-SSD $1')
      }
    }
    translations[lang] = text.replace(/\s+/g, ' ').trim()
  }
  return { category, translations, zhMarketingNameBlank: true, reviewReasons }
}

/** 简→繁基础映射（zh-CN → zh-TW 用，覆盖产品名常用字）。 */
const S2T_MAP: Record<string, string> = {
  '固态硬盘': '固態硬碟', '移动固态硬盘': '行動固態硬碟', '台式电脑内存': '桌上型電腦記憶體',
  '笔记本电脑内存': '筆記型電腦記憶體', '闪存盘': '隨身碟', '固态U盘': '固態隨身碟',
  '存储卡': '記憶卡', '读卡器': '讀卡機', '硬盘盒': '硬碟盒', '扩展坞': '擴充埠',
  '台式机内存条': '桌上型電腦記憶體', '双接口U盘': '雙介面高速固態隨身碟',
}

/**
 * 中文产品名 → zh-TW（确定性简→繁）。
 * 仅转换已知品类词与常见字；系列名/型号/规格保留。
 */
export function zhCNtoZhTW(zhName: string): string {
  let result = zhName
  // 长词优先替换（移动固态硬盘 先于 固态硬盘）
  const keys = Object.keys(S2T_MAP).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    result = result.split(k).join(S2T_MAP[k])
  }
  return result
}

// CATEGORY_WORDS 引用保留（与检测模块同源校验，防漂移）
void CATEGORY_WORDS
