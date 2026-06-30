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

  const uniqueTexts: string[] = []

  // 模板组：取第一个索引作为代表（用原始文本，LLM 翻译质量最好）
  for (const g of groups) {
    const repIdx = uniqueTexts.length
    const repOrigIdx = g.indices[0]
    uniqueTexts.push(texts[repOrigIdx])
    const repValues = g.valueMaps.get(repOrigIdx) || []
    for (const idx of g.indices) {
      expandData.set(idx, {
        repIndex: repIdx,
        repValues,
        targetValues: g.valueMaps.get(idx) || [],
      })
    }
  }

  // 非模板文本
  for (let i = 0; i < texts.length; i++) {
    if (templatedIndices.has(i) || !texts[i]) continue
    const repIdx = uniqueTexts.length
    uniqueTexts.push(texts[i])
    expandData.set(i, { repIndex: repIdx, repValues: [], targetValues: [] })
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
