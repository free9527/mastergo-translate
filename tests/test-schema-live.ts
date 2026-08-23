/**
 * LLM 输出 schema 化 · 第 0 步实机实测（2026-08-23）
 *
 * 目的：在生产代码改动前，用真实 API（gpt-5.5 中转）+ 真实素材 CSV 验证三件事：
 *
 *   A. ↵（U+21B5）在 JSON string 值中的兼容性 —— 翻译 schema 化的唯一硬技术风险。
 *      实测：json_object 模式下模型输出含 ↵ 的 JSON，JSON.parse 后 ↵ 是否原样还原；
 *      多行单元格（真实 CSV 格）走一遍；真实换行 \n 在 JSON 里的形态（\n 转义 vs 裸字符）。
 *
 *   B. 校对 schema 对比 —— 软约定（现状 prompt，无 response_format）vs
 *      硬约束（response_format json_object + {"results":[...]} 包装）。
 *      各跑 N 次：JSON 可解析率 / 格式服从率（reason 枚举、只输出修改项）/ 修改条数分布。
 *
 *   C. 压力测试 —— 15 条/批（翻译上限）、含 __GLOSSARY_N__/__PRD_N__ 占位符、
 *      含引号/多行/emoji/超长营销文案的真实格，硬约束下是否截断/拒答/格式崩坏。
 *
 * 用法：
 *   npx tsx tests/test-schema-live.ts           # 全部 A+B+C
 *   npx tsx tests/test-schema-live.ts a         # 只跑 A
 *   npx tsx tests/test-schema-live.ts b c
 *
 * 输出：tests/tmp-schema-live-report.txt（结构化报告，人工审阅）
 */

// Node.js 环境 XMLHttpRequest polyfill
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { readFileSync, writeFileSync } from 'fs'
import { parseCSVRow } from '../lib/parse-csv'

// ============================================================
// 配置（与 test-v115-live-translation.ts 同一实机 API）
// ============================================================
const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
const MODEL = 'gpt-5.5'

// ============================================================
// 最小 API 客户端（不依赖 lib/llm-api —— 实测要完全控制 body）
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
// 工具：JSON 可解析性检查 + ↵ 形态分析
// ============================================================
function tryParseJson(content: string): { ok: boolean; value?: any; err?: string } {
  try {
    return { ok: true, value: JSON.parse(content) }
  } catch (e) {
    return { ok: false, err: (e as Error).message.slice(0, 120) }
  }
}

/** 统计字符串中 ↵ 的字面字符数 vs 转义序列数（原始 content 层面） */
function countReturnSymbols(raw: string): { literal: number; escapedUnicode: number; realNewline: number } {
  return {
    literal: (raw.match(/↵/g) || []).length,
    escapedUnicode: (raw.match(/\\u21b5/gi) || []).length,
    realNewline: (raw.match(/\n/g) || []).length,
  }
}

// ============================================================
// 真实素材：从 CSV 取含多行/引号/emoji 的真实格
// ============================================================
const CSV_DIR = '测试文本素材/'

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

/** 从 PLAY PRO microSD CSV 取 EN 列真实内容格 */
function loadRealCells(): string[] {
  const raw = readFileSync(CSV_DIR + 'Card 卡类-OW&AMZ小语种翻译 - PLAY PRO microSD.csv', 'utf-8').replace(/^﻿/, '')
  const records = splitCsvRecords(raw)
  const header = parseCSVRow(records[2])
  const enCol = header.findIndex(h => h.trim() === 'EN')
  const cells: string[] = []
  for (let i = 3; i < records.length; i++) {
    if (!records[i].trim()) continue
    const rowCells = parseCSVRow(records[i])
    const src = (rowCells[enCol] || '').trim()
    if (src) cells.push(src)
  }
  return cells
}

// ============================================================
// 报告收集
// ============================================================
const report: string[] = []
function log(line: string) {
  console.log(line)
  report.push(line)
}

