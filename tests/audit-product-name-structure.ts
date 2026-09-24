// ============================================================
// 产品名命名规则归一验证器 v2——品线分层判定（只读，零风险）
// ============================================================
// 架构（用户拍板）：先判品线 → 按品线用对应规则 → 兜底
//   品线由「品类词封闭集」判定（内存/SSD/U盘/卡/外设），
//   各品线有专属「型号形态 + 系列词特征」（命名规则文档的实际差异）。
// 用途：用分层结构反向验证术语库产品名库，校准分层判定体系。
// ============================================================

/// <reference types="node" />

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { CATEGORY_WORDS } from '../lib/prompt-constants'
import { parseCSVRecords } from '../lib/parse-csv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CSV_PATH = join(__dirname, '..', '术语素材', 'Lexar术语库_产品名.csv')
const REPORT_PATH = join(__dirname, '..', 'claude-tmp', 'product-name-structure-audit.txt')

// ── 品线定义（品类词 → 品线 + 该品线型号形态 + 系列词特征）──

type ProductLine = 'memory' | 'ssd' | 'usb' | 'card' | 'peripheral' | 'unknown'

interface LineRule {
  line: ProductLine
  categoryWords: string[]
  /** 该品线型号形态正则 */
  modelForms: RegExp[]
  /** 该品线常见系列词（小写） */
  seriesHints: Set<string>
  /** 该品线规格段 token 正则（接口/代数/特性，剥离不计型号） */
  specTokens: RegExp[]
}

const LINE_RULES: LineRule[] = [
  {
    line: 'memory',
    categoryWords: ['Desktop Memory', 'Laptop Memory'],
    // 内存：DDR 代数 + 容量/频率；ARES/THOR 系列；型号如 ARES DDR4 / THOR DDR5
    modelForms: [/^ddr\d$/i, /^\d{4,5}$/, /^[A-Z]{2,4}\d{0,4}$/],
    seriesHints: new Set(['ares', 'thor', 'armor', 'rgb', 'play', 'oc', 'hades', 'zeus']),
    specTokens: [/^ddr\d$/i, /^\d{4}mhz$/i, /^mhz$/i, /^cl\d+$/i, /^gen$/i],
  },
  {
    line: 'ssd',
    categoryWords: ['SSD', 'Portable SSD'],
    // SSD：NM/NQ/NS/EQ 字母+数字型号；Professional/GOLD 等级；PCIe/NVMe/M.2 规格
    modelForms: [/^[A-Z]{1,3}\d{3,4}[A-Z]?$/i, /^[A-Z]{2}\d{3}$/, /^e\d{3}$/i, /^\d{3,4}$/],
    seriesHints: new Set(['professional', 'gold', 'silver', 'blue', 'nm', 'nq', 'ns', 'eq', 'play', 'armor', 'thor', 'ares', 'blaze', 'pro', 'plus', 'max', 'ultra', 'elite']),
    specTokens: [/^pcie$/i, /^nvme$/i, /^gen\d?$/i, /^gen\d+x\d+$/i, /^m\.2$/i, /^\d{4}$/, /^sata$/i, /^gb$/i, /^tb$/i, /^\d+gb$/i, /^\d+tb$/i, /^ssd$/i, /^with$/i, /^heatsink$/i, /^dram$/i, /^slc$/i, /^cache$/i],
  },
  {
    line: 'usb',
    categoryWords: ['Flash Drive', 'Dual Drive', 'Solid State Dual Drive'],
    // U盘：JumpDrive 系列几乎必备；型号 C40E/E21/P30/F35/M22/V40 等（字母+数字+可选字母）
    modelForms: [/^[A-Z]\d{2}[A-Z]?$/i, /^[A-Z]\d{1}[A-Z]?$/i, /^[A-Z]{2}\d{2}$/i, /^d\d{2}e$/i, /^f\d{2}$/i, /^m\d{3}$/i, /^p\d{2}$/i, /^s\d{2}$/i, /^v\d{2,3}$/i, /^e\d{2}$/i],
    seriesHints: new Set(['jumpdrive', 'twistturn', 'fingerprint', 'elite', 'legends', 'dual', 'solid', 'state']),
    specTokens: [/^usb$/i, /^usb-c$/i, /^type-c$/i, /^gen$/i, /^\d+(\.\d+)?$/i, /^with$/i, /^\(eol\)$/i, /^eol$/i, /^fingerprint$/i],
  },
  {
    line: 'card',
    categoryWords: ['Card'],
    // 存储卡：速度代号(2000x/633x) 或 CFexpress Type A/B；GOLD/SILVER/BLUE 等级
    modelForms: [/^\d+x$/i, /^cfexpress$/i, /^type$/i, /^[ab]$/i, /^v\d{2}$/i, /^microsd(xc)?$/i, /^sdxc$/i, /^sdhc$/i],
    seriesHints: new Set(['gold', 'silver', 'blue', 'diamond', 'platinum', 'professional', 'high-endurance', 'high-performance', 'play']),
    specTokens: [/^uhs-?i+$/i, /^vpg\d*$/i, /^a\d$/i, /^u\d$/i, /^class$/i, /^\d+gb$/i, /^\d+tb$/i],
  },
  {
    line: 'peripheral',
    categoryWords: ['Reader', 'Enclosure', 'Hub'],
    // 外设：型号/形态 + 品类（结构最简单）
    modelForms: [/^[A-Z]{1,3}\d{1,4}[A-Z]?$/i, /^\d{3,4}$/],
    seriesHints: new Set(['professional', 'dual', 'usb', 'type-c', 'workflow']),
    specTokens: [/^usb$/i, /^usb-c$/i, /^type-c$/i, /^hub$/i, /^ssd$/i, /^nvme$/i, /^m\.2$/i, /^cfexpress$/i, /^sd$/i, /^microsd$/i],
  },
]

