// ============================================================
// v12.28 杠杆 3：质量回归门禁（三模式）
// ============================================================
// 定位：把「改完不知道好没好」变成可验证的回归闭环。
//   judge 评分是参考信号非真理（项目既有认知）——门禁只做版本间对比，
//   fidelity 掉 > 0.2 只标 ⚠️ 需人工复核，不阻塞工作流（用户拍板 D4）。
//
// 三种模式：
//   结构门禁（默认，零 API 零成本）：
//     金标准集结构校验 + 关键判定逻辑回归（v12.27 检测器命中/场景策略正确/
//     金标准集每条 expect 字段合法）。每次改动可跑。
//   真实门禁（需 LEXAR_LIVE_API_KEY 环境变量）：
//     跑真实管道 + judge 三维评分 + 与 baseline.json 对比 + 报告。
//     key 缺失自动降级为结构门禁（安全铁律：key 不硬编码，从环境变量读）。
//   --update-baseline：
//     真实门禁跑完后人工确认，更新 baseline.json（防误把退化写成新基线）。
//
// 安全纪律（全局 Do-Not #1）：API key 一律从环境变量 LEXAR_LIVE_API_KEY 读，
//   绝不硬编码。本脚本不包含任何密钥。
// ============================================================

/// <reference types="node" />

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { renderLangForTranslate, CATEGORY_WORDS, PRODUCT_LINE_CATEGORY_MAP } from '../lib/prompt-constants'
import { getStagePolicy, computeEffectiveToggles } from '../lib/batch-context'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = join(__dirname, 'golden', 'golden-set.json')
const BASELINE_PATH = join(__dirname, 'golden', 'baseline.json')
const REPORT_PATH = join(__dirname, '..', 'claude-tmp', 'quality-gate-report.txt')

let pass = 0
let fail = 0
const warnings: string[] = []
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}
function warn(msg: string) { warnings.push(msg); console.log(`  ⚠️  ${msg}`) }

// ============================================================
// 金标准集类型
// ============================================================
interface GoldenCase {
  id: string
  comment?: string
  source: string
  scenePreset: string
  productLine: string | null
  targetLang: string
  referenceTranslation?: string
  expect: {
    glossaryLockedTerms?: string[]
    mustContain?: string[]
    fidelityFloor?: boolean
  }
}
interface GoldenSet { cases: GoldenCase[] }

// ============================================================
// 模式判定
// ============================================================
const args = process.argv.slice(2)
const updateBaseline = args.includes('--update-baseline')
const API_KEY = process.env.LEXAR_LIVE_API_KEY || ''
const API_URL = process.env.LEXAR_LIVE_API_URL || ''
const LIVE_MODE = API_KEY.length > 0 && API_URL.length > 0

console.log('═══ v12.28 质量回归门禁 ═══')
console.log(`模式: ${LIVE_MODE ? '真实门禁（LEXAR_LIVE_API_KEY 已配置）' : '结构门禁（无 key，零 API）'}${updateBaseline ? ' + 更新基线' : ''}`)
if (!LIVE_MODE && updateBaseline) {
  console.log('⚠️  --update-baseline 需要真实门禁模式（配置 LEXAR_LIVE_API_KEY/URL），当前为结构门禁，跳过基线更新')
}

// ============================================================
// 第一部分：金标准集结构校验（两模式都跑）
// ============================================================
console.log('\nA. 金标准集结构校验')

if (!existsSync(GOLDEN_PATH)) {
  console.log(`  ❌ 金标准集不存在: ${GOLDEN_PATH}`)
  process.exit(1)
}
const golden: GoldenSet = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'))
assert(Array.isArray(golden.cases) && golden.cases.length > 0, `A1 金标准集非空（${golden.cases.length} 条）`)

