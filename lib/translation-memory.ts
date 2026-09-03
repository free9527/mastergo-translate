/**
 * 翻译记忆 — 模板匹配
 *
 * 同型号不同容量/速度的文本（如 "NM790 1TB SSD" / "NM790 2TB SSD"），
 * 提取公共模板只翻译一次，再用实际数值回填。减少 LLM 调用 + 保证一致性。
 *
 * 策略：
 *   1. 提取数字+存储单位的组合（TB/GB/MB/s 等）→ 记录位置和值
 *   2. 同一模板只选一个代表发送给 LLM（用真实数值，保证翻译质量）
 *   3. 翻译完成后，在译文中找到代表文本的数值并替换为目标文本的数值
 */

// 需要模板化的数值模式
const VALUE_PATTERNS = [
  // 速度：7400MB/s, 6500 MB/s
  /(\d+(?:[,.\s]\d{3})*(?:\.\d+)?\s*[KMGTP]B\/s)/gi,
  // 容量：1TB, 2 GB, 512GB（不在 /s 速度模式中）
  /(\d+(?:[,.\s]\d{3})*(?:\.\d+)?\s*(?:T[BP]|G[BP]|M[BP]|K[BP])(?!\/s))/gi,
]

export interface TemplateGroup {
  /** 模板文本（替换数值后） */
  template: string
  /** 属于该模板的原始文本索引列表 */
  indices: number[]
  /** 每个索引对应提取到的数值映射（placeholder → value） */
  valueMaps: Map<number, Array<{ placeholder: string; value: string }>>
}

/**
 * 从文本中提取数值并替换为占位符，生成模板。
 */
function extractTemplate(text: string): {
  template: string
  values: Array<{ placeholder: string; value: string }>
} {
  let result = text
  const values: Array<{ placeholder: string; value: string }> = []
  let counter = 0

  for (const pattern of VALUE_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(result)) !== null) {
      const value = match[1]
      if (value.includes('__TMVAL_')) continue
      const placeholder = `__TMVAL_${counter}__`
      result = result.replace(value, placeholder)
      values.push({ placeholder, value })
      counter++
      pattern.lastIndex = match.index + placeholder.length
    }
  }

  return { template: result, values }
}

/**
 * 将一组文本按模板分组。
 * 只有 ≥2 个文本共享同一模板时才合并。
 */
export function buildTemplateGroups(texts: string[]): TemplateGroup[] {
  const groupMap = new Map<string, TemplateGroup>()

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    if (!text) continue

    const { template, values } = extractTemplate(text)
    if (values.length === 0) continue  // 无提取值，不参与模板化

    const existing = groupMap.get(template)
    if (existing) {
      existing.indices.push(i)
      existing.valueMaps.set(i, values)
    } else {
      const vm = new Map<number, Array<{ placeholder: string; value: string }>>()
      vm.set(i, values)
      groupMap.set(template, { template, indices: [i], valueMaps: vm })
    }
  }

  return Array.from(groupMap.values()).filter(g => g.indices.length > 1)
}

/**
 * 在源文本中查找值，返回在文本中的出现位置。
 */
function findValueInText(text: string, value: string): number {
  // 尝试直接查找
  const idx = text.indexOf(value)
  if (idx >= 0) return idx
  // 尝试去掉空格后查找（900 MB/s vs 900MB/s）
  const compactValue = value.replace(/\s+/g, '')
  const compactText = text.replace(/\s+/g, '')
  return compactText.indexOf(compactValue)
}

/**
 * 用模板译文 + 原始文本的数值映射，回填实际数值。
 */
function fillTemplateValues(
  templateTranslation: string,
  repValues: Array<{ placeholder: string; value: string }>,
  targetValues: Array<{ placeholder: string; value: string }>,
): string {
  let result = templateTranslation

  // 为每个占位符，在译文中找到代表值 → 替换为目标值
  for (let i = 0; i < repValues.length; i++) {
    const repVal = repValues[i].value
    const tgtVal = targetValues[i]?.value
    if (!tgtVal || repVal === tgtVal) continue

    // 在译文中查找代表值的位置
    const pos = findValueInText(result, repVal)
    if (pos >= 0) {
      result = result.slice(0, pos) + tgtVal + result.slice(pos + repVal.length)
    }
    // 如果代表值没出现在译文中（LLM 可能改了格式），尝试用占位符
    // 占位符在 LLM 输出中通常被保留或丢弃，这里作为后备不做强处理
  }

  return result
}

