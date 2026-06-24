/**
 * 存储行业单位本地化转换
 *
 * 对于纯"数字+存储单位"文本（如 128GB、256MB/s），
 * 跳过 LLM API 调用，直接用查表法做单位本地化转换。
 * 混合内容（如 "128GB 高速存储"）仍走正常翻译流程。
 */

// ============================================================
// 存储单位正则
// ============================================================

// 所有需要识别的存储行业单位
const STORAGE_UNITS = [
  'PB\\/s', 'TB\\/s', 'GB\\/s', 'MB\\/s', 'KB\\/s', 'B\\/s',  // 速度单位（/s 放前面优先匹配）
  'Mbps', 'Gbps',
  'MT\\/s', 'MHz', 'GHz',
  'IOPS', 'TBW', 'RPM',
  'PB', 'TB', 'GB', 'MB', 'KB', 'B',
  'W',  // 瓦特
]

// 匹配纯"数字 + 可选空格 + 存储单位"的完整文本
const UNIT_PATTERN = new RegExp(
  '^(\\d+(?:\\.\\d+)?)\\s*(' + STORAGE_UNITS.join('|') + ')$',
  'i'
)

// ============================================================
// 单位转换表（仅覆盖需要转换的语言）
// ============================================================

interface UnitMap {
  [unit: string]: string
}

const UNIT_CONVERSIONS: Record<string, UnitMap> = {
  fr: {
    'KB': 'Ko',
    'MB': 'Mo',
    'GB': 'Go',
    'TB': 'To',
    'PB': 'Po',
    'KB/S': 'Ko/s',
    'MB/S': 'Mo/s',
    'GB/S': 'Go/s',
    'TB/S': 'To/s',
  },
  ru: {
    'KB': 'КБ',
    'MB': 'МБ',
    'GB': 'ГБ',
    'TB': 'ТБ',
    'PB': 'ПБ',
    'KB/S': 'КБ/с',
    'MB/S': 'МБ/с',
    'GB/S': 'ГБ/с',
    'TB/S': 'ТБ/с',
  },
  ar: {
    'KB': 'كيلوبايت',
    'MB': 'ميجابايت',
    'GB': 'جيجابايت',
    'TB': 'تيرابايت',
    'PB': 'بيتابايت',
    'KB/S': 'كيلوبايت/ثانية',
    'MB/S': 'ميجابايت/ثانية',
    'GB/S': 'جيجابايت/ثانية',
    'TB/S': 'تيرابايت/ثانية',
  },
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 检测文本是否为纯"数字+存储单位"格式
 * 返回匹配结果，包含数值和单位；不匹配返回 null
 */
export function matchStorageSpec(text: string): { value: string; unit: string } | null {
  const trimmed = text.trim()
  const match = trimmed.match(UNIT_PATTERN)
  if (!match) return null

  const value = match[1]
  const unit = match[2].toUpperCase()  // 统一大写用于查表
  return { value, unit }
}

/**
 * 将存储规格文本转换为目标语言的单位写法
 * @param text 原始文本，如 "128GB"、"256 MB/s"
 * @param targetLang 目标语言代码
 * @returns 转换后的文本，如法语 "128 Go"；如果不需要转换则返回原文本
 */
export function convertStorageUnit(text: string, targetLang: string): string {
  const match = matchStorageSpec(text)
  if (!match) return text

  const conversions = UNIT_CONVERSIONS[targetLang]
  if (!conversions) return text  // 该语言不需要转换

  const targetUnit = conversions[match.unit]
  if (!targetUnit) return text  // 该单位不需要转换

  // 法语/俄语/阿拉伯语在数字和单位之间加空格，其他语言不加
  const separator = ['fr', 'ru', 'ar'].includes(targetLang) ? ' ' : ''
  return match.value + separator + targetUnit
}