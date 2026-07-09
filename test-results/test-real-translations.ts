/**
 * 真实翻译文档测试脚本 v2
 *
 * 改进：
 * 1. 拆分多行文本为单条
 * 2. 对比逻辑改为关键信息检查（数字、品牌名、产品型号）
 * 3. 每个语言只测 5 条，避免超时
 *
 * 使用方法：
 *   npx tsx test-results/test-real-translations.ts
 */

// Node.js 环境没有 XMLHttpRequest，用 xhr2 polyfill 补上
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse/sync'
import { translateBatch, proofreadBatch } from '../lib/llm-api'
import { LLMConfig } from '../messages/types'

// ============================================================
// 测试配置
// ============================================================

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-FS2AGf1vcZU1OpIIho7nBd8bQGcm45nII6UlZAECxj5Iaamn'
const MODEL = 'qwen3.7-max'

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
// CSV 文件配置
// ============================================================

const TEST_DIR = 'C:/Users/Administrator/Desktop/materGO/translate/测试文本'

// 语言代码映射（CSV 列名 → 标准语言代码）
const LANG_MAP: Record<string, string> = {
  '德DE': 'de',
  '法FR': 'fr',
  '西班牙ES': 'es',
  '意大利IT': 'it',
  '波兰PL': 'pl',
  '阿拉伯AR': 'ar',
  '日本JP': 'ja',
  '中文CN': 'zh-CN',
  '台湾TC': 'zh-TW',
  '越南VN': 'vi',
  '荷兰NL': 'nl',
  '瑞典SE': 'sv',
  '土耳其TR': 'tr',
}

// 测试文件列表
const TEST_FILES = [
  'Card 卡类-OW&AMZ小语种翻译 - PLAY PRO microSD.csv',
]

// ============================================================
// CSV 解析
// ============================================================

interface TranslationPair {
  source: string
  reference: string
  lang: string
}

function parseCSV(filePath: string): TranslationPair[] {
  const content = fs.readFileSync(filePath, 'utf-8')

  const records = parse(content, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
  })

  // 找到表头行
  let headerRowIndex = -1
  for (let i = 0; i < Math.min(10, records.length); i++) {
    const row = records[i]
    if (row.some(cell => cell && (cell.includes('Reference') || cell.includes('EN')))) {
      headerRowIndex = i
      break
    }
  }

  if (headerRowIndex === -1) {
    console.log(`  ⚠️  未找到表头行`)
    return []
  }

  const header = records[headerRowIndex]

  // 找到 EN 列和各语言列的索引
  let enColIndex = -1
  const langColIndices: Record<string, number> = {}

  for (let i = 0; i < header.length; i++) {
    const cell = (header[i] || '').trim()
    if (cell === 'EN' || cell.includes('EN')) {
      enColIndex = i
    }
    for (const [csvLang, stdLang] of Object.entries(LANG_MAP)) {
      if (cell.includes(csvLang)) {
        langColIndices[csvLang] = i
      }
    }
  }

  if (enColIndex === -1) {
    console.log(`  ⚠️  未找到 EN 列`)
    return []
  }

  console.log(`  表头行: ${headerRowIndex}, EN 列: ${enColIndex}`)
  console.log(`  语言列: ${Object.keys(langColIndices).join(', ')}`)

  // 提取翻译对（拆分多行文本）
  const pairs: TranslationPair[] = []

  for (let i = headerRowIndex + 1; i < records.length; i++) {
    const row = records[i]
    const sourceCell = (row[enColIndex] || '').trim()

    if (!sourceCell || sourceCell.length < 3) continue

    // 拆分多行文本为单条
    const sourceLines = sourceCell.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    for (const [csvLang, colIndex] of Object.entries(langColIndices)) {
      const refCell = (row[colIndex] || '').trim()
      if (!refCell || refCell.length < 2) continue

      const refLines = refCell.split('\n').map(l => l.trim()).filter(l => l.length > 0)
      const stdLang = LANG_MAP[csvLang]

      // 配对：源文和译文行数应该一致
      const pairCount = Math.min(sourceLines.length, refLines.length)
      for (let j = 0; j < pairCount; j++) {
        const source = sourceLines[j]
        const reference = refLines[j]

        // 过滤：只保留有实际内容的文本
        if (source.length < 3 || reference.length < 2) continue
        // 过滤：跳过纯数字/符号
        if (/^[\d\s.,]+$/.test(source)) continue

        pairs.push({ source, reference, lang: stdLang })
      }
    }
  }

  return pairs
}

