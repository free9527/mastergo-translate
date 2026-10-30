/**
 * human-corpus-loader.ts — 人工钦定语料库加载（v12.43）
 *
 * 职责：把内联语料库（human-corpus-data.ts，源文 × 多语种人工钦定对照）
 *   转为 TranslationCorrection[]（origin='user'，最高优先级人工验收源），
 *   供 TM 短路（retrieveTMShortCircuit）/ TM few-shot（retrieveTM）消费——
 *   人工钦定译文仅同源句顺序精确匹配时直接落地或作为 few-shot 范例（≥0.90）。
 *
 * 为什么是行业标准第一杠杆（TextUnited/Smartling 实锤）：
 *   「The real operational value is not generated language. It is reusable approved language.」
 *   人工钦定 > LLM 润色——质量天花板是人工翻译，喂回 TM 让管道「越用越聪明」。
 *
 * 安全闸（与 retrieveTMShortCircuit 既有防线完全对齐）：
 *   ⛔ origin='user' 单源——人工钦定与用户手动验收同级（都是人工背书的质量锚点）
 *   ⛔ 直接落地要求同源句顺序精确匹配；相似句仅作参考
 *   ⛔ targetLang 严格相等
 *   ⛔ 调用方负责【术语过期防线】：落地前过 enforceGlossaryTerms（App.vue:2010 既有）
 *   ⛔ v12.58 数字守卫（HANDOFF 264 行 TODO 落地）：源文/译文数字多重集须相等。
 *     生成端（gen-corpus-inline.ts）已拦一道，此处是运行时第二道——防将来手改内联数据。
 *     笔误钦定比没有钦定更危险（Lexar→Lexware 事故同型防御）。
 *
 * 数据源：lib/human-corpus-data.ts（自动生成，勿手改——生成脚本 claude-tmp/gen-corpus-inline.ts）。
 *   内联为 TS 常量而非运行时读 CSV（lib 无 fs 权限——与 default-glossary.ts 同款模式）。
 */

import { TranslationCorrection } from '@messages/types'
import { HUMAN_CORPUS } from './human-corpus-data'

/**
 * 加载人工钦定语料库 → TranslationCorrection[]。
 * @returns TranslationCorrection[]（origin='user'；语料库为空时返回空数组——降级不阻塞）
 */
export function loadHumanCorpus(): TranslationCorrection[] {
  const now = Date.now()
  return HUMAN_CORPUS
    .filter(e => isBrandConsistent(e.source, e.translation) && isNumberConsistent(e.source, e.translation))
    .map(e => ({
      source: e.source,
      targetLang: e.targetLang,
      originalTranslation: e.translation,
      correctedTranslation: e.translation,
      correctedAt: now,
      origin: 'user',
      suppressAutoGlossary: true,  // 语料库条目不触发自动入库建议（量大，与用户单条修正性质不同）
    }))
}

/**
 * v12.52: 品牌词完整性校验——source 含 Lexar 品牌词根时，translation 必须同样含
 *   品牌词根 "Lexar"（子串、大小写不敏感），否则该条不灌入。
 * 根因（2026-09-30 实机翻译出错）：源 CSV de 列把 Lexar 拼成 Lexware（德语笔误），
 *   source 完整（含 Lexar）→ tmSimilarity=1.0 触发 TM 短路 → Lexware 直接落地画布，
 *   绕过 LLM 与校对。品牌词是形式信号（字符集合包含），代码可验证——代码管形式。
 * 为什么是「子串 Lexar」而非「\bLexar\b」：译文里的品牌合法形态多样
 *   （Lexars 所有格、LexarApp 复合名、Lexar® 带符号），都要保留；而 Lexware 这类
 *   错词在 "Lexar" 中间插了 'w'，子串匹配天然不命中。副作用：CJK 译文里整段
 *   "Lexar R…" 叙事型源文被截断成纯中文（源 CSV 历史截断产物）也会被过滤——
 *   属「宁漏勿滥」，错杀的是本就残缺的叙事段，不影响安全。
 */
function isBrandConsistent(source: string, translation: string): boolean {
  if (/Lexar/i.test(source) && !/Lexar/i.test(translation)) return false
  return true
}

/**
 * v12.58: 数字一致性校验（HANDOFF 264 行 TODO 落地）——NFKC 归一后源文/译文数字多重集相等。
 *   源文数字被改写/丢弃的「叙事段」（如 37X / 10N 整段落 marketing copy）绝不短路落地、
 *   也不作 few-shot 范例——否则短路把「丢数字」贴画布、few-shot 教 LLM 丢数字，两头毒。
 * NFKC 归一兼容：日文全角数字「２倍」→「2倍」、葡语小数逗号「2,5」→ 仍匹配、不误杀本地化。
 * 与 translation-memory.numberSetKey 语义一致（有重复、跨全角/半角）。
 */
function isNumberConsistent(source: string, translation: string): boolean {
  return numberSetKey(source) === numberSetKey(translation)
}

function numberSetKey(text: string): string {
  const norm = text.normalize('NFKC')
  return (norm.match(/\d+(?:[.,]\d+)?/g) || []).sort().join(',')
}
