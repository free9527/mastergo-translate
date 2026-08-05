/**
 * v11.5 实机模拟送翻测试 — PLAY PRO microSD CSV 全量
 *
 * 目的：用真实 API（gpt-5.5）+ 真实术语库 + 真实 CSV 源文，端到端验证 v11.5
 * Prompt 减肥后首调质量无回退。
 *
 * CSV 结构（Python csv 模块实测）：
 *   - 多行单元格（卖点标题\n\n正文段落在同一格），共 15 行 ≈ 12 个内容格
 *   - 列头在第 3 行：Reference,EN,德DE,法FR,...,土耳其TR
 *   - 按 CSV 规范整格 = 一条送翻文本（格内换行 → 插件 normalizeTextForLLM 转 ↵）
 *
 * 用法：
 *   npx tsx tests/test-v115-live-translation.ts                          # 默认 PLAY PRO，zh-CN/zh-TW/ja/de
 *   npx tsx tests/test-v115-live-translation.ts --csv "NM1090 PRO.csv"   # 指定 CSV
 *   npx tsx tests/test-v115-live-translation.ts zh-CN de                 # 指定语种
 *   npx tsx tests/test-v115-live-translation.ts --strict ko fr es ...    # 严格模式（20 语种全量验证用）
 *   npx tsx tests/test-v115-live-translation.ts --strict --concurrency 4 ko fr ...
 *
 * --strict 模式（v11.5 20 语种全量验证）：
 *   - brand 检测全语种化：无官方同形 pattern 的语种（ko/fr/de/es/...）报"缺 pattern"而非静默跳过
 *   - 拉丁语系→拉丁语系全大写行降噪：沿用 v10.6 判定器精神——短行（<15 词）/含数字（规格行）豁免，
 *     与术语库一致的词豁免（isGlossaryCovered 同逻辑），长营销行才标记人工复核
 *   - en→en 跳过（同语言管道不是验证对象）
 *
 * 输出：tests/tmp-v115-live-<csvslug>-<lang>.txt（每格：源文 | 我方译文 | CSV 官方译文 | 判定）
 *       tests/tmp-v115-live-<csvslug>-summary.txt（各语种汇总指标）
 */

// Node.js 环境 XMLHttpRequest polyfill（fetchWithRetry 内部用 XHR）
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { readFileSync, writeFileSync } from 'fs'
import { translateBatch, proofreadBatch, buildTaskGlossaryHint } from '../lib/llm-api'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV } from '../lib/default-glossary'
import { parseCSVRow } from '../lib/parse-csv'
import { LLMConfig } from '../messages/types'

// ============================================================
// 配置（与 test-all-languages.ts 相同的实机 API）
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

// ============================================================
// CSV 解析（RFC 4180 多行单元格）
// ============================================================
// 默认 PLAY PRO microSD；--csv <文件名> 切换到 测试文本素材/ 下其他 CSV
const CSV_DIR = '测试文本素材/'
const DEFAULT_CSV = 'Card 卡类-OW&AMZ小语种翻译 - PLAY PRO microSD.csv'

const CSV_COL_TO_LANG: Record<string, string> = {
  '德DE': 'de', '法FR': 'fr', '西班牙ES': 'es', '意大利IT': 'it', '波兰PL': 'pl',
  '阿拉伯AR': 'ar', '日本JP': 'ja', '中文CN': 'zh-CN', '台湾TC': 'zh-TW',
  '越南VN': 'vi', '荷兰NL': 'nl', '瑞典SE': 'sv', '土耳其TR': 'tr',
}

/** 按 CSV 规范切记录：引号内换行不分割（lib/parse-csv 只有单行解析，这里补记录切分） */
function splitCsvRecords(text: string): string[] {
  const records: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      cur += ch
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ }  // 转义引号 ""
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
  const header = parseCSVRow(records[2])  // 第 3 条记录是列头
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
// 术语库加载（与 UI buildGlossaryMaps 同逻辑）
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
  // 全语言列补充（v9.9 无条件注册全部语言列 key）
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
// 判定（硬指标，代码管形式）
// ============================================================
const BRAND_TAMPER_PATTERNS: Record<string, RegExp[]> = {
  'zh-CN': [/專業級|专业级/],
  'zh-TW': [/專業級|专业级/],
  'ja': [/プロフェッショナル/],
}