// ============================================================
// 对比逻辑
// ============================================================

interface ComparisonResult {
  match: boolean
  issues: string[]
}

function compareTranslation(
  source: string,
  reference: string,
  ai: string,
): ComparisonResult {
  const issues: string[] = []

  // 1. 检查是否为空
  if (!ai || ai.length === 0) {
    issues.push('译文为空')
    return { match: false, issues }
  }

  // 2. 提取关键信息
  const srcNumbers = source.match(/\d+/g) || []
  const aiNumbers = ai.match(/\d+/g) || []

  // 3. 检查数字保留（允许格式差异，如 900MB/s → 900 MB/s）
  const missingNumbers = srcNumbers.filter(n => !aiNumbers.includes(n))
  if (missingNumbers.length > 0) {
    issues.push(`丢失数字: ${missingNumbers.join(', ')}`)
  }

  // 4. 检查品牌名保留（Lexar, PLAY PRO 等）
  const brandPatterns = [
    { pattern: /Lexar/i, name: 'Lexar' },
    { pattern: /PLAY\s*PRO/i, name: 'PLAY PRO' },
    { pattern: /microSD/i, name: 'microSD' },
  ]

  for (const { pattern, name } of brandPatterns) {
    const srcHas = pattern.test(source)
    const aiHas = pattern.test(ai)
    if (srcHas && !aiHas) {
      issues.push(`丢失品牌: ${name}`)
    }
  }

  // 5. 检查技术术语保留（microSDXC, Express Card 等）
  const techPatterns = [
    { pattern: /microSDXC/i, name: 'microSDXC' },
    { pattern: /Express\s*Card/i, name: 'Express Card' },
  ]

  for (const { pattern, name } of techPatterns) {
    const srcHas = pattern.test(source)
    const aiHas = pattern.test(ai)
    if (srcHas && !aiHas) {
      issues.push(`丢失术语: ${name}`)
    }
  }

  // 6. 判断是否通过（允许合理的翻译差异）
  const match = issues.length === 0

  return { match, issues }
}

// ============================================================
// 测试执行
// ============================================================

interface TestResult {
  file: string
  lang: string
  total: number
  passed: number
  failed: number
  errors: string[]
  samples: Array<{
    source: string
    reference: string
    ai: string
    match: boolean
    issues: string[]
  }>
}

