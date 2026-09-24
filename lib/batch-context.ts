// ═══════════════════════════════════════════════════════════════
// 模块: batch-context — 批次上下文（v12.28 质量×效率系统性方案地基）
// ═══════════════════════════════════════════════════════════════
//
// 职责边界（一个载体，三个消费者）：
//   1. 场景×阶段开关矩阵（杠杆 1）—— SCENE_PIPELINE_POLICY + getStagePolicy
//   2. 判定结果复用（杠杆 2）—— EntryJudgment 记录表（只算一次、只读不改）
//   3. consistency 自适应降级（杠杆 2 附属）—— 连续超时降级，网关恢复自动复位
//
// 源文体检（杠杆 4）是纯函数 preflightSource，不持有状态，也在此模块。
//
// 【不做什么】
//   ⛔ 不改任何翻译/校对/润色阶段的内部逻辑——只控制「开/关」与「判定共享」
//   ⛔ 不引入跨线程状态——UI 线程持有实例，调用时传切片（与现有架构对齐）
//   ⛔ 判定记录只读不改（auditStage 同款纪律）——任何阶段不得下游污染判定
// ═══════════════════════════════════════════════════════════════

import { SCENE_GROUP_MAP } from '@lib/prompt-constants'
import type { LLMConfig } from '@messages/types'

// ============================================================
// 杠杆 1: 场景 × 阶段开关矩阵
// ============================================================

/** 管道各阶段开关（声明式，非散落 if） */
export interface StagePolicy {
  /** best-of-2 双跑择优 */
  bestOf2: boolean
  /** 人设润色整链（judge + polish + verify） */
  polish: boolean
  /** 校对 */
  proofread: boolean
  /** 一致性探测 */
  consistency: boolean
}

/**
 * 场景 × 阶段开关矩阵（v12.28，2026-09-24 用户拍板「LLM 决策」）。
 *
 * 决策逻辑（与六维评审 / v12.3 负面清单同根）：
 *   客观陈述类场景（technical_doc/operation_guide/compliance_doc）+ 格式敏感类
 *   场景（packaging/software_ui）关润色——它们要的是「准」，不是「润」。润色在
 *   客观陈述场景是纯浪费（ko 实机 4 次空调用 + factsIntact=false 回退实锤），
 *   且高风险（碰事实锚）。
 *   营销类场景（ecommerce）润色开——人设润色正是为营销语感设计（v12.3/v12.10）。
 *
 * bestOf2 列恒 true（2026-09-24 收窄，用户拍板）：
 *   best-of-2 双跑的跳过只由 v12.25「含数字批次」信号决定（那是经实测验证的精准
 *   信号——规格书全数字批次双跑空转），而不是按场景整体关（粗糙——规格书里的
 *   纯文字描述条目不含有数字信号，一刀切会错杀双跑择优的保护）。场景矩阵只保留
 *   它真有依据的那格（润色），不碰没依据的那格（双跑）。
 *
 * key = SCENE_GROUP_MAP 的 group 级（非 6 个具体 preset），避免重复。
 * SCENE_GROUP_MAP 全集：ecommerce/technical_doc/operation_guide/compliance_doc/packaging/software_ui
 */
export const SCENE_PIPELINE_POLICY: Record<string, StagePolicy> = {
  technical_doc:    { bestOf2: true, polish: false, proofread: true, consistency: true },
  operation_guide:  { bestOf2: true, polish: false, proofread: true, consistency: true },
  compliance_doc:   { bestOf2: true, polish: false, proofread: true, consistency: true },
  ecommerce:        { bestOf2: true, polish: true,  proofread: true, consistency: true },
  packaging:        { bestOf2: true, polish: false, proofread: true, consistency: true },
  software_ui:      { bestOf2: true, polish: false, proofread: true, consistency: true },
}

/** 保守全开兜底（未知场景组不误伤） */
const DEFAULT_STAGE_POLICY: StagePolicy = { bestOf2: true, polish: true, proofread: true, consistency: true }

