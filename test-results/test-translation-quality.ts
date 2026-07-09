/**
 * 翻译质量综合测试脚本
 * 测试维度：产品线 × 场景 × 语言 × 批次大小 × 文本类型
 *
 * 使用方法：
 *   npx tsx test-translation-quality.ts
 *
 * 环境变量：
 *   API_URL - API 地址（默认 http://127.0.0.1:8788/v1/chat/completions）
 *   API_KEY - API 密钥（默认 test-key）
 *   MODEL - 模型名称（默认 qwen3.7-plus）
 */

// Node.js 环境没有 XMLHttpRequest，用 xhr2 polyfill 补上
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { translateBatch, detectUntranslatedText } from './lib/llm-api'
import { LLMConfig } from './messages/types'

// ============================================================
// 测试配置
// ============================================================

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-FS2AGf1vcZU1OpIIho7nBd8bQGcm45nII6UlZAECxj5Iaamn'
const MODEL = 'qwen3.7-max'

// ============================================================
// 测试数据：不同产品线 × 文本类型
// ============================================================

interface TestCase {
  name: string
  productLine: string | null
  texts: string[]
  glossary: Map<string, string>
}

const testCases: TestCase[] = [
  // ── 游戏存储卡 (gaming_card) ──
  {
    name: 'gaming_card: 口号+标题+产品名+描述',
    productLine: 'gaming_card',
    texts: [
      'Good for Today Great for Tomorrow',
      'Level-up Your Handheld Gaming Experience',
      'Lexar PLAY PRO microSDXC Express Card',
      'Read speeds up to 800MB/s let you play, create, and store more',
      '*Comparison of theoretical maximum speeds (Data source: SDA)',
    ],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Cartão Lexar PLAY PRO microSDXC Express'],
      ['Read Speed', 'Velocidade de leitura'],
      ['Handheld Consoles', 'Consolas portáteis'],
    ]),
  },

  // ── 电竞 SSD (gaming_ssd) ──
  {
    name: 'gaming_ssd: 技术参数+产品名+卖点',
    productLine: 'gaming_ssd',
    texts: [
      'Lexar NM790 PCIe 4.0 NVMe SSD',
      'Read speeds up to 7400MB/s',
      'Game faster, load quicker, perform better',
      'Compatible with PlayStation 5 and PC',
      'Available in 1TB, 2TB, and 4TB capacities',
    ],
    glossary: new Map([
      ['Lexar NM790 PCIe 4.0 NVMe SSD', 'SSD Lexar NM790 PCIe 4.0 NVMe'],
      ['Read Speed', 'Velocidade de leitura'],
      ['Write Speed', 'Velocidade de gravação'],
    ]),
  },

  // ── 专业影像 (professional_imaging) ──
  {
    name: 'professional_imaging: 专业描述+产品名+规格',
    productLine: 'professional_imaging',
    texts: [
      'Lexar Professional CFexpress Type B Card',
      'Capture every detail with blazing-fast write speeds',
      'Designed for professional photographers and videographers',
      'Rigorously tested for reliability in extreme conditions',
      '*Write speed up to 800MB/s (Data source: Lexar)',
    ],
    glossary: new Map([
      ['Lexar Professional CFexpress Type B Card', 'Cartão Lexar Professional CFexpress Tipo B'],
      ['Write Speed', 'Velocidade de gravação'],
      ['Rigorously Tested', 'Rigorosamente testado'],
    ]),
  },

  // ── PC 生产力 (pc_productivity) ──
  {
    name: 'pc_productivity: 办公场景+产品名+性能',
    productLine: 'pc_productivity',
    texts: [
      'Lexar NS100 2.5" SATA SSD',
      'Boost your PC performance with faster boot times',
      'Ideal for everyday computing and office work',
      'Easy installation — upgrade in minutes',
      'Available in 240GB, 480GB, and 960GB',
    ],
    glossary: new Map([
      ['Lexar NS100 2.5" SATA SSD', 'SSD Lexar NS100 2.5" SATA'],
      ['Read Speed', 'Velocidade de leitura'],
    ]),
  },

  // ── 消费存储卡 (consumer_cards) ──
  {
    name: 'consumer_cards: 日常使用+产品名+容量',
    productLine: 'consumer_cards',
    texts: [
      'Lexar SILVER PLUS microSD Card',
      'Store more photos, videos, and files',
      'Perfect for smartphones and tablets',
      'Fast transfer speeds for quick access',
      'Available in 64GB, 128GB, and 256GB',
    ],
    glossary: new Map([
      ['Lexar SILVER PLUS microSD Card', 'Cartão microSD Lexar SILVER PLUS'],
      ['Card Reader', 'Leitor de cartões'],
    ]),
  },

  // ── 移动存储 (portable_storage) ──
  {
    name: 'portable_storage: 便携场景+产品名+特性',
    productLine: 'portable_storage',
    texts: [
      'Lexar Armor 700 Portable SSD',
      'Take your files anywhere with durable protection',
      'Shock-resistant design for outdoor adventures',
      'USB 3.2 Gen 2 for fast data transfer',
      'Compatible with Windows, Mac, and Android',
    ],
    glossary: new Map([
      ['Lexar Armor 700 Portable SSD', 'SSD Portátil Lexar Armor 700'],
      ['Read Speed', 'Velocidade de leitura'],
    ]),
  },

  // ── 无产品线（通用场景）──
  {
    name: 'general: 混合文本类型',
    productLine: null,
    texts: [
      'Power Up Your Play',
      'Lexar Quality Labs',
      'Limited Lifetime Warranty',
      '*Read speed up to 7000MB/s (Data source: Lexar)',
      'Compatible with a wide range of devices',
    ],
    glossary: new Map([
      ['Power Up Your Play', 'Potencialize a sua jogabilidade'],
      ['Lexar Quality Labs', 'Laboratórios de Qualidade Lexar'],
      ['Limited Lifetime Warranty', 'Garantia limitada vitalícia'],
    ]),
  },
]

