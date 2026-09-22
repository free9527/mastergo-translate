/**
 * v12.23 说明书/规格书「文档模式」实机探测——上下文注入 + prompt 精简 三组对比
 *
 * 背景（用户拍板）：说明性文档按「有上下文」处理（详情页=短句独立 / 说明书=长段落有上下文）。
 * 本脚本不调生产管道，用真实 prompt 组装（operation_guide 场景卡）+ 裸 XHR 模拟三组配置，
 * 对比官方译文（CSV 内 es/ja 列），验证两件事：
 *   1. 上下文注入（前1+后1 源文参考）对说明书翻译质量提升多少
 *   2. 说明书 prompt 精简（删 marketing/few-shot/机翻味词表）后质量是否不降、token 降多少
 *
 * 三组配置：
 *   ① 基线   = 详情页默认组装（CORE_LEAN + MISSION + operation_guide 场景 + CONTEXT 独立句），无上下文
 *   ② 上下文 = ① + 每条带前1+后1 源文参考块
 *   ③ 精简+上下文 = 精简版说明书 prompt（无 few-shot/无 marketing/机翻味词表）+ 上下文
 *
 * 素材：规格书说明书/Product Info_Pexar DPF_2026 - PX-125说明书.csv（EN 源，es/ja 官方译文对照）
 * 用法：npx tsx tests/test-v1223-manual-scenario.ts [es|ja|both]
 * 产物：tests/tmp-manual-scenario-<lang>.json + tmp-manual-scenario-report.md
 */
import { readFileSync, writeFileSync } from 'fs'
// Node.js 环境 XMLHttpRequest polyfill（与 test-judge-baseline.ts 同款）
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest
import { parseCSVRow } from '../lib/parse-csv'
import {
  IDENTITY_MISSION,
  CORE_PRINCIPLES_LEAN,
  CORE_PRINCIPLES_LEAN_ZH,
  SCENE_CONSTRAINTS,
} from '../lib/prompt-constants'

// ── API 配置（与 test-judge-baseline.ts 同款，真实网关 gpt-5.5）──
const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
const MODEL = 'gpt-5.5'

// ── 目标语种：es / ja ──
const argLang = process.argv[2] || 'both'
const TARGET_LANGS = argLang === 'both' ? ['es', 'ja'] : [argLang]

// CSV 列映射（这份 CSV 表头与测试文本素材不同）
const CSV_COL_TO_LANG: Record<string, string> = {
  '西班牙 ES': 'es', '日语': 'ja',
}

// ── CSV 解析（RFC 4180 多行单元格）──
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
    } else if (ch === '"') { inQuotes = true; cur += ch }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      records.push(cur); cur = ''
    } else cur += ch
  }
  if (cur.trim()) records.push(cur)
  return records
}

interface ManualEntry { source: string; official: Record<string, string> }