/**
 * 取当前场景的阶段策略。
 * @param scenePreset UI 场景 id（ecommerce/technical_params/spec_sheet/manual/after_sales/packaging/ui）
 *                    —— 内部经 SCENE_GROUP_MAP 归组后查矩阵
 */
export function getStagePolicy(scenePreset: string | null | undefined): StagePolicy {
  if (!scenePreset) return DEFAULT_STAGE_POLICY
  const group = SCENE_GROUP_MAP[scenePreset] || scenePreset
  return SCENE_PIPELINE_POLICY[group] || DEFAULT_STAGE_POLICY
}

// ============================================================
// 杠杆 1 落地：effective 开关计算（场景策略 AND 用户开关）
// ============================================================

/**
 * v12.28: 各阶段「effective 开」计算——用户开关 AND 场景策略。
 *
 * 与用户拍板对齐（D1）：场景策略是「场景适配层」，用户开关（enableAiOptimize/
 * enablePolish/enableBestOfN/enableProofread）是「用户意愿层」，两者 AND——
 * 任一关即关。enableAiOptimize 是总开关（关时全停，v12.10.5 语义不变）。
 *
 * 这样 App.vue 的 effPolish/effBestOfN 等只需改调这里，场景适配集中一处。
 */
export interface EffectiveToggles {
  proofread: boolean
  polish: boolean
  bestOfN: boolean
  /** 当前场景策略（透出用，如日志「本场景已关润色」） */
  policy: StagePolicy
}

export function computeEffectiveToggles(config: LLMConfig): EffectiveToggles {
  const policy = getStagePolicy(config.scenePreset)
  const aiOn = config.enableAiOptimize !== false
  return {
    proofread: aiOn && config.enableProofread && policy.proofread,
    // enablePolish/enableBestOfN 为可选字段——undefined 视为开（v12.10.4 默认全开语义）
    polish: aiOn && config.enablePolish !== false && policy.polish,
    bestOfN: aiOn && config.enableBestOfN !== false && policy.bestOf2,
    policy,
  }
}

// ============================================================
// 杠杆 2: 判定结果复用（每条源文的判定记录表）
// ============================================================

/**
 * 单条源文的判定记录——只算一次、全管道各阶段共享只读。
 *
 * 消除的重复判定（现状各阶段独立算同一判定）：
 *   - 术语锁定：润色资格(isGlossaryLockedTranslation) + 合规校验各自算
 *   - 含数字：best-of-2 跳过(v12.25)算一次，润色资格又可算
 *   - 营销句资格：best-of-2 资格判定结果，供日志/后续分析
 *   - 润色资格：polish-guard 算，校对 CHECK 1R 可参考
 */
export interface EntryJudgment {
  /** 术语整条锁定（cleanKey 命中术语库） */
  isGlossaryLocked: boolean
  /** 含数字（规格特征，best-of-2 跳过/润色豁免共用信号） */
  hasDigits: boolean
  /** 营销句（best-of-2 资格判定结果，供透出与分析） */
  isMarketingSentence: boolean
  /** 润色资格（负面清单综合判定） */
  polishEligible: boolean
  /** 润色豁免原因（polishEligible=false 时透出用） */
  polishExemptReason?: string
}

/**
 * 批次级判定记录表。
 * 纪律：只算一次、只读不改——任何阶段不得修改已写入的判定（防下游污染）。
 */
export class JudgmentTable {
  private readonly table = new Map<number, EntryJudgment>()

  /** 写入判定（已存在则拒绝覆盖——判定只算一次的纪律保证） */
  set(index: number, judgment: EntryJudgment): void {
    if (this.table.has(index)) return  // 只算一次：已判定不覆盖
    this.table.set(index, judgment)
  }

  /** 读取判定（只读） */
  get(index: number): EntryJudgment | undefined {
    return this.table.get(index)
  }

  /** 是否已判定 */
  has(index: number): boolean {
    return this.table.has(index)
  }

