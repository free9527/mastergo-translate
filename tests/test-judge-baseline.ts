/**
 * judge 基线脚本 — 去机翻感阶段 C（v12.1，2026-08-25）
 *
 * 目的：用 LLM 人设模拟（judge-personas.ts）给「我方译文」+「官方 CSV 译文」
 *       打三维分数（naturalness/tone/fidelity，1-5），建立机翻感量化基线，
 *       支撑版本间回归对比与方案 A 的灰度闸门。
 *
 * 方法论声明（所有报告必带，⛔ 违反即误用）：
 *   1. judge = LLM 人设模拟，置信度低于真人母语评审
 *   2. fidelity 维度以代码校验为准，judge 仅软信号
 *   3. 只允许差分对比结论（版本 A vs 版本 B），不允许绝对分数结论
 *
 * 架构：
 *   翻译段：复用 test-v115-live-translation.ts 生产管道（translateBatch + proofreadBatch）
 *   judge 段：复用 test-schema-live.ts 裸 XHR callApiRaw（json_object 硬约束）
 *   --judge-only 模式：跳过翻译，读 --input 的 JSON（B/A 前后对比用）
 *
 * 用法：
 *   npx tsx tests/test-judge-baseline.ts                          # PLAY PRO，默认 zh-CN de
 *   npx tsx tests/test-judge-baseline.ts zh-CN ja --concurrency 2
 *   npx tsx tests/test-judge-baseline.ts --persona-check zh-CN    # C0.5 人设校准（只翻译+judge，报告含完整译文供人工核对）
 *   npx tsx tests/test-judge-baseline.ts --judge-only --input tests/tmp-judge-baseline-play-pro-microsd-zh-CN.json --lang zh-CN
 *   npx tsx tests/test-judge-baseline.ts --polish de es ru tr --concurrency 2   # v12.4 迭代 4：润色灰度验证（产物带 -polish 后缀，与 B 前基线对比）
 *
 * 输出：
 *   tests/tmp-judge-baseline-<slug>-<lang>.json  机器可读（完整译文不截断 + 每格 4 次评分 + 均值/方差）
 *   tests/tmp-judge-baseline-<slug>-summary.txt  人工审阅（语种×维度均值 + 最低分格 TOP5 + 官方译文参照分）
 */

// Node.js 环境 XMLHttpRequest polyfill（fetchWithRetry 内部用 XHR）
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { translateBatch, proofreadBatch, buildTaskGlossaryHint, personaJudgeBatch, polishBatch } from '../lib/llm-api'
import { isPolishEligible } from '../lib/polish-guard'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV } from '../lib/default-glossary'
import { parseCSVRow } from '../lib/parse-csv'
import { getJudgePersonas, personaSupportedLangs } from '../lib/judge-personas'
import { LLMConfig } from '../messages/types'

// ============================================================
// 配置（v12.1 定稿：judge/翻译实测统一用 gpt-5.5——用户 2026-08-25 拍板「最终选用 GPT」。
// kimi/kimi-k3 试跑结论：对非拉丁文字语种（ar/th/id）JSON 输出 parse_fail 率 25-50%，
// 0 分污染均值（ar 报告值 1.85 vs 剔除 0 分后真实值 3.71）——不可用，弃。
// ============================================================
const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
const MODEL = 'gpt-5.5'

const config: LLMConfig = {
  apiKey: API_KEY,
  apiUrl: API_URL,
  model: MODEL,
  translationStyle: 'standard',
  translationStyleCustom: '',
  scenePreset: 'ecommerce',
  manualProductLine: undefined,
  enableProofread: true,
  proofreadApiKey: API_KEY,
  proofreadApiUrl: API_URL,
  proofreadModel: MODEL,
}

if (!API_KEY) {
  console.error('⛔ 环境变量 ANTHROPIC_AUTH_TOKEN 未设置——judge/翻译用的 kimi token 从这里读（Claude Code 会话同款）')
  process.exit(1)
}