// ============================================================
// A 段：↵ 兼容性实测
// ============================================================
async function runA() {
  log('\n╔══ A 段：↵（U+21B5）JSON 兼容性实测 ══╗')

  // A1：直接要求模型输出含 ↵ 的 JSON object
  log('\n── A1: json_object 模式下输出含 ↵ 的 JSON ──')
  const a1 = await callApiRaw({
    system: 'You are a JSON generator. Output ONLY a valid JSON object.',
    user: `Output a JSON object: {"translations":[{"i":1,"text":"<line1>↵<line2>"}]} where <line1> is "Read speed up to 205MB/s" and <line2> is "Write speed up to 140MB/s". The ↵ between them must be the literal Unicode character U+21B5, NOT a real newline and NOT an escape sequence.`,
    responseFormat: { type: 'json_object' },
  })
  const a1Stats = countReturnSymbols(a1.content)
  const a1Parse = tryParseJson(a1.content)
  log(`  原始返回: ${a1.raw}`)
  log(`  ↵ 字面字符: ${a1Stats.literal} 个；\\u21b5 转义: ${a1Stats.escapedUnicode} 个；真实换行: ${a1Stats.realNewline} 个`)
  log(`  JSON.parse: ${a1Parse.ok ? '✅ 成功' : `❌ 失败 ${a1Parse.err}`}`)
  if (a1Parse.ok) {
    const text = a1Parse.value?.translations?.[0]?.text ?? ''
    const hasLiteral = text.includes('↵')
    const hasRealNl = text.includes('\n')
    log(`  parse 后 text 含字面 ↵: ${hasLiteral ? '✅' : '❌'}；含真实换行: ${hasRealNl ? '⚠️ 是' : '否'}`)
    log(`  parse 后 text: ${JSON.stringify(text)}`)
    if (!hasLiteral) log('  ⛔ A1 失败：JSON 模式下 ↵ 未按字面字符保留')
  } else {
    log(`  原始 content 前 300 字: ${a1.content.slice(0, 300)}`)
  }

  // A2：真实多行 CSV 格（格内换行 → 插件管道会转成 ↵），要求 JSON 输出
  log('\n── A2: 真实多行 CSV 格 → JSON 输出 ↵ 还原 ──')
  const realCells = loadRealCells()
  const multiLineCell = realCells.find(c => c.includes('\n')) || realCells[0]
  const withMarker = multiLineCell.replace(/\n+/g, ' ↵ ')
  log(`  素材格（前 120 字）: ${withMarker.slice(0, 120)}`)
  const a2 = await callApiRaw({
    system: 'You translate Lexar product content from English to German. Output ONLY a valid JSON object. The ↵ symbol is a LITERAL CHARACTER, NOT a line break — preserve it as the character "↵" in your output strings.',
    user: `Translate this text to German. Output JSON: {"translations":[{"i":1,"text":"..."}]}\n\n[1] "${withMarker}"`,
    responseFormat: { type: 'json_object' },
  })
  const a2Stats = countReturnSymbols(a2.content)
  const a2Parse = tryParseJson(a2.content)
  log(`  原始返回: ${a2.raw}`)
  log(`  ↵ 字面字符: ${a2Stats.literal} 个；\\u21b5 转义: ${a2Stats.escapedUnicode} 个`)
  log(`  JSON.parse: ${a2Parse.ok ? '✅ 成功' : `❌ 失败 ${a2Parse.err}`}`)
  if (a2Parse.ok) {
    const text = a2Parse.value?.translations?.[0]?.text ?? ''
    const srcMarkerCount = (withMarker.match(/↵/g) || []).length
    const outMarkerCount = (text.match(/↵/g) || []).length
    log(`  源文 ↵ 数: ${srcMarkerCount}；译文 ↵ 数: ${outMarkerCount} ${outMarkerCount >= srcMarkerCount ? '✅ 保留' : '⚠️ 减少'}`)
    log(`  译文（前 150 字）: ${JSON.stringify(text.slice(0, 150))}`)
  }

  // A3：无 response_format 对照组（软约定）
  log('\n── A3: 软约定对照组（无 response_format，prompt 要求 JSON）──')
  const a3 = await callApiRaw({
    system: 'You are a JSON generator. Output ONLY a valid JSON object, no other text.',
    user: `Output a JSON object: {"translations":[{"i":1,"text":"<line1>↵<line2>"}]} where <line1> is "Read speed up to 205MB/s" and <line2> is "Write speed up to 140MB/s". The ↵ must be the literal Unicode character U+21B5.`,
  })
  const a3Parse = tryParseJson(a3.content)
  log(`  JSON.parse: ${a3Parse.ok ? '✅ 成功' : `❌ 失败 ${a3Parse.err}`}`)
  if (a3Parse.ok) {
    const text = a3Parse.value?.translations?.[0]?.text ?? ''
    log(`  parse 后含字面 ↵: ${text.includes('↵') ? '✅' : '❌'}`)
  } else {
    log(`  content 前 200 字: ${a3.content.slice(0, 200)}`)
  }

  log('\n── A 段结论 ──')
  log('  （人工审阅上方数据：↵ 字面保留 ✅/❌ 决定翻译 schema 化可行性）')
}