  /** 批次内已判定条目数（透出用） */
  get size(): number {
    return this.table.size
  }
}

// ============================================================
// 杠杆 2 附属: consistency 自适应降级
// ============================================================

/**
 * consistency 探测连续超时降级器（会话内自适应，非永久关）。
 *
 * 背景（2026-09-24 ko 实机实锤）：consistency 连续 100% 8s 超时（网关高负载），
 * 每批白等 8s。consistency 只报告不修改（v12.19 探测版纪律），超时不影响译文。
 *
 * 机制：连续 ≥3 次超时 → 本会话后续批次自动降级为跳过（uiLog 提示）；
 *       某次成功 → 计数清零自动恢复。零质量风险（探测层本就不改数据）。
 */
export class ConsistencyDegrader {
  private consecutiveTimeouts = 0
  private static readonly DEGRADE_THRESHOLD = 3

  /** 记录一次超时；返回本次会话是否应继续降级 */
  recordTimeout(): boolean {
    this.consecutiveTimeouts++
    return this.isDegraded()
  }

  /** 记录一次成功（网关恢复）→ 计数清零自动复位 */
  recordSuccess(): void {
    this.consecutiveTimeouts = 0
  }

  /** 当前是否处于降级态 */
  isDegraded(): boolean {
    return this.consecutiveTimeouts >= ConsistencyDegrader.DEGRADE_THRESHOLD
  }

  /** 透出用：当前连续超时数 */
  get timeoutCount(): number {
    return this.consecutiveTimeouts
  }
}

// ============================================================
// 批次上下文（聚合上述三者，UI 线程持有）
// ============================================================

/**
 * 一次翻译批次的共享上下文。
 * UI 线程在批次开始时创建，贯穿翻译/校对/润色各阶段，批次结束即弃。
 */
export class BatchContext {
  /** 当前场景 preset（UI 场景 id） */
  readonly scenePreset: string | null
  /** 杠杆 1：阶段策略 */
  readonly policy: StagePolicy
  /** 杠杆 2：判定记录表 */
  readonly judgments = new JudgmentTable()
  /** 杠杆 2 附属：consistency 降级器（会话级，跨批次共享——故不随批次重置） */
  readonly consistencyDegrader: ConsistencyDegrader

  constructor(scenePreset: string | null, sharedDegrader?: ConsistencyDegrader) {
    this.scenePreset = scenePreset
    this.policy = getStagePolicy(scenePreset)
    // consistency 降级器跨批次共享（超时统计是会话级，不是批次级）
    this.consistencyDegrader = sharedDegrader || new ConsistencyDegrader()
  }

  /** 便捷判定：当前场景是否开启某阶段 */
  get bestOf2Enabled(): boolean { return this.policy.bestOf2 }
  get polishEnabled(): boolean { return this.policy.polish }
  get proofreadEnabled(): boolean { return this.policy.proofread }
  get consistencyEnabled(): boolean {
    // 场景策略开 AND 未降级 → 才真跑 consistency
    return this.policy.consistency && !this.consistencyDegrader.isDegraded()
  }
}

// ============================================================
// 杠杆 4: 源文质量前置体检（纯函数，零 LLM，毫秒级）
// ============================================================

/** 体检发现项 */
export interface PreflightFinding {
  kind: 'scene-mismatch' | 'misspelled' | 'prohibited-src' | 'bilingual-hint'
  severity: 'block' | 'warn' | 'info'
  message: string
  /** 命中的条目索引（透出用） */
  entryIndices: number[]
  /** 命中词/片段（透出用，可选） */
  fragments?: string[]
}

/**
 * 体检检查项开关（声明式——UI 按场景/开关决定跑哪些检查）。
 * 与场景矩阵同纪律：开关集中一处，不散落 if。
 */