const CSV_DIR = '测试文本素材/'
const DEFAULT_CSV = 'Card 卡类-OW&AMZ小语种翻译 - PLAY PRO microSD.csv'

const CSV_COL_TO_LANG: Record<string, string> = {
  '德DE': 'de', '法FR': 'fr', '西班牙ES': 'es', '意大利IT': 'it', '波兰PL': 'pl',
  '阿拉伯AR': 'ar', '日本JP': 'ja', '中文CN': 'zh-CN', '台湾TC': 'zh-TW',
  '越南VN': 'vi', '荷兰NL': 'nl', '瑞典SE': 'sv', '土耳其TR': 'tr',
}

const ALL_JUDGE_LANGS = ['zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'pt-BR', 'it', 'nl', 'pl', 'sv', 'tr', 'ru', 'vi', 'th', 'id', 'ar']

const JUDGE_REPEAT = 2          // 每人设重复次数（× 2 人设 = 每格 4 次评分）
const JUDGE_BATCH = 8           // judge 每批格数（防单批过长输出截断）
const VARIANCE_FLAG = 1.0       // 方差超过此值标记「评分不稳定」
const PERSONA_GAP_FLAG = 1.5    // 两人设均值差超过此值标记「人设敏感」

// v12.4 迭代 4：--polish 模式（润色灰度验证）——与生产灰度白名单一致
// v12.12: 白名单对齐生产 v12.10.4（润色全语种生效，闸门已移除）——ja/zh-TW 不再被跳过
const POLISH_MODE = process.argv.includes('--polish')
const POLISH_GRAY_LANGS = ['de', 'es', 'ru', 'tr', 'ja', 'zh-TW', 'zh-CN', 'ko', 'fr', 'pt', 'pt-BR', 'it', 'nl', 'pl', 'sv', 'vi', 'th', 'id', 'ar']

// ============================================================
// CSV 解析（RFC 4180 多行单元格，与 v115 脚本同逻辑）
// ============================================================
function splitCsvRecords(text: string): string[] {
  const records: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      cur += ch
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      }
    } else if (ch === '"') {
      inQuotes = true
      cur += ch
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      records.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) records.push(cur)
  return records
}

interface CsvEntry { source: string; official: Record<string, string> }

function parseTestCsv(csvPath: string): CsvEntry[] {
  const raw = readFileSync(csvPath, 'utf-8').replace(/^﻿/, '')
  const records = splitCsvRecords(raw)
  const header = parseCSVRow(records[2])
  const enCol = header.findIndex(h => h.trim() === 'EN')
  if (enCol < 0) throw new Error('CSV 缺 EN 列')
  const langCols: Array<{ col: number; lang: string }> = []
  for (let i = 0; i < header.length; i++) {
    const lang = CSV_COL_TO_LANG[header[i].trim()]
    if (lang) langCols.push({ col: i, lang })
  }
  const entries: CsvEntry[] = []
  for (let i = 3; i < records.length; i++) {
    if (!records[i].trim()) continue
    const cells = parseCSVRow(records[i])
    const source = (cells[enCol] || '').trim()
    if (!source) continue
    const official: Record<string, string> = {}
    for (const { col, lang } of langCols) {
      const v = (cells[col] || '').trim()
      if (v) official[lang] = v
    }
    entries.push({ source, official })
  }
  return entries
}

// ============================================================
// 术语库加载（与 v115 脚本同逻辑）
// ============================================================
interface GlossaryEntry { source: string; translations: Record<string, string> }

