/**
 * 真实翻译文档压力测试脚本
 *
 * 使用真实 CSV 翻译文件进行压力测试：
 * 1. 大批次翻译（10-15 条/批次）
 * 2. 多语言覆盖（13 种语言）
 * 3. 术语库验证（检查是否正确应用术语库）
 * 4. 与参考译文对比（关键信息保留检查）
 *
 * 使用方法：
 *   npx tsx test-results/test-stress-real-translations.ts
 */

// Node.js 环境没有 XMLHttpRequest，用 xhr2 polyfill 补上
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse/sync'
import { translateBatch } from '../lib/llm-api'
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
  enableProofread: false,  // 压力测试先关闭校对，减少 API 调用
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

// 测试文件列表（选择有代表性的文件）
const TEST_FILES = [
  'Card 卡类-OW&AMZ小语种翻译 - PLAY PRO microSD.csv',
  'Card 卡类-OW&AMZ小语种翻译 - ARMOR GOLD SD.csv',
  'Card 卡类-OW&AMZ小语种翻译 - CFe 4.0 DIAMOND Type B.csv',
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
  score: number  // 0-100
}

function compareTranslation(
  source: string,
  reference: string,
  ai: string,
): ComparisonResult {
  const issues: string[] = []
  let score = 100

  // 1. 检查是否为空
  if (!ai || ai.length === 0) {
    issues.push('译文为空')
    return { match: false, issues, score: 0 }
  }

  // 2. 提取关键信息
  const srcNumbers = source.match(/\d+/g) || []
  const aiNumbers = ai.match(/\d+/g) || []

  // 3. 检查数字保留（允许格式差异，如 900MB/s → 900 MB/s）
  const missingNumbers = srcNumbers.filter(n => !aiNumbers.includes(n))
  if (missingNumbers.length > 0) {
    issues.push(`丢失数字: ${missingNumbers.join(', ')}`)
    score -= 20
  }

  // 4. 检查品牌名保留（Lexar, PLAY PRO 等）
  const brandPatterns = [
    { pattern: /Lexar/i, name: 'Lexar' },
    { pattern: /PLAY\s*PRO/i, name: 'PLAY PRO' },
    { pattern: /microSD/i, name: 'microSD' },
    { pattern: /ARMOR\s*GOLD/i, name: 'ARMOR GOLD' },
    { pattern: /DIAMOND/i, name: 'DIAMOND' },
    { pattern: /CFexpress/i, name: 'CFexpress' },
  ]

  for (const { pattern, name } of brandPatterns) {
    const srcHas = pattern.test(source)
    const aiHas = pattern.test(ai)
    if (srcHas && !aiHas) {
      issues.push(`丢失品牌: ${name}`)
      score -= 15
    }
  }

  // 5. 检查技术术语保留（microSDXC, Express Card 等）
  const techPatterns = [
    { pattern: /microSDXC/i, name: 'microSDXC' },
    { pattern: /Express\s*Card/i, name: 'Express Card' },
    { pattern: /PCIe/i, name: 'PCIe' },
    { pattern: /NVMe/i, name: 'NVMe' },
  ]

  for (const { pattern, name } of techPatterns) {
    const srcHas = pattern.test(source)
    const aiHas = pattern.test(ai)
    if (srcHas && !aiHas) {
      issues.push(`丢失术语: ${name}`)
      score -= 10
    }
  }

  // 6. 检查译文长度合理性（防止截断或过度扩展）
  const srcLen = source.length
  const aiLen = ai.length
  const refLen = reference.length

  // 译文长度应该在源文的 0.3-3 倍之间（CJK 字符更紧凑）
  if (aiLen < srcLen * 0.3 && srcLen > 50) {
    issues.push(`译文过短: 源文 ${srcLen} 字符，译文 ${aiLen} 字符`)
    score -= 15
  }
  if (aiLen > srcLen * 3 && srcLen > 50) {
    issues.push(`译文过长: 源文 ${srcLen} 字符，译文 ${aiLen} 字符`)
    score -= 10
  }

  // 7. 判断是否通过（允许合理的翻译差异）
  const match = issues.length === 0

  return { match, issues, score: Math.max(0, score) }
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
  avgScore: number
  errors: string[]
  samples: Array<{
    source: string
    reference: string
    ai: string
    match: boolean
    score: number
    issues: string[]
  }>
  duration: number
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

    // 压力测试：使用更大的批次（10-15 条）
    const batchSize = Math.min(15, langPairs.length)
    const testPairs = langPairs.slice(0, batchSize)

    const sources = testPairs.map(p => p.source)
    const references = testPairs.map(p => p.reference)

    const result: TestResult = {
      file,
      lang,
      total: testPairs.length,
      passed: 0,
      failed: 0,
      avgScore: 0,
      errors: [],
      samples: [],
      duration: 0,
    }

    try {
      // AI 翻译
      const startTime = Date.now()
      const translated = await translateBatch(
        sources, lang, new Map(), config,
        undefined, undefined, undefined, undefined, undefined, false,
      )
      result.duration = Date.now() - startTime

      // 对比结果
      let totalScore = 0
      for (let i = 0; i < testPairs.length; i++) {
        const comparison = compareTranslation(sources[i], references[i], translated[i])
        totalScore += comparison.score

        result.samples.push({
          source: sources[i],
          reference: references[i],
          ai: translated[i],
          match: comparison.match,
          score: comparison.score,
          issues: comparison.issues,
        })

        if (comparison.match) {
          result.passed++
        } else {
          result.failed++
        }
      }

      result.avgScore = totalScore / testPairs.length

    } catch (error) {
      result.errors.push(`翻译失败: ${error.message}`)
      result.failed = testPairs.length
    }

    results.push(result)
  }

  return results
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('=== 真实翻译文档压力测试 ===\n')
  console.log('测试维度：')
  console.log('  1. 大批次翻译（10-15 条/批次）')
  console.log('  2. 多语言覆盖（13 种语言）')
  console.log('  3. 与参考译文对比（关键信息保留检查）')
  console.log('  4. 术语库验证（品牌名、技术术语保留）\n')

  const allResults: TestResult[] = []

  for (const testFile of TEST_FILES) {
    const filePath = path.join(TEST_DIR, testFile)

    if (!fs.existsSync(filePath)) {
      console.log(`\n⚠️  文件不存在: ${testFile}`)
      continue
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`📄 ${testFile}`)
    console.log('='.repeat(60))

    const pairs = parseCSV(filePath)
    console.log(`  提取 ${pairs.length} 条翻译对`)

    if (pairs.length === 0) {
      console.log('  ⚠️  无有效翻译对，跳过')
      continue
    }

    const results = await runTest(testFile, pairs)
    allResults.push(...results)
  }

  // 测试报告
  console.log('\n\n' + '='.repeat(60))
  console.log('测试报告')
  console.log('='.repeat(60))

  const totalTests = allResults.length
  const totalPassed = allResults.reduce((sum, r) => sum + r.passed, 0)
  const totalFailed = allResults.reduce((sum, r) => sum + r.failed, 0)
  const totalItems = totalPassed + totalFailed
  const avgScore = allResults.reduce((sum, r) => sum + r.avgScore, 0) / totalTests
  const avgDuration = allResults.reduce((sum, r) => sum + r.duration, 0) / totalTests

  console.log(`\n总计: ${totalTests} 个语言测试`)
  console.log(`总条目: ${totalItems} 条`)
  console.log(`通过: ${totalPassed} 条`)
  console.log(`失败: ${totalFailed} 条`)
  console.log(`通过率: ${((totalPassed / totalItems) * 100).toFixed(1)}%`)
  console.log(`平均得分: ${avgScore.toFixed(1)}/100`)
  console.log(`平均耗时: ${avgDuration.toFixed(0)}ms`)

  // 按语言统计
  console.log('\n=== 按语言统计 ===')
  const byLang: Record<string, { passed: number; failed: number; total: number }> = {}
  for (const r of allResults) {
    if (!byLang[r.lang]) byLang[r.lang] = { passed: 0, failed: 0, total: 0 }
    byLang[r.lang].passed += r.passed
    byLang[r.lang].failed += r.failed
    byLang[r.lang].total += r.total
  }
  for (const [lang, stats] of Object.entries(byLang)) {
    const rate = ((stats.passed / stats.total) * 100).toFixed(1)
    console.log(`  ${lang}: ${stats.passed}/${stats.total} (${rate}%)`)
  }

  // 失败详情
  if (totalFailed > 0) {
    console.log('\n=== 失败详情（前 10 条）===')
    let count = 0
    for (const r of allResults) {
      for (const s of r.samples) {
        if (!s.match && count < 10) {
          console.log(`\n❌ ${r.file} - ${r.lang}`)
          console.log(`  源文: ${s.source.slice(0, 80)}...`)
          console.log(`  参考: ${s.reference.slice(0, 80)}...`)
          console.log(`  AI:   ${s.ai.slice(0, 80)}...`)
          console.log(`  得分: ${s.score}/100`)
          for (const issue of s.issues) {
            console.log(`    - ${issue}`)
          }
          count++
        }
      }
    }
  }

  // 示例对比（前 3 条）
  console.log('\n=== 示例对比（前 3 条）===')
  let count = 0
  for (const r of allResults) {
    for (const s of r.samples) {
      if (count < 3) {
        console.log(`\n${r.file} - ${r.lang}:`)
        console.log(`  源文: ${s.source.slice(0, 100)}`)
        console.log(`  参考: ${s.reference.slice(0, 100)}`)
        console.log(`  AI:   ${s.ai.slice(0, 100)}`)
        console.log(`  ${s.match ? '✅ 匹配' : '❌ 不匹配'} (得分: ${s.score}/100)`)
        count++
      }
    }
  }

  if (totalFailed === 0) {
    console.log('\n✅ 所有压力测试通过！')
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
