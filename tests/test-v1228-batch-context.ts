// ============================================================
// v12.28 杠杆 1+2+4：场景策略矩阵 + 判定复用 + consistency 降级 + 源文体检
// ============================================================
// 覆盖：
//   A 场景×阶段开关矩阵（getStagePolicy 归组 + 各场景开关正确性）
//   B 判定记录表（只算一次、只读不改纪律）
//   C consistency 自适应降级（连续超时降级 + 成功复位 + 批次上下文一致性）
//   D 源文体检（规格书信号检测 + 场景不匹配 warn + 边界）
//   E BatchContext 聚合（策略 + 便捷判定 + consistencyEnabled 联合语义）
// ============================================================

/// <reference types="node" />

import {
  getStagePolicy,
  SCENE_PIPELINE_POLICY,
  BatchContext,
  JudgmentTable,
  ConsistencyDegrader,
  preflightSource,
  detectSpecSheetSignals,
  computeEffectiveToggles,
} from '../lib/batch-context'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

// ────────────────────────────────────────────────────────────
console.log('\nA. 场景×阶段开关矩阵')

// A1: 客观陈述类场景关润色（bestOf2 恒开——v12.25 含数字信号专管，场景不碰双跑）
const techPolicy = getStagePolicy('technical_params')
assert(techPolicy.polish === false, 'A1a technical_params 关润色')
assert(techPolicy.bestOf2 === true, 'A1b technical_params bestOf2 恒开（收窄：双跑只由 v12.25 含数字信号跳）')
assert(techPolicy.proofread === true, 'A1c technical_params 保校对')
assert(techPolicy.consistency === true, 'A1d technical_params 保 consistency')

const specPolicy = getStagePolicy('spec_sheet')
assert(specPolicy.polish === false && specPolicy.bestOf2 === true, 'A2 spec_sheet 关润色保双跑（归组 technical_doc）')

const manualPolicy = getStagePolicy('manual')
assert(manualPolicy.polish === false && manualPolicy.bestOf2 === true, 'A3 manual(operation_guide) 关润色保双跑')

const afterSalesPolicy = getStagePolicy('after_sales')
assert(afterSalesPolicy.polish === false && afterSalesPolicy.bestOf2 === true, 'A4 after_sales(compliance_doc) 关润色保双跑')

// A2: 营销类场景全开
const ecomPolicy = getStagePolicy('ecommerce')
assert(ecomPolicy.polish === true && ecomPolicy.bestOf2 === true, 'A5 ecommerce 全开润色+双跑')

// A3: 格式敏感类关润色保双跑
const packPolicy = getStagePolicy('packaging')
assert(packPolicy.polish === false && packPolicy.bestOf2 === true, 'A6 packaging 关润色保双跑')
const uiPolicy = getStagePolicy('ui')
assert(uiPolicy.polish === false && uiPolicy.bestOf2 === true, 'A7 software_ui 关润色保双跑')

// A4: 未知场景保守全开（不误伤）
const unknownPolicy = getStagePolicy('nonexistent_scene')
assert(unknownPolicy.polish === true && unknownPolicy.bestOf2 === true, 'A8 未知场景保守全开')
const nullPolicy = getStagePolicy(null)
assert(nullPolicy.polish === true && nullPolicy.bestOf2 === true, 'A9 null 场景保守全开')

// ────────────────────────────────────────────────────────────
console.log('\nB. 判定记录表（只算一次纪律）')

const jt = new JudgmentTable()
jt.set(0, { isGlossaryLocked: true, hasDigits: false, isMarketingSentence: false, polishEligible: false, polishExemptReason: 'glossary-locked' })
assert(jt.has(0), 'B1 判定写入后可读')
assert(jt.get(0)?.isGlossaryLocked === true, 'B2 判定内容正确')

// B3: 只算一次——重复 set 不覆盖
jt.set(0, { isGlossaryLocked: false, hasDigits: true, isMarketingSentence: true, polishEligible: true })
assert(jt.get(0)?.isGlossaryLocked === true, 'B3 重复 set 不覆盖（只算一次纪律）')
assert(jt.size === 1, 'B4 size 正确')

// ────────────────────────────────────────────────────────────
console.log('\nC. consistency 自适应降级')

const deg = new ConsistencyDegrader()
assert(!deg.isDegraded(), 'C1 初始不降级')
deg.recordTimeout()
assert(!deg.isDegraded(), 'C2 1 次超时不降级')
deg.recordTimeout()
assert(!deg.isDegraded(), 'C3 2 次超时不降级')
deg.recordTimeout()
assert(deg.isDegraded(), 'C4 3 次连续超时 → 降级')
assert(deg.timeoutCount === 3, 'C5 超时计数正确')

