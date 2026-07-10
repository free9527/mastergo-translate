/**
 * 翻译速度瓶颈测试脚本
 *
 * 测试维度：
 * 1. 超时时间（15秒 vs 120秒）对平均耗时的影响
 * 2. 翻译-校对间隔（0秒 vs 1.5秒）的影响
 * 3. 并发数（3路 vs 5路）是否触发 429
 * 4. temperature（0.1 vs 0.2 vs 0.3）对速度的影响
 * 5. 批次大小（10 vs 15 vs 20）对速度的影响
 *
 * 使用方法：
 *   npx tsx test-results/test-speed-bottlenecks.ts
 */

import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse/sync'

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-FS2AGf1vcZU1OpIIho7nBd8bQGcm45nII6UlZAECxj5Iaamn'
const MODEL = 'qwen3.7-max'

interface TestConfig {
  name: string
  timeout: number
  temperature: number
  batchSize: number
  concurrency: number
  delay: number  // 翻译-校对间隔
}

interface TestResult {
  config: TestConfig
  totalBatches: number
  totalItems: number
  successBatches: number
  failedBatches: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  totalDuration: number
  errors: string[]
}

// 测试数据：从 CSV 提取 30 条源文
function loadTestData(): string[] {
  const TEST_DIR = 'C:/Users/Administrator/Desktop/materGO/translate/测试文本'
  const testFile = 'Card 卡类-OW&AMZ小语种翻译 - PLAY PRO microSD.csv'
  const filePath = path.join(TEST_DIR, testFile)
  const content = fs.readFileSync(filePath, 'utf-8')
  const records = parse(content, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
  })

  // 找到 EN 列
  let enColIndex = -1
  for (let i = 0; i < Math.min(10, records.length); i++) {
    const row = records[i]
    if (row.some(cell => cell && (cell.includes('Reference') || cell.includes('EN')))) {
      for (let j = 0; j < row.length; j++) {
        const cell = (row[j] || '').trim()
        if (cell === 'EN' || cell.includes('EN')) {
          enColIndex = j
          break
        }
      }
      break
    }
  }

  if (enColIndex === -1) return []

  const sources: string[] = []
  for (let i = 3; i < records.length; i++) {
    const cell = (records[i][enColIndex] || '').trim()
    if (cell && cell.length >= 3 && cell.length <= 200 && !/^[\d\s.,]+$/.test(cell)) {
      sources.push(cell)
      if (sources.length >= 60) break  // 60条 = 4批×15条
    }
  }
  return sources
}

// 单次 API 调用
async function callAPI(
  texts: string[],
  targetLang: string,
  config: TestConfig,
): Promise<{ duration: number; success: boolean; error?: string }> {
  const startTime = Date.now()

  const systemPrompt = `You are a translator. Translate the following texts from English to ${targetLang}. Output format: [N] translation`
  const textList = texts.map((t, i) => `[${i + 1}] ${t}`).join('\n')

  try {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', API_URL, true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${API_KEY}`)
    xhr.timeout = config.timeout

    const response = await new Promise<{ ok: boolean; status: number; text: string }>((resolve, reject) => {
      xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText })
      xhr.onerror = () => reject(new Error('网络错误'))
      xhr.ontimeout = () => reject(new Error(`超时（${config.timeout / 1000}秒）`))
      xhr.send(JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: textList },
        ],
        temperature: config.temperature,
      }))
    })

    const duration = Date.now() - startTime
    if (response.ok) {
      return { duration, success: true }
    } else {
      return { duration, success: false, error: `HTTP ${response.status}` }
    }
  } catch (e) {
    return { duration: Date.now() - startTime, success: false, error: (e as Error).message }
  }
}

// 测试单个配置
async function runTest(config: TestConfig, sources: string[]): Promise<TestResult> {
  const result: TestResult = {
    config,
    totalBatches: 0,
    totalItems: 0,
    successBatches: 0,
    failedBatches: 0,
    avgDuration: 0,
    minDuration: Infinity,
    maxDuration: 0,
    totalDuration: 0,
    errors: [],
  }

  const batches: string[][] = []
  for (let i = 0; i < sources.length; i += config.batchSize) {
    batches.push(sources.slice(i, i + config.batchSize))
  }

  const durations: number[] = []
  const startTime = Date.now()

  // 并发执行
  for (let i = 0; i < batches.length; i += config.concurrency) {
    const concurrentBatches = batches.slice(i, i + config.concurrency)
    const promises = concurrentBatches.map(batch => callAPI(batch, 'de', config))
    const results = await Promise.allSettled(promises)

    for (const r of results) {
      result.totalBatches++
      if (r.status === 'fulfilled' && r.value.success) {
        result.successBatches++
        const duration = r.value.duration
        durations.push(duration)
        result.minDuration = Math.min(result.minDuration, duration)
        result.maxDuration = Math.max(result.maxDuration, duration)
        result.totalDuration += duration
      } else {
        result.failedBatches++
        const error = r.status === 'rejected' ? r.reason.message : r.value.error
        result.errors.push(error || 'unknown')
      }
    }

    // 间隔等待
    if (config.delay > 0 && i + config.concurrency < batches.length) {
      await new Promise(r => setTimeout(r, config.delay))
    }
  }

  result.totalDuration = Date.now() - startTime
  result.avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
  result.totalItems = sources.length

  return result
}

