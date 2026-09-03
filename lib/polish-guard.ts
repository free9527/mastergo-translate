// ═══════════════════════════════════════════════════════════════
// 模块: polish-guard — 润色资格负面清单 + 硬锁校验（v12.3 人设驱动判定→润色→硬锁）
// ═══════════════════════════════════════════════════════════════
// 职责: 润色管道的代码层守卫——进 LLM 前的资格过滤 + 出 LLM 后的事实硬锁。
//       无人值守铁律：语义判断必须可形式化，代码管形式，LLM 管语义。
// 纪律:
//   ⛔ 误杀无妨（回退=没润色），漏放不行（=物料事故）
//   ⛔ 资格负面清单只收形式信号可判的条目（合规/术语库锁定/不可翻译/极短/含↵）
//   ⛔ 硬锁校验失败 → 整条回退润色前译文，静默不惊动用户（v10.6 同款哲学）
// ═══════════════════════════════════════════════════════════════

import { validateNumbers, enforceGlossaryTerms, hasTrademarkSpam } from '@lib/post-process'
import { shouldKeepSource } from '@lib/keep-source'
import { isGlossaryLockedTranslation, detectProhibited } from '@lib/prohibited-check'

// ───────────────────────────────────────────────────────────────
// 语义断行切分（v12.12，判定方式五条之③断行二分——用户拍板 2026-09-03）
// ───────────────────────────────────────────────────────────────
// 规则（用户定义）：**语义断行**（句间/段落/bullet 列表——↵ 两侧各自完整）保留；
//   **句中断行**（排版换行——一句话被视觉宽度劈开）拍平为空格。
// 形式判定信号（↵ 左段）：
//   · 以终结标点结尾 → 语义断行（一句话说完了）
//   · ≤5 词（标题/bullet 形态）→ 语义断行
//   · 否则 → 句中断行，拍平
// 终结标点表覆盖 20 语种：拉丁 .!?;: + CJK 。！？；：… + 阿拉伯 ؟ + 省略号 …
// 泰文兜底：无终结标点概念且空格分词不可靠 → 左段字符数 ≤20 视作标题形态
// ───────────────────────────────────────────────────────────────

/** 句末终结标点（20 语种覆盖——拉丁/CJK/阿拉伯/省略号） */
const SEGMENT_END_RE = /[.!?;:。！？；：…؟][)"'”’»」』]*$/

/**
 * 语义断行切分：把多行格按「语义断行」切成段，句中断行拍平。
 * 返回段数组（段内无 ↵）。单段文本（无断行/全部句中断行）返回单元素数组。
 * 润色按段调度（LLM 物理上碰不到 ↵，结构锁从校验升级为构造保证）；
 * 资格判定（polishExemptReason）共用同一切段口径——单一事实源永不漂移。
 *
 * @param mode 'strict'（默认，源文用）：↵ 左段终结标点或 ≤5 词（标题/bullet）→ 段边界
 *             'lenient'（译文用）：在 strict 基础上额外放宽——左段 ≤8 词也认段边界。
 *             理由（v12.12 实锤）：译文语言可能无终结标点习惯（tr 标题 Bir Üst Seviye için
 *             4 词无标点 OK；但 seviyeye taşıyın 2 词实为句中断行被译文语言形态误判）。
 *             放宽只发生在译文侧——段切多了无妨（各段独立润色+独立硬锁+拼回原位），
 *             段切少了会把「源文语义断行 vs 译文句中断行」的对位关系搞丢（段数不等整格不润）。
 */