/** 品牌系列词：源文出现这些词时，译文的同形保留必须命中术语库才合法 */
const BRAND_SERIES_WORDS = ['Professional', 'ARMOR', 'ARES', 'THOR', 'PLAY', 'JumpDrive', 'BLUE', 'nCARD', 'NQ', 'NS', 'E300', 'E350', 'E6', 'EQ', 'ES', 'SL', 'RW', 'Workflow', 'pexar']

/** 拉丁语系→拉丁语系同形判定集（这些语种的译文与 en 源文可能合法同形） */
const LATIN_LANGS = new Set(['fr', 'de', 'es', 'pt', 'pt-BR', 'it', 'nl', 'pl', 'sv', 'tr', 'vi', 'id', 'en'])

/**
 * 与 isGlossaryCovered（lib/llm-api.ts v10.5）同逻辑：
 * 文本中所有"疑似品牌词"是否都被术语库覆盖。
 * 测试端简化为：检查 text 中每个 BRAND_SERIES_WORDS 成员，若出现则 glossaryMap 必须有以它为 key 或以它为 value 子串的条目。
 */
function isGlossaryCoveredInTest(text: string, glossaryMap: Map<string, string>): boolean {
  for (const word of BRAND_SERIES_WORDS) {
    if (!text.includes(word)) continue
    let covered = false
    for (const [key, value] of glossaryMap) {
      // key 是源文形态（如 Lexar ARMOR GOLD SDXC UHS-II Card），value 是译文形态
      if (text.includes(key) || (value && value.includes(word) && text.includes(value))) { covered = true; break }
    }
    if (!covered) return false
  }
  return true
}

/**
 * 拉丁语系 brand 检测：找出译文中"全大写拉丁行"（可能整行未翻）。
 * 沿用 v10.6 判定器精神降噪：
 *   - 短行（<15 个空格分隔 token）豁免 —— 产品名行、规格行天然短
 *   - 含数字的行豁免 —— 规格行（900MB/s、PCIe 5.0）合法同形
 *   - 与术语库一致的行豁免 —— 产品名/术语锁定值
 * 只标记"长营销行整行未翻"这一真异常。
 */
function findUntranslatedLatinLines(mine: string, glossaryMap: Map<string, string>): string[] {
  const bad: string[] = []
  for (const line of mine.split(/\n|↵/)) {
    const t = line.trim()
    if (!t) continue
    // 全大写拉丁字母行（允许数字/符号/空白）
    if (!/^[\p{Lu}\p{N}\s\p{P}\p{S}®™©-]+$/u.test(t)) continue
    if (!/\p{Lu}/u.test(t)) continue  // 至少要有一个大写字母
    const tokens = t.split(/\s+/).filter(Boolean)
    if (tokens.length < 15) continue       // 短行豁免
    if (/\p{N}/u.test(t)) continue         // 含数字豁免（规格行）
    if (isGlossaryCoveredInTest(t, glossaryMap)) continue  // 术语库一致豁免
    bad.push(t.slice(0, 80))
  }
  return bad
}

/**
 * brand 直译检测：
 * - zh-CN/zh-TW/ja：官方 pattern（專業級/プロフェッショナル）
 * - 其余拉丁语系：无官方同形 pattern（这些语言 "Professional" 与英文同形是合法的），
 *   改用"全大写拉丁行"检测整行未翻；返回 null 表示无 pattern 语种（strict 模式下调用方记录）
 */
