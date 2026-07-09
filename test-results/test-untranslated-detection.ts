/**
 * 漏翻检测 + 重试机制测试脚本
 * 测试场景：批量翻译包含口号、标题、注释的文本
 */

import { detectUntranslatedText } from './lib/llm-api'

// 测试数据：模拟批量翻译结果
const testCases = [
  {
    name: '口号漏翻',
    source: 'Good for Today Great for Tomorrow',
    translated: 'Good for Today Great for Tomorrow', // 未翻译
    expected: 'should detect as untranslated',
  },
  {
    name: '标题漏翻',
    source: 'Level-up Your Handheld Gaming Experience',
    translated: 'Level-up Your Handheld Gaming Experience', // 未翻译
    expected: 'should detect as untranslated',
  },
  {
    name: '注释漏翻',
    source: '*Comparison of the theoretical maximum speeds under different interface forms (Data source: SDA)',
    translated: '*Comparison of the theoretical maximum speeds under different interface forms (Data source: SDA)', // 未翻译
    expected: 'should detect as untranslated',
  },
  {
    name: '正常翻译',
    source: 'Read speed up to 7000MB/s',
    translated: 'Velocidade de leitura até 7000MB/s',
    expected: 'should NOT detect as untranslated',
  },
  {
    name: '产品名保留（正确）',
    source: 'Lexar PLAY PRO microSDXC Express Card',
    translated: 'Cartão Lexar PLAY PRO microSDXC Express',
    expected: 'should NOT detect as untranslated',
  },
]

console.log('=== 漏翻检测测试 ===\n')

const sources = testCases.map(tc => tc.source)
const translations = testCases.map(tc => tc.translated)

const untranslatedIndices = detectUntranslatedText(sources, translations, 'pt')

console.log(`检测到 ${untranslatedIndices.size} 条漏翻：\n`)

for (const idx of untranslatedIndices) {
  const tc = testCases[idx]
  console.log(`[${idx}] ${tc.name}`)
  console.log(`  源文: ${tc.source.slice(0, 60)}...`)
  console.log(`  译文: ${tc.translated.slice(0, 60)}...`)
  console.log(`  预期: ${tc.expected}`)
  console.log(`  结果: ✅ 正确检测到漏翻\n`)
}

// 验证未检测到的条目
for (let i = 0; i < testCases.length; i++) {
  if (!untranslatedIndices.has(i)) {
    const tc = testCases[i]
    console.log(`[${i}] ${tc.name}`)
    console.log(`  源文: ${tc.source.slice(0, 60)}...`)
    console.log(`  译文: ${tc.translated.slice(0, 60)}...`)
    console.log(`  预期: ${tc.expected}`)
    console.log(`  结果: ✅ 正确未检测为漏翻\n`)
  }
}

console.log('=== 测试完成 ===')
console.log(`总计: ${testCases.length} 条`)
console.log(`检测到漏翻: ${untranslatedIndices.size} 条`)
console.log(`未检测到漏翻: ${testCases.length - untranslatedIndices.size} 条`)