// C6: 成功复位
deg.recordSuccess()
assert(!deg.isDegraded(), 'C6 成功后自动复位')
assert(deg.timeoutCount === 0, 'C7 复位后计数清零')

// ────────────────────────────────────────────────────────────
console.log('\nD. 源文体检')

// D1: 规格书信号检测（脚标）
const specSignals = detectSpecSheetSignals([
  'Transfer speeds up to 400MB/s¹ are 4X faster than USB 3.0².',
  'Available for iOS and Android devices³.',
])
assert(specSignals.footnoteCount >= 3, `D1 脚标信号检测（${specSignals.footnoteCount} 处）`)

// D2: 规格表结构检测（Key: Value 行）
const kvSignals = detectSpecSheetSignals([
  'Capacity: 1TB\nInterface: USB 3.2\nSpeed: 400MB/s\nWeight: 20g',
])
assert(kvSignals.kvLineCount >= 3, `D2 规格表结构检测（${kvSignals.kvLineCount} 行）`)

// D3: 场景不匹配——规格书内容 + 非规格书场景 → warn
const mismatch = preflightSource([
  'Transfer speeds up to 400MB/s¹ are 4X faster than USB 3.0² drives³.',
], 'ecommerce')
assert(mismatch.length === 1 && mismatch[0].kind === 'scene-mismatch', 'D3 规格书内容+详情页场景 → 场景不匹配 warn')
assert(mismatch[0].severity === 'warn', 'D4 场景不匹配是 warn 级（不阻塞）')

// D5: 规格书内容 + 规格书场景 → 不报
const matchOk = preflightSource([
  'Transfer speeds up to 400MB/s¹ are 4X faster than USB 3.0² drives³.',
], 'spec_sheet')
assert(matchOk.length === 0, 'D5 规格书内容+规格书场景 → 不报（匹配）')

// D6: 普通营销内容 + 详情页场景 → 不报
const normalEcom = preflightSource([
  'Experience the ultimate in portable storage. Fast, reliable, and built to last.',
], 'ecommerce')
assert(normalEcom.length === 0, 'D6 普通营销内容+详情页场景 → 不误报')

// D7: 普通内容 + 规格书场景 → 不报（方向不对称，不反着报）
const normalSpec = preflightSource([
  'Experience the ultimate in portable storage.',
], 'spec_sheet')
assert(normalSpec.length === 0, 'D7 普通内容+规格书场景 → 不报')

// ────────────────────────────────────────────────────────────
console.log('\nE. BatchContext 聚合')

// E1: 规格书场景上下文 → polish 关、bestOf2 恒开（收窄：双跑由 v12.25 含数字信号跳）
const techCtx = new BatchContext('spec_sheet')
assert(techCtx.polishEnabled === false, 'E1 规格书上下文 polishEnabled=false')
assert(techCtx.bestOf2Enabled === true, 'E2 规格书上下文 bestOf2Enabled=true（收窄）')
assert(techCtx.proofreadEnabled === true, 'E3 规格书上下文 proofreadEnabled=true')

// E2: 详情页上下文 → 全开
const ecomCtx = new BatchContext('ecommerce')
assert(ecomCtx.polishEnabled === true && ecomCtx.bestOf2Enabled === true, 'E4 详情页上下文全开')

// E3: consistencyEnabled 联合语义（场景开 AND 未降级）
assert(ecomCtx.consistencyEnabled === true, 'E5 未降级时 consistencyEnabled=true')
ecomCtx.consistencyDegrader.recordTimeout()
ecomCtx.consistencyDegrader.recordTimeout()
ecomCtx.consistencyDegrader.recordTimeout()
assert(ecomCtx.consistencyEnabled === false, 'E6 降级后 consistencyEnabled=false')

// E4: 共享降级器跨批次传递（会话级）
const sharedDeg = new ConsistencyDegrader()
sharedDeg.recordTimeout(); sharedDeg.recordTimeout(); sharedDeg.recordTimeout()
const ctx1 = new BatchContext('ecommerce', sharedDeg)
const ctx2 = new BatchContext('ecommerce', sharedDeg)
assert(ctx1.consistencyEnabled === false && ctx2.consistencyEnabled === false, 'E7 共享降级器跨批次生效')

// E5: 判定表在上下文内可用
ctx1.judgments.set(0, { isGlossaryLocked: true, hasDigits: false, isMarketingSentence: false, polishEligible: false })
assert(ctx1.judgments.get(0)?.isGlossaryLocked === true, 'E8 上下文判定表可用')

// ────────────────────────────────────────────────────────────
console.log('\nG. computeEffectiveToggles（场景策略 AND 用户开关）')

const baseCfg = { apiKey: '', apiUrl: '', model: '', scenePreset: 'ecommerce', enableProofread: true, enableAiOptimize: true } as Parameters<typeof computeEffectiveToggles>[0]