async function runTest(
  file: string,
  pairs: TranslationPair[],
): Promise<TestResult[]> {
  // 按语言分组
  const byLang: Record<string, TranslationPair[]> = {}
  for (const pair of pairs) {
    if (!byLang[pair.lang]) byLang[pair.lang] = []
    byLang[pair.lang].push(pair)
  }

  const results: TestResult[] = []

  for (const [lang, langPairs] of Object.entries(byLang)) {
    console.log(`\n  测试 ${lang} (${langPairs.length} 条)...`)

    // 限制测试数量（避免 API 调用过多）
    const testPairs = langPairs.slice(0, 5)

    const sources = testPairs.map(p => p.source)
    const references = testPairs.map(p => p.reference)

    const result: TestResult = {
      file,
      lang,
      total: testPairs.length,
      passed: 0,
      failed: 0,
      errors: [],
      samples: [],
    }

    try {
      // AI 翻译
      const translated = await translateBatch(
        sources, lang, new Map(), config,
        undefined, undefined, undefined, undefined, undefined, false,
      )

      // 校对
      const proofreadItems = sources.map((src, i) => ({
        sourceText: src,
        translatedText: translated[i],
      }))
      const proofreadResult = await proofreadBatch(
        proofreadItems, lang, new Map(), config,
        undefined, undefined, undefined, false,
      )
      const finalTranslations = proofreadResult.map(r => r.text)

      // 对比
      for (let i = 0; i < testPairs.length; i++) {
        const source = sources[i]
        const reference = references[i]
        const ai = finalTranslations[i]

        const comparison = compareTranslation(source, reference, ai)

        if (comparison.match) {
          result.passed++
        } else {
          result.failed++
          result.errors.push(`[${i}] ${source.substring(0, 30)}... → ${comparison.issues.join(', ')}`)
        }

        result.samples.push({
          source: source.substring(0, 50),
          reference: reference.substring(0, 50),
          ai: ai.substring(0, 50),
          match: comparison.match,
          issues: comparison.issues,
        })
      }

      console.log(`    ✅ ${result.passed}/${result.total} 通过`)

    } catch (error) {
      result.errors.push(`执行异常: ${error.message}`)
      result.failed = result.total
    }

    results.push(result)
  }

  return results
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('=== 真实翻译文档测试 v2 ===\n')

  const allResults: TestResult[] = []

  for (const fileName of TEST_FILES) {
    const filePath = path.join(TEST_DIR, fileName)
    console.log(`\n📄 ${fileName}`)

    if (!fs.existsSync(filePath)) {
      console.log(`  ❌ 文件不存在`)
      continue
    }

    const pairs = parseCSV(filePath)
    console.log(`  提取 ${pairs.length} 条翻译对`)

    if (pairs.length === 0) {
      console.log(`  ⚠️  无有效翻译对，跳过`)
      continue
    }

    const results = await runTest(fileName, pairs)
    allResults.push(...results)
  }

  // 测试报告
  console.log('\n\n=== 测试报告 ===\n')

  const totalPassed = allResults.reduce((sum, r) => sum + r.passed, 0)
  const totalFailed = allResults.reduce((sum, r) => sum + r.failed, 0)
  const totalTests = totalPassed + totalFailed

  console.log(`总计: ${totalTests} 条测试`)
  console.log(`通过: ${totalPassed} 条`)
  console.log(`失败: ${totalFailed} 条`)
  console.log(`通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`)

  // 按语言统计
  console.log('\n=== 按语言统计 ===')
  const byLang: Record<string, { passed: number; failed: number }> = {}
  for (const r of allResults) {
    if (!byLang[r.lang]) byLang[r.lang] = { passed: 0, failed: 0 }
    byLang[r.lang].passed += r.passed
    byLang[r.lang].failed += r.failed
  }

  for (const [lang, stats] of Object.entries(byLang)) {
    const total = stats.passed + stats.failed
    const rate = ((stats.passed / total) * 100).toFixed(1)
    console.log(`  ${lang}: ${stats.passed}/${total} (${rate}%)`)
  }

  // 失败详情
  if (totalFailed > 0) {
    console.log('\n=== 失败详情 ===')
    for (const r of allResults.filter(r => r.failed > 0)) {
      console.log(`\n❌ ${r.file} - ${r.lang}`)
      for (const err of r.errors.slice(0, 5)) {
        console.log(`  - ${err}`)
      }
    }
  }

  // 示例对比
  console.log('\n=== 示例对比（每种语言前 2 条）===')
  for (const r of allResults) {
    console.log(`\n${r.lang}:`)
    for (const s of r.samples.slice(0, 2)) {
      console.log(`  源文: ${s.source}`)
      console.log(`  参考: ${s.reference}`)
      console.log(`  AI:   ${s.ai}`)
      console.log(`  ${s.match ? '✅' : '❌'} ${s.match ? '通过' : s.issues.join(', ')}`)
      console.log()
    }
  }

  if (totalFailed === 0) {
    console.log('\n✅ 所有测试通过！')
    process.exit(0)
  } else {
    console.log(`\n❌ ${totalFailed} 条测试失败`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('测试执行失败:', err)
  process.exit(1)
})