// ============================================================
// B 段：校对 schema 对比（软约定 vs 硬约束）
// ============================================================

/** 构造 8 条带典型错误的校对素材（源文 en → 译文 zh-CN） */
function buildProofreadCases(): Array<{ source: string; trans: string; expectFix: boolean; note: string }> {
  return [
    { source: 'Read speed up to 205MB/s', trans: '读取速度高达205MB/s', expectFix: false, note: '正确译文' },
    { source: 'Lexar Professional SILVER PLUS SDXC UHS-II Card', trans: 'Lexar專業級 SILVER PLUS SDXC UHS-II 記憶卡', expectFix: true, note: '品牌直译 Professional→專業級（术语库锁定 zh-CN 应为专业）' },
    { source: 'Transfer photos and videos quickly', trans: 'Transfer photos and videos quickly', expectFix: true, note: '整句漏翻（src===trans）' },
    { source: 'Up to 2TB capacity', trans: '容量高达2TB，满足您所有存储需求，轻松应对各种场景', expectFix: true, note: '多翻加戏' },
    { source: 'Waterproof, shockproof, and X-ray proof', trans: '防水防震防X光', expectFix: false, note: '正确简洁译文' },
    { source: 'Limited Lifetime Warranty', trans: '有限终身质保', expectFix: false, note: '术语库锁定值（v11.12+ 豁免场景）' },
    { source: 'Works with DJI Osmo Action 6', trans: '兼容DJI Osmo Action 6运动相机', expectFix: true, note: '第三方型号后加品类词（v11.8 事故型）' },
    { source: 'PCIe 5.0 NVMe M.2 2280 SSD', trans: 'PCIe 5.0 NVMe M.2 2280 SSD', expectFix: false, note: '规格行合法同形' },
  ]
}

const PROOFREAD_SYS_SOFT = `You are a localization QA reviewer for Lexar storage products. Review translations against source.
Output ONLY a valid JSON array. No other text.
- All correct → output: []
- Errors exist → output array of correction objects.
JSON Schema: [{"i":<1-based index>,"text":"<corrected translation>","reason":"<one of: 漏翻|多翻|语义错误|术语错误|语法错误|拼写错误|标点错误|一致性问题>","ambiguous":[]}]
Only include items that NEED correction.`

const PROOFREAD_SYS_HARD = `You are a localization QA reviewer for Lexar storage products. Review translations against source.
Output ONLY a valid JSON object with a single key "results" whose value is an array.
- All correct → output: {"results":[]}
- Errors exist → output: {"results":[{"i":<1-based index>,"text":"<corrected translation>","reason":"<one of: 漏翻|多翻|语义错误|术语错误|语法错误|拼写错误|标点错误|一致性问题>","ambiguous":[]}]}
Only include items that NEED correction.`

