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
import { isGlossaryLockedTranslation } from '@lib/prohibited-check'

// ───────────────────────────────────────────────────────────────
// 资格负面清单（进 LLM 前，代码过滤——这些条目根本不给 LLM 碰）
// ───────────────────────────────────────────────────────────────

/** 合规关键词表——法律/合规声明润色权为零（六维之六逐字对应） */
const COMPLIANCE_KEYWORDS = [
  'warranty', 'guarantee', 'liability', 'disclaimer', 'certification', 'certified',
  'compliance', 'regulation', 'fcc', 'ce mark', 'rohs', 'reach', 'ul listed',
  'limited lifetime warranty', 'lifetime warranty', 'guaranteed',
]

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
  const src = source.trim()
  const trans = translated.trim()
  if (!src || !trans) return false

  // ① 含 ↵ 多行格豁免（v12.3 用户拍板：第一版不润——多行格机翻感主要是连写/断行问题，
  //    非搭配问题；且行内润色后 ↵ 结构对齐硬锁缺位，贸然放开会把断行语义弄丢。
  //    v12.6 ja 调研「改行タイミング不自然」实锤落在此豁免区——当前架构治不了，
  //    要收窄成「保断行结构、润行内文案」需另出方案，不在本次 ja 上线范围）
  if (src.includes('↵') || src.includes('\n') || trans.includes('↵') || trans.includes('\n')) return false

  // ② 极短文本（≤3 词）豁免——润色空间为零
  const wordCount = src.split(/\s+/).filter(Boolean).length
  if (wordCount <= 3) return false

  // ③ 合规关键词命中豁免——法律/合规声明润色权为零
  const srcLower = src.toLowerCase()
  if (COMPLIANCE_KEYWORDS.some(kw => srcLower.includes(kw))) return false

  // ④ 术语库整条命中豁免——润色即篡改术语库钦定值
  if (isGlossaryLockedTranslation(src, trans, normalizedGlossaryMap)) return false

  // ⑤ 不可翻译条目豁免（纯规格行/型号列表/裸单位）——shouldKeepSource 注册表复用
  if (shouldKeepSource(src, { targetLang })) return false

  return true
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
 * 润色产出硬锁校验：数字/术语/极性/单位四层。
 * @param source 源文
 * @param polished 润色后译文
 * @param targetLang 目标语言
 * @param glossaryMap 术语库 map（enforceGlossaryTerms 用）
 * @returns ok=false 时应回退润色前译文
 */
export function validatePolishOutput(
  source: string,
  polished: string,
  targetLang: string,
  glossaryMap?: Map<string, string>,
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
  if (hasTrademarkSpam(polished)) {
    return { ok: false, reason: '™散弹（hasTrademarkSpam）' }
  }

  return { ok: true }
}