export function splitSemanticSegments(text: string, mode: 'strict' | 'lenient' = 'strict'): string[] {
  if (!text || (!text.includes('↵') && !text.includes('\n'))) return text ? [text] : []
  const rawSegs = text.split(/[↵\n]+/).map(s => s.trim()).filter(Boolean)
  const wordCap = mode === 'lenient' ? 8 : 5
  const segs: string[] = []
  for (const raw of rawSegs) {
    if (segs.length === 0) { segs.push(raw); continue }
    const prev = segs[segs.length - 1]
    const prevWords = prev.split(/\s+/).filter(Boolean).length
    // 语义断行判定：左段终结标点结尾 或 ≤wordCap 词（标题/bullet）或 ≤20 字符（泰文形态）
    const isSemanticBreak = SEGMENT_END_RE.test(prev) || prevWords <= wordCap || prev.length <= 20
    if (isSemanticBreak) {
      segs.push(raw)
    } else {
      // 句中断行 → 拍平（与前段合并，中间单空格）
      segs[segs.length - 1] = prev + ' ' + raw
    }
  }
  return segs
}

/** ™®© 剥离（判定/润色 LLM 输入用——proofTmStripped 范式；格式噪音不进语义判定层） */
export const stripTmSymbols = (t: string): string => t.replace(/[™®©]/g, '')

// ───────────────────────────────────────────────────────────────
// 资格负面清单（进 LLM 前，代码过滤——这些条目根本不给 LLM 碰）
// ───────────────────────────────────────────────────────────────

/** 合规关键词表——法律/合规声明润色权为零（六维之六逐字对应）
 *  v12.10 导出：best-of-2 择优资格判定复用同一表（单一事实源） */
export const COMPLIANCE_KEYWORDS = [
  'warranty', 'guarantee', 'liability', 'disclaimer', 'certification', 'certified',
  'compliance', 'regulation', 'fcc', 'ce mark', 'rohs', 'reach', 'ul listed',
  'limited lifetime warranty', 'lifetime warranty', 'guaranteed',
]

/** 润色豁免原因（v12.10 豁免计数细分用——日志可观测性） */
export type PolishExemptReason =
  | 'arrow'           // ↵ 多行格整格豁免（段数不等/段内不合规）
  | 'empty'           // 空文本
  | 'short'           // 极短（≤3 词/全极短段）
  | 'compliance'      // 合规关键词
  | 'glossary-locked' // 术语库整条命中
  | 'keep-source'     // 不可翻译（纯规格行/型号列表/裸单位）

/**
 * 润色豁免原因透出（isPolishEligible 的姊妹函数——同一条判定链，单一事实源）。
 * v12.10: 实机日志发现豁免计数「其他 N」黑盒无法复盘，透出原因供日志细分。
 * @returns null = eligible（允许润色）；否则返回豁免原因
 */
export function polishExemptReason(
  source: string,
  translated: string,
  targetLang: string,
  normalizedGlossaryMap?: Map<string, string>,
): PolishExemptReason | null {
  const srcHasBreak = source.includes('↵') || source.includes('\n')
  const transHasBreak = translated.includes('↵') || translated.includes('\n')
  if (srcHasBreak || transHasBreak) {
    // v12.12: 切段口径收编为 splitSemanticSegments（单一事实源）——
    //   语义断行切分（句中断行已拍平），资格与润色按段判定永不漂移
    const srcSegs = splitSemanticSegments(source)
    const transSegs = splitSemanticSegments(translated)
    if (srcSegs.length !== transSegs.length) return 'arrow'
    const segEligibility: boolean[] = []
    for (let i = 0; i < srcSegs.length; i++) {
      const segSrc = srcSegs[i]
      const segTrans = transSegs[i]
      if (!segSrc || !segTrans) return 'arrow'
      const segSrcLower = segSrc.toLowerCase()
      if (COMPLIANCE_KEYWORDS.some(kw => segSrcLower.includes(kw))) return 'compliance'
      if (isGlossaryLockedTranslation(segSrc, segTrans, normalizedGlossaryMap)) return 'glossary-locked'
      if (shouldKeepSource(segSrc, { targetLang })) return 'keep-source'
      const segWordCount = segSrc.split(/\s+/).filter(Boolean).length
      segEligibility.push(segWordCount > 3)
    }
    if (!segEligibility.some(Boolean)) return 'short'
    return null
  }

  const src = source.trim()
  const trans = translated.trim()
  if (!src || !trans) return 'empty'

  const wordCount = src.split(/\s+/).filter(Boolean).length
  if (wordCount <= 3) return 'short'

  const srcLower = src.toLowerCase()
  if (COMPLIANCE_KEYWORDS.some(kw => srcLower.includes(kw))) return 'compliance'

  if (isGlossaryLockedTranslation(src, trans, normalizedGlossaryMap)) return 'glossary-locked'

  if (shouldKeepSource(src, { targetLang })) return 'keep-source'

  return null
}

