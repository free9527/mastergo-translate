/**
 * 并行语言测试脚本 - 5个Agent同时测试
 *
 * 将20种语言分成5组，每组4种语言，并行测试
 * 每组测试包含：翻译 → 漏翻检测 → 校对 → 再次检测
 *
 * 使用方法：
 *   npx tsx test-parallel-languages.ts
 */

// Node.js 环境需要 XMLHttpRequest polyfill
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { translateBatch, proofreadBatch, detectUntranslatedText, buildTaskGlossaryHint } from './lib/llm-api'
import { LLMConfig } from './messages/types'

// ============================================================
// 配置
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
// 测试用例
// ============================================================

const testTexts = [
  'BIT Running for 30 Minutes Later Temperature Comparison with Other Gen 5 SSDs',
  'Paired with the latest AMD and Intel CPUs and PCIe 5.0 motherboards, it achieves the perfect match for ultimate performance. It is also backward compatible with PCIe 3.0 and PCIe 4.0 systems to ensure extensive applicability.',
  '*Due to different measurement methods between manufacturers and operating systems, the actual displayed usable capacity will be lower than nominal capacity - approximately 3,725GB for rounded 4,000GB SSDs and 3,814GB for full-capacity 4,096GB SSDs. Displayed capacity varies by operating system.',
]

// ============================================================
// 20种语言分组（5组 × 4种语言）
// ============================================================

const languageGroups = [
  {
    agent: 'Agent-1 (CJK)',
    languages: ['zh-CN', 'zh-TW', 'ja', 'ko'],
  },
  {
    agent: 'Agent-2 (European-1)',
    languages: ['fr', 'de', 'es', 'it'],
  },
  {
    agent: 'Agent-3 (European-2)',
    languages: ['pt', 'pt-BR', 'nl', 'pl'],
  },
  {
    agent: 'Agent-4 (European-3 + Other)',
    languages: ['sv', 'tr', 'ru', 'vi'],
  },
  {
    agent: 'Agent-5 (Asian + English)',
    languages: ['th', 'id', 'ar', 'en'],
  },
]

// ============================================================
// 测试函数
// ============================================================

interface TestResult {
  lang: string
  success: boolean
  translatedCount: number
  untranslatedAfterTranslation: number
  untranslatedAfterProofread: number
  fixedByProofread: number
  error?: string
  translations?: string[]
}

