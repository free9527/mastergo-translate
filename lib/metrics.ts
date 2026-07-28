/**
 * 翻译指标收集器 — 可观测性
 * 记录翻译管道的关键性能指标，用于诊断和优化
 */

export interface BatchMetrics {
  // 批次基本信息
  batchIndex: number
  batchSize: number
  targetLang: string
  productLine?: string | null

  // API 调用统计
  apiCalls: number
  retryLayers: {
    unified: boolean
    aggressive: number
    sentenceSplit: number
    caseNormalization: number
  }

  // 耗时统计（毫秒）
  duration: {
    total: number
    llm: number
    preprocessing: number
    postprocessing: number
  }

  // 术语库统计
  glossary: {
    totalTerms: number
    matchedTerms: number
    hitRate: number
  }

  // 质量统计
  quality: {
    untranslated: number
    truncated: number
    brandInjection: number
    expansion: number
  }
}

export interface ProofreadMetrics {
  batchIndex: number
  batchSize: number
  targetLang: string
  apiCalls: number
  duration: number
  modifications: number
  modificationRate: number
}

export interface TranslationMetrics {
  startTime: number
  endTime?: number
  totalBatches: number
  totalTexts: number
  targetLang: string
  productLine?: string | null

  // 批次指标
  batches: BatchMetrics[]
  proofreads: ProofreadMetrics[]

  // 汇总统计
  summary: {
    totalApiCalls: number
    totalDuration: number
    avgBatchDuration: number
    avgProofreadDuration: number
    totalUntranslated: number
    totalModifications: number
    overallModificationRate: number
    glossaryHitRate: number
  }
}

// 全局指标收集器
let currentMetrics: TranslationMetrics | null = null

/**
 * 开始新的翻译任务指标收集
 */
export function startMetricsCollection(
  totalBatches: number,
  totalTexts: number,
  targetLang: string,
  productLine?: string | null,
): void {
  currentMetrics = {
    startTime: Date.now(),
    totalBatches,
    totalTexts,
    targetLang,
    productLine,
    batches: [],
    proofreads: [],
    summary: {
      totalApiCalls: 0,
      totalDuration: 0,
      avgBatchDuration: 0,
      avgProofreadDuration: 0,
      totalUntranslated: 0,
      totalModifications: 0,
      overallModificationRate: 0,
      glossaryHitRate: 0,
    },
  }
}

/**
 * 记录翻译批次指标
 */
export function recordBatchMetrics(metrics: BatchMetrics): void {
  if (!currentMetrics) return
  currentMetrics.batches.push(metrics)
}

/**
 * 记录校对批次指标
 */
export function recordProofreadMetrics(metrics: ProofreadMetrics): void {
  if (!currentMetrics) return
  currentMetrics.proofreads.push(metrics)
}

/**
 * 结束指标收集并计算汇总
 */
export function finalizeMetrics(): TranslationMetrics | null {
  if (!currentMetrics) return null

  currentMetrics.endTime = Date.now()

  // 计算汇总统计
  const totalApiCalls = currentMetrics.batches.reduce((sum, b) => sum + b.apiCalls, 0) +
    currentMetrics.proofreads.reduce((sum, p) => sum + p.apiCalls, 0)

  const totalDuration = currentMetrics.endTime - currentMetrics.startTime

  const avgBatchDuration = currentMetrics.batches.length > 0
    ? currentMetrics.batches.reduce((sum, b) => sum + b.duration.total, 0) / currentMetrics.batches.length
    : 0

  const avgProofreadDuration = currentMetrics.proofreads.length > 0
    ? currentMetrics.proofreads.reduce((sum, p) => sum + p.duration, 0) / currentMetrics.proofreads.length
    : 0

  const totalUntranslated = currentMetrics.batches.reduce((sum, b) => sum + b.quality.untranslated, 0)

  const totalModifications = currentMetrics.proofreads.reduce((sum, p) => sum + p.modifications, 0)

  const overallModificationRate = currentMetrics.totalTexts > 0
    ? totalModifications / currentMetrics.totalTexts
    : 0

  const glossaryHitRate = currentMetrics.batches.length > 0
    ? currentMetrics.batches.reduce((sum, b) => sum + b.glossary.hitRate, 0) / currentMetrics.batches.length
    : 0

  currentMetrics.summary = {
    totalApiCalls,
    totalDuration,
    avgBatchDuration,
    avgProofreadDuration,
    totalUntranslated,
    totalModifications,
    overallModificationRate,
    glossaryHitRate,
  }

  const result = currentMetrics
  currentMetrics = null
  return result
}

/**
 * 格式化指标报告（用于 UI 显示）
 */
export function formatMetricsReport(metrics: TranslationMetrics): string {
  const duration = metrics.endTime ? metrics.endTime - metrics.startTime : 0
  const durationSec = (duration / 1000).toFixed(1)

  const lines = [
    `翻译完成`,
    ``,
    `基本信息:`,
    `  目标语言: ${metrics.targetLang}`,
    `  产品线: ${metrics.productLine || '通用'}`,
    `  总批次: ${metrics.totalBatches}`,
    `  总文本: ${metrics.totalTexts}`,
    ``,
    `性能指标:`,
    `  总耗时: ${durationSec}s`,
    `  API 调用: ${metrics.summary.totalApiCalls} 次`,
    `  平均批次耗时: ${(metrics.summary.avgBatchDuration / 1000).toFixed(1)}s`,
    `  平均校对耗时: ${(metrics.summary.avgProofreadDuration / 1000).toFixed(1)}s`,
    ``,
    `质量指标:`,
    `  未翻译: ${metrics.summary.totalUntranslated} 条`,
    `  校对修改: ${metrics.summary.totalModifications} 条`,
    `  校对修改率: ${(metrics.summary.overallModificationRate * 100).toFixed(1)}%`,
    `  术语命中率: ${(metrics.summary.glossaryHitRate * 100).toFixed(1)}%`,
  ]

  return lines.join('\n')
}

/**
 * 创建批次指标计时器
 */
export function createBatchTimer(): { stop: () => number } {
  const start = Date.now()
  return {
    stop: () => Date.now() - start,
  }
}