/**
 * 润色资格判定（资格负面清单，全部形式信号可判）。
 * @param source 源文
 * @param translated 译文
 * @param targetLang 目标语言
 * @param normalizedGlossaryMap 术语库归一化 map（可选，isGlossaryLockedTranslation 用）
 * @returns true = 允许润色；false = 豁免（负面清单命中）
 */
export function isPolishEligible(
  source: string,
  translated: string,
  targetLang: string,
  normalizedGlossaryMap?: Map<string, string>,
): boolean {
  // v12.10: 判定链收编为 polishExemptReason 委托（单一事实源——
  //   豁免原因透出与资格判定永不漂移；本函数的判定注释见 polishExemptReason）。
  return polishExemptReason(source, translated, targetLang, normalizedGlossaryMap) === null
}

// ───────────────────────────────────────────────────────────────
// 否定极性/限定词词表（de/es/ru/tr 四语种最小集，从实机源文反向提取）
// v12.6: + ja（ja 判定 prompts 会处理直译/文体，限定词丢失仍走本表一票否决）
// ───────────────────────────────────────────────────────────────
// 词表完备性论证：词表只覆盖"源文实际出现的"否定/限定词型，不追求全覆盖——
//   源文没有的词型润色时不会触发该校验，天然无风险。
// 实机源文（PLAY PRO + NM1090 PRO）出现的限定词：
//   up to（11 次）/ maximum（1）/ theoretical（1）/ compatible with（2）/ under（1）
//   否定词：无（0 次）——但词表保留否定词框架，未来源文出现时扩充
// ───────────────────────────────────────────────────────────────

interface PolarityEntry {
  /** 源文限定词/否定词（英文，小写匹配） */
  source: string
  /** 目标语言必须包含的对应表达（该语种译文里必须出现至少一个） */
  required: string[]
  /** 类型标注（报告用） */
  type: 'hedge' | 'negation'
}

const POLARITY_TABLE: Record<string, PolarityEntry[]> = {
  de: [
    { source: 'up to', required: ['bis zu', 'maximal', 'bis'], type: 'hedge' },
    { source: 'maximum', required: ['maximal', 'höchstens', 'bis zu'], type: 'hedge' },
    { source: 'theoretical', required: ['theoretisch'], type: 'hedge' },
    { source: 'compatible with', required: ['kompatibel', 'abwärtskompatibel'], type: 'hedge' },
    { source: 'under', required: ['unter', 'weniger als'], type: 'hedge' },
  ],
  es: [
    { source: 'up to', required: ['hasta', 'máximo', 'como máximo'], type: 'hedge' },
    { source: 'maximum', required: ['máximo', 'como máximo', 'hasta'], type: 'hedge' },
    { source: 'theoretical', required: ['teórico', 'teórica'], type: 'hedge' },
    { source: 'compatible with', required: ['compatible', 'retrocompatible'], type: 'hedge' },
    { source: 'under', required: ['menos de', 'bajo', 'inferior a'], type: 'hedge' },
  ],
  ru: [
    { source: 'up to', required: ['до', 'максимум', 'не более'], type: 'hedge' },
    { source: 'maximum', required: ['максимум', 'не более', 'до'], type: 'hedge' },
    { source: 'theoretical', required: ['теоретический', 'теоретическая', 'теоретическое'], type: 'hedge' },
    { source: 'compatible with', required: ['совместим', 'обратно совместим'], type: 'hedge' },
    { source: 'under', required: ['менее', 'до', 'не более'], type: 'hedge' },
  ],
  tr: [
    { source: 'up to', required: ['kadar', "'ye kadar", "'a kadar", 'maksimum'], type: 'hedge' },
    { source: 'maximum', required: ['maksimum', 'en fazla', 'kadar'], type: 'hedge' },
    { source: 'theoretical', required: ['teorik'], type: 'hedge' },
    { source: 'compatible with', required: ['uyumlu', 'geriye dönük uyumlu'], type: 'hedge' },
    { source: 'under', required: ['altında', 'den az', 'kadar'], type: 'hedge' },
  ],
  ja: [
    { source: 'up to', required: ['最大', 'まで', '最高'], type: 'hedge' },
    { source: 'maximum', required: ['最大', '上限'], type: 'hedge' },
    { source: 'theoretical', required: ['理論'], type: 'hedge' },
    { source: 'compatible with', required: ['互換'], type: 'hedge' },
    { source: 'under', required: ['以下', '未満'], type: 'hedge' },
  ],
  // v12.7: zh-TW 限定词表（繁体中文，从实机源文反向提取——与 zh-CN 共用英文源文词型，
  //   但 required 是繁体形态；简繁共用词型时 zh-CN 优先，zh-TW 只补繁体特有形态）
  'zh-TW': [
    { source: 'up to', required: ['最高', '高達', '最多', '達'], type: 'hedge' },
    { source: 'maximum', required: ['最大', '上限', '最高'], type: 'hedge' },
    { source: 'theoretical', required: ['理論'], type: 'hedge' },
    { source: 'compatible with', required: ['相容', '兼容'], type: 'hedge' },
    { source: 'under', required: ['以下', '低於'], type: 'hedge' },
  ],
}

