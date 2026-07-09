// ============================================================
// 共享类型定义（UI 和主线程通用）
// ============================================================

export enum UIMessage {
  SCAN_ALL = 'SCAN_ALL',
  SCAN_SELECTION = 'SCAN_SELECTION',
  APPLY_TRANSLATIONS = 'APPLY_TRANSLATIONS',
  APPLY_FONTS = 'APPLY_FONTS',
  UNDO_ALL = 'UNDO_ALL',
  SAVE_GLOSSARY_PRODUCTS = 'SAVE_GLOSSARY_PRODUCTS',
  LOAD_GLOSSARY_PRODUCTS = 'LOAD_GLOSSARY_PRODUCTS',
  SAVE_GLOSSARY_EXCLUSIVE = 'SAVE_GLOSSARY_EXCLUSIVE',
  LOAD_GLOSSARY_EXCLUSIVE = 'LOAD_GLOSSARY_EXCLUSIVE',
  EXPORT_CSV = 'EXPORT_CSV',
  IMPORT_CSV = 'IMPORT_CSV',
  SAVE_SETTINGS = 'SAVE_SETTINGS',
  LOAD_SETTINGS = 'LOAD_SETTINGS',
  LOAD_FONTS = 'LOAD_FONTS',
  NOTIFY = 'NOTIFY',
  LOAD_TRANSLATION_CACHE = 'LOAD_TRANSLATION_CACHE',
  SAVE_TRANSLATION_CACHE = 'SAVE_TRANSLATION_CACHE',
  SAVE_CORRECTION = 'SAVE_CORRECTION',
  LOAD_CORRECTIONS = 'LOAD_CORRECTIONS',
  SAVE_SUGGESTED_TERMS = 'SAVE_SUGGESTED_TERMS',
  LOAD_SUGGESTED_TERMS = 'LOAD_SUGGESTED_TERMS',
  CORRECTION_SUGGESTION = 'CORRECTION_SUGGESTION',
  LOCATE_NODE = 'LOCATE_NODE',
  APPLY_SINGLE = 'APPLY_SINGLE',
}

export interface TestConnectionResult {
  success: boolean
  message: string
  model?: string
  latencyMs?: number
}

export enum PluginMessage {
  SCAN_RESULT = 'SCAN_RESULT',
  APPLY_PROGRESS = 'APPLY_PROGRESS',
  APPLY_DONE = 'APPLY_DONE',
  APPLY_FONTS_PROGRESS = 'APPLY_FONTS_PROGRESS',
  APPLY_FONTS_DONE = 'APPLY_FONTS_DONE',
  UNDO_DONE = 'UNDO_DONE',
  GLOSSARY_PRODUCTS_LOADED = 'GLOSSARY_PRODUCTS_LOADED',
  GLOSSARY_PRODUCTS_SAVED = 'GLOSSARY_PRODUCTS_SAVED',
  GLOSSARY_EXCLUSIVE_LOADED = 'GLOSSARY_EXCLUSIVE_LOADED',
  GLOSSARY_EXCLUSIVE_SAVED = 'GLOSSARY_EXCLUSIVE_SAVED',
  CSV_EXPORT_READY = 'CSV_EXPORT_READY',
  CSV_IMPORT_DONE = 'CSV_IMPORT_DONE',
  SETTINGS_LOADED = 'SETTINGS_LOADED',
  SETTINGS_SAVED = 'SETTINGS_SAVED',
  FONTS_LOADED = 'FONTS_LOADED',
  TRANSLATION_CACHE_LOADED = 'TRANSLATION_CACHE_LOADED',
  CORRECTIONS_LOADED = 'CORRECTIONS_LOADED',
  CORRECTION_SAVED = 'CORRECTION_SAVED',
  CORRECTION_SUGGESTION = 'CORRECTION_SUGGESTION',
  SUGGESTED_TERMS_LOADED = 'SUGGESTED_TERMS_LOADED',
  ERROR = 'ERROR',
  STATUS = 'STATUS',
}

export interface TextItem {
  nodeIds: string[]
  nodeNames: string[]
  pageName: string
  sourceText: string
  translatedText: string
  proofreadText: string
  proofreadReason: string
  corrected: boolean
  // 源属性
  fontSize: number
  fontFamily: string
  fontStyle: string
  lineHeight: number | null       // null=PIXELS值, null 时表示 AUTO
  letterSpacing: number | null    // null=未设置
  textAlignHorizontal: string     // LEFT | CENTER | RIGHT | JUSTIFIED
  // 目标属性（空/0/null=继承原属性）
  targetFontFamily: string
  targetFontStyle: string
  targetFontSize: number          // 0=继承
  targetLineHeight: number | null // null=继承
  targetLetterSpacing: number | null // null=继承
  targetTextAlign: string         // ''=继承
}

