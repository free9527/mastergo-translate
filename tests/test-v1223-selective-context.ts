/**
 * v12.23 选择性上下文注入——形式信号命中验证（零 API 成本）
 *
 * 前提假设：「需要上下文的句子」可用代码形式信号初筛（代词回指/定冠词回指/跨句术语），
 * 只有被标记条目才注入上下文 → 精准命中受益句，token 几乎不涨。
 *
 * 本脚本扫 CSV 全部 34 条 EN 源文，用三类形式信号标记疑似条目，
 * 然后对照「已知受益句」（人工判断 es/ja 实机对照得出）验证命中率与误报率：
 *   - 已知受益句：条目5（They 指代）/条目6（Supports 二义，端口语境）——es/ja 实测 ②③优于①
 *   - 已知无差异句：标题/温度/警告等（①=②=③）——应不被标记（低误报）
 *
 * 三类形式信号：
 *   A 指示/人称代词回指：this/that/these/those/they/it/them（句首或独立指代，无明显先行词）
 *   B 定冠词回指：the + 名词（该名词在前一条已出现 → 回指前文概念）
 *   C 跨句术语依赖：本条术语在前一条定义过（如 "the code"/"the frame" 依赖前条 "frame code"）
 *
 * 用法：npx tsx tests/test-v1223-selective-context.ts
 */
import { readFileSync } from 'fs'
import { parseCSVRow } from '../lib/parse-csv'

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

interface Entry { source: string }
function parseCsv(csvPath: string): Entry[] {
  const raw = readFileSync(csvPath, 'utf-8').replace(/^﻿/, '')
  const records = splitCsvRecords(raw)
  const header = parseCSVRow(records[0])
  const enCol = header.findIndex(h => h.trim() === '英文EN')
  const entries: Entry[] = []
  for (let i = 1; i < records.length; i++) {
    if (!records[i].trim()) continue
    const cells = parseCSVRow(records[i])
    const source = (cells[enCol] || '').trim()
    if (source) entries.push({ source })
  }
  return entries
}

// ── 形式信号（v2 收窄版）──
// 收窄1: this/that/these/those 后紧跟名词 = 限定词（类指，this product/these magnets）不算回指；
//        仅代词独立作主语/宾语（They can... / send them / it works）才算回指。
// 收窄2: 法律警告/安全声明整类豁免（WARNING/CAUTION/Risk/Do not/Improper 等固定套话，天然自包含）。

// A 独立回指代词（they/them/it 独立使用，或 this/that/these/those 后不接名词）
const PRONOUN_STANDALONE_RE = /\b(they|them|it)\b/i
const PRONOUN_DET_NOUN_RE = /\b(this|that|these|those)\s+[a-z]/i   // 限定词用法（排除）
const PRONOUN_DET_RE = /\b(this|that|these|those)\b/i

// B 定冠词 + 名词
const THE_NOUN_RE = /\bthe\s+([a-z][a-z\-]+)/gi

// 收窄2: 法律警告/安全声明套话（这类条目的 the product/this product 是类指非回指）
const WARNING_BOILERPLATE_RE = /\b(warning|caution|risk of|do not|improper use|for service|consult your|stop using|medical (equipment|device)|keep away|may cause damage)\b/i

const STOP = new Set(['a','an','the','and','or','to','of','in','on','for','with','your','you','can','be','is','are','at','by','from','up','if','when','then','than','that','this','these','those','it','its','they','them','their'])
function nouns(text: string): Set<string> {
  const out = new Set<string>()
  const tokens = text.toLowerCase().match(/[a-z][a-z\-]+/g) || []
  for (const t of tokens) {
    if (!STOP.has(t) && t.length > 2) out.add(t.replace(/s$/, ''))
  }
  return out
}

interface Flag { i: number; signals: string[] }

