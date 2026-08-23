// ============================================================
// 电商平台违禁词检测器（纯函数，v11.12）
// ============================================================
//
// 职责：代码管形式——词表匹配/豁免剔除/边界判定全在这里；
// LLM 管语义——命中后的改写规避交给校对（见 llm-api proofreadBatch
// prohibitedFixMap 参数）。本文件无 mg 依赖，UI/主线程/测试三处共用。
//
// 判定规则（与 lib/prohibited-words.ts 数据约定一一对应）：
//   1. 拉丁/西里尔/越南语词条 → 词边界正则（i flag，无 g flag：
//      g flag 的 lastIndex 跨条状态污染会让"同语言连续两条"漏命中第二条——
//      经典坑，测试 B 有回归锁）
//   2. CJK/泰/阿拉伯词条 → 子串匹配（无词边界概念；阿拉伯词形变化需子串）
//   3. 符号词（100%/#1）→ 正则匹配 + 数字端 (?<!\d)/(?!\d)（防 1100%/256GB#12 误伤）
//   4. 复合词 → 空格弹性 \s+（"stress   test" 双空格也命中）
//   5. 中文检测先剔除 PROHIBITED_ZH_EXEMPTIONS 豁免短语再匹配
//      （"最佳实践"不命中"最佳"）
//      v11.15：豁免短语允许内部任意插入修饰字符（按字符级弹性 regex 剔除）——
//      "Recovery Tool 专业数据恢复软件" 品类描述由锚短语 'Recovery Tool 数据恢复'
//      覆盖，"专业/软件"等修饰词开在锚词中间不算开洞（锚词本身是 Lexar 专属
//      产品名，通用功效文案不携带）；其余条目（最佳实践/第一时间…）原文无插入
//      字符，弹性 regex 退化为精确子串剔除，语义不变。
//   6. 重叠命中取最长（"全网最低"吞并"最低"）——badge/note 只报最长的那个，
//      避免同一段文本报 3 个词刷屏稀释信任
//
// 维护：词表增删去 lib/prohibited-words.ts，本文件只改匹配机制。
// ============================================================

import {
  PROHIBITED_ZH_EXEMPTIONS,
  PROHIBITED_AVOID,
  ProhibitedWord,
} from './prohibited-words'
import { cleanKey } from './post-process'

export interface ProhibitedHit {
  word: string
  note: string
}

// ── 正则转义（词条为纯文本，构造时统一转义）──
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── 词条字符形态分类 ──
/** CJK/韩文/泰文/阿拉伯文：无词边界概念，子串匹配（compileEntry 唯一分支条件） */
const SUBSTRING_SCRIPT_RE = /[一-鿿぀-ヿ가-힯฀-๿؀-ۿ]/

/** 词条内空格弹性化：复合词中间任意空白都算命中 */
function flexSpace(escapedWord: string): string {
  return escapedWord.replace(/ /g, '\\s+')
}

interface CompiledEntry {
  word: string
  note: string
  /** 拉丁/西里尔词边界正则；纯符号词（100%/#1）走数字端边界（无 g flag）；子串类词条为 null */
  regex: RegExp | null
  /** 子串匹配小写形态（仅 CJK/泰/阿拉伯等无词边界概念的文字用，indexOf 直接用） */
  needle: string | null
}

function compileEntry(w: ProhibitedWord): CompiledEntry {
  const word = w.word
  // 唯一分支条件：含 CJK/韩/泰/阿拉伯字符 → 子串（无词边界概念）；
  // 否则（纯拉丁/西里尔、纯符号如 100%/#1、符号+数字混合如 %100）全走正则分支——
  // 词首/尾是字母用字母边界，是数字/符号用数字端 (?<!\d)/(?!\d) 防 1100%/256GB#12 误伤。
  // 历史 bug：分支条件带 LATIN_CYRILLIC_RE 前置，纯符号词永远进不了正则分支，
  // 「防 1100% 误伤」形同虚设（B34 回归锁抓出）。
  if (!SUBSTRING_SCRIPT_RE.test(word)) {
    const startsWithLetter = /^[A-Za-zÀ-ɏЀ-ӿ]/.test(word)
    const endsWithLetter = /[A-Za-zÀ-ɏЀ-ӿ]$/.test(word)
    const lookBehind = startsWithLetter ? '(?<![A-Za-zÀ-ɏЀ-ӿ])' : '(?<!\\d)'
    const lookAhead = endsWithLetter ? '(?![A-Za-zÀ-ɏЀ-ӿ])' : '(?!\\d)'
    return {
      word,
      note: w.note,
      regex: new RegExp(lookBehind + flexSpace(escapeRegExp(word)) + lookAhead, 'i'),
      needle: null,
    }
  }
  // CJK/韩/泰/阿拉伯：子串匹配（含「扩容U盘」这类 CJK+拉丁 混合词——SUBSTRING_SCRIPT_RE 命中即走这里）
  return { word, note: w.note, regex: null, needle: word.toLowerCase() }
}

// ── 编译缓存（词表静态不可变，幂等无污染）──
const compiledCache = new Map<string, CompiledEntry[]>()

function getCompiled(langCode: string): CompiledEntry[] {
  let c = compiledCache.get(langCode)
  if (c) return c
  const list = PROHIBITED_AVOID[langCode] || []
  c = list.map(compileEntry)
  compiledCache.set(langCode, c)
  return c
}