// G1: 详情页 + 用户全开 → 全开
const g1 = computeEffectiveToggles({ ...baseCfg, scenePreset: 'ecommerce' })
assert(g1.polish === true && g1.bestOfN === true && g1.proofread === true, 'G1 详情页+用户全开 → 全开')

// G2: 规格书 + 用户全开 → 场景关润色（bestOf2 收窄后恒开，双跑由 v12.25 含数字信号跳）
const g2 = computeEffectiveToggles({ ...baseCfg, scenePreset: 'spec_sheet' })
assert(g2.polish === false && g2.bestOfN === true, 'G2 规格书+用户全开 → 场景关润色、bestOfN 恒开（收窄）')
assert(g2.proofread === true, 'G2b 规格书保校对')

// G3: 规格书 + 用户关 AI 总开关 → 全关
const g3 = computeEffectiveToggles({ ...baseCfg, scenePreset: 'spec_sheet', enableAiOptimize: false })
assert(g3.polish === false && g3.bestOfN === false && g3.proofread === false, 'G3 关 AI 总开关 → 全关')

// G4: 详情页 + 用户关 polish → polish 关（用户开关也生效，AND 语义）
const g4 = computeEffectiveToggles({ ...baseCfg, scenePreset: 'ecommerce', enablePolish: false })
assert(g4.polish === false && g4.bestOfN === true, 'G4 详情页+用户关 polish → polish 关 bestOfN 开')

// G5: enablePolish/enableBestOfN undefined → 视为开（v12.10.4 默认全开）
const g5 = computeEffectiveToggles({ ...baseCfg, scenePreset: 'ecommerce', enablePolish: undefined, enableBestOfN: undefined })
assert(g5.polish === true && g5.bestOfN === true, 'G5 可选字段 undefined → 视为开')

// ────────────────────────────────────────────────────────────
console.log('\nH. 体检扩展检查项（错词/违禁词/双语混写）')

// H1: 可疑错词（注入 mock 判定器）
const misspelledFindings = preflightSource(
  ['This is normal text', 'Panasionic camera'],
  'ecommerce',
  { sceneMismatch: false, misspelled: true, prohibitedSrc: false, bilingualHint: false },
  { isSuspectMisspelledWord: (s) => s.trim() === 'Panasionic camera' },
)
assert(misspelledFindings.length === 1 && misspelledFindings[0].kind === 'misspelled', 'H1 可疑错词检出')
assert(misspelledFindings[0].severity === 'info', 'H1b 错词是 info 级（不阻塞）')
assert(JSON.stringify(misspelledFindings[0].entryIndices) === '[1]', 'H1c 错词命中条目索引正确')

// H2: 源文违禁词（注入 mock 检测器）
const prohibitedFindings = preflightSource(
  ['Best quality guaranteed', 'Normal text here'],
  'ecommerce',
  { sceneMismatch: false, misspelled: false, prohibitedSrc: true, bilingualHint: false },
  {
    detectProhibited: (text) => text.includes('Best') ? [{ word: 'best', note: '主观绝对化' }] : [],
    detectSourceLangForProhibited: (t) => /[A-Za-z]/.test(t) ? 'en' : null,
  },
)
assert(prohibitedFindings.length === 1 && prohibitedFindings[0].kind === 'prohibited-src', 'H2 源文违禁词检出')
assert(prohibitedFindings[0].severity === 'info', 'H2b 违禁词透出是 info（阻塞走 v12.20 通道，不重复造）')

// H3: 双语混写提示（注入 mock 判定器）
const bilingualFindings = preflightSource(
  ['佳能 Canon', 'Normal text'],
  'ecommerce',
  { sceneMismatch: false, misspelled: false, prohibitedSrc: false, bilingualHint: true },
  { isBilingual: (s) => s.trim() === '佳能 Canon' },
)
assert(bilingualFindings.length === 1 && bilingualFindings[0].kind === 'bilingual-hint', 'H3 双语混写检出')
assert(bilingualFindings[0].severity === 'info', 'H3b 双语混写是 info 级')

// H4: 检查项开关——全关时不报（开关语义）
const allOff = preflightSource(
  ['Panasionic camera', '佳能 Canon'],
  'ecommerce',
  { sceneMismatch: false, misspelled: false, prohibitedSrc: false, bilingualHint: false },
  { isSuspectMisspelledWord: () => true, isBilingual: () => true },
)
assert(allOff.length === 0, 'H4 检查项全关 → 不报（开关语义）')

// H5: 无注入判定器 → 对应检查跳过（向后兼容：不传 detectors 不报错）
const noDetectors = preflightSource(['Some text'], 'ecommerce')
assert(Array.isArray(noDetectors), 'H5 不传 detectors → 不报错（向后兼容）')

// ────────────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
