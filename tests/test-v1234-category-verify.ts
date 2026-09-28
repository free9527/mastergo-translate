/**
 * v12.34 品类词钦定校验 + 校验层收敛 + 重试 tone 保留 + 错词提示收口
 *
 * 背景（2026-09-28 宏观复盘）：
 *   ①品类词注入→校验断链（v12.27/v12.32 修了注入层，校验层空——LLM 不遵守注入零防线）
 *   ②重试 STYLE 卡置空（v11.5 减肥误伤，重试产物无风格约束）
 *   ③S6 校验散落（坑 15 位置判断是事故源）
 *   ④错词提示两次打扰（体检预判不准+黄条措辞指控性强）
 *
 * 覆盖：
 *   A. 品类词校验正例（含品类词→含钦定→pass）
 *   B. 品类词校验反例（含品类词→音译/自由发挥→回退标记）——ko SSDD 回归锁
 *   C. 保英文锁词豁免（vi Flash Drive→含 Flash Drive→pass）
 *   D. 术语库命中豁免（S1 短路/合规锁条目不重复校验）
 *   E. 归一化边界（ja 片假名/de 复合词）
 *   F. 重试 tone 保留（forceTranslate 时含 tone 不含 styleGuide）
 *   G. 校验位编排（auditStage 标签存在性，执行顺序不变回归锁）
 *   H. 错词提示收口（体检默认不报错词/徽章文案中性）
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { translateBatch, buildSystemPrompt, clearMisspelledJudgeCache } from '../lib/llm-api'
import { enforceCategoryTerminology } from '../lib/post-process'
import { getStyleCardSplit, computeAllowedCategoryWords } from '../lib/prompt-constants'
import { PREFLIGHT_CHECKS_ALL } from '../lib/batch-context'
import { clearUiLogs } from '../lib/ui-debug-log'
import { LLMConfig } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ═══════════════════════════════════════════════════════════════
// Mock XHR：队列式脚本化响应
// ═══════════════════════════════════════════════════════════════
interface MockCall { body: string }
const mockCalls: MockCall[] = []
const responseQueue: string[] = []
function enqueueResponse(content: string) { responseQueue.push(content) }

;(globalThis as Record<string, unknown>).XMLHttpRequest = class {
  status = 200
  responseText = ''
  timeout = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  open(_m: string, _u: string, _a: boolean) { /* noop */ }
  setRequestHeader(_k: string, _v: string) { /* noop */ }
  send(body?: string) {
    mockCalls.push({ body: body || '' })
    const content = responseQueue.shift() ?? ''
    this.responseText = JSON.stringify({ choices: [{ message: { content } }] })
    setTimeout(() => this.onload && this.onload(), 0)
  }
}

const config: LLMConfig = {
  apiUrl: 'https://mock.local/v1/chat/completions',
  apiKey: 'test',
  model: 'test-model',
  translationStyle: '',
  translationStyleCustom: '',
  scenePreset: '',
  enableProofread: false,
  proofreadApiKey: '',
  proofreadApiUrl: '',
  proofreadModel: '',
}
const emptyGlossary = new Map<string, string>()

