/**
 * product-name-generator.ts — 产品名五槽位生成 20 语种（v11.1）
 *
 * 依据：术语素材/Lexar术语库_产品名.csv（141 条真实数据归纳）+
 *       命名规则文档（lexar产品命名规则以及小语种翻译规则.md）。
 * 冲突时以 CSV 现状为准（保证新品名与已有术语库风格统一、可混用）。
 *
 * 五槽位：品牌 Lexar + [Professional] + 系列名 + 型号/规格 + 品类词
 *   - 系列名/型号/规格：全语种原样保留（规则文档"系列命名保留、硬件原生参数不翻译"）
 *   - 品类词：按 CATEGORY_TRANSLATIONS 查译法 × 按 WORD_ORDER 套语序模板
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
// 语序模板（CSV 归纳，一致率 100%）
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
const CATEGORY_TRANSLATIONS: Record<string, Record<string, string>> = {
  'SSD': {
    'zh-CN': '固态硬盘', 'zh-TW': '固態硬碟', 'ja': 'SSD', 'ko': 'SSD',
    'fr': 'SSD', 'de': 'SSD', 'es': 'Unidad de estado sólido (SSD)',
    'pt': 'SSD Interno', 'pt-BR': 'SSD Interno', 'ru': 'Внутренний SSD',
    'it': 'SSD', 'vi': 'Ổ Cứng SSD', 'th': 'SSD ภายใน', 'id': 'SSD Internal',
    'ar': 'SSD داخلي', 'nl': 'Interne SSD', 'pl': 'Dysk SSD wewnętrzny',
    'sv': 'Intern SSD', 'tr': 'Dahili SSD', 'en': 'SSD',
  },
  'Portable SSD': {
    'zh-CN': '移动固态硬盘', 'zh-TW': '行動固態硬碟', 'ja': 'ポータブルSSD', 'ko': '휴대용 SSD',
    'fr': 'SSD portable', 'de': 'Tragbare SSD', 'es': 'SSD portátil',
    'pt': 'SSD Portátil', 'pt-BR': 'SSD Portátil', 'ru': 'Портативный SSD',
    'it': 'SSD portatile', 'vi': 'SSD Di Động', 'th': 'SSD แบบพกพา', 'id': 'SSD Portabel',
    'ar': 'SSD محمول', 'nl': 'Draagbare SSD', 'pl': 'Przenośny dysk SSD',
    'sv': 'Portabel SSD', 'tr': 'Taşınabilir SSD', 'en': 'Portable SSD',
  },
  'Desktop Memory': {
    'zh-CN': '台式电脑内存', 'zh-TW': '桌上型電腦記憶體', 'ja': 'デスクトップメモリ', 'ko': '데스크탑 메모리',
    'fr': 'Mémoire pour ordinateur de bureau', 'de': 'Desktop Arbeitsspeicher',
    'es': 'Memoria de sobremesa', 'pt': 'Memória RAM para Desktop', 'pt-BR': 'Memória RAM para Desktop',
    'ru': 'Оперативная память для ПК', 'it': 'Memoria per Desktop',
    'vi': 'Bộ Nhớ Máy Tính Để Bàn', 'th': 'แรมคอมพิวเตอร์ตั้งโต๊ะ', 'id': 'RAM Desktop',
    'ar': 'ذاكرة RAM لأجهزة الكمبيوتر المكتبية', 'nl': 'RAM-geheugen voor desktop',
    'pl': 'Pamięć RAM do komputera stacjonarnego', 'sv': 'Arbetsminne för stationär dator',
    'tr': 'Masaüstü RAM', 'en': 'Desktop Memory',
  },
  'Laptop Memory': {
    'zh-CN': '笔记本电脑内存', 'zh-TW': '筆記型電腦記憶體', 'ja': 'ラップトップメモリ', 'ko': '랩탑 메모리',
    'fr': 'Mémoire pour ordinateur portable', 'de': 'Laptop Arbeitsspeicher',
    'es': 'Memoria para portátil', 'pt': 'Memória RAM para Portátil', 'pt-BR': 'Memória RAM para Notebook',
    'ru': 'Оперативная память для ноутбука', 'it': 'Memoria per Laptop',
    'vi': 'Bộ Nhớ Máy Tính Xách Tay', 'th': 'แรมโน้ตบุ๊ก', 'id': 'RAM Laptop',
    'ar': 'ذاكرة RAM لأجهزة الكمبيوتر المحمولة', 'nl': 'RAM-geheugen voor laptop',
    'pl': 'Pamięć RAM do laptopa', 'sv': 'Arbetsminne för bärbar dator',
    'tr': 'Laptop RAM', 'en': 'Laptop Memory',
  },
  'Flash Drive': {
    'zh-CN': '闪存盘', 'zh-TW': '隨身碟', 'ja': 'フラッシュドライブ', 'ko': 'Flash Drive',
    'fr': 'Clé USB', 'de': 'USB-Stick', 'es': 'Unidad flash',
    'pt': 'Pen USB', 'pt-BR': 'Pen Drive', 'ru': 'USB-флеш-накопитель',
    'it': 'Unità flash', 'vi': 'Flash Drive', 'th': 'แฟลชไดร์ฟ', 'id': 'Flashdisk',
    'ar': 'محرك فلاش USB', 'nl': 'USB-stick', 'pl': 'Pendrive',
    'sv': 'USB-minne', 'tr': 'USB Bellek', 'en': 'Flash Drive',
  },
  'Dual Drive': {
    'zh-CN': '闪存盘', 'zh-TW': '隨身碟', 'ja': 'フラッシュドライブ', 'ko': 'Flash Drive',
    'fr': 'Clé USB', 'de': 'USB-Stick', 'es': 'Unidad flash',
    'pt': 'Pen USB', 'pt-BR': 'Pen Drive', 'ru': 'USB-флеш-накопитель',
    'it': 'Unità flash', 'vi': 'Flash Drive', 'th': 'แฟลชไดร์ฟ', 'id': 'Flashdisk',
    'ar': 'محرك فلاش USB', 'nl': 'USB-stick', 'pl': 'Pendrive',
    'sv': 'USB-minne', 'tr': 'USB Bellek', 'en': 'Dual Drive',
  },
  'Solid State Dual Drive': {
    'zh-CN': '固态U盘', 'zh-TW': '固態隨身碟', 'ja': 'ソリッドステートデュアルドライブ', 'ko': '솔리드 스테이트 듀얼 드라이브',
    'fr': 'Clé USB SSD', 'de': 'SSD-USB-Stick', 'es': 'Unidad flash SSD',
    'pt': 'Pen USB SSD', 'pt-BR': 'Pen Drive SSD', 'ru': 'SSD USB-флеш-накопитель',
    'it': 'Unità flash SSD', 'vi': 'Flash Drive SSD', 'th': 'โซลิดสเตทแฟลชไดร์ฟ', 'id': 'SSD Flashdisk',
    'ar': 'محرك فلاش SSD', 'nl': 'SSD USB-stick', 'pl': 'Pendrive SSD',
    'sv': 'SSD USB-minne', 'tr': 'SSD USB Bellek', 'en': 'Solid State Dual Drive',
  },
  'Card': {
    'zh-CN': '存储卡', 'zh-TW': '記憶卡', 'ja': 'カード', 'ko': '카드',
    'fr': 'Carte', 'de': 'Karte', 'es': 'Tarjeta',
    'pt': 'Cartão', 'pt-BR': 'Cartão', 'ru': 'Карта памяти',
    'it': 'Scheda', 'vi': 'Thẻ', 'th': 'เมมโมรี่การ์ด', 'id': 'Kartu Memori',
    'ar': 'بطاقة ذاكرة', 'nl': 'Geheugenkaart', 'pl': 'Karta pamięci',
    'sv': 'Minneskort', 'tr': 'Hafıza Kartı', 'en': 'Card',
  },
  'Reader': {
    'zh-CN': '读卡器', 'zh-TW': '讀卡機', 'ja': 'リーダー', 'ko': '리더',
    'fr': 'Lecteur', 'de': 'Lesegerät', 'es': 'Lector',
    'pt': 'Leitor', 'pt-BR': 'Leitor', 'ru': 'Картридер',
    'it': 'Lettore', 'vi': 'Reader', 'th': 'การ์ดรีดเดอร์', 'id': 'Card Reader',
    'ar': 'قارئ بطاقات', 'nl': 'Kaartlezer', 'pl': 'Czytnik kart',
    'sv': 'Kortläsare', 'tr': 'Kart Okuyucu', 'en': 'Reader',
  },
  'Enclosure': {
    'zh-CN': '硬盘盒', 'zh-TW': '硬碟盒', 'ja': 'ケース', 'ko': '케이스',
    'fr': 'Boîtier', 'de': 'Gehäuse', 'es': 'Receptáculo',
    'pt': 'Caixa', 'pt-BR': 'Case', 'ru': 'Корпус',
    'it': 'Custodia', 'vi': 'Enclosure', 'th': 'กล่อง', 'id': 'Casing',
    'ar': 'علبة', 'nl': 'Behuizing', 'pl': 'Obudowa',
    'sv': 'Kabinett', 'tr': 'Kutusu', 'en': 'Enclosure',
  },
  'Hub': {
    'zh-CN': '扩展坞', 'zh-TW': '擴充埠', 'ja': 'ハブ', 'ko': '허브',
    'fr': 'Hub', 'de': 'Hub', 'es': 'Concentrador',
    'pt': 'Hub', 'pt-BR': 'Hub', 'ru': 'Хаб',
    'it': 'Hub', 'vi': 'Hub', 'th': 'ฮับ', 'id': 'Hub',
    'ar': 'موزع', 'nl': 'Hub', 'pl': 'Hub',
    'sv': 'Hubb', 'tr': 'Hub', 'en': 'Hub',
  },
}

// 越南语特例：内置 SSD / Card 前置，Portable SSD 后置，外设全保留英文
const VI_PREFIX_CATEGORIES = new Set(['SSD', 'Card', 'Desktop Memory', 'Laptop Memory'])
const VI_KEEP_ENGLISH_CATEGORIES = new Set(['Reader', 'Enclosure', 'Hub'])

// ═══════════════════════════════════════════════════════════════
// 品类识别
// ═══════════════════════════════════════════════════════════════
const CATEGORY_KEYS = Object.keys(CATEGORY_TRANSLATIONS)
  .sort((a, b) => b.length - a.length) // 最长优先（Solid State Dual Drive > Portable SSD > SSD）

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
 *   - 返回 canonical key（'Card' 非 'card'），下游 CATEGORY_TRANSLATIONS 查询不受影响
 */