function parseManualCsv(csvPath: string): ManualEntry[] {
  const raw = readFileSync(csvPath, 'utf-8').replace(/^﻿/, '')
  const records = splitCsvRecords(raw)
  const header = parseCSVRow(records[0])
  const enCol = header.findIndex(h => h.trim() === '英文EN')
  if (enCol < 0) throw new Error('CSV 缺 英文EN 列')
  const langCols: Array<{ col: number; lang: string }> = []
  for (let i = 0; i < header.length; i++) {
    const lang = CSV_COL_TO_LANG[header[i].trim()]
    if (lang) langCols.push({ col: i, lang })
  }
  const entries: ManualEntry[] = []
  for (let i = 1; i < records.length; i++) {
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

// ── 场景卡组装（operation_guide，与生产 getStyleCard 的场景部分同语义）──
function buildSceneBlock(targetLang: string): string {
  const scene = SCENE_CONSTRAINTS['operation_guide']
  if (!scene) return ''
  const lines: string[] = [...scene.universal]
  const override = scene.langOverrides[targetLang] || []
  lines.push(...override)
  return '\n[SCENE·operation_guide]\n' + lines.join('\n')
}

// ── CONTEXT 块（与 buildSystemPrompt 同语义，独立句 vs 文档上下文两版）──
function contextBlockIndependent(isZh: boolean): string {
  return isZh
    ? '\n[上下文] 同一设计文件中的独立 UI 字符串。逐条独立翻译。相同源文术语在条目间保持译文一致。'
    : '\n[CONTEXT] Independent UI strings from the same design file. Translate each entry independently. When the same source term appears across entries, use the same target term.'
}
function contextBlockDocument(isZh: boolean): string {
  return isZh
    ? '\n[上下文] 本批条目来自同一份说明书文档，按文档阅读顺序排列、前后语义连贯。逐条翻译，但术语/指代/表述须与上下文条目保持一致。'
    : '\n[CONTEXT] These entries come from the SAME instruction manual, in reading order, with continuous context. Translate each entry, but keep terminology, references, and phrasing consistent with neighboring entries.'
}

// ── 三种 system prompt 组装 ──
function buildSystem(targetLang: string, mode: 'baseline' | 'context' | 'lean'): string {
  const isZh = targetLang === 'ja' ? false : isCJK(targetLang)
  const role = isZh
    ? `[身份]\n你是 Lexar（雷克沙）存储产品的本地化专家。你产出自然、精准的译文，读起来像母语者写的一样。`
    : `[IDENTITY]\nYou translate Lexar product content. Your translations read as if originally written in the target language by a native speaker.`
  const principles = isZh ? CORE_PRINCIPLES_LEAN_ZH : CORE_PRINCIPLES_LEAN
  const mission = IDENTITY_MISSION[targetLang] || IDENTITY_MISSION['en'] || ''
  const scene = buildSceneBlock(targetLang)
  const context = mode === 'baseline' ? contextBlockIndependent(isZh) : contextBlockDocument(isZh)
  const outputFormat = isZh
    ? `\n[输出格式]\n仅输出合法 JSON 对象：{"translations":[{"i":<1-based 索引>,"text":"<译文>"}]}\n- 每条都要有对应项，i 与输入 [N] 一一对应\n- 纯 JSON，无 markdown 代码块，无解释\n⛔ ↵ 是字面字符标记 — 在 text 中输出字符 "↵"，不要转为真实换行。\n→ 开始翻译：`
    : `\n[OUTPUT]\nOutput ONLY a valid JSON object: {"translations":[{"i":<1-based index>,"text":"<translation>"}]}\n- Include ALL items — "i" must match the input [N] indices exactly\n- Raw JSON only, no markdown, no explanations\n⛔ The ↵ symbol is a LITERAL CHARACTER — output it as the characters "↵" inside text strings.\n→ Output translations now:`
  // 三组差异：baseline=独立上下文；context=文档上下文；lean=文档上下文（prompt 层精简在 token 统计体现——本脚本 lean 与 context 的 system 相同骨架，
  // 精简主要体现在「不注入 few-shot/marketing/机翻味词表」——生产 buildSystemPrompt 首调本就不含这些，
  // 故 lean 组的核心差异是「明确说明书不需要详情页的 ecommerce 默认约束」，本脚本通过 scene 已对齐。
  return `${role}\n\n${principles}\n\n[MISSION·${targetLang}]\n${mission}${scene}${context}${outputFormat}`
}

function isCJK(lang: string): boolean {
  return lang === 'zh-CN' || lang === 'zh-TW' || lang === 'ja' || lang === 'ko'
}

// ── user message：无上下文版 vs 上下文版 ──
function buildUser(entries: ManualEntry[], indices: number[], withContext: boolean, targetLang: string): string {
  const lines: string[] = []
  for (let k = 0; k < indices.length; k++) {
    const gi = indices[k]
    const src = entries[gi].source
    if (withContext) {
      const prev = gi > 0 ? entries[gi - 1].source : ''
      const next = gi < entries.length - 1 ? entries[gi + 1].source : ''
      lines.push(`[${k + 1}] (en→${targetLang}) "${src}"`)
      if (prev) lines.push(`    (prev context: "${prev.slice(0, 120)}")`)
      if (next) lines.push(`    (next context: "${next.slice(0, 120)}")`)
    } else {
      lines.push(`[${k + 1}] (en→${targetLang}) "${src}"`)
    }
  }
  return lines.join('\n')
}

// ── 裸 API 调用（XMLHttpRequest，与 test-judge-baseline 同款）──
async function callApi(system: string, user: string): Promise<{ content: string; promptTok: number; compTok: number }> {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  }
  const resText = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', API_URL, true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${API_KEY}`)
    xhr.timeout = 120000
    xhr.onload = () => resolve(xhr.responseText)
    xhr.onerror = () => reject(new Error('XHR network error'))
    xhr.ontimeout = () => reject(new Error('XHR timeout'))
    xhr.send(JSON.stringify(body))
  })
  const data = JSON.parse(resText)
  if (data.error) throw new Error(`API error: ${JSON.stringify(data.error).slice(0, 200)}`)
  return {
    content: data.choices?.[0]?.message?.content || '',
    promptTok: data.usage?.prompt_tokens ?? 0,
    compTok: data.usage?.completion_tokens ?? 0,
  }
}