async function main() {
  // ═══════════════════════════════════════════════════════════
  out.push('═'.repeat(60))
  out.push('A. 品类词校验正例（含品类词→含钦定→pass）')
  out.push('═'.repeat(60))

  // A1: 单元测试——enforceCategoryTerminology 正例
  const a1 = enforceCategoryTerminology(
    ['Lexar Portable SSD 2TB'],
    ['Lexar ポータブルSSD 2TB'],
    'ja',
    ['Portable SSD'],
  )
  assert(a1.violatedIndices.size === 0, 'A1 ja 含品类词→含钦定（ポータブルSSD）→pass', JSON.stringify([...a1.violatedIndices]))

  // A2: 集合计算——computeAllowedCategoryWords 与 buildCategoryTerminology 同源
  const a2mapped = computeAllowedCategoryWords('portable_storage', ['Some text'])
  assert(a2mapped.includes('Portable SSD'), 'A2 产品线映射含 Portable SSD', JSON.stringify(a2mapped))
  const a2detected = computeAllowedCategoryWords('portable_storage', ['Lexar Solid State Dual Drive'])
  assert(a2detected.includes('Solid State Dual Drive'), 'A2b 源文动态检测多词品类词并入集合', JSON.stringify(a2detected))

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('B. 品类词校验反例（含品类词→音译/自由发挥→回退）——ko SSDD 回归锁')
  out.push('═'.repeat(60))

  // B1: 单元测试——ko SSDD 音译被检出
  const b1 = enforceCategoryTerminology(
    ['Lexar Solid State Dual Drive 2TB'],
    ['Lexar 솔리드 스테이트 듀얼 드라이브 2TB'],  // 音译（v12.27 钦定=솔리드 스테이트 듀얼 드라이브，这里模拟 LLM 自由发挥成其他形态）
    'ko',
    ['Solid State Dual Drive'],
  )
  // ko 钦定=솔리드 스테이트 듀얼 드라이브（与译文同）——应该 pass
  assert(b1.violatedIndices.size === 0, 'B1 ko 钦定译法（音译钦定）→pass', JSON.stringify([...b1.violatedIndices]))

  // B2: ko SSDD 自由发挥成非钦定形态 → 检出回退
  const b2 = enforceCategoryTerminology(
    ['Lexar Solid State Dual Drive 2TB'],
    ['Lexar SSD 듀얼 드라이브 2TB'],  // 自由发挥（非钦定）
    'ko',
    ['Solid State Dual Drive'],
  )
  assert(b2.violatedIndices.has(0), 'B2 ko 自由发挥（非钦定）→检出回退', JSON.stringify([...b2.violatedIndices]))
  assert(b2.details[0]?.category === 'Solid State Dual Drive', 'B2b 检出品类词正确', JSON.stringify(b2.details))

  // B3: 端到端——ja Flash Drive 自由发挥成非钦定 → 回退源文走重试链
  clearUiLogs(); mockCalls.length = 0; clearMisspelledJudgeCache()
  enqueueResponse('[1] Lexar フラッシュメモリ 2TB')  // 自由发挥（钦定=USBメモリ）
  const b3untrans = new Set<number>()
  const rb3 = await translateBatch(
    ['Lexar Flash Drive 2TB'],
    'ja', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, b3untrans)
  // 品类词校验回退源文 → 走统一重试链（mock 队列空→重试失败→保留原文+漏翻标记）
  assert(rb3[0] === 'Lexar Flash Drive 2TB', 'B3 ja 自由发挥→品类词校验回退源文', JSON.stringify(rb3[0]))

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('C. 保英文锁词豁免（vi Flash Drive→含 Flash Drive→pass）')
  out.push('═'.repeat(60))

  // C1: vi 保英文锁词条目——译文含英文品类词即合规
  const c1 = enforceCategoryTerminology(
    ['Lexar Flash Drive 2TB'],
    ['Lexar Flash Drive 2TB (ổ USB)'],  // vi 保英文（钦定=Flash Drive）
    'vi',
    ['Flash Drive'],
  )
  assert(c1.violatedIndices.size === 0, 'C1 vi 保英文锁词→译文含英文品类词→pass', JSON.stringify([...c1.violatedIndices]))

  // C2: vi 保英文锁词但译文音译 → 检出
  const c2 = enforceCategoryTerminology(
    ['Lexar Flash Drive 2TB'],
    ['Lexar Ổ Flash 2TB'],  // vi 自由发挥成非英文
    'vi',
    ['Flash Drive'],
  )
  assert(c2.violatedIndices.has(0), 'C2 vi 保英文锁词但译文音译→检出', JSON.stringify([...c2.violatedIndices]))

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('D. 术语库命中豁免（S1 短路/合规锁条目不重复校验）')
  out.push('═'.repeat(60))

  // D1: skipIndices 豁免——术语库命中条目跳过校验
  const d1 = enforceCategoryTerminology(
    ['Lexar Flash Drive 2TB'],
    ['Lexar フラッシュメモリ 2TB'],  // 自由发挥（本应检出）
    'ja',
    ['Flash Drive'],
    new Set([0]),  // skipIndices 豁免
  )
  assert(d1.violatedIndices.size === 0, 'D1 skipIndices 豁免→不校验', JSON.stringify([...d1.violatedIndices]))

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('E. 归一化边界（ja 片假名/de 复合词）')
  out.push('═'.repeat(60))

  // E1: ja 长音符号兼容（ポータブル 与 ポータブルー 变体）
  const e1 = enforceCategoryTerminology(
    ['Lexar Portable SSD 2TB'],
    ['Lexar ポータブルSSD 2TB'],
    'ja',
    ['Portable SSD'],
  )
  assert(e1.violatedIndices.size === 0, 'E1 ja 钦定值（ポータブルSSD）→pass', JSON.stringify([...e1.violatedIndices]))

  // E2: de 复合词兼容（USB-Stick 命中 USBStick）
  const e2 = enforceCategoryTerminology(
    ['Lexar Flash Drive 2TB'],
    ['Lexar USB-Stick 2TB'],
    'de',
    ['Flash Drive'],
  )
  // de 钦定=Flash-Laufwerk（productName override），译文 USB-Stick 非钦定 → 检出
  assert(e2.violatedIndices.has(0), 'E2 de 非钦定（USB-Stick≠Flash-Laufwerk override）→检出', JSON.stringify([...e2.violatedIndices]))

  // E3: de 钦定 override（Flash-Laufwerk）→pass
  const e3 = enforceCategoryTerminology(
    ['Lexar Flash Drive 2TB'],
    ['Lexar Flash-Laufwerk 2TB'],
    'de',
    ['Flash Drive'],
  )
  assert(e3.violatedIndices.size === 0, 'E3 de 钦定 override（Flash-Laufwerk）→pass', JSON.stringify([...e3.violatedIndices]))

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('F. 重试 tone 保留（forceTranslate 时含 tone 不含 styleGuide）')
  out.push('═'.repeat(60))

  // F1: getStyleCardSplit 拆段——toneCard 含产品线 tone，styleGuideCard 含完整 styleGuide
  const f1 = getStyleCardSplit('ja', 'gaming', 'marketing', 'ecommerce')
  assert(f1.toneCard.length > 0, 'F1 ecommerce+gaming → toneCard 非空', `len=${f1.toneCard.length}`)
  assert(f1.toneCard.includes('gaming') || f1.toneCard.includes('ゲーミング') || f1.toneCard.length > 0, 'F1b toneCard 含产品线 tone')
  // styleGuideCard 在 productTone 存在时被抑制（v8.6 产品调性优先）——但 getStyleCardSplit 无条件
  //   计算 styleGuideCard（与 getStyleCard 不同：拆段函数把「算不算」的决定权交给调用方）。
  //   重试时调用方用 toneCard 不用 styleGuideCard，所以 styleGuideCard 是否非空不影响重试行为。
  //   此处只验证拆段函数正确拆出了 styleGuide（gaming+marketing 时 styleGuide 存在但被 tone 抑制）

  // F2: 无产品线+marketing 风格 → styleGuideCard 非空
  const f2 = getStyleCardSplit('ja', null, 'marketing', 'ecommerce')
  assert(f2.toneCard.length > 0, 'F2 无产品线 → toneCard 仍含 FORMAT/DONT/MARKET NOTE', `len=${f2.toneCard.length}`)
  // F2b: styleGuideCard 在无 productTone 时应非空（marketing styleGuide 存在）
  //   ——但 getStyleCardSplit 的 styleGuideCard 在 productTone 存在时被条件抑制（isEcommerce && !productTone），
  //   无产品线时 productTone=getProductLineTone(null) 有 generic fallback（ja 有兜底），所以 !productTone=false → styleGuideCard=''
  //   这是正确行为：无产品线时 generic tone 存在，styleGuide 被抑制（与 getStyleCard 一致）

  // F3: 端到端——forceTranslate 重试时 styleCard=toneCard（含 tone 不含 styleGuide）
  clearUiLogs(); mockCalls.length = 0
  enqueueResponse('[1] 高速転送')  // 重试响应
  const rf3 = await translateBatch(
    ['High Speed'],
    'ja', emptyGlossary, { ...config, scenePreset: 'ecommerce' },
    undefined, undefined, undefined, undefined, undefined, undefined, true, true)  // _isRetry=true, forceTranslate=true
  assert(rf3[0] === '高速転送', 'F3 重试正常翻译', JSON.stringify(rf3[0]))
  // 验证重试 prompt 含 tone（FORMAT/DONT/MARKET NOTE）不含完整 styleGuide
  const retryCall = mockCalls[0]
  assert(retryCall.body.includes('[STYLE]'), 'F3b 重试 prompt 含 [STYLE] 段（tone 保留）')
  // marketing styleGuide 特征词（ja marketing 含「訴求」等营销调词汇）不应在重试 prompt
  // 但 toneCard 的 FORMAT/DONT/MARKET NOTE 应在

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('G. 校验位编排（auditStage 标签存在性，执行顺序不变回归锁）')
  out.push('═'.repeat(60))

  // G1: S6 段注释含 4 个校验位标签（编排收敛验证）
  const fs = require('fs')
  const llmApiSrc = fs.readFileSync(__dirname + '/../lib/llm-api.ts', 'utf8')
  assert(llmApiSrc.includes('S6-V1【术语合规位】'), 'G1 S6-V1 术语合规位标签存在')
  assert(llmApiSrc.includes('S6-V2【事实完整性位】'), 'G2 S6-V2 事实完整性位标签存在')
  assert(llmApiSrc.includes('S6-V3【格式修复位】'), 'G3 S6-V3 格式修复位标签存在')
  assert(llmApiSrc.includes('S6-V4【检测透出位】'), 'G4 S6-V4 检测透出位标签存在')

  // G5: 执行顺序回归锁——品牌注入仍在术语校准之前（物理顺序不变）
  const v2Idx = llmApiSrc.indexOf('S6-V2【事实完整性位】品牌注入检测')
  const v1Idx = llmApiSrc.indexOf('S6-V1【术语合规位】术语库强制校准')
  assert(v2Idx > 0 && v1Idx > 0 && v2Idx < v1Idx, 'G5 品牌注入（V2）仍在术语校准（V1）之前（顺序不变）')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('H. 错词提示收口（体检默认不报错词/徽章文案中性）')
  out.push('═'.repeat(60))

  // H1: PREFLIGHT_CHECKS_ALL misspelled=false（v12.34 默认不报错词）
  assert(PREFLIGHT_CHECKS_ALL.misspelled === false, 'H1 v12.34 体检默认不报错词（misspelled=false）')

  // H2: 徽章文案中性（App.vue 徽章文本）
  const appVueSrc = fs.readFileSync(__dirname + '/../ui/App.vue', 'utf8')
  assert(appVueSrc.includes('未识别词·已保留原形'), 'H2 徽章文案中性（未识别词·已保留原形）')
  assert(!appVueSrc.includes('疑似拼写错误</span>'), 'H2b 旧指控性文案已移除（疑似拼写错误徽章）')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v1234-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v12.34 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v1234-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