export interface PreflightChecks {
  sceneMismatch?: boolean   // 场景不匹配（规格书信号）
  misspelled?: boolean      // 可疑错词
  prohibitedSrc?: boolean   // 源文违禁词
  bilingualHint?: boolean   // 双语混写提示
}

/** 默认全查（翻译前体检） */
export const PREFLIGHT_CHECKS_ALL: Required<PreflightChecks> = {
  sceneMismatch: true, misspelled: true, prohibitedSrc: true, bilingualHint: true,
}

/** 体检判定器依赖注入（避免 batch-context 反向依赖 llm-api/prohibited-check——
 *  保持本模块为纯数据+纯函数的低层，判定器由调用方（App.vue）注入）。 */
export interface PreflightDetectors {
  /** 可疑错词判定（复用 llm-api.isSuspectMisspelledWord） */
  isSuspectMisspelledWord?: (src: string, glossaryMap?: Map<string, string>) => boolean
  /** 源文违禁词检测（复用 prohibited-check.detectProhibited + detectSourceLangForProhibited） */
  detectProhibited?: (text: string, langCode: string) => Array<{ word: string; note: string }>
  detectSourceLangForProhibited?: (text: string) => 'zh' | 'en' | null
  /** 双语混写判定（复用 third-party-models.isBilingualCameraBrand——
   *  当前仅相机品牌双语；后续扩展其他双语形态时在此表内加判） */
  isBilingual?: (text: string) => boolean
}

/**
 * 检测源文是否「像规格书」（脚标/规格表结构密度）。
 *
 * 形式信号（代码管形式，不越界判语义）：
 *   - 脚标：※N / 上标数字 ¹²³⁴ / 句尾孤立数字（速度值后 1/2/3）
 *   - 规格表结构：「Key: Value」行（冒号分隔的短行）占比
 * 命中密度超阈值 → 判定为「像规格书」。
 *
 * @returns 信号命中数（供阈值判定与透出）
 */
export function detectSpecSheetSignals(sourceTexts: string[]): { footnoteCount: number; kvLineCount: number } {
  let footnoteCount = 0
  let kvLineCount = 0
  for (const text of sourceTexts) {
    if (!text) continue
    // 脚标：※N 或 上标数字 ¹²³⁴⁵⁶⁷⁸⁹⁰
    const fn = text.match(/※\d|[¹²³⁴⁵⁶⁷⁸⁹⁰]/g)
    if (fn) footnoteCount += fn.length
    // 规格表 Key: Value 行（冒号+值，行较短）
    const lines = text.split(/[\n↵]/)
    for (const line of lines) {
      if (/^[^:：\n]{2,30}[:：]\s*\S/.test(line) && line.length < 80) kvLineCount++
    }
  }
  return { footnoteCount, kvLineCount }
}

/** 场景不匹配判定阈值：脚标 ≥2 或 规格行 ≥3 */
const SPEC_SIGNAL_FOOTNOTE_THRESHOLD = 2
const SPEC_SIGNAL_KV_THRESHOLD = 3

/**
 * 源文质量前置体检（扫描后、翻译前）。
 *
 * 边界（用户拍板 D3）：场景不匹配只「warn 提示」，不自动切场景——
 * 「这批该用什么场景」是业务判断，代码只提供形式信号，用户决定。
 * 错词/违禁词/双语是 info/warn 提示（不阻塞翻译），违禁词的「判定合规/阻塞」
 * 仍由 v12.20 既有通道处理（此处只统一透出，不重复造阻塞逻辑）。
 *
 * @param sourceTexts 批次源文
 * @param currentScenePreset 当前场景 preset（UI 场景 id），内部归组后与 technical_doc 比对
 * @param checks 检查项开关（缺省全查）
 * @param detectors 判定器依赖注入（App.vue 注入现有判定器，本模块不反向依赖）
 * @param glossaryMap 术语库（错词判定豁免用）
 * @returns 体检发现项列表（空数组 = 无异常）
 */