async function runB() {
  log('\n╔══ B 段：校对 schema 对比（软约定 vs 硬约束）══╗')
  const cases = buildProofreadCases()
  const userMsg = cases.map((c, i) => `[${i + 1}] (en→zh-CN) ${c.source}\nTrans：${c.trans}`).join('\n')
  const RUNS = 10  // 2026-08-23 补跑：3→10 次/组，确认 [7] 型号类错误抓取率是否有统计差异

  log(`  素材: ${cases.length} 条（${cases.filter(c => c.expectFix).length} 条预期应改）× ${RUNS} 次/组`)

  for (const mode of ['soft', 'hard'] as const) {
    log(`\n── ${mode === 'soft' ? '软约定（现状）' : '硬约束（json_object + results 包装）'} ──`)
    let parseOk = 0
    let formatOk = 0
    const fixCounts: number[] = []
    const reasonEnumOk: boolean[] = []
    const VALID_REASONS = new Set(['漏翻', '多翻', '语义错误', '术语错误', '语法错误', '拼写错误', '标点错误', '一致性问题'])

    for (let run = 0; run < RUNS; run++) {
      try {
        const res = await callApiRaw({
          system: mode === 'soft' ? PROOFREAD_SYS_SOFT : PROOFREAD_SYS_HARD,
          user: userMsg,
          responseFormat: mode === 'hard' ? { type: 'json_object' } : undefined,
        })
        const parsed = tryParseJson(res.content)
        if (!parsed.ok) { log(`  run${run + 1}: ❌ JSON 解析失败 ${parsed.err}`); continue }
        parseOk++
        const arr: any[] = mode === 'soft'
          ? (Array.isArray(parsed.value) ? parsed.value : parsed.value?.results ?? [])
          : (parsed.value?.results ?? [])
        if (!Array.isArray(arr)) { log(`  run${run + 1}: ❌ 结构不符（非 array）`); continue }
        formatOk++
        fixCounts.push(arr.length)
        const allReasonOk = arr.every((e: any) => VALID_REASONS.has(e.reason))
        reasonEnumOk.push(allReasonOk)
        const fixedIdx = arr.map((e: any) => e.i).sort((a: number, b: number) => a - b).join(',')
        log(`  run${run + 1}: 改 ${arr.length} 条 [${fixedIdx || '无'}] reason枚举${allReasonOk ? '✅' : '⚠️越界'}`)
        for (const e of arr) {
          const c = cases[e.i - 1]
          if (c) log(`    [${e.i}] ${e.reason}: ${String(e.text).slice(0, 70)}${!c.expectFix ? ' ⚠️改了预期正确的' : ''}`)
        }
      } catch (e) {
        log(`  run${run + 1}: ❌ 调用异常 ${(e as Error).message.slice(0, 100)}`)
      }
    }
    log(`  ── ${mode} 汇总: JSON可解析 ${parseOk}/${RUNS}，结构服从 ${formatOk}/${RUNS}，修改条数 [${fixCounts.join(',')}]，reason枚举全合规 ${reasonEnumOk.every(Boolean) ? '✅' : '⚠️'} ──`)
  }
}