/**
 * 否定极性/限定词一票否决校验。
 * 源文含限定词/否定词时，润色产出必须含对应表达——丢失即回退。
 * @param source 源文
 * @param polished 润色后译文
 * @param targetLang 目标语言
 * @returns true = 违反（限定词/否定丢失，应回退）；false = 通过
 */
export function detectPolarityBreach(source: string, polished: string, targetLang: string): boolean {
  const entries = POLARITY_TABLE[targetLang]
  if (!entries) return false  // 词表未覆盖的语种不做该校验（灰度纪律）

  const srcLower = source.toLowerCase()
  const polishedLower = polished.toLowerCase()

  for (const entry of entries) {
    if (!srcLower.includes(entry.source)) continue  // 源文不含该限定词，跳过
    // 源文含该限定词 → 润色产出必须含至少一个对应表达
    const hasRequired = entry.required.some(r => polishedLower.includes(r.toLowerCase()))
    if (!hasRequired) return true  // 限定词丢失 → 违反
  }
  return false
}

// ───────────────────────────────────────────────────────────────
// 硬锁校验（出 LLM 后，四层校验——任何一层失败整条回退）
// ───────────────────────────────────────────────────────────────

export interface PolishValidationResult {
  ok: boolean
  reason?: string  // 失败原因（报告/日志用）
}

/**
 * 润色产出硬锁校验：数字/术语/极性/单位/违禁词八层。
 * @param source 源文
 * @param polished 润色后译文
 * @param targetLang 目标语言
 * @param glossaryMap 术语库 map（enforceGlossaryTerms 用）
 * @param prePolish 润色前译文（第⑧层违禁词对比基线——润色前本就含违禁词的条目不因润色背锅）
 * @returns ok=false 时应回退润色前译文
 */