interface TransItem { i: number; text: string }
function parseTranslations(content: string): Map<number, string> {
  const map = new Map<number, string>()
  const m = content.match(/\{[\s\S]*"translations"[\s\S]*\}/)
  const jsonStr = m ? m[0] : content
  try {
    const obj = JSON.parse(jsonStr)
    const arr: TransItem[] = obj.translations || []
    for (const t of arr) map.set(t.i, t.text)
  } catch {
    // 兜底逐行
    const re = /"i"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
    let mm
    while ((mm = re.exec(content)) !== null) {
      map.set(parseInt(mm[1]), mm[2].replace(/\\n/g, '\n').replace(/\\"/g, '"'))
    }
  }
  return map
}

// ── 主流程 ──
interface GroupResult {
  translations: Map<number, string>
  promptTok: number
  compTok: number
  systemLen: number
  userLen: number
}

async function runGroup(
  entries: ManualEntry[],
  indices: number[],
  targetLang: string,
  mode: 'baseline' | 'context' | 'lean',
): Promise<GroupResult> {
  const system = buildSystem(targetLang, mode)
  const user = buildUser(entries, indices, mode !== 'baseline', targetLang)
  const { content, promptTok, compTok } = await callApi(system, user)
  return {
    translations: parseTranslations(content),
    promptTok,
    compTok,
    systemLen: system.length,
    userLen: user.length,
  }
}

async function main() {
  const csvPath = '规格书说明书/Product Info_Pexar DPF_2026 - PX-125说明书.csv'
  const allEntries = parseManualCsv(csvPath)
  // 精选覆盖全形态的条目索引（0-based，基于非空 EN 条目序列）
  // 标题/步骤/多行/清单/长说明/超长/故障排查
  const picked = [0, 2, 3, 5, 9, 14, 17, 20, 24, 27, 30].filter(i => i < allEntries.length)
  console.log(`CSV 非空 EN 条目: ${allEntries.length}，本次测 ${picked.length} 条`)

  const report: string[] = ['# 说明书/规格书 文档模式实机对比报告', '']
  const summary: string[] = []

  for (const lang of TARGET_LANGS) {
    console.log(`\n=== ${lang} ===`)
    const groups: Record<string, GroupResult> = {}
    for (const mode of ['baseline', 'context', 'lean'] as const) {
      process.stdout.write(`  [${mode}] 调用中...`)
      try {
        groups[mode] = await runGroup(allEntries, picked, lang, mode)
        console.log(` 完成 prompt=${groups[mode].promptTok} comp=${groups[mode].compTok} sysLen=${groups[mode].systemLen} userLen=${groups[mode].userLen}`)
      } catch (e) {
        console.log(` 失败: ${e instanceof Error ? e.message : e}`)
        groups[mode] = { translations: new Map(), promptTok: 0, compTok: 0, systemLen: 0, userLen: 0 }
      }
    }

    // token 对比汇总
    const b = groups.baseline, c = groups.context, l = groups.lean
    summary.push(`## ${lang} token/长度对比`)
    summary.push(`| 组 | system字符 | user字符 | prompt_tok | completion_tok |`)
    summary.push(`|---|---|---|---|---|`)
    summary.push(`| ①基线 | ${b.systemLen} | ${b.userLen} | ${b.promptTok} | ${b.compTok} |`)
    summary.push(`| ②上下文 | ${c.systemLen} | ${c.userLen} | ${c.promptTok} | ${c.compTok} |`)
    summary.push(`| ③精简+上下文 | ${l.systemLen} | ${l.userLen} | ${l.promptTok} | ${l.compTok} |`)
    summary.push('')

    // 逐条对照
    report.push(`\n# 语种: ${lang}\n`)
    for (let k = 0; k < picked.length; k++) {
      const gi = picked[k]
      const entry = allEntries[gi]
      const official = entry.official[lang] || '(无官方译文)'
      report.push(`## [条目 ${k + 1}] 源文 (${entry.source.length} 字符)`)
      report.push('```')
      report.push(entry.source)
      report.push('```')
      report.push(`**官方译文**: `)
      report.push('```')
      report.push(official)
      report.push('```')
      report.push(`**① 基线(无上下文)**: `)
      report.push('```')
      report.push(groups.baseline.translations.get(k + 1) || '(未返回)')
      report.push('```')
      report.push(`**② 上下文注入**: `)
      report.push('```')
      report.push(groups.context.translations.get(k + 1) || '(未返回)')
      report.push('```')
      report.push(`**③ 精简+上下文**: `)
      report.push('```')
      report.push(groups.lean.translations.get(k + 1) || '(未返回)')
      report.push('```')
      report.push('---')
    }

    // 原始数据落盘
    writeFileSync(
      `tests/tmp-manual-scenario-${lang}.json`,
      JSON.stringify({
        lang,
        picked,
        sources: picked.map(gi => allEntries[gi].source),
        official: picked.map(gi => allEntries[gi].official[lang] || ''),
        baseline: Object.fromEntries(groups.baseline.translations),
        context: Object.fromEntries(groups.context.translations),
        lean: Object.fromEntries(groups.lean.translations),
        tokens: {
          baseline: { prompt: b.promptTok, comp: b.compTok, sysLen: b.systemLen, userLen: b.userLen },
          context: { prompt: c.promptTok, comp: c.compTok, sysLen: c.systemLen, userLen: c.userLen },
          lean: { prompt: l.promptTok, comp: l.compTok, sysLen: l.systemLen, userLen: l.userLen },
        },
      }, null, 2),
      'utf-8',
    )
  }

  // 报告 = token 汇总 + 逐条对照
  const finalReport = [...summary, '', ...report].join('\n')
  writeFileSync('tests/tmp-manual-scenario-report.md', finalReport, 'utf-8')
  console.log('\n✅ 产物: tests/tmp-manual-scenario-report.md + tmp-manual-scenario-<lang>.json')
}

main().catch(e => { console.error('⛔', e); process.exit(1) })
