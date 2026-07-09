/**
 * 真实翻译文本 + 极端压力测试
 *
 * 结合真实 CSV 翻译文本 + 极端压力场景：
 * 1. 超长文本（1000+ 字符）
 * 2. 大量术语（接近 20 条上限）
 * 3. 多批次翻译（模拟并发场景）
 * 4. 混合语种（中英混合）
 * 5. 极端边界（大量特殊字符、换行符等）
 *
 * 使用方法：
 *   npx tsx test-results/test-stress-real-extreme.ts
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
  enableProofread: false,
  proofreadApiKey: API_KEY,
  proofreadApiUrl: API_URL,
  proofreadModel: MODEL,
}

// ============================================================
// CSV 文件配置
// ============================================================

const TEST_DIR = 'C:/Users/Administrator/Desktop/materGO/translate/测试文本'

// 语言代码映射
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

  let headerRowIndex = -1
  for (let i = 0; i < Math.min(10, records.length); i++) {
    const row = records[i]
    if (row.some(cell => cell && (cell.includes('Reference') || cell.includes('EN')))) {
      headerRowIndex = i
      break
    }
  }

  if (headerRowIndex === -1) return []

  const header = records[headerRowIndex]
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

  if (enColIndex === -1) return []

  const pairs: TranslationPair[] = []

  for (let i = headerRowIndex + 1; i < records.length; i++) {
    const row = records[i]
    const sourceCell = (row[enColIndex] || '').trim()

    if (!sourceCell || sourceCell.length < 3) continue

    const sourceLines = sourceCell.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    for (const [csvLang, colIndex] of Object.entries(langColIndices)) {
      const refCell = (row[colIndex] || '').trim()
      if (!refCell || refCell.length < 2) continue

      const refLines = refCell.split('\n').map(l => l.trim()).filter(l => l.length > 0)
      const stdLang = LANG_MAP[csvLang]

      const pairCount = Math.min(sourceLines.length, refLines.length)
      for (let j = 0; j < pairCount; j++) {
        const source = sourceLines[j]
        const reference = refLines[j]

        if (source.length < 3 || reference.length < 2) continue
        if (/^[\d\s.,]+$/.test(source)) continue

        pairs.push({ source, reference, lang: stdLang })
      }
    }
  }

  return pairs
}

// ============================================================
// 极端压力测试用例生成器
// ============================================================

function generateExtremeTestCases(pairs: TranslationPair[]) {
  const testCases = []

  // ── 测试 1：超长文本（拼接多条真实文本，达到 1000+ 字符）──
  const longTexts = pairs.slice(0, 10).map(p => p.source).join('\n\n')
  if (longTexts.length > 500) {
    testCases.push({
      name: '超长文本（1000+ 字符）',
      texts: [longTexts],
      targetLang: 'zh-CN',
      glossary: new Map([
        ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
        ['Read speed', '读取速度'],
        ['Write speed', '写入速度'],
        ['Lexar AIR PRO SD Card Reader', 'Lexar AIR PRO SD 读卡器'],
        ['Lexar ARMOR GOLD SD Card', 'Lexar ARMOR GOLD SD 存储卡'],
      ]),
      expectedKeywords: ['Lexar', '存储卡', '读取速度'],
    })
  }

  // ── 测试 2：大量术语（接近 20 条上限）──
  const productTexts = pairs
    .filter(p => p.source.includes('Lexar') || p.source.includes('Card') || p.source.includes('SSD'))
    .slice(0, 15)
    .map(p => p.source)

  if (productTexts.length >= 10) {
    testCases.push({
      name: '大量术语（接近 20 条上限）',
      texts: productTexts,
      targetLang: 'zh-CN',
      glossary: new Map([
        ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
        ['Lexar ARMOR GOLD SD Card', 'Lexar ARMOR GOLD SD 存储卡'],
        ['Lexar SILVER PLUS microSD Card', 'Lexar SILVER PLUS microSD 存储卡'],
        ['Lexar DIAMOND PLUS CF Card', 'Lexar DIAMOND PLUS CF 存储卡'],
        ['Lexar NM790 PCIe 4.0 NVMe SSD', 'Lexar NM790 PCIe 4.0 NVMe 固态硬盘'],
        ['Lexar Professional CFexpress Card', 'Lexar Professional CFexpress 存储卡'],
        ['Lexar AIR PRO SD Card Reader', 'Lexar AIR PRO SD 读卡器'],
        ['Lexar JumpDrive S47 USB Flash Drive', 'Lexar JumpDrive S47 USB 闪存盘'],
        ['Read speed', '读取速度'],
        ['Write speed', '写入速度'],
        ['Storage capacity', '存储容量'],
        ['Transfer files', '传输文件'],
        ['High-speed data transfer', '高速数据传输'],
        ['Durable and reliable', '耐用可靠'],
        ['Waterproof design', '防水设计'],
        ['Shockproof design', '防震设计'],
        ['Lifetime warranty', '终身保修'],
        ['Content creators', '内容创作者'],
        ['Professional photographers', '专业摄影师'],
        ['Videographers', '摄像师'],
      ]),
      expectedKeywords: ['Lexar', '存储卡'],
    })
  }

  // ── 测试 3：多批次翻译（模拟并发场景，每批 15 条）──
  const batchTexts = pairs.slice(0, 15).map(p => p.source)
  if (batchTexts.length >= 10) {
    testCases.push({
      name: '多批次翻译（15 条/批次）',
      texts: batchTexts,
      targetLang: 'zh-CN',
      glossary: new Map([
        ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
        ['Read speed', '读取速度'],
        ['Write speed', '写入速度'],
      ]),
      expectedKeywords: ['Lexar'],
    })
  }

  // ── 测试 4：混合语种（中英混合，从真实文本中提取）──
  const mixedTexts = pairs
    .filter(p => /[a-zA-Z]/.test(p.source) && /[一-龥]/.test(p.source))
    .slice(0, 5)
    .map(p => p.source)

  if (mixedTexts.length >= 3) {
    testCases.push({
      name: '混合语种（中英混合）',
      texts: mixedTexts,
      targetLang: 'zh-CN',
      glossary: new Map([
        ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
        ['Read speed', '读取速度'],
        ['Write speed', '写入速度'],
      ]),
      expectedKeywords: ['Lexar'],
    })
  }

  // ── 测试 5：极端边界（大量特殊字符、换行符）──
  const specialTexts = pairs
    .filter(p => /[®™©\n\r\t]/.test(p.source) || p.source.length > 200)
    .slice(0, 5)
    .map(p => p.source)

  if (specialTexts.length >= 3) {
    testCases.push({
      name: '极端边界（大量特殊字符、换行符）',
      texts: specialTexts,
      targetLang: 'zh-CN',
      glossary: new Map([
        ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
        ['Read speed', '读取速度'],
        ['Write speed', '写入速度'],
      ]),
      expectedKeywords: ['Lexar'],
    })
  }

  // ── 测试 6：术语冲突（相似术语同时出现）──
  const conflictTexts = [
    'Card reader for SD Card',
    'Card and Card reader bundle',
    'Memory Card vs Memory',
    'SSD vs HDD storage',
    'Read speed and Write speed comparison',
  ]
  testCases.push({
    name: '术语冲突（相似术语同时出现）',
    texts: conflictTexts,
    targetLang: 'zh-CN',
    glossary: new Map([
      ['Card', '存储卡'],
      ['Card reader', '读卡器'],
      ['SD Card', 'SD 存储卡'],
      ['Memory Card', '内存卡'],
      ['Memory', '内存'],
      ['SSD', '固态硬盘'],
      ['HDD', '机械硬盘'],
      ['Read speed', '读取速度'],
      ['Write speed', '写入速度'],
    ]),
    expectedKeywords: ['存储卡', '读卡器', '读取速度'],
  })

  // ── 测试 7：多语言目标（同一批次，不同目标语言）──
  const multiLangTexts = pairs.slice(0, 5).map(p => p.source)
  if (multiLangTexts.length >= 3) {
    testCases.push({
      name: '多语言目标（zh-CN）',
      texts: multiLangTexts,
      targetLang: 'zh-CN',
      glossary: new Map([
        ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
        ['Read speed', '读取速度'],
        ['Write speed', '写入速度'],
      ]),
      expectedKeywords: ['Lexar'],
    })

    testCases.push({
      name: '多语言目标（ja）',
      texts: multiLangTexts,
      targetLang: 'ja',
      glossary: new Map([
        ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Expressカード'],
        ['Read speed', '読み込み速度'],
        ['Write speed', '書き込み速度'],
      ]),
      expectedKeywords: ['Lexar'],
    })

    testCases.push({
      name: '多语言目标（de）',
      texts: multiLangTexts,
      targetLang: 'de',
      glossary: new Map([
        ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express Karte'],
        ['Read speed', 'Lesegeschwindigkeit'],
        ['Write speed', 'Schreibgeschwindigkeit'],
      ]),
      expectedKeywords: ['Lexar'],
    })
  }

  return testCases
}

// ============================================================
// 验证逻辑
// ============================================================

interface TestResult {
  name: string
  passed: boolean
  actual: string[]
  expectedKeywords?: string[]
  issues: string[]
  duration: number
  score: number  // 0-100
}

function verifyResult(
  testCase: { texts: string[]; expectedKeywords?: string[] },
  actual: string[],
  duration: number,
): TestResult {
  const issues: string[] = []
  let score = 100

  // 检查是否为空
  for (let i = 0; i < actual.length; i++) {
    if (!actual[i] || actual[i].length === 0) {
      issues.push(`[${i}] 译文为空`)
      score -= 20
    }
  }

  // 检查关键词
  if (testCase.expectedKeywords) {
    const combined = actual.join(' ')
    for (const keyword of testCase.expectedKeywords) {
      if (!combined.includes(keyword)) {
        issues.push(`缺少关键词: "${keyword}"`)
        score -= 15
      }
    }
  }

  // 检查译文长度（防止截断）
  for (let i = 0; i < actual.length; i++) {
    const srcLen = testCase.texts[i].length
    const tgtLen = actual[i].length
    if (tgtLen < srcLen * 0.3 && srcLen > 50) {
      issues.push(`[${i}] 译文过短: 源文 ${srcLen} 字符，译文 ${tgtLen} 字符`)
      score -= 15
    }
  }

  return {
    name: '',
    passed: issues.length === 0,
    actual,
    expectedKeywords: testCase.expectedKeywords,
    issues,
    duration,
    score: Math.max(0, score),
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('=== 真实翻译文本 + 极端压力测试 ===\n')
  console.log('测试维度：')
  console.log('  1. 超长文本（1000+ 字符）')
  console.log('  2. 大量术语（接近 20 条上限）')
  console.log('  3. 多批次翻译（15 条/批次）')
  console.log('  4. 混合语种（中英混合）')
  console.log('  5. 极端边界（大量特殊字符、换行符）')
  console.log('  6. 术语冲突（相似术语同时出现）')
  console.log('  7. 多语言目标（zh-CN, ja, de）\n')

  // 从真实 CSV 文件中提取翻译对
  console.log('📂 从真实 CSV 文件中提取翻译对...\n')
  const allPairs: TranslationPair[] = []

  for (const testFile of TEST_FILES) {
    const filePath = path.join(TEST_DIR, testFile)

    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  文件不存在: ${testFile}`)
      continue
    }

    console.log(`📄 ${testFile}`)
    const pairs = parseCSV(filePath)
    console.log(`  提取 ${pairs.length} 条翻译对`)
    allPairs.push(...pairs)
  }

  console.log(`\n总计提取 ${allPairs.length} 条翻译对\n`)

  if (allPairs.length === 0) {
    console.log('❌ 未找到有效翻译对，退出')
    process.exit(1)
  }

  // 生成极端压力测试用例
  const testCases = generateExtremeTestCases(allPairs)

  console.log(`生成 ${testCases.length} 个极端压力测试用例\n`)

  const results: TestResult[] = []

  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`测试: ${testCase.name}`)
    console.log(`${'='.repeat(60)}`)

    console.log('\n【输入】')
    console.log(`  文本数量: ${testCase.texts.length}`)
    console.log(`  总字符数: ${testCase.texts.reduce((sum, t) => sum + t.length, 0)}`)
    console.log(`  术语数量: ${testCase.glossary.size}`)
    console.log(`  目标语言: ${testCase.targetLang}`)

    try {
      console.log('\n【翻译中...】')
      const startTime = Date.now()
      const translated = await translateBatch(
        testCase.texts,
        testCase.targetLang,
        testCase.glossary,
        config,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      )
      const duration = Date.now() - startTime

      console.log('\n【译文】')
      translated.forEach((t, i) => console.log(`  [${i}] ${t.slice(0, 100)}${t.length > 100 ? '...' : ''}`))

      const result = verifyResult(testCase, translated, duration)
      result.name = testCase.name
      results.push(result)

      console.log('\n【验证结果】')
      console.log(`  耗时: ${duration}ms`)
      console.log(`  得分: ${result.score}/100`)
      if (result.passed) {
        console.log('  ✅ 通过')
      } else {
        console.log('  ❌ 失败')
        for (const issue of result.issues) {
          console.log(`    - ${issue}`)
        }
      }

    } catch (error) {
      console.log(`\n  ❌ 翻译失败: ${error.message}`)
      results.push({
        name: testCase.name,
        passed: false,
        actual: [],
        issues: [`翻译失败: ${error.message}`],
        duration: 0,
        score: 0,
      })
    }
  }

  // 测试报告
  console.log('\n\n' + '='.repeat(60))
  console.log('测试报告')
  console.log('='.repeat(60))

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const total = results.length
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length

  console.log(`\n总计: ${total} 个测试`)
  console.log(`通过: ${passed} 个`)
  console.log(`失败: ${failed} 个`)
  console.log(`通过率: ${((passed / total) * 100).toFixed(1)}%`)
  console.log(`平均得分: ${avgScore.toFixed(1)}/100`)
  console.log(`平均耗时: ${avgDuration.toFixed(0)}ms`)

  if (failed > 0) {
    console.log('\n=== 失败详情 ===')
    for (const r of results.filter(r => !r.passed)) {
      console.log(`\n❌ ${r.name}`)
      console.log(`  得分: ${r.score}/100`)
      for (const issue of r.issues) {
        console.log(`  - ${issue}`)
      }
    }
  }

  if (failed === 0) {
    console.log('\n✅ 所有极端压力测试通过！')
    process.exit(0)
  } else {
    console.log(`\n❌ ${failed} 个测试失败`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('测试执行失败:', err)
  process.exit(1)
})
