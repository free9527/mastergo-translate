/**
 * 术语库新方案验证测试
 *
 * 验证：直接注入术语表 + enforceGlossaryTerms 安全网
 *
 * 使用方法：
 *   npx tsx test-results/test-glossary-new-approach.ts
 */

// Node.js 环境没有 XMLHttpRequest，用 xhr2 polyfill 补上
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

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
// 测试用例
// ============================================================

const testCases = [
  {
    name: '单术语精确匹配',
    texts: ['Lexar PLAY PRO microSDXC Express Card'],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
    ]),
    expected: 'Lexar PLAY PRO microSDXC Express 存储卡',
  },
  {
    name: '多术语混合',
    texts: ['Lexar PLAY PRO microSDXC Express Card with Read speed up to 900MB/s'],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
      ['Read speed', '读取速度'],
    ]),
    expectedKeywords: ['Lexar PLAY PRO microSDXC Express 存储卡', '读取速度'],
  },
  {
    name: '术语变形（复数）',
    texts: ['Read speeds up to 800MB/s'],
    glossary: new Map([
      ['Read speed', '读取速度'],
    ]),
    expectedKeywords: ['读取速度'],
  },
  {
    name: '术语冲突（Card vs Card reader）',
    texts: ['Card reader and Card'],
    glossary: new Map([
      ['Card', '存储卡'],
      ['Card reader', '读卡器'],
    ]),
    expectedKeywords: ['读卡器', '存储卡'],
  },
  {
    name: '术语+普通文本',
    texts: ['Power Up Your Play with Lexar PLAY PRO microSDXC Express Card'],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
    ]),
    expectedKeywords: ['Lexar PLAY PRO microSDXC Express 存储卡'],
  },
]

// ============================================================
// 验证逻辑
// ============================================================

interface TestResult {
  name: string
  passed: boolean
  actual: string[]
  expected?: string
  expectedKeywords?: string[]
  issues: string[]
}

function verifyResult(
  testCase: typeof testCases[0],
  actual: string[],
): TestResult {
  const issues: string[] = []
  let passed = true

  // 检查是否为空
  for (let i = 0; i < actual.length; i++) {
    if (!actual[i] || actual[i].length === 0) {
      issues.push(`[${i}] 译文为空`)
      passed = false
    }
  }

  // 检查精确匹配
  if (testCase.expected) {
    if (actual[0] !== testCase.expected) {
      issues.push(`期望: "${testCase.expected}"`)
      issues.push(`实际: "${actual[0]}"`)
      passed = false
    }
  }

  // 检查关键词
  if (testCase.expectedKeywords) {
    const combined = actual.join(' ')
    for (const keyword of testCase.expectedKeywords) {
      if (!combined.includes(keyword)) {
        issues.push(`缺少关键词: "${keyword}"`)
        passed = false
      }
    }
  }

  return {
    name: testCase.name,
    passed,
    actual,
    expected: testCase.expected,
    expectedKeywords: testCase.expectedKeywords,
    issues,
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('=== 术语库新方案验证测试 ===\n')
  console.log('方案：直接注入术语表 + enforceGlossaryTerms 安全网\n')

  const results: TestResult[] = []

  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`测试: ${testCase.name}`)
    console.log(`${'='.repeat(60)}`)

    console.log('\n【输入】')
    testCase.texts.forEach((t, i) => console.log(`  [${i}] ${t}`))

    console.log('\n【术语表】')
    for (const [k, v] of testCase.glossary.entries()) {
      console.log(`  "${k}" → "${v}"`)
    }

    try {
      console.log('\n【翻译中...】')
      const translated = await translateBatch(
        testCase.texts,
        'zh-CN',
        testCase.glossary,
        config,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      )

      console.log('\n【译文】')
      translated.forEach((t, i) => console.log(`  [${i}] ${t}`))

      const result = verifyResult(testCase, translated)
      results.push(result)

      console.log('\n【验证结果】')
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

  console.log(`\n总计: ${total} 个测试`)
  console.log(`通过: ${passed} 个`)
  console.log(`失败: ${failed} 个`)
  console.log(`通过率: ${((passed / total) * 100).toFixed(1)}%`)

  if (failed > 0) {
    console.log('\n=== 失败详情 ===')
    for (const r of results.filter(r => !r.passed)) {
      console.log(`\n❌ ${r.name}`)
      for (const issue of r.issues) {
        console.log(`  - ${issue}`)
      }
    }
  }

  if (failed === 0) {
    console.log('\n✅ 所有测试通过！')
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
