/**
 * 术语库新方案 - 极端压力测试
 *
 * 测试维度：
 * 1. 长文本（>500字符）+ 多术语混合
 * 2. 多批次翻译（10批次 × 15条）
 * 3. 混合语种（中英混合）
 * 4. 极端边界（大量术语、超长文本、特殊字符）
 *
 * 使用方法：
 *   npx tsx test-results/test-stress-glossary.ts
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
// 压力测试用例
// ============================================================

const stressTests = [
  // ── 测试 1：长文本 + 多术语混合（500+ 字符）──
  {
    name: '长文本 + 多术语混合（500+ 字符）',
    texts: [
      `Lexar® PLAY PRO™ microSDXC™ Express Card delivers revolutionary performance with Read speed up to 900MB/s and Write speed up to 800MB/s. Perfect for gaming, photography, and videography. Compatible with Lexar® AIR PRO™ SD Card Reader for ultra-fast data transfer. The Lexar PLAY PRO microSDXC Express Card is designed for professionals who demand the best performance from their Lexar® storage solutions.`,
    ],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
      ['Read speed', '读取速度'],
      ['Write speed', '写入速度'],
      ['Lexar AIR PRO SD Card Reader', 'Lexar AIR PRO SD 读卡器'],
    ]),
    targetLang: 'zh-CN',
    expectedKeywords: ['Lexar PLAY PRO microSDXC Express 存储卡', '读取速度', '写入速度'],
  },

  // ── 测试 2：多批次翻译（10 批次 × 15 条）──
  {
    name: '多批次翻译（10 批次 × 15 条）',
    texts: Array.from({ length: 15 }, (_, i) => {
      const products = [
        'Lexar PLAY PRO microSDXC Express Card',
        'Lexar ARMOR GOLD SD Card',
        'Lexar SILVER PLUS microSD Card',
        'Read speed up to 900MB/s',
        'Write speed up to 800MB/s',
        'Compatible with SD Card Reader',
        'Lexar NM790 PCIe 4.0 NVMe SSD',
        'Lexar Professional CFexpress Card',
        'Storage capacity: 128GB',
        'Transfer files in seconds',
        'High-speed data transfer',
        'Durable and reliable storage',
        'Waterproof and shockproof design',
        'Lifetime warranty included',
        'Perfect for content creators',
      ]
      return products[i % products.length]
    }),
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
      ['Lexar ARMOR GOLD SD Card', 'Lexar ARMOR GOLD SD 存储卡'],
      ['Lexar SILVER PLUS microSD Card', 'Lexar SILVER PLUS microSD 存储卡'],
      ['Read speed', '读取速度'],
      ['Write speed', '写入速度'],
      ['SD Card Reader', 'SD 读卡器'],
      ['Lexar NM790 PCIe 4.0 NVMe SSD', 'Lexar NM790 PCIe 4.0 NVMe 固态硬盘'],
      ['Lexar Professional CFexpress Card', 'Lexar Professional CFexpress 存储卡'],
    ]),
    targetLang: 'zh-CN',
    expectedKeywords: ['Lexar PLAY PRO microSDXC Express 存储卡', '读取速度', '写入速度'],
  },

  // ── 测试 3：混合语种（中英混合）──
  {
    name: '混合语种（中英混合）',
    texts: [
      'Lexar PLAY PRO 存储卡提供 Read speed up to 900MB/s',
      '使用 Lexar AIR PRO SD Card Reader 快速传输数据',
      'Lexar NM790 NVMe SSD 支持 PCIe 4.0 技术',
      'Compatible with Lexar Professional CFexpress Card',
    ],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
      ['Read speed', '读取速度'],
      ['Lexar AIR PRO SD Card Reader', 'Lexar AIR PRO SD 读卡器'],
      ['Lexar NM790 PCIe 4.0 NVMe SSD', 'Lexar NM790 PCIe 4.0 NVMe 固态硬盘'],
      ['Lexar Professional CFexpress Card', 'Lexar Professional CFexpress 存储卡'],
    ]),
    targetLang: 'zh-CN',
    expectedKeywords: ['Lexar PLAY PRO', '读取速度', 'Lexar AIR PRO SD 读卡器'],
  },

  // ── 测试 4：极端边界（大量术语，接近 20 条上限）──
  {
    name: '极端边界（大量术语，接近 20 条上限）',
    texts: [
      'Lexar PLAY PRO microSDXC Express Card with Read speed',
      'Lexar ARMOR GOLD SD Card with Write speed',
      'Lexar SILVER PLUS microSD Card',
      'Lexar DIAMOND PLUS CF Card',
      'Lexar NM790 PCIe 4.0 NVMe SSD',
      'Lexar Professional CFexpress Card',
      'Lexar AIR PRO SD Card Reader',
      'Lexar JumpDrive S47 USB Flash Drive',
      'Storage capacity: 128GB',
      'Transfer files in seconds',
    ],
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
    targetLang: 'zh-CN',
    expectedKeywords: ['Lexar PLAY PRO microSDXC Express 存储卡', '读取速度', '写入速度'],
  },

  // ── 测试 5：超长文本（1000+ 字符）──
  {
    name: '超长文本（1000+ 字符）',
    texts: [
      `Lexar® PLAY PRO™ microSDXC™ Express Card is the ultimate storage solution for professionals who demand the highest performance. With Read speed up to 900MB/s and Write speed up to 800MB/s, this card delivers blazing-fast data transfer speeds that can handle the most demanding workflows. Whether you're shooting 8K video, capturing high-resolution photos, or transferring large files, the Lexar PLAY PRO microSDXC Express Card ensures that you never miss a moment. Compatible with Lexar® AIR PRO™ SD Card Reader for even faster data transfer. The card features advanced error correction technology to ensure data integrity and reliability. With storage capacities ranging from 128GB to 1TB, you'll have plenty of space for all your content. The Lexar PLAY PRO microSDXC Express Card is designed for content creators, professional photographers, and videographers who need the best performance from their storage solutions. Backed by a lifetime warranty, you can trust Lexar to deliver quality and reliability.`,
    ],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
      ['Read speed', '读取速度'],
      ['Write speed', '写入速度'],
      ['Lexar AIR PRO SD Card Reader', 'Lexar AIR PRO SD 读卡器'],
      ['Storage capacity', '存储容量'],
      ['Content creators', '内容创作者'],
      ['Professional photographers', '专业摄影师'],
      ['Videographers', '摄像师'],
      ['Lifetime warranty', '终身保修'],
    ]),
    targetLang: 'zh-CN',
    expectedKeywords: ['Lexar PLAY PRO microSDXC Express 存储卡', '读取速度', '写入速度'],
  },

  // ── 测试 6：术语冲突（相似术语同时出现）──
  {
    name: '术语冲突（相似术语同时出现）',
    texts: [
      'Card reader for SD Card',
      'Card and Card reader bundle',
      'Memory Card vs Memory',
      'SSD vs HDD storage',
      'Read speed and Write speed comparison',
    ],
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
    targetLang: 'zh-CN',
    expectedKeywords: ['存储卡', '读卡器', '读取速度', '写入速度'],
  },

  // ── 测试 7：特殊字符 + 术语混合 ──
  {
    name: '特殊字符 + 术语混合',
    texts: [
      'Lexar® PLAY PRO™ microSDXC™ Express Card (Read speed: 900MB/s)',
      'Lexar® AIR PRO™ SD Card Reader [Write speed: 800MB/s]',
      'Lexar® NM790™ PCIe 4.0 NVMe SSD {Storage: 128GB}',
      'Lexar® Professional™ CFexpress Card <Transfer: 1000MB/s>',
    ],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
      ['Lexar AIR PRO SD Card Reader', 'Lexar AIR PRO SD 读卡器'],
      ['Lexar NM790 PCIe 4.0 NVMe SSD', 'Lexar NM790 PCIe 4.0 NVMe 固态硬盘'],
      ['Lexar Professional CFexpress Card', 'Lexar Professional CFexpress 存储卡'],
      ['Read speed', '读取速度'],
      ['Write speed', '写入速度'],
      ['Storage', '存储'],
      ['Transfer', '传输'],
    ]),
    targetLang: 'zh-CN',
    expectedKeywords: ['Lexar PLAY PRO microSDXC Express 存储卡', '读取速度', '写入速度'],
  },

  // ── 测试 8：多语言目标（同一批次，不同目标语言）──
  {
    name: '多语言目标（同一批次，不同目标语言）',
    texts: [
      'Lexar PLAY PRO microSDXC Express Card with Read speed',
      'Lexar ARMOR GOLD SD Card with Write speed',
      'Lexar NM790 PCIe 4.0 NVMe SSD',
    ],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
      ['Lexar ARMOR GOLD SD Card', 'Lexar ARMOR GOLD SD 存储卡'],
      ['Lexar NM790 PCIe 4.0 NVMe SSD', 'Lexar NM790 PCIe 4.0 NVMe 固态硬盘'],
      ['Read speed', '读取速度'],
      ['Write speed', '写入速度'],
    ]),
    targetLang: 'zh-CN',
    expectedKeywords: ['Lexar PLAY PRO microSDXC Express 存储卡', '读取速度'],
  },
]

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
}

function verifyResult(
  testCase: typeof stressTests[0],
  actual: string[],
  duration: number,
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

  // 检查译文长度（防止截断）
  for (let i = 0; i < actual.length; i++) {
    const srcLen = testCase.texts[i].length
    const tgtLen = actual[i].length
    // 中文译文长度应该至少是源文的 0.3 倍（CJK 字符更紧凑）
    if (tgtLen < srcLen * 0.3 && srcLen > 50) {
      issues.push(`[${i}] 译文过短: 源文 ${srcLen} 字符，译文 ${tgtLen} 字符`)
      passed = false
    }
  }

  return {
    name: testCase.name,
    passed,
    actual,
    expectedKeywords: testCase.expectedKeywords,
    issues,
    duration,
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('=== 术语库新方案 - 极端压力测试 ===\n')
  console.log('测试维度：')
  console.log('  1. 长文本（>500字符）+ 多术语混合')
  console.log('  2. 多批次翻译（10 批次 × 15 条）')
  console.log('  3. 混合语种（中英混合）')
  console.log('  4. 极端边界（大量术语、超长文本、特殊字符）\n')

  const results: TestResult[] = []

  for (const testCase of stressTests) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`测试: ${testCase.name}`)
    console.log(`${'='.repeat(60)}`)

    console.log('\n【输入】')
    console.log(`  文本数量: ${testCase.texts.length}`)
    console.log(`  总字符数: ${testCase.texts.reduce((sum, t) => sum + t.length, 0)}`)
    console.log(`  术语数量: ${testCase.glossary.size}`)
    console.log(`  目标语言: ${testCase.targetLang}`)

    console.log('\n【术语表】')
    for (const [k, v] of testCase.glossary.entries()) {
      console.log(`  "${k}" → "${v}"`)
    }

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
      results.push(result)

      console.log('\n【验证结果】')
      console.log(`  耗时: ${duration}ms`)
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

  console.log(`\n总计: ${total} 个测试`)
  console.log(`通过: ${passed} 个`)
  console.log(`失败: ${failed} 个`)
  console.log(`通过率: ${((passed / total) * 100).toFixed(1)}%`)
  console.log(`平均耗时: ${avgDuration.toFixed(0)}ms`)

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
    console.log('\n✅ 所有压力测试通过！')
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