function parseGlossary(csv: string): GlossaryEntry[] {
  const records = splitCsvRecords(csv.replace(/^﻿/, '').trim())
  const header = parseCSVRow(records[0])
  const entries: GlossaryEntry[] = []
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

function buildGlossaryMap(entries: GlossaryEntry[], targetLang: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const g of entries) {
    const t = g.translations[targetLang]
    if (t) map.set(g.source, t)
  }
  for (const g of entries) {
    const tgt = g.translations[targetLang]
    if (!tgt) continue
    for (const [lang, srcVal] of Object.entries(g.translations)) {
      if (lang === targetLang) continue
      if (srcVal && !map.has(srcVal)) map.set(srcVal, tgt)
    }
  }
  return map
}

// ============================================================
// 裸 API 客户端（不依赖 lib/llm-api —— judge 要完全控制 body，同 schema-live 模式）
// ============================================================
interface ApiCallOpts {
  system: string
  user: string
  temperature?: number
  responseFormat?: { type: 'json_object' }
}

async function callApiRaw(opts: ApiCallOpts): Promise<{ content: string; raw: string }> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    temperature: opts.temperature ?? 0.1,
  }
  if (opts.responseFormat) body.response_format = opts.responseFormat

  const resText = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', API_URL, true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${API_KEY}`)
    xhr.timeout = 90000
    xhr.onload = () => resolve(xhr.responseText)
    xhr.onerror = () => reject(new Error('XHR network error'))
    xhr.ontimeout = () => reject(new Error('XHR timeout'))
    xhr.send(JSON.stringify(body))
  })

  let data: any
  try { data = JSON.parse(resText) } catch { throw new Error(`API 返回非 JSON: ${resText.slice(0, 200)}`) }
  if (data.error) throw new Error(`API error: ${JSON.stringify(data.error).slice(0, 300)}`)
  const content: string = data.choices?.[0]?.message?.content || ''
  const finishReason: string = data.choices?.[0]?.finish_reason || ''
  return { content, raw: `finish_reason=${finishReason} len=${content.length}` }
}

// ============================================================
// judge prompt 与解析
// ============================================================
const DIMS = ['naturalness', 'tone', 'fidelity'] as const
type Dim = typeof DIMS[number]

interface ScoreEntry { i: number; naturalness: number; tone: number; fidelity: number; note: string }

function buildJudgeSystem(personaText: string, targetLang: string): string {
  return `${personaText}

You will be given source texts (English) and their ${targetLang} translations from a product listing.
Read the translations AS YOUR PERSONA, then score each on three dimensions (1-5 integers):

1. naturalness — Does it read like something written natively in ${targetLang}, not translated?
   1 = obviously machine-translated (calqued word order, wrong collocations)
   3 = understandable but with noticeable translation flavor
   5 = indistinguishable from native copywriting
2. tone — Does the tone fit how YOU (your persona) expect this kind of product to speak to you?
   1 = completely wrong register (reads like a manual when it should sell, or vice versa)
   3 = acceptable but bland
   5 = exactly the voice that would win your trust
3. fidelity — Compare against the source: any missing/added/wrong facts (numbers, specs, terms)?
   For this dimension you may switch to rigorous comparison mode.
   1 = missing or fabricated key facts
   3 = minor information drift
   5 = facts match 1:1

Output ONLY a valid JSON object:
{"scores":[{"i":<1-based index>,"naturalness":<1-5>,"tone":<1-5>,"fidelity":<1-5>,"note":"<one-sentence gut reaction AS YOUR PERSONA, in ${targetLang}>"}]}
- Include ALL items — "i" must match the input [N] indices exactly
- Raw JSON only, no markdown code blocks, no explanations outside the JSON`
}

function buildJudgeUser(sources: string[], translations: string[], startIdx: number): string {
  return translations.map((t, k) => {
    const n = startIdx + k + 1
    const src = sources[startIdx + k].replace(/\n/g, ' ↵ ')
    const trans = t.replace(/\n/g, ' ↵ ')
    return `[${n}] Source: ${src}\nTranslation: ${trans}`
  }).join('\n\n')
}

