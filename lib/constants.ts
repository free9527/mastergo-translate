// ============================================================
// 全局常量
// ============================================================

// DEBUG 模式：生产环境设为 false，关闭诊断日志以提升性能
export const DEBUG_MODE = false

// 翻译批次大小（减小批次减少木桶效应，单批更快）
export const TRANSLATE_BATCH_SIZE = 15
export const PROOFREAD_BATCH_SIZE = 8

// 交叉污染检测最小长度（避免短文本误判）
export const MIN_DUP_LEN = 20

// 产品线缓存上限（防止内存泄漏）
export const PRODUCT_LINE_CACHE_SIZE = 5000

// API 超时（毫秒）— 正常LLM响应5-30s，复杂批次可能需60s+，90s留足余量避免误超时
export const API_TIMEOUT_MS = 90000

// API 重试（减少重试次数，避免长时间等待）
export const API_MAX_RETRIES = 2
export const API_RETRY_DELAY_MS = 1000

// 翻译缓存上限（超出后删旧留新）
export const MAX_CACHE_SIZE = 500

// 术语库版本号（更新 default-glossary.ts 后手动 +1，旧版自动覆盖升级）
export const GLOSSARY_VERSION = 4  // 2026-07-07: Lexar术语库_专属.csv 全量更新

// UI 超时（仅用于 toast 消失等非关键逻辑）
export const TOAST_DURATION_MS = 2500

// 存储 Key
export const STORAGE_KEY_GLOSSARY_VERSION = 'translate_glossary_version'
export const STORAGE_KEY_GLOSSARY_PRODUCTS = 'translate_glossary_products'
export const STORAGE_KEY_GLOSSARY_EXCLUSIVE = 'translate_glossary_exclusive'
export const STORAGE_KEY_SETTINGS = 'translate_settings'
export const STORAGE_KEY_ORIGINALS = 'translate_originals'
export const STORAGE_KEY_APPLIED = 'translate_applied'
export const STORAGE_KEY_TRANSLATION_CACHE = 'translate_cache'
export const STORAGE_KEY_CORRECTIONS = 'translate_corrections'
export const CORRECTION_THRESHOLD = 1  // 同一源文本被修正后立即生效，加入术语库

// UI 尺寸（v9.1 #16: 420×720 → 480×840，sticky 操作区增大后结果区保有可视空间）
export const UI_WIDTH = 480
export const UI_HEIGHT = 840

// 扫描节点数上限（超出提示用户改用局部扫描，避免主线程长时间无响应）
export const MAX_SCAN_NODES = 1500

// 字体 key 工具
export const FONT_KEY_SEP = '\x00'
export function makeFontKey(family: string, style: string): string {
  return family + FONT_KEY_SEP + style
}
export function parseFontKey(key: string): { family: string; style: string } {
  const parts = key.split(FONT_KEY_SEP)
  return { family: parts[0], style: parts[1] || 'Regular' }
}

// 源文本标准化：合并大小写、空格、换行、商标符号差异，避免同义文本重复翻译
export function normalizeText(s: string): string {
  return s
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[®™©]/g, '')
    .toLowerCase()
    .trim()
}