export function detectCategory(enName: string): string | null {
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
}

/**
 * 按规则生成英文产品名的 20 语种译名。
 *
 * @param enName    完整英文产品名（如 "Lexar THOR Ultra M.2 2280 PCIe Gen5x4 NVMe SSD"）
 * @param series    系列名（如 "THOR Ultra"），用于定位品类词之外的保留部分
 * @returns 20 语种译名表
 */
export function generateProductNameTranslations(
  enName: string,
  series: string,
): GeneratedProductNames {
  const category = detectCategory(enName)
  const translations: Record<string, string> = {}

  if (!category) {
    // 无品类词（如纯型号/系列组合）→ 全语种原样保留
    for (const lang of TARGET_LANGS) translations[lang] = enName
    return { category: null, translations, zhMarketingNameBlank: true }
  }

  // 拆分：品类词之外的部分（Lexar + 系列 + 型号/规格），全语种保留
  // core = enName 去掉品类词，去多余空格
  // v11.4: i flag —— detectCategory 大小写不敏感命中后，源文中的实际写法（小写 card）
  //   也必须剥掉，否则 core 残留品类词导致译名重复（"Lexar nCARD NM card 存储卡"）
  const catRe = new RegExp(`\\s*\\b${category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*`, 'i')
  const core = enName.replace(catRe, ' ').replace(/\s+/g, ' ').trim()

  for (const lang of TARGET_LANGS) {
    // 越南语外设特例：整条保留英文
    if (lang === 'vi' && VI_KEEP_ENGLISH_CATEGORIES.has(category)) {
      translations[lang] = enName
      continue
    }

    const catTranslated = CATEGORY_TRANSLATIONS[category][lang] || category

    // 语序
    let order: 'prefix' | 'suffix' = WORD_ORDER[lang] || 'suffix'
    if (lang === 'vi') {
      order = VI_PREFIX_CATEGORIES.has(category) ? 'prefix' : 'suffix'
    }

    translations[lang] = order === 'prefix'
      ? `${catTranslated} ${core}`.replace(/\s+/g, ' ').trim()
      : `${core} ${catTranslated}`.replace(/\s+/g, ' ').trim()
  }

  return { category, translations, zhMarketingNameBlank: true }
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
