/**
 * 端到端翻译测试脚本
 * 测试场景：批量翻译包含口号、标题、注释的文本到葡萄牙语
 * 验证：修改后的提示词是否能解决漏翻问题
 */

import { translateBatch } from './lib/llm-api.ts'
import { LLMConfig } from '@messages/types'

// 测试数据：模拟用户报告的漏翻场景
const testTexts = [
  'Good for Today Great for Tomorrow',  // 口号
  'Level-up Your Handheld Gaming Experience',  // 标题
  '*Comparison of the theoretical maximum speeds under different interface forms (Data source: SDA)',  // 注释
  'Read speed up to 7000MB/s',  // 正常文本
  'Lexar PLAY PRO microSDXC Express Card',  // 产品名
]

// 模拟 LLM 配置（需要从实际配置中获取）
const config: LLMConfig = {
  apiUrl: 'http://127.0.0.1:8788/v1/chat/completions',
  apiKey: 'test-key',
  model: 'qwen3.7-plus',
  scenePreset: 'standard',
}

// 模拟术语库
const glossaryMap = new Map<string, string>([
  ['Read speed', 'Velocidade de leitura'],
  ['Write speed', 'Velocidade de gravação'],
  ['Lexar PLAY PRO microSDXC Express Card', 'Cartão Lexar PLAY PRO microSDXC Express'],
])

console.log('=== 端到端翻译测试 ===\n')
console.log('测试文本：')
testTexts.forEach((text, i) => {
  console.log(`[${i}] ${text}`)
})
console.log('\n目标语言: pt (葡萄牙语)\n')

try {
  const results = await translateBatch(
    testTexts,
    'pt',
    glossaryMap,
    config,
    undefined, // sourceLang
    undefined, // pageName
    undefined, // fileName
    undefined, // crossBatchTerms
    undefined, // taskGlossaryHint
    false, // _isRetry
  )

  console.log('翻译结果：\n')
  results.forEach((result, i) => {
    console.log(`[${i}] ${testTexts[i]}`)
    console.log(`    → ${result}`)
    console.log('')
  })

  // 检查是否有漏翻
  const untranslatedCount = results.filter((result, i) =>
    result.toLowerCase().trim() === testTexts[i].toLowerCase().trim()
  ).length

  console.log(`\n=== 测试结果 ===`)
  console.log(`总计: ${testTexts.length} 条`)
  console.log(`漏翻: ${untranslatedCount} 条`)

  if (untranslatedCount > 0) {
    console.log('\n⚠️ 仍有漏翻，需要进一步调整')
    process.exit(1)
  } else {
    console.log('\n✅ 所有文本都已翻译')
  }
} catch (error) {
  console.error('翻译失败:', error)
  process.exit(1)
}