// 通用型号形态（兜底——品线规则都不中时的宽松形态）
const GENERIC_MODEL_RE = /^[A-Z]{1,4}\d{1,5}[A-Za-z]?$|^\d{3,5}$|^\d+x$/i

// ── 品线判定（品类词 → 品线）──
function detectLine(source: string): { line: ProductLine; category: string | null } {
  const allCats = Object.keys(CATEGORY_WORDS).sort((a, b) => b.length - a.length)
  for (const cat of allCats) {
    const escaped = cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(source)) {
      const rule = LINE_RULES.find(r => r.categoryWords.includes(cat))
      return { line: rule ? rule.line : 'unknown', category: cat }
    }
  }
  return { line: 'unknown', category: null }
}

// ── 结构解析（按品线规则）──
interface ParseResult {
  source: string
  line: ProductLine
  category: string | null
  ok: boolean
  series: string[]
  model: string[]
  suffix: string[]
  unknown: string[]
  failReason?: string
}

function parseByLine(source: string): ParseResult {
  const { line, category } = detectLine(source)
  const res: ParseResult = { source, line, category, ok: false, series: [], model: [], suffix: [], unknown: [] }

  if (line === 'unknown' || !category) {
    res.failReason = '品线判定失败（品类词不在封闭集）'
    return res
  }
  const rule = LINE_RULES.find(r => r.line === line)!

  // 去 Lexar 前缀 + 品类词
  let s = source.replace(/[®™©]/g, '').trim()
  if (!/^Lexar\b/i.test(s)) { res.failReason = '非 Lexar 开头'; return res }
  s = s.replace(/^Lexar\s*/i, '')
  const catEscaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  s = s.replace(new RegExp(`\\b${catEscaped}\\b`, 'i'), ' <<<CAT>>> ')

  const tokens = s.split(/\s+/).filter(Boolean)
  for (const tok of tokens) {
    if (tok === '<<<CAT>>>') continue
    const clean = tok.replace(/^[(]|[)]$/g, '')
    if (rule.modelForms.some(r => r.test(clean))) { res.model.push(tok); continue }
    if (rule.seriesHints.has(clean.toLowerCase())) { res.series.push(tok); continue }
    if (rule.specTokens.some(r => r.test(clean))) { res.suffix.push(tok); continue }
    // 通用型号形态兜底（品线规则外的全新型号）
    if (GENERIC_MODEL_RE.test(clean)) { res.model.push(tok); continue }
    // 大写开头词（潜在新系列）
    if (/^[A-Z][A-Za-z]+$/.test(clean) && clean.length >= 3) { res.series.push(tok); continue }
    res.unknown.push(tok)
  }

  res.ok = res.model.length > 0
  if (!res.ok) res.failReason = '缺型号（品线规则+通用兜底均未命中）'
  return res
}