/**
 * 从一组文本中提取"代表集"——每个模板只保留一个文本用于翻译。
 */
export function compressBatch(texts: string[]): {
  uniqueTexts: string[]
  /** originalIndex → { repIndex, repValues, targetValues } */
  expandData: Map<number, {
    repIndex: number
    repValues: Array<{ placeholder: string; value: string }>
    targetValues: Array<{ placeholder: string; value: string }>
  }>
} {
  const groups = buildTemplateGroups(texts)
  const expandData = new Map<number, {
    repIndex: number
    repValues: Array<{ placeholder: string; value: string }>
    targetValues: Array<{ placeholder: string; value: string }>
  }>()

  if (groups.length === 0) {
    const uniqueTexts = texts.filter(t => t)
    for (let i = 0; i < texts.length; i++) {
      if (texts[i]) {
        expandData.set(i, {
          repIndex: uniqueTexts.indexOf(texts[i]),
          repValues: [],
          targetValues: [],
        })
      }
    }
    return { uniqueTexts, expandData }
  }

  const templatedIndices = new Set<number>()
  for (const g of groups) {
    for (const idx of g.indices) templatedIndices.add(idx)
  }

  // 标记每个模板组的代表索引（第一个成员）
  const groupRepMap = new Map<number, TemplateGroup>()
  for (const g of groups) {
    groupRepMap.set(g.indices[0], g)
  }

  const uniqueTexts: string[] = []

  // v7.5.5: 按原始顺序遍历，保持 Figma 图层扫描顺序
  // 模板组代表放在其原始位置，非模板文本直接追加
  for (let i = 0; i < texts.length; i++) {
    if (!texts[i]) continue
    const group = groupRepMap.get(i)
    if (group) {
      // 模板组的代表（第一个成员），插入代表文本
      const repIdx = uniqueTexts.length
      uniqueTexts.push(texts[i])
      const repValues = group.valueMaps.get(i) || []
      for (const idx of group.indices) {
        expandData.set(idx, {
          repIndex: repIdx,
          repValues,
          targetValues: group.valueMaps.get(idx) || [],
        })
      }
    } else if (!templatedIndices.has(i)) {
      // 非模板文本，直接追加
      const repIdx = uniqueTexts.length
      uniqueTexts.push(texts[i])
      expandData.set(i, { repIndex: repIdx, repValues: [], targetValues: [] })
    }
    // 模板组的非代表成员：跳过（expandData 展开时会指向代表位置）
  }

  return { uniqueTexts, expandData }
}

/**
 * 将翻译结果从代表集展开回原始文本数组。
 */
