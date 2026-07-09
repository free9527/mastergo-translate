/**
 * 漏翻检测逻辑测试脚本（独立版本）
 * 测试场景：批量翻译包含口号、标题、注释的文本
 */

// 模拟 detectUntranslatedText 函数逻辑
function detectUntranslatedText(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang: string,
): Set<number> {
  const untranslatedIndices = new Set<number>()

  function normalize(s: string): string {
    return s.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  for (let i = 0; i < sourceTexts.length; i++) {
    const src = sourceTexts[i] || ''
    const trans = translatedTexts[i] || ''
    if (!src || !trans) continue

    // 归一化后完全相同 → 漏翻
    if (normalize(src) === normalize(trans)) {
      untranslatedIndices.add(i)
    }
  }

  return untranslatedIndices
}

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
  {
    name: '商标符号差异（应检测为漏翻）',
    source: 'Lexar® PLAY PRO™',
    translated: 'Lexar® PLAY PRO™', // 未翻译，只有商标符号
    expected: 'should detect as untranslated',
  },
]

console.log('=== 漏翻检测逻辑测试 ===\n')

const sources = testCases.map(tc => tc.source)
const translations = testCases.map(tc => tc.translated)

const untranslatedIndices = detectUntranslatedText(sources, translations, 'pt')

console.log(`检测到 ${untranslatedIndices.size} 条漏翻：\n`)

let passCount = 0
let failCount = 0

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i]
  const detected = untranslatedIndices.has(i)
  const shouldDetect = tc.expected.includes('should detect')

  console.log(`[${i}] ${tc.name}`)
  console.log(`  源文: ${tc.source.slice(0, 60)}${tc.source.length > 60 ? '...' : ''}`)
  console.log(`  译文: ${tc.translated.slice(0, 60)}${tc.translated.length > 60 ? '...' : ''}`)
  console.log(`  预期: ${tc.expected}`)
  console.log(`  实际: ${detected ? '检测到漏翻' : '未检测到漏翻'}`)

  if (detected === shouldDetect) {
    console.log(`  结果: ✅ PASS\n`)
    passCount++
  } else {
    console.log(`  结果: ❌ FAIL\n`)
    failCount++
  }
}

console.log('=== 测试完成 ===')
console.log(`总计: ${testCases.length} 条`)
console.log(`通过: ${passCount} 条`)
console.log(`失败: ${failCount} 条`)
console.log(`检测到漏翻: ${untranslatedIndices.size} 条`)

if (failCount > 0) {
  console.log('\n⚠️ 有测试失败，请检查逻辑')
  process.exit(1)
} else {
  console.log('\n✅ 所有测试通过')
}
