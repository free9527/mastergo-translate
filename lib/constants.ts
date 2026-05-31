// ============================================================
// 全局常量
// ============================================================

// 翻译批次大小
export const TRANSLATE_BATCH_SIZE = 10
export const PROOFREAD_BATCH_SIZE = 10

// API 重试
export const API_MAX_RETRIES = 3
export const API_RETRY_DELAY_MS = 1000

// 翻译缓存上限（超出后删旧留新）
export const MAX_CACHE_SIZE = 500

// UI 超时（仅用于 toast 消失等非关键逻辑）
export const TOAST_DURATION_MS = 2500

// 存储 Key
export const STORAGE_KEY_GLOSSARY = 'translate_glossary'
export const STORAGE_KEY_SETTINGS = 'translate_settings'
export const STORAGE_KEY_ORIGINALS = 'translate_originals'
export const STORAGE_KEY_TRANSLATION_CACHE = 'translate_cache'
export const STORAGE_KEY_CORRECTIONS = 'translate_corrections'
export const CORRECTION_THRESHOLD = 2  // 同一源文本被修正超过此次数时提示加入术语库

// UI 尺寸
export const UI_WIDTH = 420
export const UI_HEIGHT = 720

// 字体 key 工具
export const FONT_KEY_SEP = '\x00'
export function makeFontKey(family: string, style: string): string {
  return family + FONT_KEY_SEP + style
}
export function parseFontKey(key: string): { family: string; style: string } {
  const parts = key.split(FONT_KEY_SEP)
  return { family: parts[0], style: parts[1] || 'Regular' }
}