// ── 扫描 ──
function main(): void {
  const csv = readFileSync(CSV_PATH, 'utf8')
  const records = parseCSVRecords(csv)
  const results: ParseResult[] = []
  for (let i = 1; i < records.length; i++) {
    const source = (records[i][0] || '').trim()
    if (source) results.push(parseByLine(source))
  }

  const lines: string[] = []
  const total = results.length
  const okCount = results.filter(r => r.ok).length
  const fails = results.filter(r => !r.ok)
  const unknowns = results.filter(r => r.unknown.length > 0)

  lines.push('产品名命名规则归一验证 v2（品线分层判定）')
  lines.push(`时间: ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`═══ 总览 ═══`)
  lines.push(`总条数: ${total} | 符合结构: ${okCount} (${(okCount / total * 100).toFixed(1)}%) | 不符合: ${fails.length} | 含未归类 token: ${unknowns.length}`)
  lines.push('')

  // 按品线统计
  const byLine = new Map<ProductLine, { total: number; ok: number }>()
  for (const r of results) {
    if (!byLine.has(r.line)) byLine.set(r.line, { total: 0, ok: 0 })
    const e = byLine.get(r.line)!
    e.total++; if (r.ok) e.ok++
  }
  lines.push(`═══ 按品线覆盖 ═══`)
  for (const [line, e] of byLine.entries()) {
    lines.push(`  ${line.padEnd(12)} ${e.ok}/${e.total} (${(e.ok / e.total * 100).toFixed(0)}%)`)
  }
  lines.push('')

  // 系列词集合
  const seriesSet = new Set<string>()
  for (const r of results) for (const s of r.series) seriesSet.add(s)
  lines.push(`═══ 系列词（唯一 ${seriesSet.size}）═══`)
  lines.push('  ' + [...seriesSet].join(', '))
  lines.push('')

  // 型号形态样例
  const modelSet = new Set<string>()
  for (const r of results) for (const m of r.model) modelSet.add(m)
  lines.push(`═══ 型号形态样例（唯一 ${modelSet.size}，前 50）═══`)
  lines.push('  ' + [...modelSet].slice(0, 50).join(', '))
  lines.push('')

  lines.push(`═══ 不符合结构（${fails.length}）═══`)
  for (const r of fails) {
    lines.push(`  [${r.line}/${r.failReason}] ${r.source}`)
    if (r.unknown.length) lines.push(`      未归类: ${r.unknown.join(', ')}`)
  }
  lines.push('')
  lines.push(`═══ 含未归类 token（${unknowns.length}，边界形态）═══`)
  for (const r of unknowns.slice(0, 50)) {
    lines.push(`  [${r.line}] ${r.source}`)
    lines.push(`      未归类: ${r.unknown.join(', ')} | 系列:${r.series.join(',')} 型号:${r.model.join(',')}`)
  }

  const out = lines.join('\n')
  console.log(out)
  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, out, 'utf8')
  console.log(`\n已写出: ${REPORT_PATH}`)
}

main()
