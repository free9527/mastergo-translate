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
  const result = getCanonicalFont(targetLang)
  if (!result) return null

  // 互译闭环：原文字体与替换字体相同，且无额外属性需改变 → 跳过不替换
  // 例如：Avenir 原文 + en/fr/de 目标语言 → Avenir，无需替换
  // 例如：HarmonyOS Sans SC 原文 + zh-CN/ja 目标语言 → HarmonyOS Sans SC，无需替换
  // 例外：ar 目标语言即使源字体是 Naskh Arabic，仍需返回对齐属性
  if (sourceFamily === result.targetFamily && !result.targetTextAlign) {
    return null
  }

  return result
}

/**
 * v12.22: Avenir → HarmonyOS Sans 字重名映射（单一事实源，ui/App.vue 与 lib/main.ts 共用）。
 *
 * 背景：HarmonyOS Sans 全家族（SC/TC/Naskh Arabic）字重表统一为
 *   Thin / Light / Regular / Bold / Black —— 无 Medium、无任何斜体。
 * 旧表只有 5 条且含 'Light Italic'/'Bold Italic' 两个 HarmonyOS 不存在的字重，
 * 表外字重（Book/Medium/Light/Oblique/Black…）又原样透传 ——
 * setRangeFontName 拿到不存在的 style 抛异常、被 catch 静默吞掉，
 * 整条文本保持 Avenir 不换（用户看到的「® 没换字体」实际是整条没换成）。
 *
 * 规则：
 *   - 所有映射值必须 ∈ {Thin, Light, Regular, Bold, Black}（HarmonyOS 真实字重表）
 *   - 斜体（Oblique/Italic）一律降级到对应正体（用户拍板方案 A：保字重，丢斜体）
 *   - 表外/未识别字重兜底 Regular —— 保证 setRangeFontName 永不因 style 不存在抛异常
 */
const AVENIR_TO_HARMONYOS_STYLE: Record<string, string> = {
  'Thin': 'Thin',
  'Thin Italic': 'Thin',
  'Thin Oblique': 'Thin',
  'Extra Light': 'Light',
  'Extra Light Italic': 'Light',
  'Extra Light Oblique': 'Light',
  'Light': 'Light',
  'Light Italic': 'Light',
  'Light Oblique': 'Light',
  'Roman': 'Regular',
  'Book': 'Regular',
  'Regular': 'Regular',
  'Italic': 'Regular',
  'Oblique': 'Regular',
  'Medium': 'Regular',
  'Medium Italic': 'Regular',
  'Medium Oblique': 'Regular',
  'Heavy': 'Bold',
  'Heavy Italic': 'Bold',
  'Heavy Oblique': 'Bold',
  'Bold': 'Bold',
  'Bold Italic': 'Bold',
  'Bold Oblique': 'Bold',
  'Black': 'Black',
  'Black Italic': 'Black',
  'Black Oblique': 'Black',
}

/** HarmonyOS Sans 全家族统一的真实字重表（用于兜底校验） */
const HARMONYOS_STYLES = new Set(['Thin', 'Light', 'Regular', 'Bold', 'Black'])

/**
 * 将源字体 style name 映射为 HarmonyOS Sans 支持的 style name。
 * 仅在 Avenir → HarmonyOS Sans（SC/TC/Naskh Arabic）时做映射，其余原样返回。
 * 兜底：任何映射结果若不在 HarmonyOS 字重表内，强制降为 Regular（防抛异常）。
 */
export function normalizeFontStyle(sourceFamily: string, sourceStyle: string, targetFamily: string): string {
  const raw = sourceStyle || 'Regular'
  const isHarmonyOS =
    targetFamily === 'HarmonyOS Sans SC' ||
    targetFamily === 'HarmonyOS Sans TC' ||
    targetFamily === 'HarmonyOS Sans Naskh Arabic'
  if (sourceFamily === 'Avenir' && isHarmonyOS) {
    const mapped = AVENIR_TO_HARMONYOS_STYLE[raw] || 'Regular'
    return HARMONYOS_STYLES.has(mapped) ? mapped : 'Regular'
  }
  return raw
}