export function validatePolishOutput(
  source: string,
  polished: string,
  targetLang: string,
  glossaryMap?: Map<string, string>,
  prePolish?: string,
): PolishValidationResult {
  // ① 数字校验（validateNumbers 复跑——源文数字集合 ⊆ 译文）
  const numResult = validateNumbers([source], [polished])
  if (numResult.mismatchedIndices.size > 0) {
    return { ok: false, reason: '数字不一致（validateNumbers）' }
  }

  // ② 术语库值校验（enforceGlossaryTerms 复跑——润色不得篡改术语库值）
  if (glossaryMap && glossaryMap.size > 0) {
    const enforced = enforceGlossaryTerms([source], [polished], glossaryMap, new Set())
    if (enforced[0] !== polished) {
      return { ok: false, reason: '术语库值被润色篡改（enforceGlossaryTerms）' }
    }
  }

  // ③ 否定极性/限定词校验（一票否决）
  if (detectPolarityBreach(source, polished, targetLang)) {
    return { ok: false, reason: '限定词/否定极性丢失（detectPolarityBreach）' }
  }

  // ④ 单位保留校验（validateNumbers 的补充——数字后的单位字符串必须在译文中出现）
  //    防 "900MB/s" 润成 "900"（数字对了但单位丢了，validateNumbers 检不出——它只提带单位数字，
  //    译文无单位时提取为空导致数量不等能检出，但 "900MB/s"→"900 GB" 数值相等会漏放）
  const unitPattern = /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|MB\/s|GB\/s|TB\/s|MHz|GHz|mGy)/gi
  const srcUnits = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(unitPattern.source, 'gi')
  while ((m = re.exec(source)) !== null) {
    srcUnits.add(m[2].toLowerCase())
  }
  for (const unit of srcUnits) {
    if (!polished.toLowerCase().includes(unit)) {
      return { ok: false, reason: `单位丢失（${unit} 未在译文中出现）` }
    }
  }

  // ⑤ ™ 散弹校验（v12.4——润色 LLM 若模仿™分布输出逐字母™模式，一票否决回退）
  //   v12.6: hasTrademarkSpam 已扩充同符号紧邻重复判据（™™/®®/©©），CFexpress™™ 类事故
  //   在润色层也能被拦（翻译层 restore 去重是主防线，本层是兜底）。
  if (hasTrademarkSpam(polished)) {
    return { ok: false, reason: '™散弹（hasTrademarkSpam）' }
  }

  // ⑥ ™ 完整性校验（v12.6——源文™词在译文中对应位置必须有™，缺失即回退）
  //   与 restoreTrademarkSymbols 的"锚第一个实例"行为对齐：源文同词多™时，
  //   译文只要求第一个实例词尾有™（第二个及以后实例缺失不判违规——与修复后 restore 输出一致）。
  //   防润色 LLM 把™剥掉不恢复（如 "CFexpress™" 润成 "CFexpress"）。
  const tmIntegrity = checkTrademarkIntegrity(source, polished)
  if (!tmIntegrity.ok) {
    return { ok: false, reason: `™完整性缺失（${tmIntegrity.missing.join('、')}）` }
  }

  // ⑦ ↵ 结构锁校验（v12.7——多行格润色后 ↵ 个数+位置不变，信息点不跨段搬家）
  //   形式信号：源文/润色后译文按 ↵/\n 切段，段数必须相等；每段内的数字/限定词
  //   必须仍在原段（不跨段搬家）。段内语序/搭配可变（润色正当空间）。
  const srcBreaks = source.split(/[↵\n]/).length - 1
  const polishedBreaks = polished.split(/[↵\n]/).length - 1
  if (srcBreaks !== polishedBreaks) {
    return { ok: false, reason: `↵ 结构破坏（源文 ${srcBreaks} 个 ↵，润色后 ${polishedBreaks} 个）` }
  }
  if (srcBreaks > 0) {
    const srcSegs = source.split(/[↵\n]/).map(s => s.trim())
    const polishedSegs = polished.split(/[↵\n]/).map(s => s.trim())
    for (let i = 0; i < srcSegs.length; i++) {
      // 段内数字不跨段（validateNumbers 是整条的，段内数字跨段搬家整条数字不变会漏）
      const srcNums = (srcSegs[i].match(/\d+(?:[.,]\d+)?/g) || []).sort()
      const polishedNums = (polishedSegs[i].match(/\d+(?:[.,]\d+)?/g) || []).sort()
      if (srcNums.join(',') !== polishedNums.join(',')) {
        return { ok: false, reason: `↵ 第 ${i + 1} 段数字跨段搬家（源文段 ${srcNums.length} 个，润色段 ${polishedNums.length} 个）` }
      }
      // 段内限定词不跨段（detectPolarityBreach 是整条的，段内限定词跨段搬家同理漏）
      const srcLower = srcSegs[i].toLowerCase()
      const polishedLower = polishedSegs[i].toLowerCase()
      const entries = POLARITY_TABLE[targetLang]
      if (entries) {
        for (const entry of entries) {
          if (!srcLower.includes(entry.source)) continue
          const hasRequired = entry.required.some(r => polishedLower.includes(r.toLowerCase()))
          if (!hasRequired) {
            return { ok: false, reason: `↵ 第 ${i + 1} 段限定词跨段搬家（${entry.source} 丢失）` }
          }
        }
      }
    }
  }

  // ⑧ 违禁词校验（v12.9——润色不得引入目标语言平台违禁词）
  //   对比「润色前 vs 润色后」命中数：润色前本就含违禁词的条目（术语库锁定值/已豁免规格表述）
  //   不因润色背锅；只有润色**新增**违禁词（干净译文被润脏）才回退。
  //   复用 detectProhibited（含 v12.9 豁免表），豁免形态天然不触发。
  //   与下游校对的关系：本层管「润色别弄脏」，校对管「脏了帮你改」——两道独立防线；
  //   关校对时本层是唯一兜底（润色产物直接写画布），开校对时双保险。
  if (prePolish !== undefined) {
    const beforeHits = detectProhibited(prePolish, targetLang)
    const afterHits = detectProhibited(polished, targetLang)
    if (afterHits.length > beforeHits.length) {
      return { ok: false, reason: `润色引入违禁词（${afterHits.map(h => h.word).join('、')}）` }
    }
  }

  return { ok: true }
}

