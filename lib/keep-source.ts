/**
 * keep-source.ts — 豁免中央注册表（v10.0 架构复盘优化 #2）
 *
 * 背景（arch-review-2026-07）："这段文本不用翻译/不算漏翻"的豁免规则曾散在
 * 多处互不可见（isUntranslatable 各处调用 / v9.3 同语系豁免 / v9.11 F3b 拉丁豁免 /
 * UI computeUntranslatedBadge 自抄一份 isSameScriptLanguagePair），修一个误判
 * （放宽）就在别处制造漏翻（过度豁免）——v8.7→v9.3→v9.5→F3b 跷跷板四轮。
 *
 * 本模块收口全部"豁免"判定：每条规则注册于此、附注释说明防的是哪个历史 bug。
 * 改豁免只动这里。判断入口：
 *
 *   shouldKeepSource(src, ctx)       — 翻译/漏翻检测场景：源文是否应原样保留（豁免翻译）
 *   isSameLanguageExempt(src, ctx)   — 同语言校验豁免：译文==源文是否因"本就同语言"而不算漏翻
 *
 * 注意边界：本模块只管"代码确定性豁免"。模糊边界（跨语言同形词是否恰好是正确译文）
 * 仍归校对 LLM CHECK 3 语义裁决——代码不抢 LLM 的活，反之亦然。
 */

import { isUntranslatable } from '@lib/llm-api'
import { detectLatinLang, detectSourceLanguage, isSameScriptLanguagePair } from '@lib/lang-detect'

/**
 * 同语系变体对（zh 简繁 / pt 欧巴葡）——直接 re-export lang-detect 的单一实现。
 * 历史上 UI computeUntranslatedBadge 自抄过一份（test-ui-badge-same-lang.ts 也抄了），
 * 现统一从这里取，新调用方不要再自己实现。
 */
export { isSameScriptLanguagePair }

/** 豁免判定上下文 */
export interface KeepSourceContext {
  targetLang: string
  /** v9.10: EN 视图术语库（isUntranslatable 豁免只认 EN，防全语言视图误判豁免 R5） */
  glossaryEnMap?: Map<string, string>
  /** 批次全部源文（同语言豁免的批次级复核需要；缺省按单条处理） */
  batchSources?: string[]
}

/** 拉丁目标语言白名单 — F3b 守卫 1 的共用定义（见下） */
const LATIN_TARGET_LANGS = new Set(['en', 'pt', 'pt-BR', 'es', 'de', 'fr', 'it', 'nl', 'pl', 'sv', 'tr', 'id', 'vi'])

/**
 * 翻译/漏翻检测场景的"保留原文"豁免。
 * true = 该源文本就不该翻（或无法判断是否该翻），译文==源文不算漏翻。
 *
 * 当前注册的规则：
 *  1. isUntranslatable — 纯标点/单字符/品牌/数字单位/技术缩写/产品型号/术语库同形
 *     （v8.7 单复数豁免、v9.10 R5 EN 视图、v9.5 F10 单字符边界……全部内聚在那一个函数里）
 *
 * 为什么同语言豁免不在这里：它依赖 targetLang 且是"译文==源文"场景的专属判定，
 * 走 isSameLanguageExempt，避免两个入口互相嵌套产生新的口径分裂。
 */
export function shouldKeepSource(src: string, ctx: KeepSourceContext): boolean {
  return isUntranslatable(src, ctx.glossaryEnMap)
}

/**
 * 同语言校验豁免（F3b，2026-07-31 定版三重守卫）。
 * 场景：de→de、pt-BR→pt-BR 等"翻译/校对工作流但源==目标语言"时，译文==源文是
 * 正确结果，不算漏翻。
 *
 * 三重守卫（防三重回退误判，v9.5 B4/C7/D4 回归防线）：
 *  1. 仅拉丁目标语言白名单 — zh/ja/ko 的 detectSourceLanguage 是字符集粗类
 *     （zh-TW 报 zh-CN），若豁免会让 zh-TW→zh-CN 未转换（真漏翻）逃逸
 *  2. 逐条 detectLatinLang(src) === targetLang — 混杂批次（de 混 en）中
 *     en 条目 srcLang≠target 不误豁免（v9.5 D4）
 *  3. 批次级复核 detectSourceLanguage(batch) === targetLang — 单条弱信号
 *     （如 "Hohe Geschwindigkeit" 仅 1 个功能词）detectLatinLang 回退 null/en，
 *     但整批确为 de 时仍豁免（v9.11 D1）；反之单条碰巧同语言但整批不是时不豁免
 */
export function isSameLanguageExempt(src: string, ctx: KeepSourceContext): boolean {
  if (!LATIN_TARGET_LANGS.has(ctx.targetLang)) return false
  if (detectLatinLang(src) !== ctx.targetLang) return false
  const batch = ctx.batchSources && ctx.batchSources.length > 0 ? ctx.batchSources : [src]
  return detectSourceLanguage(batch) === ctx.targetLang
}