// 主流程
async function main() {
  console.log('=== 翻译速度瓶颈测试 ===\n')

  const sources = loadTestData()
  console.log(`加载 ${sources.length} 条测试文本\n`)

  if (sources.length === 0) {
    console.error('未加载到测试数据')
    process.exit(1)
  }

  const tests: TestConfig[] = [
    // 基线测试
    { name: '基线(120s超时, temp=0.2, batch=15, conc=3)', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 0 },

    // 测试1: 超时时间
    { name: '超时15秒', timeout: 15000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 0 },
    { name: '超时60秒', timeout: 60000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 0 },
    { name: '超时120秒', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 0 },

    // 测试2: temperature
    { name: 'temp=0.1', timeout: 120000, temperature: 0.1, batchSize: 15, concurrency: 3, delay: 0 },
    { name: 'temp=0.2', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 0 },
    { name: 'temp=0.3', timeout: 120000, temperature: 0.3, batchSize: 15, concurrency: 3, delay: 0 },

    // 测试3: 批次大小
    { name: 'batch=10', timeout: 120000, temperature: 0.2, batchSize: 10, concurrency: 3, delay: 0 },
    { name: 'batch=15', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 0 },
    { name: 'batch=20', timeout: 120000, temperature: 0.2, batchSize: 20, concurrency: 3, delay: 0 },

    // 测试4: 并发数
    { name: 'conc=1', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 1, delay: 0 },
    { name: 'conc=3', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 0 },
    { name: 'conc=5', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 5, delay: 0 },

    // 测试5: 翻译-校对间隔
    { name: 'delay=0秒', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 0 },
    { name: 'delay=1.5秒', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 1500 },
    { name: 'delay=3秒', timeout: 120000, temperature: 0.2, batchSize: 15, concurrency: 3, delay: 3000 },
  ]

  const results: TestResult[] = []

  for (const test of tests) {
    console.log(`\n测试: ${test.name}`)
    const result = await runTest(test, sources)
    results.push(result)

    console.log(`  批次: ${result.successBatches}/${result.totalBatches} 成功`)
    console.log(`  平均耗时: ${result.avgDuration.toFixed(0)}ms`)
    console.log(`  最小/最大: ${result.minDuration === Infinity ? '-' : result.minDuration + 'ms'} / ${result.maxDuration}ms`)
    console.log(`  总耗时: ${result.totalDuration}ms`)
    if (result.errors.length > 0) {
      console.log(`  错误: ${result.errors.join(', ')}`)
    }
  }

  // 汇总报告
  console.log('\n\n=== 汇总报告 ===\n')
  console.log('测试名称'.padEnd(40) + '平均耗时'.padEnd(15) + '成功率'.padEnd(15) + '总耗时')
  console.log('-'.repeat(80))
  for (const r of results) {
    const successRate = r.totalBatches > 0 ? ((r.successBatches / r.totalBatches) * 100).toFixed(1) + '%' : 'N/A'
    console.log(
      r.config.name.padEnd(40) +
      (r.avgDuration.toFixed(0) + 'ms').padEnd(15) +
      successRate.padEnd(15) +
      r.totalDuration + 'ms'
    )
  }

  // 保存结果
  const logPath = 'test-results/test-speed-bottlenecks-' + new Date().toISOString().slice(0, 10) + '.log'
  const logContent = results.map(r => {
    return `${r.config.name}\n  平均: ${r.avgDuration.toFixed(0)}ms, 最小: ${r.minDuration}ms, 最大: ${r.maxDuration}ms, 总耗时: ${r.totalDuration}ms, 成功: ${r.successBatches}/${r.totalBatches}\n  错误: ${r.errors.join(', ') || '无'}\n`
  }).join('\n')
  fs.writeFileSync(logPath, logContent, 'utf-8')
  console.log(`\n结果已保存到: ${logPath}`)
}

main().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