function checkBrandTamper(text: string, lang: string, glossaryMap: Map<string, string>): { tamper: string | null; hasPattern: boolean; latinLines: string[] } {
  const patterns = BRAND_TAMPER_PATTERNS[lang]
  if (patterns) {
    for (const re of patterns) {
      const m = text.match(re)
      if (m) return { tamper: m[0], hasPattern: true, latinLines: [] }
    }
    return { tamper: null, hasPattern: true, latinLines: [] }
  }
  // 非 pattern 语种：拉丁语系→拉丁语系用全大写行检测；非拉丁语系（ko/ru/th/ar/...）无检测手段
  if (LATIN_LANGS.has(lang)) {
    return { tamper: null, hasPattern: false, latinLines: findUntranslatedLatinLines(text, glossaryMap) }
  }
  return { tamper: null, hasPattern: false, latinLines: [] }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const rawArgs = process.argv.slice(2)
  const csvIdx = rawArgs.indexOf('--csv')
  const csvName = csvIdx >= 0 ? rawArgs[csvIdx + 1] : DEFAULT_CSV
  const csvPath = CSV_DIR + csvName
  const strict = rawArgs.includes('--strict')
  const concIdx = rawArgs.indexOf('--concurrency')
  const concurrency = concIdx >= 0 ? parseInt(rawArgs[concIdx + 1], 10) || 1 : 1
  // 输出文件按 CSV 产品线名命名（防多 CSV 互覆）：PLAY PRO microSD → play-pro-microsd
  const productSlug = csvName.replace(/\.csv$/i, '').match(/([\w ]+)$/i)?.[1]?.trim().replace(/\s+/g, '-').toLowerCase() || 'out'
  const langs = rawArgs.filter((a, i) =>
    !a.startsWith('--') &&
    rawArgs[i - 1] !== '--csv' &&
    rawArgs[i - 1] !== '--concurrency'
  )
  const targetLangs = (langs.length > 0 ? langs : ['zh-CN', 'zh-TW', 'ja', 'de'])
    .filter(l => l !== 'en')  // en→en 同语言管道不是验证对象，跳过
  if (rawArgs.includes('en')) console.log('（en 已跳过：en→en 同语言管道非验证对象）')

  console.log(`解析 CSV: ${csvPath}`)
  const entries = parseTestCsv(csvPath)
  console.log(`内容格: ${entries.length} 个（多行单元格，格内换行 → ↵），目标语种: ${targetLangs.join(', ')}`)

  const glossaryEntries = parseGlossary(DEFAULT_GLOSSARY_PRODUCTS_CSV)
  console.log(`术语库: ${glossaryEntries.length} 条`)

  const summaryLines: string[] = []
  summaryLines.push(`v11.5 实机送翻测试 — ${csvName}（${new Date().toISOString()}）`)
  summaryLines.push(`条目: ${entries.length}，语种: ${targetLangs.join(', ')}${strict ? '（strict 模式）' : ''}`)
  summaryLines.push('')

  // 单语种完整流程（翻译→校对→判定→输出），返回汇总行
  async function runLang(lang: string): Promise<string[]> {
    console.log(`\n═══ ${lang} ═══`)
    const glossaryMap = buildGlossaryMap(glossaryEntries, lang)
    const allSources = entries.map(e => e.source)
    const taskGlossaryHint = buildTaskGlossaryHint(glossaryMap, config.scenePreset, allSources)

    const untranslatedAll = new Set<number>()
    const misspelledAll = new Set<number>()
    const expansionAll = new Set<number>()
    const firstCallAnomalyAll = new Set<number>()  // v11.5 观测：首调（重试前）异常数

    console.log(`  翻译 ${allSources.length} 格...`)
    const results = await translateBatch(
      allSources, lang, glossaryMap, config,
      undefined, undefined, undefined, taskGlossaryHint, undefined,
      false, false, undefined, untranslatedAll, misspelledAll, expansionAll,
      firstCallAnomalyAll,
    )
    console.log(`  翻译完成（首调异常 ${firstCallAnomalyAll.size} → 重试后漏翻 ${untranslatedAll.size} / 错词 ${misspelledAll.size} / 超长 ${expansionAll.size}）`)

    // 校对（proofreadBatch 返回全量结果数组，索引与 items 对齐，text=校对后文本）
    console.log('  校对...')
    const proofItems = entries.map((e, i) => ({ sourceText: e.source, translatedText: results[i] }))
    let proofreadChanges: Array<{ index: number; correctedText: string; reason: string }> = []
    try {
      const pr = await proofreadBatch(
        proofItems, lang, glossaryMap, config,
        undefined, undefined, taskGlossaryHint, undefined,
        expansionAll.size > 0 ? expansionAll : undefined,
      )
      proofreadChanges = pr
        .map((r, i) => ({ index: i, correctedText: r.text, reason: r.reason }))
        .filter(r => r.correctedText && r.correctedText !== results[r.index])
    } catch (e) {
      console.log(`  校对异常（跳过）: ${(e as Error).message.slice(0, 100)}`)
    }
    console.log(`  校对完成（修改 ${proofreadChanges.length} 条）`)

    const final = [...results]
    for (const r of proofreadChanges) final[r.index] = r.correctedText

    // ═══ 判定 + 输出 ═══
    const lines: string[] = []
    let brandTamperCount = 0
    let latinLineSuspectCount = 0
    let placeholderResidual = 0
    let identicalToSource = 0
    let exactMatchOfficial = 0
    let officialCompared = 0

    for (let i = 0; i < entries.length; i++) {
      const src = entries[i].source
      const mine = final[i] || ''
      const official = entries[i].official[lang] || ''
      const flags: string[] = []

      const brand = checkBrandTamper(mine, lang, glossaryMap)
      if (brand.tamper) { brandTamperCount++; flags.push(`⛔品牌直译:${brand.tamper}`) }
      if (strict && !brand.hasPattern && !LATIN_LANGS.has(lang)) {
        flags.push('⚠无brand检测pattern（该语种官方译法与英文同形，无法形式检测）')
      }
      if (brand.latinLines.length > 0) {
        latinLineSuspectCount += brand.latinLines.length
        flags.push(`⚠疑似整行未翻(人工复核):${brand.latinLines.length}行`)
      }
      if (/__[A-Z]+_\d+__/.test(mine)) { placeholderResidual++; flags.push('⛔占位符残留') }
      if (mine.trim() === src.trim() && src.trim().length > 0) { identicalToSource++; flags.push('⛔与源文相同') }
      if (official) {
        officialCompared++
        if (mine.trim() === official.trim()) exactMatchOfficial++
      }
      if (untranslatedAll.has(i)) flags.push('漏翻')
      if (misspelledAll.has(i)) flags.push('疑似错词')
      const prChange = proofreadChanges.find(r => r.index === i)
      if (prChange) flags.push(`校对改:${prChange.reason}`)

      lines.push(`[${i + 1}] ${flags.length ? flags.join(' ') : '✅'}`)
      lines.push(`  源文: ${src.replace(/\n+/g, ' ↵ ').slice(0, 150)}`)
      lines.push(`  我方: ${mine.replace(/\n+/g, ' ↵ ').slice(0, 150)}`)
      if (official) lines.push(`  官方: ${official.replace(/\n+/g, ' ↵ ').slice(0, 150)}`)
      if (brand.latinLines.length > 0) {
        for (const l of brand.latinLines) lines.push(`  ⚠整行: ${l}`)
      }
      lines.push('')
    }

    writeFileSync(`tests/tmp-v115-live-${productSlug}-${lang}.txt`, lines.join('\n'), 'utf-8')

    const summary = [
      `── ${lang} ──`,
      `  条目: ${entries.length}（有官方译文对照: ${officialCompared}）`,
      `  首调异常（v11.5 观测指标，重试前截断+漏翻）: ${firstCallAnomalyAll.size}`,
      `  漏翻（最终仍源文）: ${untranslatedAll.size}`,
      `  疑似错词: ${misspelledAll.size}`,
      `  超长标记: ${expansionAll.size}`,
      `  校对修改: ${proofreadChanges.length}`,
      `  ⛔品牌直译: ${brandTamperCount}${brandTamperCount === 0 && !LATIN_LANGS.has(lang) && lang !== 'zh-CN' && lang !== 'zh-TW' && lang !== 'ja' ? '（⚠该语种无检测pattern，0≠无问题）' : ''}`,
      `  ⚠疑似整行未翻(拉丁语系,人工复核): ${latinLineSuspectCount}`,
      `  ⛔占位符残留: ${placeholderResidual}`,
      `  ⛔与源文相同: ${identicalToSource}`,
      `  与官方译文完全一致: ${exactMatchOfficial}/${officialCompared}（参考指标，措辞可不同）`,
    ]
    summary.forEach(l => console.log(l))
    return summary
  }

  // 并发执行（默认 1=串行；--concurrency N 时 N 个语种并行）
  const langSummaryMap = new Map<string, string[]>()
  for (let i = 0; i < targetLangs.length; i += concurrency) {
    const batch = targetLangs.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(l => runLang(l)))
    batch.forEach((l, j) => langSummaryMap.set(l, batchResults[j]))
  }
  for (const lang of targetLangs) {
    summaryLines.push(...(langSummaryMap.get(lang) || []))
    summaryLines.push('')
  }

  writeFileSync(`tests/tmp-v115-live-${productSlug}-summary.txt`, summaryLines.join('\n'), 'utf-8')
  console.log(`\n汇总已写入 tests/tmp-v115-live-${productSlug}-summary.txt`)
}

main().catch(e => { console.error('测试失败:', e); process.exit(1) })