export interface LLMConfig {
  apiKey: string
  apiUrl: string
  model: string
  translationStyle: string
  translationStyleCustom: string
  scenePreset: string
  manualProductLine?: string  // undefined=自动检测, 'none'=不注入, 其他值=强制指定产品线
  enableProofread: boolean
  proofreadApiKey: string
  proofreadApiUrl: string
  proofreadModel: string
}

export interface TranslationCorrection {
  source: string
  targetLang: string
  originalTranslation: string
  correctedTranslation: string
  correctedAt: number  // timestamp
}

export interface GlossaryEntry {
  source: string
  translations: Record<string, string>  // 语言代码 → 翻译
}

// ============================================================
// 术语行为判定（替代旧的三重标签体系）
// ============================================================

/** 营销文案术语 — 非电商场景自动过滤，不注入 prompt */
export const MARKETING_ONLY_TERMS = new Set([
  'End Storage Anxiety',
  'Power Up Your Play',
  'Seamless Play, Ultimate Gaming',
  'Zero Lag Game Loading',
  'Capture the Diamond Moments',
  'Unleash Your Full Potential in Work and Play',
  'Unlock Device Potential',
  'Unmatched Performance',
  'Unleash Your Computer with Next-Gen DDR5',
  'Smooth 4K Video Recording',
  'No dropped frames',
  'No sudden speed drop',
  'Play Hard, Work Hard',
  'Professional Grade Performance',
  'Steel-Armored, Unstoppable Performance',
  'Full Game Library Storage',
  'Seamlessly compatible with Intel XMP 3.0 & AMD EXPO for one-click overclocking.',
  'DDR5 Performance with Powerful Heatsink',
  'Heat-Defying 6nm Controller',
  'Compact & Portable',
  '4X Faster than USB 3.0',
])

/** 合规声明术语 — 强制注入，不受场景/产品线过滤影响 */
export const COMPLIANCE_TERMS = new Set([
  'Limited Lifetime Warranty',
  'Limited Warranty',
  'Product images are for reference only',
  'Please back up important data properly',
])

export function isMarketingTerm(source: string): boolean {
  return MARKETING_ONLY_TERMS.has(source)
}

export function isComplianceTerm(source: string): boolean {
  return COMPLIANCE_TERMS.has(source)
}

/** 产品线标签说明（用于术语库模板） */
export const PRODUCT_LINE_LABELS: Record<string, string> = {
  gaming_dimm: '游戏内存（ARES/THOR DDR）',
  gaming_ssd: '游戏SSD（PLAY/ARES SSD）',
  gaming_card: '游戏存储卡（PLAY microSD/SD）',
  professional_imaging: '专业影像（GOLD/DIAMOND/ARMOR CFexpress/SD）',
  pc_productivity: 'PC生产力（NM/NQ/NS/EQ SSD/DRAM）',
  consumer_cards: '消费级存储卡（BLUE/SILVER SD/microSD）',
  portable_storage: '移动存储（PSSD/U盘/读卡器/Hub）',
  innovation_lifestyle: '创新生活（pexar/数码相框）',
  common: '通用（所有产品线共用）',
}

export interface LanguageOption {
  code: string
  name: string
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'zh-CN', name: 'CN 简体中文' },
  { code: 'zh-TW', name: 'TW 繁体中文' },
  { code: 'en', name: 'EN 英文' },
  { code: 'ja', name: 'JA 日文' },
  { code: 'ko', name: 'KO 韩语' },
  { code: 'fr', name: 'FR 法文' },
  { code: 'de', name: 'DE 德文' },
  { code: 'es', name: 'ES 西班牙语' },
  { code: 'pt', name: 'PT 葡萄牙语' },
  { code: 'pt-BR', name: 'BR 巴西葡语' },
  { code: 'ru', name: 'RU 俄语' },
  { code: 'it', name: 'IT 意大利语' },
  { code: 'vi', name: 'VN 越南语' },
  { code: 'th', name: 'TH 泰语' },
  { code: 'id', name: 'ID 印尼语' },
  { code: 'ar', name: 'AR 阿拉伯语' },
  { code: 'nl', name: 'NL 荷兰语' },
  { code: 'pl', name: 'PL 波兰语' },
  { code: 'sv', name: 'SV 瑞典语' },
  { code: 'tr', name: 'TR 土耳其语' },
]