export function expandBatch(
  uniqueTranslations: string[],
  expandData: Map<number, {
    repIndex: number
    repValues: Array<{ placeholder: string; value: string }>
    targetValues: Array<{ placeholder: string; value: string }>
  }>,
  originalCount: number,
): string[] {
  const result: string[] = new Array(originalCount).fill('')

  for (let i = 0; i < originalCount; i++) {
    const data = expandData.get(i)
    if (!data) {
      result[i] = ''
      continue
    }
    const repTranslation = uniqueTranslations[data.repIndex] || ''
    if (data.targetValues.length === 0) {
      result[i] = repTranslation
    } else {
      result[i] = fillTemplateValues(repTranslation, data.repValues, data.targetValues)
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════
// v12.13: TM few-shot 检索（方案 2 收窄版——人工验收译文锚定）
// ═══════════════════════════════════════════════════════════════
// 职责: 翻译首调前，从「人工验收译文」（corrections origin=user）中检索
//       与当前批次源文高度相似的历史对，作为 few-shot 注入首调——
//       项目铁律「抽象形容词对 LLM 无效，具体对照才有效」的机制化：
//       历史已验收译文是品牌已背书的质量锚点。
// 收窄红线（2026-09-03 裁决）:
//   ⛔ 数据源只用 corrections origin='user'（纯人工验收）——
//      翻译缓存（未验收）/ 校对自动修正（LLM 产物）一律不用，防平庸译文自我强化
//   ⛔ 相似度 ≥0.90 且源文数字集合必须完全相等（规格错位防线：
//      "up to 2TB" 绝不锚 "up to 4TB"）
//   ⛔ 每格最多 1 条、每批最多 MAX_TM_PER_BATCH 条（防注意力稀释 v10.9 教训）
//   ⛔ 源文 <15 字符不检索（极短标签无 pattern 可学）
// 语种适配: 拉丁/西里尔/阿拉伯按词级 Jaccard；CJK/泰文（无空格分词）按字符 bigram。
// 注: 本模块 v7.5.8 起是「同型号不同容量模板匹配」（compressBatch/expandBatch）；
//     v12.13 追加「人工验收译文检索」——两个职责共享「翻译记忆」语义，同居一文件。
// ═══════════════════════════════════════════════════════════════

import { TranslationCorrection } from '@messages/types'

export interface TMEntry {
  /** 历史源文（correction.source） */
  source: string
  /** 人工验收译文（correction.correctedTranslation） */
  target: string
}

/** 每批最多注入条数（防注意力稀释） */
export const MAX_TM_PER_BATCH = 2
/** 相似度阈值（收窄裁决：≥0.90） */
const TM_THRESHOLD = 0.9
/** 极短源文不检索（无 pattern 可学） */
const MIN_SOURCE_LEN = 15

// ── 文字类型自适应分词 ──

/** CJK/泰文（无可靠空格分词）→ 字符 bigram 集合；其余 → 词集合（小写） */
function tokenizeForSim(text: string): Set<string> {
  const t = text.toLowerCase().trim()
  // CJK 统一表意文字/假名/谚文/泰文：按字符 bigram
  if (/[一-鿿぀-ヿ가-힯฀-๿]/.test(t)) {
    const chars = t.replace(/\s+/g, '')
    const bigrams = new Set<string>()
    for (let i = 0; i < chars.length - 1; i++) bigrams.add(chars.slice(i, i + 2))
    return bigrams
  }
  return new Set(t.split(/\s+/).filter(Boolean))
}

/** Jaccard 相似度（集合交/并） */
function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** 数字集合（含小数/千分位）——规格错位防线：数字集合不等 → 相似度强制 0 */
function numberSetKey(text: string): string {
  return (text.match(/\d+(?:[.,]\d+)?/g) || []).sort().join(',')
}

/**
 * TM 相似度（0-1）。数字集合不等 → 0（规格错位防线）。
 * 拉丁系按词级 Jaccard；CJK/泰文按字符 bigram Jaccard。
 */
export function tmSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (numberSetKey(a) !== numberSetKey(b)) return 0
  return jaccardSim(tokenizeForSim(a), tokenizeForSim(b))
}

/**
 * 检索翻译记忆：corrections(user 源) × 当前批次 × 同 targetLang × 相似度≥0.90。
 * @param texts 当前批次源文
 * @param corrections 全部修正记录（函数内部过滤 origin='user'）
 * @param targetLang 目标语言（correction.targetLang 严格相等）
 * @returns 按相似度降序的 TMEntry（≤MAX_TM_PER_BATCH 条，每条服务一个源文，源文不重复）
 */
export function retrieveTM(
  texts: string[],
  corrections: TranslationCorrection[],
  targetLang: string,
): TMEntry[] {
  // 收窄裁决：只用 origin='user' 的人工验收译文（缺省 origin 按 user 兼容旧记录——types.ts 注释）
  const pool = corrections.filter(c =>
    (c.origin ?? 'user') === 'user' &&
    c.targetLang === targetLang &&
    c.correctedTranslation && c.correctedTranslation.trim().length > 0 &&
    c.source && c.source.trim().length >= MIN_SOURCE_LEN,
  )
  if (pool.length === 0) return []

  // 每条源文的最佳匹配 + 全局 ≤MAX_TM_PER_BATCH（相似度降序贪心分配，correction 不重复用）
  interface Candidate { entry: TMEntry; score: number; corrIdx: number }
  const candidates: Candidate[] = []
  for (let ci = 0; ci < pool.length; ci++) {
    let best = 0
    for (const t of texts) {
      if (!t || t.trim().length < MIN_SOURCE_LEN) continue
      const s = tmSimilarity(t, pool[ci].source)
      if (s > best) best = s
    }
    if (best >= TM_THRESHOLD) {
      candidates.push({ entry: { source: pool[ci].source, target: pool[ci].correctedTranslation }, score: best, corrIdx: ci })
    }
  }
  candidates.sort((a, b) => b.score - a.score)

  // 同一历史源文（近似）只取一条：按 source 归一化去重（防同一句的多次修正重复注入）
  const seen = new Set<string>()
  const out: TMEntry[] = []
  for (const c of candidates) {
    const key = c.entry.source.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c.entry)
    if (out.length >= MAX_TM_PER_BATCH) break
  }
  return out
}
