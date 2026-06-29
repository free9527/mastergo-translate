/**
 * 自动字体映射（目标语言驱动）
 *
 * 检测到四个品牌字体时，统一替换为目标语言的标准字体。
 * 字重/字间距/行距等属性全部继承原文。
 * 仅当 item.targetFontFamily 为空时才自动填充（用户手动覆盖优先）。
 * 不在四个字体范围内的字体保持不动。
 *
 * 规则（目标语言 → 标准字体）：
 *   zh-CN / ja / ko / th / vi / id → HarmonyOS Sans SC
 *   zh-TW                          → HarmonyOS Sans TC
 *   拉丁 / 西里尔                    → Avenir
 *   ar                             → HarmonyOS Sans Naskh Arabic + RIGHT对齐
 */

const SPECIAL_FONTS = new Set([
  'HarmonyOS Sans SC',
  'HarmonyOS Sans TC',
  'Avenir',
  'HarmonyOS Sans Naskh Arabic',
])

const HANS_SC_TARGETS = new Set(['zh-CN', 'ja', 'ko', 'th', 'vi', 'id'])

const LATIN_TARGETS = new Set([
  'en', 'fr', 'de', 'es', 'pt', 'pt-BR', 'it', 'nl', 'pl', 'sv', 'tr', 'ru',
])

export interface AutoFontResult {
  targetFamily: string
  targetTextAlign?: string
}

/**
 * 根据目标语言返回应使用的标准字体。
 * 返回 null 表示目标语言不在规则范围内（理论上不会，但做兜底）。
 */
function getCanonicalFont(targetLang: string): AutoFontResult | null {
  // CJK / 东南亚 → HarmonyOS Sans SC
  if (HANS_SC_TARGETS.has(targetLang)) {
    return { targetFamily: 'HarmonyOS Sans SC' }
  }
  // 繁体中文 → HarmonyOS Sans TC
  if (targetLang === 'zh-TW') {
    return { targetFamily: 'HarmonyOS Sans TC' }
  }
  // 拉丁 / 西里尔 → Avenir
  if (LATIN_TARGETS.has(targetLang)) {
    return { targetFamily: 'Avenir' }
  }
  // 阿拉伯语 → HarmonyOS Sans Naskh Arabic + 右对齐
  if (targetLang === 'ar') {
    return { targetFamily: 'HarmonyOS Sans Naskh Arabic', targetTextAlign: 'RIGHT' }
  }
  return null
}

/**
 * 根据源字体和目标语言，返回应替换的目标字体。
 * 仅当源字体是四个品牌字体之一时触发，否则返回 null（保持原样）。
 */
export function getAutoFontMapping(
  sourceFamily: string,
  targetLang: string,
): AutoFontResult | null {
  if (!SPECIAL_FONTS.has(sourceFamily)) return null
  return getCanonicalFont(targetLang)
}