async function testLanguage(lang: string): Promise<TestResult> {
  const glossaryMap = new Map<string, string>()

  try {
    // 阶段1：翻译
    const taskGlossaryHint = buildTaskGlossaryHint(glossaryMap, config.scenePreset, testTexts)
    const translatedResults = await translateBatch(
      testTexts,
      lang,
      glossaryMap,
      config,
      'en',
      undefined,
      undefined,
      undefined,
      taskGlossaryHint,
      false,
      false,
    )

    // 阶段2：漏翻检测
    const untranslatedAfterTranslation = detectUntranslatedText(testTexts, translatedResults, lang, glossaryMap)

    // 阶段3：校对（如果有漏翻）
    let finalResults = [...translatedResults]
    let untranslatedAfterProofread = untranslatedAfterTranslation.size
    let fixedByProofread = 0

    if (config.enableProofread && untranslatedAfterTranslation.size > 0) {
      const proofreadItems = testTexts.map((sourceText, i) => ({
        sourceText,
        translatedText: translatedResults[i],
      }))

      const proofreadResults = await proofreadBatch(
        proofreadItems,
        lang,
        glossaryMap,
        config,
        undefined,
        undefined,
        taskGlossaryHint,
      )

      // 应用校对结果
      proofreadResults.forEach((result, i) => {
        if (result.text && result.text !== 'OK' && result.text !== translatedResults[i]) {
          finalResults[i] = result.text
        }
      })

      // 再次检测
      const untranslatedAfterProofreadSet = detectUntranslatedText(testTexts, finalResults, lang, glossaryMap)
      untranslatedAfterProofread = untranslatedAfterProofreadSet.size
      fixedByProofread = untranslatedAfterTranslation.size - untranslatedAfterProofread
    }

    return {
      lang,
      success: true,
      translatedCount: testTexts.length - untranslatedAfterProofread,
      untranslatedAfterTranslation: untranslatedAfterTranslation.size,
      untranslatedAfterProofread,
      fixedByProofread,
      translations: finalResults,
    }
  } catch (error) {
    return {
      lang,
      success: false,
      translatedCount: 0,
      untranslatedAfterTranslation: 0,
      untranslatedAfterProofread: 0,
      fixedByProofread: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function testAgentGroup(agentName: string, languages: string[]): Promise<TestResult[]> {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`[${agentName}] 开始测试 ${languages.length} 种语言`)
  console.log(`语言: ${languages.join(', ')}`)
  console.log('='.repeat(70))

  const results: TestResult[] = []

  for (const lang of languages) {
    console.log(`\n[${agentName}] 测试 ${lang}...`)
    const result = await testLanguage(lang)
    results.push(result)

    if (result.success) {
      console.log(`  ✅ 翻译成功: ${result.translatedCount}/${testTexts.length}`)
      if (result.untranslatedAfterTranslation > 0) {
        console.log(`  ⚠️  翻译后漏翻: ${result.untranslatedAfterTranslation}`)
        if (result.fixedByProofread > 0) {
          console.log(`  ✅ 校对修复: ${result.fixedByProofread}`)
        }
      }
      if (result.untranslatedAfterProofread > 0) {
        console.log(`  ❌ 校对后仍有漏翻: ${result.untranslatedAfterProofread}`)
      }
    } else {
      console.log(`  ❌ 测试失败: ${result.error}`)
    }

    // 延迟避免API限流
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  return results
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('=== 并行语言测试（5个Agent）===')
  console.log(`API: ${API_URL}`)
  console.log(`Model: ${MODEL}`)
  console.log(`测试文本数: ${testTexts.length}`)
  console.log(`启用校对: ${config.enableProofread ? '是' : '否'}`)
  console.log(`总语言数: 20`)
  console.log(`并行组数: 5`)

  const startTime = Date.now()

  // 并行执行5个Agent
  const agentPromises = languageGroups.map(group =>
    testAgentGroup(group.agent, group.languages)
  )

  const allResults = await Promise.all(agentPromises)

  const endTime = Date.now()
  const duration = ((endTime - startTime) / 1000).toFixed(1)

  // 汇总结果
  console.log('\n\n' + '='.repeat(70))
  console.log('测试结果汇总')
  console.log('='.repeat(70))

  let totalSuccess = 0
  let totalFailed = 0
  let totalUntranslated = 0
  let totalFixedByProofread = 0

  const failedLanguages: string[] = []

  for (let i = 0; i < languageGroups.length; i++) {
    const group = languageGroups[i]
    const results = allResults[i]

    console.log(`\n[${group.agent}]`)

    for (const result of results) {
      if (result.success) {
        totalSuccess++
        const status = result.untranslatedAfterProofread === 0 ? '✅' : '⚠️'
        console.log(`  ${status} ${result.lang}: ${result.translatedCount}/${testTexts.length} 翻译成功`)

        if (result.untranslatedAfterProofread > 0) {
          totalUntranslated += result.untranslatedAfterProofread
          failedLanguages.push(result.lang)
        }

        if (result.fixedByProofread > 0) {
          totalFixedByProofread += result.fixedByProofread
          console.log(`     └─ 校对修复: ${result.fixedByProofread} 条`)
        }
      } else {
        totalFailed++
        failedLanguages.push(result.lang)
        console.log(`  ❌ ${result.lang}: 测试失败 - ${result.error}`)
      }
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('总体统计')
  console.log('='.repeat(70))
  console.log(`总语言数: 20`)
  console.log(`成功: ${totalSuccess}`)
  console.log(`失败: ${totalFailed}`)
  console.log(`校对修复: ${totalFixedByProofread} 条`)
  console.log(`仍存漏翻: ${totalUntranslated} 条`)
  console.log(`测试耗时: ${duration} 秒`)

  if (failedLanguages.length > 0) {
    console.log(`\n❌ 存在问题的语言: ${failedLanguages.join(', ')}`)
  } else {
    console.log(`\n✅ 所有语言测试通过！`)
  }

  console.log('='.repeat(70))
}

main().catch(console.error)
