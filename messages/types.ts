// ============================================================
// 共享类型定义（UI 和主线程通用）
// ============================================================

export enum UIMessage {
  SCAN_ALL = 'SCAN_ALL',
  SCAN_SELECTION = 'SCAN_SELECTION',
  APPLY_TRANSLATIONS = 'APPLY_TRANSLATIONS',
  UNDO_ALL = 'UNDO_ALL',
  SAVE_GLOSSARY = 'SAVE_GLOSSARY',
  LOAD_GLOSSARY = 'LOAD_GLOSSARY',
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
  CORRECTION_SUGGESTION = 'CORRECTION_SUGGESTION',
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
  UNDO_DONE = 'UNDO_DONE',
  GLOSSARY_LOADED = 'GLOSSARY_LOADED',
  GLOSSARY_SAVED = 'GLOSSARY_SAVED',
  CSV_EXPORT_READY = 'CSV_EXPORT_READY',
  CSV_IMPORT_DONE = 'CSV_IMPORT_DONE',
  SETTINGS_LOADED = 'SETTINGS_LOADED',
  SETTINGS_SAVED = 'SETTINGS_SAVED',
  FONTS_LOADED = 'FONTS_LOADED',
  TRANSLATION_CACHE_LOADED = 'TRANSLATION_CACHE_LOADED',
  CORRECTIONS_LOADED = 'CORRECTIONS_LOADED',
  CORRECTION_SAVED = 'CORRECTION_SAVED',
  CORRECTION_SUGGESTION = 'CORRECTION_SUGGESTION',
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
  industryContext: string
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