// ============================================================
// 测试语言
// ============================================================

const testLanguages = [
  { code: 'pt', name: 'Portuguese' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
]

// ============================================================
// 批次大小
// ============================================================

const batchSizes = [1, 5, 10]

// ============================================================
// 测试结果统计
// ============================================================

interface TestResult {
  testCase: string
  language: string
  batchSize: number
  totalTexts: number
  untranslatedCount: number
  untranslatedIndices: number[]
  passed: boolean
}

const results: TestResult[] = []

// ============================================================
// 测试执行
// ============================================================

async function runTest(testCase: TestCase, lang: { code: string; name: string }, batchSize: number): Promise<TestResult> {
  const config: LLMConfig = {
    apiKey: API_KEY,
    apiUrl: API_URL,
    model: MODEL,
    translationStyle: 'standard',
    translationStyleCustom: '',
    scenePreset: 'standard',
    manualProductLine: testCase.productLine || 'none',
    enableProofread: false,
    proofreadApiKey: '',
    proofreadApiUrl: '',
    proofreadModel: '',
  }

  // 按批次大小分割文本
  const batches: string[][] = []
  for (let i = 0; i < testCase.texts.length; i += batchSize) {
    batches.push(testCase.texts.slice(i, i + batchSize))
  }

  let allResults: string[] = []
  for (const batch of batches) {
    const batchResults = await translateBatch(
      batch,
      lang.code,
      testCase.glossary,
      config,
      undefined, // sourceLang
      undefined, // pageName
      undefined, // fileName
      undefined, // crossBatchTerms
      undefined, // taskGlossaryHint
      false, // _isRetry
    )
    allResults = [...allResults, ...batchResults]
  }

  // 检测漏翻
  const untranslatedIndices = detectUntranslatedText(testCase.texts, allResults, lang.code)

  return {
    testCase: testCase.name,
    language: lang.name,
    batchSize,
    totalTexts: testCase.texts.length,
    untranslatedCount: untranslatedIndices.size,
    untranslatedIndices: [...untranslatedIndices],
    passed: untranslatedIndices.size === 0,
  }
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('=== 翻译质量综合测试 ===\n')
  console.log(`API: ${API_URL}`)
  console.log(`Model: ${MODEL}`)
  console.log(`测试用例: ${testCases.length} 个产品线场景`)
  console.log(`测试语言: ${testLanguages.length} 种`)
  console.log(`批次大小: ${batchSizes.join(', ')}\n`)

  let totalTests = 0
  let passedTests = 0
  let failedTests = 0

  for (const testCase of testCases) {
    for (const lang of testLanguages) {
      for (const batchSize of batchSizes) {
        totalTests++
        console.log(`[${totalTests}] ${testCase.name} → ${lang.name} (batch=${batchSize})`)

        try {
          const result = await runTest(testCase, lang, batchSize)
          results.push(result)

          if (result.passed) {
            passedTests++
            console.log(`  ✅ PASS (${result.totalTexts} texts translated)\n`)
          } else {
            failedTests++
            console.log(`  ❌ FAIL (${result.untranslatedCount}/${result.totalTexts} untranslated)`)
            console.log(`  Untranslated indices: ${result.untranslatedIndices.join(', ')}\n`)
          }
        } catch (error) {
          failedTests++
          console.log(`  ❌ ERROR: ${error}\n`)
          results.push({
            testCase: testCase.name,
            language: lang.name,
            batchSize,
            totalTexts: testCase.texts.length,
            untranslatedCount: testCase.texts.length,
            untranslatedIndices: testCase.texts.map((_, i) => i),
            passed: false,
          })
        }
      }
    }
  }

  // ============================================================
  // 测试结果汇总
  // ============================================================

  console.log('\n=== 测试结果汇总 ===\n')
  console.log(`总计测试: ${totalTests}`)
  console.log(`通过: ${passedTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`)
  console.log(`失败: ${failedTests} (${((failedTests / totalTests) * 100).toFixed(1)}%)\n`)

  // 按语言统计
  console.log('按语言统计:')
  for (const lang of testLanguages) {
    const langResults = results.filter(r => r.language === lang.name)
    const langPassed = langResults.filter(r => r.passed).length
    console.log(`  ${lang.name}: ${langPassed}/${langResults.length} passed`)
  }

  // 按批次大小统计
  console.log('\n按批次大小统计:')
  for (const batchSize of batchSizes) {
    const batchResults = results.filter(r => r.batchSize === batchSize)
    const batchPassed = batchResults.filter(r => r.passed).length
    console.log(`  batch=${batchSize}: ${batchPassed}/${batchResults.length} passed`)
  }

  // 按产品线统计
  console.log('\n按产品线统计:')
  for (const testCase of testCases) {
    const caseResults = results.filter(r => r.testCase === testCase.name)
    const casePassed = caseResults.filter(r => r.passed).length
    console.log(`  ${testCase.name}: ${casePassed}/${caseResults.length} passed`)
  }

  // 失败详情
  if (failedTests > 0) {
    console.log('\n=== 失败详情 ===\n')
    for (const result of results.filter(r => !r.passed)) {
      console.log(`❌ ${result.testCase} → ${result.language} (batch=${result.batchSize})`)
      console.log(`   Untranslated: ${result.untranslatedCount}/${result.totalTexts}`)
      console.log(`   Indices: ${result.untranslatedIndices.join(', ')}\n`)
    }
  }

  // 退出码
  if (failedTests > 0) {
    console.log('\n⚠️ 有测试失败，需要调整')
    process.exit(1)
  } else {
    console.log('\n✅ 所有测试通过')
  }
}

main().catch(console.error)