/**
 * ™ 完整性校验——源文中的每个™实例，在译文中对应锚点位置必须有™。
 * 锚点消费制（游标逐实例）：同一词出现多次时，按序消费译文中的匹配实例
 *   （第 N 个源文™实例对应第 N 个译文匹配实例）——与 v12.14 restoreTrademarkSymbols
 *   的逐实例恢复行为严格对齐（restore 插几个，本校验就要求几个，恒无冲突）。
 *   v12.6→v12.14 沿革：旧版只校验第一个实例（与旧 restore「锚第一个实例」对齐）；
 *   v12.14 restore 升级为逐实例恢复后，本校验同步升级——否则润色把第二个™润没了也不拦。
 * @returns ok=true 完整；ok=false 缺失（missing 列出缺失项）
 */
function checkTrademarkIntegrity(source: string, translated: string): { ok: boolean; missing: string[] } {
  const symbolPattern = /([^\s®™©]+)\s*([®™©]+)/g
  const symbols: Array<{ word: string; symbol: string }> = []
  let match: RegExpExecArray | null
  while ((match = symbolPattern.exec(source)) !== null) {
    const cleanWord = match[1].replace(/[®™©]/g, '')
    if (cleanWord) {
      for (const s of match[2]) symbols.push({ word: cleanWord, symbol: s })
    }
  }

  // v12.14: 不再按 词|符号 去重——逐实例校验（同词同符号出现几次校验几次）
  const missing: string[] = []
  // 译文搜索游标：按序消费匹配实例（防同词多™时所有校验都锚到第一个实例）
  let searchFrom = 0
  for (const { word, symbol } of symbols) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(escaped, 'i')
    re.lastIndex = searchFrom
    const m = re.exec(translated.slice(searchFrom))
    if (!m) {
      missing.push(`${word}${symbol}`)
      continue
    }
    const absIndex = searchFrom + m.index
    const afterWord = translated.slice(absIndex + m[0].length)
    // 词后应有该符号（允许 0-1 个空格/标点间隔，与 restore 插入行为一致）
    if (!new RegExp('^[\\s.,;:!?)]?' + symbol).test(afterWord)) {
      missing.push(`${word}${symbol}`)
    }
    // 游标推进到本实例之后（下一个同词校验从下一个实例开始找）
    searchFrom = absIndex + m[0].length
  }
  return { ok: missing.length === 0, missing }
}