function analyze(entries: Entry[]): Flag[] {
  const flags: Flag[] = []
  for (let i = 0; i < entries.length; i++) {
    const src = entries[i].source
    const signals: string[] = []

    // 收窄2: 法律警告/安全声明整类豁免（不进任何标记）
    if (WARNING_BOILERPLATE_RE.test(src)) continue

    // A 代词回指（收窄1：独立代词才算；this+名词的限定词用法排除）
    const hasStandalone = PRONOUN_STANDALONE_RE.test(src)
    const hasDetOnly = PRONOUN_DET_RE.test(src) && !PRONOUN_DET_NOUN_RE.test(src)
    if (hasStandalone) {
      const m = src.match(PRONOUN_STANDALONE_RE)
      signals.push(`A代词(${m ? m[1] : ''})`)
    } else if (hasDetOnly) {
      const m = src.match(PRONOUN_DET_RE)
      signals.push(`A代词(${m ? m[1] : ''}独立)`)
    }

    // B/C 定冠词回指 + 跨句术语（需要前条对照）
    const prevNouns = i > 0 ? nouns(entries[i - 1].source) : new Set<string>()
    let mm
    const seen = new Set<string>()
    THE_NOUN_RE.lastIndex = 0
    while ((mm = THE_NOUN_RE.exec(src)) !== null) {
      const noun = mm[1].toLowerCase().replace(/s$/, '')
      if (STOP.has(noun) || seen.has(noun)) continue
      seen.add(noun)
      if (prevNouns.has(noun)) {
        signals.push(`B/C回指(the ${noun}↩前条)`)
      }
    }

    if (signals.length > 0) flags.push({ i, signals })
  }
  return flags
}

// ── 已知受益/无差异（基于 es/ja 实机对照人工判断，0-based 非空条目索引）──
// 实测 picked = [0,2,3,5,9,14,17,20,24,27,30]，对应非空条目索引
// 已知受益：条目5(全局idx9? 需对应) / 条目6(端口规格 Supports)
// 说明：picked 数组里第5项=9, 第6项=14（但这是 picked 位置，非 entries 索引）
// 直接用 entries 索引标注：下面在 main 里按 picked 重映射

const entries = parseCsv('规格书说明书/Product Info_Pexar DPF_2026 - PX-125说明书.csv')
console.log(`非空 EN 条目: ${entries.length}\n`)

const flags = analyze(entries)
const flagSet = new Set(flags.map(f => f.i))

console.log('=== 形式信号标记结果 ===')
for (const f of flags) {
  const preview = entries[f.i].source.slice(0, 60).replace(/\n/g, '↵')
  console.log(`  [条目idx ${f.i}] ${f.signals.join(' + ')}`)
  console.log(`      "${preview}..."`)
}
console.log(`\n共标记 ${flags.length}/${entries.length} 条\n`)

// ── 命中验证：picked 实测条目里，已知受益句 vs 无差异句 ──
// picked 实测条目（entries 索引）：
const picked = [0, 2, 3, 5, 9, 14, 17, 20, 24, 27, 30]
// 人工判断（es/ja 对照）：
//   受益句（②③优于①）：
//     picked位置4=idx5(Tap "Add Friend"...They) — ja 指代/术语差异
//     picked位置6=idx14? 不对——picked=[0,2,3,5,9,14,17,20,24,27,30]
//     报告里条目5= picked[4]=9 (Tap "Add Friend"), 条目6=picked[5]=14 (端口规格1-8)
//     报告里条目7=picked[6]=17 (You can send up to 10 photos)
const KNOWN_BENEFIT = new Set([9, 14, 17])   // 实测②③有可见差异的条目(entries索引)
const KNOWN_NO_DIFF = new Set([0, 2, 3, 24, 27, 30]) // 实测①=②=③的条目

console.log('=== 命中验证 ===')
let hit = 0, miss = 0, falsePos = 0
for (const idx of KNOWN_BENEFIT) {
  const marked = flagSet.has(idx)
  if (marked) hit++
  else miss++
  const preview = entries[idx].source.slice(0, 50).replace(/\n/g, '↵')
  console.log(`  ${marked ? '✅命中' : '❌漏报'} [受益句 idx${idx}] "${preview}..."`)
}
for (const idx of KNOWN_NO_DIFF) {
  const marked = flagSet.has(idx)
  if (marked) falsePos++
  const preview = entries[idx].source.slice(0, 50).replace(/\n/g, '↵')
  console.log(`  ${marked ? '⚠️误报' : '✅正确不标'} [无差异 idx${idx}] "${preview}..."`)
}

console.log(`\n=== 统计 ===`)
console.log(`受益句命中率: ${hit}/${KNOWN_BENEFIT.size}`)
console.log(`无差异句误报: ${falsePos}/${KNOWN_NO_DIFF.size}`)
console.log(`全文档标记率: ${flags.length}/${entries.length} (${Math.round(flags.length / entries.length * 100)}%)`)
console.log(`\n判定参考：`)
console.log(`  - 命中率≥2/3 且误报≤2/6 → 选择性注入方案成立`)
console.log(`  - 否则 → 形式信号抓不准，建议不做（回到零上下文）`)