/** 平衡括号提取 {"scores":[...]}（v12.0 教训：贪婪正则被内容文本击穿，找键→平衡括号→parse） */
function extractScoresObject(text: string): { scores: ScoreEntry[] } | null {
  let searchFrom = 0
  while (true) {
    const keyIdx = text.indexOf('"scores"', searchFrom)
    if (keyIdx < 0) return null
    // 向前回溯最近的 {
    let braceStart = -1
    for (let k = keyIdx - 1; k >= 0; k--) {
      if (text[k] === '{') { braceStart = k; break }
      if (text[k] === '}') break
    }
    if (braceStart < 0) { searchFrom = keyIdx + 8; continue }
    // 平衡括号扫描（字符串/转义状态机）
    let depth = 0
    let inStr = false
    let esc = false
    for (let k = braceStart; k < text.length; k++) {
      const c = text[k]
      if (esc) { esc = false; continue }
      if (c === '\\' && inStr) { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          try {
            const obj = JSON.parse(text.slice(braceStart, k + 1))
            if (obj && Array.isArray(obj.scores)) return obj
          } catch { /* 找下一个 */ }
          break
        }
      }
    }
    searchFrom = keyIdx + 8
  }
}

function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : NaN
  if (!isFinite(n)) return 0
  return Math.max(1, Math.min(5, Math.round(n)))
}