export function preflightSource(
  sourceTexts: string[],
  currentScenePreset: string | null,
  checks: PreflightChecks = PREFLIGHT_CHECKS_ALL,
  detectors: PreflightDetectors = {},
  glossaryMap?: Map<string, string>,
): PreflightFinding[] {
  const findings: PreflightFinding[] = []
  const want = { ...PREFLIGHT_CHECKS_ALL, ...checks }

  // 检查 1：场景不匹配——内容像规格书但场景不是 technical_doc
  if (want.sceneMismatch) {
    const { footnoteCount, kvLineCount } = detectSpecSheetSignals(sourceTexts)
    const looksLikeSpec = footnoteCount >= SPEC_SIGNAL_FOOTNOTE_THRESHOLD || kvLineCount >= SPEC_SIGNAL_KV_THRESHOLD
    const currentGroup = currentScenePreset ? (SCENE_GROUP_MAP[currentScenePreset] || currentScenePreset) : null
    if (looksLikeSpec && currentGroup !== 'technical_doc') {
      const signals: string[] = []
      if (footnoteCount >= SPEC_SIGNAL_FOOTNOTE_THRESHOLD) signals.push(`${footnoteCount} 处脚标`)
      if (kvLineCount >= SPEC_SIGNAL_KV_THRESHOLD) signals.push(`${kvLineCount} 行规格结构`)
      findings.push({
        kind: 'scene-mismatch',
        severity: 'warn',
        message: `这批内容像规格书（检测到 ${signals.join('、')}），当前场景不是规格书。是否切换场景？`,
        entryIndices: sourceTexts.map((_, i) => i),
      })
    }
  }

  // 检查 2：可疑错词（info——前移到扫描期，不等翻译期才发现）
  if (want.misspelled && detectors.isSuspectMisspelledWord) {
    const idx: number[] = []
    const frags: string[] = []
    sourceTexts.forEach((text, i) => {
      const s = (text || '').trim()
      if (s && detectors.isSuspectMisspelledWord!(s, glossaryMap)) {
        idx.push(i)
        frags.push(s.slice(0, 40))
      }
    })
    if (idx.length > 0) {
      findings.push({
        kind: 'misspelled',
        severity: 'info',
        message: `${idx.length} 条疑似错词/未识别专名（将保留原形不音译）`,
        entryIndices: idx,
        fragments: frags,
      })
    }
  }

  // 检查 3：源文违禁词（info 透出——「判定合规/阻塞」走 v12.20 既有通道，不重复造）
  if (want.prohibitedSrc && detectors.detectProhibited && detectors.detectSourceLangForProhibited) {
    const idx: number[] = []
    const frags: string[] = []
    sourceTexts.forEach((text, i) => {
      const lang = detectors.detectSourceLangForProhibited!(text || '')
      if (!lang) return
      const hits = detectors.detectProhibited!(text || '', lang)
      if (hits.length > 0) {
        idx.push(i)
        frags.push(hits.map(h => h.word).join('/'))
      }
    })
    if (idx.length > 0) {
      findings.push({
        kind: 'prohibited-src',
        severity: 'info',
        message: `${idx.length} 条源文含平台违禁词（请改源文或点「判定合规」）`,
        entryIndices: idx,
        fragments: frags,
      })
    }
  }

  // 检查 4：双语混写提示（info——源文已是「中文名+拉丁名」双语形态，将保留原文不译）
  if (want.bilingualHint && detectors.isBilingual) {
    const idx: number[] = []
    const frags: string[] = []
    sourceTexts.forEach((text, i) => {
      const s = (text || '').trim()
      if (s && detectors.isBilingual!(s)) {
        idx.push(i)
        frags.push(s.slice(0, 40))
      }
    })
    if (idx.length > 0) {
      findings.push({
        kind: 'bilingual-hint',
        severity: 'info',
        message: `${idx.length} 条双语品牌标签（如「佳能 Canon」）——按常规双语表达保留原文`,
        entryIndices: idx,
        fragments: frags,
      })
    }
  }

  return findings
}