// ── 豁免短语编译缓存（v11.15：字符级弹性 regex，允许锚词内部插入修饰字符）──
// 'Recovery Tool 数据恢复' → 字符间 \W* —— "Recovery Tool 专业数据恢复软件"
// 的"专业/软件"开在锚词中间仍被剔除（中文修饰字是 \W）。对无内部插入字符的
// 条目（最佳实践等），\W* 全匹配空串 → 行为与 includes 精确剔除完全一致
// （B 段回归锁）。字母/数字是 \w 不在 \W 内 → 不会被吞，放宽有界。
const exemptionCache = new Map<string, RegExp>()

function getExemptionRegex(ex: string): RegExp {
  let re = exemptionCache.get(ex)
  if (re) return re
  // 字符间 \W*：吞空格+中文修饰字（"专业/软件"开在锚词中间仍可剔除），
  // 挡字母/数字（\w 不在 \W 内）防过度放宽。短语内字面空格亦转为 \W*。
  // 纯中文相邻条目（最佳实践/第一时间…）\W* 恒匹配空串 → 与 includes 剔除语义一致。
  // split('') 而非展开运算符：豁免表全是 BMP 字符，无代理对风险
  re = new RegExp(ex.split('').map(ch => ch === ' ' ? '\\W*' : escapeRegExp(ch)).join('\\W*'), 'i')
  exemptionCache.set(ex, re)
  return re
}

/**
 * 检测文本中目标语言的平台违禁词。
 * @returns 命中词列表（重叠取最长后），未命中返回空数组
 */
export function detectProhibited(text: string, langCode: string): ProhibitedHit[] {
  if (!text) return []
  let t = text
  // zh 系：先剔除豁免短语（含繁体形态），再匹配
  if (langCode === 'zh' || langCode === 'zh-CN' || langCode === 'zh-TW') {
    for (const ex of PROHIBITED_ZH_EXEMPTIONS) {
      const re = getExemptionRegex(ex)
      if (re.test(t)) t = t.replace(re, ' ')
    }
  }
  const entries = getCompiled(langCode === 'zh' ? 'zh-CN' : langCode)
  if (entries.length === 0) return []
  const lower = t.toLowerCase()
  const hits: Array<{ word: string; note: string; index: number; length: number }> = []
  for (const e of entries) {
    if (e.regex) {
      const m = e.regex.exec(t)
      if (m) hits.push({ word: e.word, note: e.note, index: m.index, length: m[0].length })
    } else if (e.needle) {
      const idx = lower.indexOf(e.needle)
      if (idx >= 0) hits.push({ word: e.word, note: e.note, index: idx, length: e.needle.length })
    }
  }
  // 重叠取最长：被更长命中区间完全覆盖的命中丢弃
  const filtered = hits.filter(h =>
    !hits.some(o => o !== h && o.length > h.length && o.index <= h.index && h.index + h.length <= o.index + o.length)
  )
  return filtered.map(h => ({ word: h.word, note: h.note }))
}

/** 便捷布尔版 */
export function hasProhibited(text: string, langCode: string): boolean {
  return detectProhibited(text, langCode).length > 0
}

/**
 * 源文语言快速判定（违禁词词表选择专用）。
 *
 * 不复用 detectSourceLanguage（lib/lang-detect.ts）的原因：后者按
 * "cjkChars > latinChars" 一票制，"中文+英文型号"混排文案（Lexar SL500/
 * PCIe 4.0 噪声字符数超过汉字）会被判成 en → 京东词表分支静默失效，
 * 而这是中文源文的主场景不是边角案例。
 *
 * 规则：含 CJK 统一汉字 → 'zh'（优先）；含拉丁字母 → 'en'；否则 null（不检测）。
 * 纯规格文本（"2050MB/s"/"512GB"）：含字母会判 'en'——可接受的设计：en 词表经
 * 词边界防护后对纯规格零误伤（no speed drop 前后数字守卫、test 词边界），
 * 检测开销可忽略，换来规则无例外（不为边角形态加"字母必须成词"的复杂判定）。
 */
export function detectSourceLangForProhibited(text: string): 'zh' | 'en' | null {
  if (!text) return null
  if (/[一-鿿]/.test(text)) return 'zh'
  if (/[A-Za-z]/.test(text)) return 'en'
  return null
}

/** 供测试/调试：当前已编译缓存的语言数 */
export function _prohibitedCacheSize(): number {
  return compiledCache.size
}

/**
 * v11.12+: 术语库整条命中判定（违禁词修正豁免用）。
 *
 * 背景（用户拍板 2026-08-14）：术语库是最高优先级。源文整条命中术语库时，
 * 其译文是官方钦定值——即使含违禁词（如"有限终身质保"），也只做提示、不做
 * 自动改写，避免与翻译/校对管道的"术语合规锁定"打架（改写→锁回→死锁）。
 *
 * 判定口径与翻译/校对锁定侧完全一致：cleanKey 归一化（去®™©/大小写/空白不敏感）
 * 后查 normalizedGlossaryMap。豁免的前提是"译文就是术语库钦定值"——调用方传入的
 * translatedText 需与锁定值相等才豁免（防"源文命中术语库但译文是自由发挥"误豁免）。
 *
 * @returns true = 源文整条命中术语库且译文等于钦定值 → 违禁词只提示不改写
 */
export function isGlossaryLockedTranslation(
  sourceText: string,
  translatedText: string,
  normalizedGlossaryMap: Map<string, string> | undefined,
): boolean {
  if (!normalizedGlossaryMap || !sourceText || !translatedText) return false
  const expected = normalizedGlossaryMap.get(cleanKey(sourceText))
  if (!expected) return false
  return translatedText === expected
}