// ============================================================
// C 段：压力测试（15 条/批 + 占位符 + 引号/多行/emoji/超长）
// ============================================================
async function runC() {
  log('\n╔══ C 段：压力测试（硬约束下极端形态）══╗')

  // C1：15 条满批 + 占位符 + 引号 + 多行 + emoji + 超长营销文案
  log('\n── C1: 15 条满批混合极端形态（json_object）──')
  const stressItems = [
    'Read speed up to 205MB/s. Write speed up to 140MB/s.',
    'Lexar® Professional SILVER PLUS SDXC™ UHS-II Card __GLOSSARY_0__',
    'Transfer 4K videos and RAW photos in seconds',
    'Waterproof, temperature-proof, shockproof, and X-ray proof',
    'Up to 2TB capacity for all your content',
    'Compatible with DJI Mavic 4 Pro / GoPro Hero 13 Black / Nintendo Switch OLED',
    'Limited Lifetime Warranty',
    '"The fastest card I\'ve ever used" — Professional Photographer Magazine',
    'Line one of marketing copy ↵ Line two with more details ↵ Line three concludes',
    'Get yours today! 🚀 Limited time offer',
    'PCIe 5.0 NVMe M.2 2280 SSD with heatsink',
    'Panasionic compatible devices supported',  // 故意错词
    'MB/s*',
    'A1 / A7M4 / A9III / A6700',
    'This is an extremely long marketing sentence designed to stress test the JSON output mode with a verbose description that goes on and on about read speeds, write speeds, capacities, compatibility with dozens of devices, warranty terms, environmental certifications, and promotional language that pushes the boundaries of what a single product description should contain, exceeding 400 characters to test whether JSON mode truncates or mangles long outputs.',
  ]
  const userMsg = stressItems.map((s, i) => `[${i + 1}] (en→zh-CN) "${s}"`).join('\n')
  const c1 = await callApiRaw({
    system: `You translate Lexar storage product content from English to Simplified Chinese.
Output ONLY a valid JSON object: {"translations":[{"i":<1-based index>,"text":"<translation>"}]}
⛔ The ↵ symbol is a LITERAL CHARACTER, NOT a line break — preserve it as "↵".
⛔ Placeholders like __GLOSSARY_0__ must be preserved exactly.
⛔ All 15 items must be present in the output array.`,
    user: userMsg,
    temperature: 0.2,
    responseFormat: { type: 'json_object' },
  })
  const c1Parse = tryParseJson(c1.content)
  log(`  原始返回: ${c1.raw}`)
  log(`  JSON.parse: ${c1Parse.ok ? '✅' : `❌ ${c1Parse.err}`}`)
  if (c1Parse.ok) {
    const arr: any[] = c1Parse.value?.translations ?? []
    log(`  返回条数: ${arr.length}/15 ${arr.length === 15 ? '✅' : '⛔ 缺条'}`)
    const withPlaceholder = arr.find((e: any) => String(e.text).includes('__GLOSSARY_0__'))
    log(`  占位符保留: ${withPlaceholder ? '✅ [2]含 __GLOSSARY_0__' : '⚠️ 未检出（检查[2]）'}`)
    const multiLine = arr.find((e: any) => e.i === 9)
    if (multiLine) {
      const markerCount = (String(multiLine.text).match(/↵/g) || []).length
      log(`  [9]多行 ↵ 数: ${markerCount}/2 ${markerCount >= 2 ? '✅' : '⚠️'}`)
    }
    const longOne = arr.find((e: any) => e.i === 15)
    if (longOne) log(`  [15]超长句译文长度: ${String(longOne.text).length} 字符 ${String(longOne.text).length > 50 ? '✅ 未截断' : '⛔ 疑似截断'}`)
    for (const e of arr) log(`    [${e.i}] ${String(e.text).slice(0, 60)}`)
  } else {
    log(`  content 前 400 字: ${c1.content.slice(0, 400)}`)
  }

  // C2：同一批跑软约定对照（[N] 逐行格式，现状翻译管道）
  log('\n── C2: 同批软约定对照（[N] 逐行，现状）──')
  const c2 = await callApiRaw({
    system: `You translate Lexar storage product content from English to Simplified Chinese.
Format: "[N] translated text" — one line per item. Plain text only.
⛔ The ↵ symbol is a LITERAL CHARACTER, NOT a line break — output it as the characters "↵".
⛔ Placeholders like __GLOSSARY_0__ must be preserved exactly.`,
    user: userMsg,
    temperature: 0.2,
  })
  const c2Lines = c2.content.split('\n').filter(l => /^\s*\[\d+\]/.test(l) || /^\s*\d+\./.test(l))
  log(`  原始返回: ${c2.raw}`)
  log(`  匹配 [N]/N. 行数: ${c2Lines.length}/15 ${c2Lines.length >= 15 ? '✅' : '⚠️'}`)
  log(`  ↵ 字面字符: ${countReturnSymbols(c2.content).literal} 个`)

  log('\n── C 段结论 ──')
  log('  （人工对比 C1 vs C2：硬约束完整性/占位符/↵/超长 vs 软约定）')
}

// ============================================================
// main
// ============================================================
async function main() {
  const parts = process.argv.slice(2).map(s => s.toLowerCase())
  const runAll = parts.length === 0
  log(`schema 化第 0 步实机实测 — ${new Date().toISOString()}`)
  log(`API: ${API_URL} model=${MODEL}`)

  if (runAll || parts.includes('a')) await runA()
  if (runAll || parts.includes('b')) await runB()
  if (runAll || parts.includes('c')) await runC()

  writeFileSync('tests/tmp-schema-live-report.txt', report.join('\n'), 'utf-8')
  console.log('\n报告已写入 tests/tmp-schema-live-report.txt')
}

main().catch(e => {
  console.error('实测脚本异常:', e)
  writeFileSync('tests/tmp-schema-live-report.txt', report.join('\n') + `\n\n异常中止: ${e.message}`, 'utf-8')
  process.exit(1)
})