// ============================================================
// 统计
// ============================================================
interface CellJudgement {
  index: number
  runs: Array<{ persona: string; run: number; naturalness: number; tone: number; fidelity: number; note: string }>
  mean: Record<Dim, number>
  variance: Record<Dim, number>
  personaGap: number       // 两人设 naturalness 均值差
  flags: string[]
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

function variance(nums: number[]): number {
  if (nums.length < 2) return 0
  const m = mean(nums)
  return nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length
}

function summarizeCell(index: number, runs: CellJudgement['runs'], personaIds: string[]): CellJudgement {
  const dims: Record<Dim, number[]> = { naturalness: [], tone: [], fidelity: [] }
  for (const r of runs) {
    dims.naturalness.push(r.naturalness)
    dims.tone.push(r.tone)
    dims.fidelity.push(r.fidelity)
  }
  const flags: string[] = []
  // v12.1: 有效样本数标记（parse_fail 已剔除——runs 可能 <4；<2 时均值不可信）
  if (runs.length < 2) flags.push(`有效样本不足(${runs.length}/4)`)
  const m = { naturalness: mean(dims.naturalness), tone: mean(dims.tone), fidelity: mean(dims.fidelity) }
  const v = { naturalness: variance(dims.naturalness), tone: variance(dims.tone), fidelity: variance(dims.fidelity) }
  if (runs.length >= 2 && (v.naturalness > VARIANCE_FLAG || v.tone > VARIANCE_FLAG || v.fidelity > VARIANCE_FLAG)) flags.push('评分不稳定(方差大)')
  // 人设间 naturalness 均值差
  const byPersona = new Map<string, number[]>()
  for (const r of runs) {
    if (!byPersona.has(r.persona)) byPersona.set(r.persona, [])
    byPersona.get(r.persona)!.push(r.naturalness)
  }
  const personaMeans = personaIds.map(id => mean(byPersona.get(id) || []))
  const gap = personaMeans.length === 2 ? Math.abs(personaMeans[0] - personaMeans[1]) : 0
  if (gap > PERSONA_GAP_FLAG) flags.push('人设敏感(两人设差>1.5)')
  return { index, runs, mean: m, variance: v, personaGap: gap, flags }
}

// ============================================================
// judge 执行（一格 × 2 人设 × JUDGE_REPEAT 次）
// ============================================================
async function judgeTranslations(
  sources: string[],
  translations: string[],
  targetLang: string,
  productLine: string | undefined,
  label: string,
): Promise<CellJudgement[]> {
  const personas = getJudgePersonas(targetLang, productLine)
  if (personas.length === 0) throw new Error(`语种 ${targetLang} 无人设（judge-personas.ts 未覆盖）`)
  const personaIds = personas.map(p => p.id)

  const allRuns: CellJudgement['runs'][] = translations.map(() => [])

  for (const persona of personas) {
    const system = buildJudgeSystem(persona.text, targetLang)
    for (let rep = 0; rep < JUDGE_REPEAT; rep++) {
      for (let b = 0; b < translations.length; b += JUDGE_BATCH) {
        const batchTrans = translations.slice(b, b + JUDGE_BATCH)
        const user = buildJudgeUser(sources, batchTrans, b)
        let parsed: { scores: ScoreEntry[] } | null = null
        try {
          const { content } = await callApiRaw({ system, user, temperature: 0.1, responseFormat: { type: 'json_object' } })
          parsed = extractScoresObject(content)
        } catch (e) {
          console.log(`    ⚠ judge 调用异常（${persona.id} rep${rep} 批${b}）: ${(e as Error).message.slice(0, 80)}`)
        }
        if (!parsed) {
          console.log(`    ⚠ judge 输出解析失败（${persona.id} rep${rep} 批${b}），该批跳过（不记 0 分——v12.1 教训：kimi 对 ar/th/id 的 JSON 服从性差，parse_fail 记 0 会污染均值）`)
          continue
        }
        // i 索引映射防乱序（v12.0 教训）
        const byI = new Map<number, ScoreEntry>()
        for (const s of parsed.scores) byI.set(s.i, s)
        for (let k = 0; k < batchTrans.length; k++) {
          const s = byI.get(b + k + 1)
          // 缺 i 的条目跳过不记 0 分（parse 成功但个别条目缺失≠条目质量差）
          if (s) {
            allRuns[b + k].push({ persona: persona.id, run: rep, naturalness: clampScore(s.naturalness), tone: clampScore(s.tone), fidelity: clampScore(s.fidelity), note: String(s.note || '').slice(0, 200) })
          }
        }
      }
    }
    console.log(`    ${label} ${persona.id} 评分完成`)
  }

  return allRuns.map((runs, i) => summarizeCell(i, runs, personaIds))
}

// ============================================================
// 报告
// ============================================================
interface LangReport {
  lang: string
  csv: string
  timestamp: string
  methodology: string
  cells: Array<{
    index: number
    source: string
    mine: string
    official: string
    mineJudgement: CellJudgement
    officialJudgement: CellJudgement | null
  }>
  summary: {
    mine: Record<Dim, number>
    official: Record<Dim, number> | null
    unstableCells: number
    personaSensitiveCells: number
  }
}

const METHODOLOGY = 'judge=LLM人设模拟(judge-personas.ts)，置信度低于真人母语评审；fidelity以代码校验为准，judge仅软信号；只允许差分对比结论，不允许绝对分数结论'

function buildReport(lang: string, csvName: string, cells: LangReport['cells']): LangReport {
  const mineMeans: Record<Dim, number[]> = { naturalness: [], tone: [], fidelity: [] }
  const offMeans: Record<Dim, number[]> = { naturalness: [], tone: [], fidelity: [] }
  let unstable = 0
  let personaSensitive = 0
  for (const c of cells) {
    for (const d of DIMS) mineMeans[d].push(c.mineJudgement.mean[d])
    if (c.mineJudgement.flags.length) unstable++
    if (c.mineJudgement.personaGap > PERSONA_GAP_FLAG) personaSensitive++
    if (c.officialJudgement) {
      for (const d of DIMS) offMeans[d].push(c.officialJudgement.mean[d])
    }
  }
  return {
    lang,
    csv: csvName,
    timestamp: new Date().toISOString(),
    methodology: METHODOLOGY,
    cells,
    summary: {
      mine: { naturalness: mean(mineMeans.naturalness), tone: mean(mineMeans.tone), fidelity: mean(mineMeans.fidelity) },
      official: offMeans.naturalness.length
        ? { naturalness: mean(offMeans.naturalness), tone: mean(offMeans.tone), fidelity: mean(offMeans.fidelity) }
        : null,
      unstableCells: unstable,
      personaSensitiveCells: personaSensitive,
    },
  }
}

function fmtSummary(report: LangReport): string[] {
  const s = report.summary
  const f = (v: number) => v.toFixed(2)
  const lines = [
    `── ${report.lang} ──`,
    `  我方译文: naturalness=${f(s.mine.naturalness)} tone=${f(s.mine.tone)} fidelity=${f(s.mine.fidelity)}（${report.cells.length} 格）`,
  ]
  if (s.official) {
    lines.push(`  官方译文: naturalness=${f(s.official.naturalness)} tone=${f(s.official.tone)} fidelity=${f(s.official.fidelity)}（参照锚点，${report.cells.filter(c => c.officialJudgement).length} 格）`)
  }
  lines.push(`  ⚠评分不稳定: ${s.unstableCells} 格 / 人设敏感: ${s.personaSensitiveCells} 格`)
  // 最低分 TOP5
  const worst = [...report.cells].sort((a, b) => a.mineJudgement.mean.naturalness - b.mineJudgement.mean.naturalness).slice(0, 5)
  if (worst.length && worst[0].mineJudgement.mean.naturalness < 4) {
    lines.push(`  最低 naturalness 格:`)
    for (const c of worst) {
      if (c.mineJudgement.mean.naturalness >= 4) break
      lines.push(`    [${c.index + 1}] nat=${c.mineJudgement.mean.naturalness.toFixed(1)} ${c.mineJudgement.flags.join(' ')}`)
      lines.push(`      源文: ${c.source.replace(/\n+/g, ' ↵ ').slice(0, 100)}`)
      lines.push(`      译文: ${c.mine.replace(/\n+/g, ' ↵ ').slice(0, 100)}`)
    const note = c.mineJudgement.runs.find(r => r.note && r.note !== 'PARSE_FAIL' && r.note !== 'MISSING_I')
      if (note) lines.push(`      人设反应: ${note.note.slice(0, 100)}`)
    }
  }
  lines.push('')
  return lines
}

// ============================================================
// 翻译段（复用 v115 生产管道路径）
// ============================================================
async function translateEntries(entries: CsvEntry[], lang: string): Promise<string[]> {
  const glossaryEntries = parseGlossary(DEFAULT_GLOSSARY_PRODUCTS_CSV)
  const glossaryMap = buildGlossaryMap(glossaryEntries, lang)
  const allSources = entries.map(e => e.source)
  const taskGlossaryHint = buildTaskGlossaryHint(glossaryMap, config.scenePreset, allSources)

  console.log(`  翻译 ${allSources.length} 格...`)
  const results = await translateBatch(
    allSources, lang, glossaryMap, config,
    undefined, undefined, undefined, taskGlossaryHint, undefined,
    false, false, undefined, new Set(), new Set(), new Set(), new Set(),
  )

  // v12.4 迭代 4 灰度验证：--polish 模式下插入生产同款润色管道
  // （与 App.vue startTranslate 同路径：资格过滤→人设判定→润色→硬锁回退）。
  // 对照组 = 不传 --polish 的同脚本输出（B 前基线 tests/baseline-pre-b/）。
  // normalizedGlossaryMap：isPolishEligible 的术语库锁定判定用 cleanKey 口径
  // （小写+剥®™©+连字符→空格+空白折叠——与 post-process cleanKey 同规则，
  // 此处本地实现与 App.vue 的 normalizedGlossaryMap 构建对齐）。
  if (POLISH_MODE && POLISH_GRAY_LANGS.includes(lang)) {
    const normalizedMap = new Map<string, string>()
    for (const [k, v] of glossaryMap) normalizedMap.set(k.toLowerCase().replace(/[®™©]/g, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim(), v)
    try {
      const eligibleIndices: number[] = []
      for (let j = 0; j < allSources.length; j++) {
        if (isPolishEligible(allSources[j], results[j] || '', lang, normalizedMap)) eligibleIndices.push(j)
      }
      console.log(`  润色资格: ${allSources.length}条→eligible ${eligibleIndices.length}条`)
      let applied = 0, reverted = 0
      if (eligibleIndices.length > 0) {
        const eligibleSources = eligibleIndices.map(j => allSources[j])
        const eligibleTrans = eligibleIndices.map(j => results[j] || '')
        const judgeHits = await personaJudgeBatch(eligibleSources, eligibleTrans, lang, config, undefined)
        console.log(`  人设判定: 命中 ${judgeHits.size}条${judgeHits.size > 0 ? ' ' + [...judgeHits.keys()].map(i => `[${i + 1}]`).join('') : ''}`)
        if (judgeHits.size > 0) {
          const hitIndices = [...judgeHits.keys()]
          const polishedResults = await polishBatch(eligibleSources, eligibleTrans, hitIndices, judgeHits, lang, config, glossaryMap)
          for (const pr of polishedResults) {
            const origIdx = eligibleIndices[pr.index]
            if (pr.polished) {
              applied++
              console.log(`  润色生效: [${origIdx + 1}] "${(results[origIdx] || '').slice(0, 50)}" → "${pr.text.slice(0, 50)}"`)
              results[origIdx] = pr.text
            } else {
              reverted++
              console.log(`  硬锁回退: [${origIdx + 1}] ${pr.reason || '未知原因'}`)
            }
          }
        }
      }
      console.log(`  润色汇总: eligible ${eligibleIndices.length} / 生效 ${applied} / 回退 ${reverted}`)
    } catch (e) {
      console.log(`  润色管道异常（用未润色译文继续）: ${(e as Error).message.slice(0, 80)}`)
    }
  } else if (POLISH_MODE) {
    console.log(`  --polish 已传但 ${lang} 不在灰度白名单（${POLISH_GRAY_LANGS.join('/')}），跳过润色`)
  }

  console.log(`  校对...`)
  const proofItems = entries.map((e, i) => ({ sourceText: e.source, translatedText: results[i] }))
  let final = [...results]
  try {
    const pr = await proofreadBatch(proofItems, lang, glossaryMap, config, undefined, undefined, taskGlossaryHint, undefined, undefined)
    const changes = pr.map((r, i) => ({ i, text: r.text })).filter(r => r.text && r.text !== results[r.i])
    for (const c of changes) final[c.i] = c.text
    console.log(`  校对修改 ${changes.length} 条`)
  } catch (e) {
    console.log(`  校对异常（用未校对译文继续）: ${(e as Error).message.slice(0, 80)}`)
  }
  return final
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const rawArgs = process.argv.slice(2)
  const getArg = (name: string) => {
    const i = rawArgs.indexOf(name)
    return i >= 0 ? rawArgs[i + 1] : undefined
  }
  const csvName = getArg('--csv') || DEFAULT_CSV
  const csvPath = CSV_DIR + csvName
  const productSlug = csvName.replace(/\.csv$/i, '').match(/([\w ]+)$/i)?.[1]?.trim().replace(/\s+/g, '-').toLowerCase() || 'out'
  const concIdx = rawArgs.indexOf('--concurrency')
  const concurrency = concIdx >= 0 ? parseInt(rawArgs[concIdx + 1], 10) || 1 : 1
  const judgeOnlyInput = rawArgs.includes('--judge-only') ? getArg('--input') : undefined
  const personaCheck = getArg('--persona-check')
  const positionalLangs = rawArgs.filter((a, i) =>
    !a.startsWith('--') &&
    rawArgs[i - 1] !== '--csv' &&
    rawArgs[i - 1] !== '--concurrency' &&
    rawArgs[i - 1] !== '--input' &&
    rawArgs[i - 1] !== '--persona-check'
  )
  const targetLangs = (personaCheck ? [personaCheck] : positionalLangs.length > 0 ? positionalLangs : ['zh-CN', 'de'])
    .filter(l => l !== 'en')

  // 启动校验：judge 语种人设覆盖
  const supported = new Set(personaSupportedLangs())
  for (const l of targetLangs) {
    if (!supported.has(l)) throw new Error(`语种 ${l} 无人设覆盖——judge-personas.ts 先补人设再跑`)
  }

  const entries = parseTestCsv(csvPath)
  console.log(`解析 CSV: ${csvPath}（${entries.length} 格），目标语种: ${targetLangs.join(', ')}`)
  if (personaCheck) console.log(`★ persona-check 校准模式：judge 结果含完整译文与 note，供人工核对`)

  const summaryAll: string[] = []
  summaryAll.push(`judge 基线报告 — ${csvName}（${new Date().toISOString()}）`)
  summaryAll.push(`方法论: ${METHODOLOGY}`)
  summaryAll.push('')

  async function runLang(lang: string): Promise<string[]> {
    console.log(`\n═══ ${lang} ═══`)
    let mine: string[]
    let loadedFrom: string | undefined
    if (judgeOnlyInput) {
      // --judge-only：从已有 JSON 读译文（B/A 前后对比复用同一批译文才可比）
      const prev: LangReport = JSON.parse(readFileSync(judgeOnlyInput, 'utf-8'))
      mine = prev.cells.map(c => c.mine)
      loadedFrom = judgeOnlyInput
      console.log(`  judge-only 模式：译文来自 ${loadedFrom}`)
    } else {
      mine = await translateEntries(entries, lang)
    }

    console.log(`  judge 我方译文（2 人设 × ${JUDGE_REPEAT} 次）...`)
    const mineJudgements = await judgeTranslations(entries.map(e => e.source), mine, lang, undefined, '我方')

    // 官方译文参照锚点（只评有官方译文的格；不进 judge 输入防锚定——独立调用）
    const officialIndices = entries.map((e, i) => e.official[lang] ? i : -1).filter(i => i >= 0)
    let officialJudgements: (CellJudgement | null)[] = entries.map(() => null)
    if (officialIndices.length > 0) {
      console.log(`  judge 官方译文（${officialIndices.length} 格，参照锚点）...`)
      const judged = await judgeTranslations(
        officialIndices.map(i => entries[i].source),
        officialIndices.map(i => entries[i].official[lang]),
        lang, undefined, '官方',
      )
      officialIndices.forEach((cellIdx, k) => { officialJudgements[cellIdx] = judged[k] })
    }

    const report = buildReport(lang, csvName, entries.map((e, i) => ({
      index: i,
      source: e.source,
      mine: mine[i] || '',
      official: e.official[lang] || '',
      mineJudgement: mineJudgements[i],
      officialJudgement: officialJudgements[i],
    })))

    const jsonPath = `tests/tmp-judge-baseline-${productSlug}${POLISH_MODE ? '-polish' : ''}-${lang}.json`
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8')
    console.log(`  → ${jsonPath}`)
    return fmtSummary(report)
  }

  const langSummaryMap = new Map<string, string[]>()
  for (let i = 0; i < targetLangs.length; i += concurrency) {
    const batch = targetLangs.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(l => runLang(l)))
    batch.forEach((l, j) => langSummaryMap.set(l, batchResults[j]))
  }
  for (const lang of targetLangs) {
    summaryAll.push(...(langSummaryMap.get(lang) || []))
  }

  const summaryPath = `tests/tmp-judge-baseline-${productSlug}-summary.txt`
  writeFileSync(summaryPath, summaryAll.join('\n'), 'utf-8')
  console.log(`\n汇总: ${summaryPath}`)
  console.log(summaryAll.join('\n'))
}

main().catch(e => { console.error('脚本失败:', e); process.exit(1) })