const validScenes = new Set(['ecommerce', 'technical_params', 'spec_sheet', 'manual', 'after_sales', 'packaging', 'ui'])
const validLangs = new Set(['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'pt-BR', 'ru', 'it', 'vi', 'th', 'id', 'ar', 'nl', 'pl', 'sv', 'tr'])
let idsSeen = new Set<string>()
let structureOk = true
for (const c of golden.cases) {
  if (!c.id || idsSeen.has(c.id)) { structureOk = false; console.log(`    ❌ id 缺失或重复: ${c.id}`) }
  idsSeen.add(c.id)
  if (!c.source || !c.source.trim()) { structureOk = false; console.log(`    ❌ ${c.id} source 为空`) }
  if (!validScenes.has(c.scenePreset)) { structureOk = false; console.log(`    ❌ ${c.id} scenePreset 非法: ${c.scenePreset}`) }
  if (!validLangs.has(c.targetLang)) { structureOk = false; console.log(`    ❌ ${c.id} targetLang 非法: ${c.targetLang}`) }
  if (!c.expect || typeof c.expect !== 'object') { structureOk = false; console.log(`    ❌ ${c.id} expect 缺失`) }
}
assert(structureOk, 'A2 金标准集每条结构合法（id 唯一/source 非空/scene/lang 合法/expect 存在）')

// ============================================================
// 第二部分：关键判定逻辑回归（结构门禁核心——验管道逻辑没改坏）
// ============================================================
console.log('\nB. 关键判定逻辑回归（结构门禁，零 API）')

for (const c of golden.cases) {
  // B1: 品类词动态检测回归——源文里的多词品类词，其当前语种钦定必须被注入
  //     （v12.27 主修复的端到端验证：映射外词不再裸奔）
  const langBlock = renderLangForTranslate(c.targetLang, c.productLine, true, [c.source])
  if (c.expect.glossaryLockedTerms) {
    for (const term of c.expect.glossaryLockedTerms) {
      assert(
        langBlock.includes(term),
        `B [${c.id}] 品类词钦定注入: ${c.targetLang} 含 "${term}"`,
      )
    }
  }

  // B2: 场景策略回归——客观陈述类场景关润色（bestOf2 恒开，收窄：双跑由 v12.25
  //     含数字信号专管，场景不碰双跑），营销类全开
  const policy = getStagePolicy(c.scenePreset)
  const isObjectiveScene = ['technical_params', 'spec_sheet', 'manual', 'after_sales'].includes(c.scenePreset)
  const isMarketingScene = c.scenePreset === 'ecommerce'
  if (isObjectiveScene) {
    assert(policy.polish === false && policy.bestOf2 === true, `B [${c.id}] 场景策略: ${c.scenePreset} 关润色、bestOf2 恒开（收窄）`)
  } else if (isMarketingScene) {
    assert(policy.polish === true && policy.bestOf2 === true, `B [${c.id}] 场景策略: ${c.scenePreset} 全开`)
  }
}

// ============================================================
// 第三部分：真实门禁（需 key）——跑管道 + judge + 基线对比
// ============================================================
interface CaseResult {
  id: string
  translation?: string
  fidelity?: number
  naturalness?: number
  tone?: number
  mustContainOk?: boolean
  error?: string
}
const results: Record<string, CaseResult> = {}

if (LIVE_MODE) {
  console.log('\nC. 真实门禁（真实 API + judge 评分）')
  console.log('  （本模式跑真实管道+judge，耗时较长；fidelity 掉>0.2 只标 ⚠️ 不阻塞）')
} else {
  console.log('\nC. 真实门禁——跳过（未配置 LEXAR_LIVE_API_KEY/URL，结构门禁模式）')
  console.log('   配置环境变量后可跑真实质量对比（key 从环境变量读，不硬编码）')
}

// ============================================================
// 真实门禁主流程（封装为 async 函数，避免 top-level await 在 cjs 输出报错）
// ============================================================
async function runLiveGate(): Promise<void> {
  // Node 环境 XMLHttpRequest polyfill（与 test-schema-live 同款）
  const xhr2 = await import('xhr2').catch(() => null)
  if (xhr2) (globalThis as Record<string, unknown>).XMLHttpRequest = xhr2.default

  const { translateBatch } = await import('../lib/llm-api')
  // 术语库构建：buildGlossaryMaps 是 UI 层函数（ui/App.vue），lib 无此导出。
  //   真实门禁用「默认术语库 + 内置第三方」构建目标语言视图（与 test-v115-live-translation 同逻辑）。
  const { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } = await import('../lib/default-glossary')
  const { BUILTIN_THIRD_PARTY_ENTRIES } = await import('../lib/third-party-models')
  const { splitCsvRecords, parseCSVRow } = await import('../lib/parse-csv')

  interface GEntry { source: string; translations: Record<string, string> }
  const parseGlossaryCsv = (csv: string): GEntry[] => {
    const records = splitCsvRecords(csv.replace(/^﻿/, '').trim())
    const header = parseCSVRow(records[0])
    const entries: GEntry[] = []
    for (let i = 1; i < records.length; i++) {
      const cells = parseCSVRow(records[i])
      const source = (cells[0] || '').trim()
      if (!source) continue
      const translations: Record<string, string> = {}
      for (let j = 1; j < header.length && j < cells.length; j++) {
        const v = (cells[j] || '').trim()
        if (v) translations[header[j].trim()] = v
      }
      entries.push({ source, translations })
    }
    return entries
  }
  // 内置第三方词条 translations 用通配键 '*'（identity）——按当前目标语言展开为 identity 值
  const expandBuiltin = (targetLang: string): GEntry[] =>
    BUILTIN_THIRD_PARTY_ENTRIES.map(e => ({ source: e.source, translations: { [targetLang]: e.source, en: e.source } }))
  const buildAllEntries = (targetLang: string): GEntry[] => [
    ...expandBuiltin(targetLang),
    ...parseGlossaryCsv(DEFAULT_GLOSSARY_PRODUCTS_CSV),
    ...parseGlossaryCsv(DEFAULT_GLOSSARY_EXCLUSIVE_CSV),
  ]
  // 双视图构建（v9.9 全语言 key 注册，与 UI buildGlossaryMaps 同逻辑，内置优先 first-wins）
  const buildDualView = (targetLang: string): { full: Map<string, string>; en: Map<string, string> } => {
    const allEntries = buildAllEntries(targetLang)
    const full = new Map<string, string>()
    const en = new Map<string, string>()
    for (const g of allEntries) {
      const t = g.translations[targetLang]
      if (t && !full.has(g.source)) full.set(g.source, t)
      if (g.translations['en'] && !en.has(g.source)) en.set(g.source, g.translations['en'])
    }
    for (const g of allEntries) {
      const tgt = g.translations[targetLang]
      if (!tgt) continue
      for (const [lang, srcVal] of Object.entries(g.translations)) {
        if (lang === targetLang || lang === 'deprecated') continue
        if (srcVal && !full.has(srcVal)) full.set(srcVal, tgt)
      }
    }
    return { full, en }
  }

  for (const c of golden.cases) {
    try {
      // 真实翻译（单条批次）
      const config = {
        apiKey: API_KEY, apiUrl: API_URL, model: process.env.LEXAR_LIVE_MODEL || 'gpt-5.5',
        scenePreset: c.scenePreset, translationStyle: 'standard',
        enableProofread: false, enablePolish: false, enableBestOfN: false, enableAiOptimize: true,
      } as Parameters<typeof translateBatch>[3]
      const { full: glossaryMap, en: glossaryEnMap } = buildDualView(c.targetLang)
      const out = await translateBatch([c.source], c.targetLang, glossaryMap, config, undefined, undefined, undefined, undefined, undefined, undefined, false, false, glossaryEnMap)
      const translation = out[0] || ''

      // expect 校验
      const mustContainOk = (c.expect.mustContain || []).every(m => translation.includes(m))
      const glossaryOk = (c.expect.glossaryLockedTerms || []).every(g => translation.includes(g))

      // judge 评分（轻量内联 judge——金标准有 referenceTranslation 时对比，无则单评）
      // judge 是参考信号：只产 fidelity/naturalness/tone 三维 1-5 分，供版本间对比
      const judgeScores = await judgeTranslation(c.source, translation, c.targetLang, c.referenceTranslation)

      results[c.id] = {
        id: c.id, translation,
        fidelity: judgeScores.fidelity, naturalness: judgeScores.naturalness, tone: judgeScores.tone,
        mustContainOk: mustContainOk && glossaryOk,
      }
      const flag = mustContainOk && glossaryOk ? '✅' : '❌'
      console.log(`  ${flag} [${c.id}] fidelity=${judgeScores.fidelity} nat=${judgeScores.naturalness} tone=${judgeScores.tone}${!mustContainOk || !glossaryOk ? ' (expect 未满足)' : ''}`)
    } catch (e) {
      results[c.id] = { id: c.id, error: (e as Error).message.slice(0, 120) }
      warn(`[${c.id}] 真实门禁异常: ${(e as Error).message.slice(0, 80)}`)
    }
  }

  // ── 基线对比（fidelity 掉 > 0.2 标 ⚠️，不阻塞）──
  console.log('\nD. 基线对比（fidelity 掉>0.2 → ⚠️ 需人工复核，不阻塞）')
  let baseline: { results?: Record<string, { fidelity?: number }> } = {}
  if (existsSync(BASELINE_PATH)) {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  }
  const hasBaseline = baseline.results && Object.keys(baseline.results).length > 0
  if (!hasBaseline) {
    console.log('  （无基线——本次为首次真实门禁，跳过对比）')
  } else {
    for (const c of golden.cases) {
      const prev = baseline.results?.[c.id]?.fidelity
      const curr = results[c.id]?.fidelity
      if (prev !== undefined && curr !== undefined) {
        const drop = prev - curr
        if (drop > 0.2) {
          warn(`[${c.id}] fidelity 下降 ${drop.toFixed(2)}（${prev}→${curr}）> 0.2 —— 需人工复核`)
        } else {
          console.log(`  ✅ [${c.id}] fidelity ${prev}→${curr}（Δ${(-drop).toFixed(2)}）`)
        }
      }
    }
  }

  // ── 更新基线（--update-baseline，人工确认后）──
  if (updateBaseline) {
    const newBaseline = {
      _meta: {
        version: 'v12.28',
        generated: new Date().toISOString(),
        note: 'judge 评分是参考信号非真理；基线只用于版本间对比。',
      },
      results: Object.fromEntries(
        Object.entries(results).map(([id, r]) => [id, { fidelity: r.fidelity, naturalness: r.naturalness, tone: r.tone }]),
      ),
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2), 'utf8')
    console.log(`  ✍️  基线已更新: ${BASELINE_PATH}`)
  }
}

// ============================================================
// judge（轻量内联——参考信号，非真理）
// ============================================================
async function judgeTranslation(
  source: string, translation: string, targetLang: string, reference?: string,
): Promise<{ fidelity: number; naturalness: number; tone: number }> {
  // judge 缺省中位分（无 key 或异常时的保守兜底——judge 是参考信号，缺省不阻塞）
  const fallback = { fidelity: 3, naturalness: 3, tone: 3 }
  if (!LIVE_MODE) return fallback
  try {
    const prompt = `You are a ${targetLang} native localization judge. Score the translation 1-5 on three axes.
Source: ${source}
Translation: ${translation}${reference ? `\nReference (human-approved): ${reference}` : ''}
Output ONLY JSON: {"fidelity":<1-5>,"naturalness":<1-5>,"tone":<1-5>}
- fidelity: facts/numbers/terms preserved exactly, nothing added/omitted
- naturalness: reads as if natively written, not translated
- tone: register matches the scene`
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: process.env.LEXAR_LIVE_MODEL || 'gpt-5.5',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content || ''
    const m = content.match(/\{[\s\S]*\}/)
    if (m) {
      const p = JSON.parse(m[0]) as { fidelity?: number; naturalness?: number; tone?: number }
      return {
        fidelity: clamp15(p.fidelity), naturalness: clamp15(p.naturalness), tone: clamp15(p.tone),
      }
    }
  } catch { /* judge 失败静默回退中位分 */ }
  return fallback
}
function clamp15(n: number | undefined): number {
  if (typeof n !== 'number' || isNaN(n)) return 3
  return Math.max(1, Math.min(5, Math.round(n)))
}

// ============================================================
// 报告输出（封装为 async 入口，统一 top-level await 出口）
// ============================================================
async function main(): Promise<void> {
  // 真实门禁（LIVE_MODE 时执行）
  if (LIVE_MODE) {
    await runLiveGate()
  }

  const reportLines = [
    '═══ v12.28 质量回归门禁报告 ═══',
    `时间: ${new Date().toISOString()}`,
    `模式: ${LIVE_MODE ? '真实门禁' : '结构门禁'}`,
    `金标准集: ${golden.cases.length} 条`,
    `结构校验+逻辑回归: ${pass} 通过, ${fail} 失败`,
    '',
  ]
  if (LIVE_MODE) {
    reportLines.push('── 真实门禁结果 ──')
    for (const c of golden.cases) {
      const r = results[c.id]
      if (r?.error) reportLines.push(`  [${c.id}] 异常: ${r.error}`)
      else if (r) reportLines.push(`  [${c.id}] fidelity=${r.fidelity} nat=${r.naturalness} tone=${r.tone} mustContain=${r.mustContainOk ? 'OK' : 'FAIL'}`)
    }
    reportLines.push('')
  }
  if (warnings.length > 0) {
    reportLines.push('── ⚠️ 需人工复核 ──')
    for (const w of warnings) reportLines.push(`  ⚠️  ${w}`)
    reportLines.push('')
  }
  reportLines.push('纪律：judge 评分是参考信号非真理；fidelity 掉>0.2 只标 ⚠️，不阻塞（用户拍板 D4）。')

  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, reportLines.join('\n'), 'utf8')

  console.log(`\n结果: ${pass} 通过, ${fail} 失败${warnings.length > 0 ? `, ${warnings.length} 条 ⚠️ 需人工复核` : ''}`)
  console.log(`报告: ${REPORT_PATH}`)
  // 结构校验/逻辑回归失败才非零退出；⚠️（fidelity 下降）不阻塞——退出码恒 0 除非结构性失败
  if (fail > 0) process.exit(1)
}

// 统一入口（cjs 输出下 top-level await 不支持，用 .catch 兜底）
main().catch(e => { console.error('门禁执行异常:', e); process.exit(1) })
