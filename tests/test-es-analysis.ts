/**
 * ES 翻译问题分析测试
 * 使用 NM1090 PRO 真实数据，分析 ES 翻译触发激进重试的根因
 * 同时对比 DE/FR/JA 等其他语言
 */
import XMLHttpRequest from 'xhr2';
(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { translateBatch, detectUntranslatedText, isUntranslatable, detectTargetLanguageFeatures } from '../lib/llm-api'
import { DEBUG_MODE } from '../lib/constants'

// 强制开启 debug 日志
;(globalThis as any).DEBUG_MODE = true

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
const MODEL = 'gpt-5.5'

// 从 NM1090 PRO CSV 提取的测试文本（覆盖各种类型：标题、规格、营销、段落）
const TEST_TEXTS = [
  // 1. 产品名（不应翻译）
  'Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
  // 2. 短标题（Title Case）
  'Performance for the Next Level',
  // 3. 特性列表（多行，技术术语密集）
  'DRAM Cache SLC Dynamic Cache\n\n4K Random Read Up to 2100K IOPS\n\nGen5 SSD\nAccelerate Load Times by up to 200%\n\nUp to 4TB\n\nHeat-Defying 6nm Controller\n\nLexar DiskMaster Easy Drive Management\n\n5 Years Service',
  // 4. 营销段落（含技术术语）
  'Accelerate Load Times by up to 200%*\nExperience blistering read/write speeds up to 14,000/13,000MB/s* thanks to a combination of PCIe 5.0 technology and next-gen 232-layer 3D TLC NAND.\n\n\n*Speeds based on internal testing. Actual performance may vary.',
  // 5. 长段落（AMD 合作伙伴）
  'An Unmatched AMD Partner\nThe NM1090 PRO is the perfect match for AMD Ryzen 9000 series CPUs. It not only delivers extreme storage and computing performance but also ensures fast game loading and smooth operation. It is the ideal choice for users who seek a high-performance gaming experience.',
  // 6. 技术描述（含 BIT Running 等专有名词）
  'Heat-Defying 6nm Controller\n\nOffers advanced performance and simultaneously achieves better power management. The controller\'s temperature is reduced by 38%*, ensuring that the hard drive remains cool during high-load operation and provides a smoother performance experience.\n\n\nBIT Running for 30 Minutes Later\nTemperature Comparison with Other Gen 5 SSDs\n\nController Temperature Reduction\nS.M.A.R.T. Temperature Reduction\n\n* Based on internal testing. Actual performance may vary.',
  // 7. 短标题（ALL CAPS 混合）
  'Ultra-fast Response Blazing Speed',
  // 8. 技术段落（4K IOPS）
  '4K Random Reads Up to 2100K IOPS*, significantly speeds up system response and application loading times, especially enhancing efficiency in multitasking and video editing, providing gamers with a smoother experience.\n\n* Speeds based on internal testing. Actual performance may vary.',
  // 9. 状态描述
  'A State-of-the-Art Experience\nDRAM Cache and SLC Dynamic Cache greatly enhance data transfer speeds to reduce wait times and improve system responsiveness.\n\nDram Capacity',
  // 10. 容量描述（含 AIPC 术语）
  'Up to 4TB\n\nOffers 1TB/2TB/4TB storage options. Easily handles OS, large games, and UHD/8K media storage needs, meeting the high demand for SSD capacity in the AIPC era.\n\nHigh-quality chips ensure ample storage design, offering gamers more space\nActual usable capacity\nA non-full capacity 4TB SSD\nNM1090 PRO 4TB\n\n* Based on internal testing. Actual performance may vary.',
  // 11. 兼容性描述
  'Compatible with Microsoft DirectStorage \nBuilt to leverage Microsoft DirectStorage3 and significantly boost game loads, minimize delays, conserve CPU power, and enrich the gaming experience.',
  // 12. 性能描述（含 PCIe 版本）
  'Unleashing ultimate performance\nPaired with the latest AMD and Intel CPUs and PCIe 5.0 motherboards, it achieves the perfect match for ultimate performance. It is also backward compatible with PCIe 3.0 and PCIe 4.0 systems to ensure extensive applicability.',
  // 13. 软件功能列表
  'Lexar DiskMaster\nFirmware upgrades\nHealth monitoring\nPerformance optimization\nData security',
  // 14. 短标题
  'Unleash the Gaming Power',
  // 15. 短描述
  'Support Microsoft DirectStorage technology significantly reduces game load time.',
  // 16. 短标题
  'New Creative Experience',
  // 17. 短描述
  'Boosts rendering speeds, turning ideas into reality instantly.',
  // 18. 短标题（AIPC）
  'Ultimate Performance for AIPC',
  // 19. 短描述
  'Meets AIPC\'s high-end demands with exceptional performance and vast capacity.',
  // 20. 保修
  '5 Years Service',
]

// 模拟术语库（从 CSV 推断）
const glossaryMap = new Map<string, string>([
  ['Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD', 'Unidad de estado sólido (SSD) Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280'],
  ['Lexar', 'Lexar'],
  ['SSD', 'SSD'],
  ['NM1090 PRO', 'NM1090 PRO'],
  ['PCIe 5.0', 'PCIe 5.0'],
  ['NVMe', 'NVMe'],
  ['DRAM Cache', 'Caché DRAM'],
  ['SLC Cache', 'Caché SLC'],
  ['Read Speed', 'Velocidad de lectura'],
  ['Write Speed', 'Velocidad de escritura'],
  ['IOPS', 'IOPS'],
  ['Gen5 SSD', 'Gen5 SSD'],
  ['Heat-Defying 6nm Controller', 'Controlador de 6 nm que desafía el calor'],
  ['Lexar DiskMaster', 'Lexar DiskMaster'],
  ['Backward Compatible', 'Retrocompatible'],
  ['AIPC', 'AIPC'],
  ['DirectStorage', 'DirectStorage'],
])

// 分析单条译文的语言特征
function analyzeTranslation(text: string, targetLang: string): {
  hasFeatures: boolean
  featureRatio: number
  englishWords: string[]
  englishRatio: number
  totalWords: number
} {
  const featureCheck = detectTargetLanguageFeatures(text, targetLang)

  // 计算英文词占比
  const allWords = text.split(/\s+/).filter(w => w.length > 0)
  const englishWords = text.match(/\b[a-zA-Z]+\b/g) || []
  const glossaryLower = new Set([...glossaryMap.keys()].map(k => k.toLowerCase()))
  const nonGlossaryEnglishWords = englishWords.filter(w => !glossaryLower.has(w.toLowerCase()))

  return {
    hasFeatures: featureCheck.hasFeatures,
    featureRatio: featureCheck.featureRatio,
    englishWords: nonGlossaryEnglishWords,
    englishRatio: allWords.length > 0 ? nonGlossaryEnglishWords.length / allWords.length : 0,
    totalWords: allWords.length,
  }
}

async function testLanguage(targetLang: string): Promise<{
  lang: string
  duration: number
  untranslatedIndices: number[]
  translations: string[]
  analysis: Array<{
    index: number
    hasFeatures: boolean
    englishRatio: number
    englishWords: string[]
  }>
}> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`测试语言: ${targetLang}`)
  console.log('='.repeat(60))

  const startTime = Date.now()

  try {
    const result = await translateBatch(
      TEST_TEXTS,
      targetLang,
      glossaryMap,
      {
        apiUrl: API_URL,
        apiKey: API_KEY,
        model: MODEL,
        translationStyle: 'standard',
        scenePreset: 'ecommerce',
      },
      'en',
      'NM1090 PRO',
      undefined,
    )

    const duration = Date.now() - startTime

    // 检测漏翻
    const untranslated = detectUntranslatedText(TEST_TEXTS, result, targetLang, glossaryMap)

    console.log(`\n--- 翻译结果 ---`)
    console.log(`耗时: ${(duration / 1000).toFixed(1)}s`)
    console.log(`漏翻数量: ${untranslated.size}`)
    if (untranslated.size > 0) {
      console.log(`漏翻索引: ${[...untranslated].join(', ')}`)
    }

    // 分析每条译文
    const analysis: Array<{
      index: number
      hasFeatures: boolean
      englishRatio: number
      englishWords: string[]
    }> = []

    console.log(`\n--- 详细分析 ---`)
    for (let i = 0; i < result.length; i++) {
      const src = TEST_TEXTS[i]
      const trans = result[i]
      const isUntranslated = untranslated.has(i)
      const analysis1 = analyzeTranslation(trans, targetLang)

      analysis.push({
        index: i,
        hasFeatures: analysis1.hasFeatures,
        englishRatio: analysis1.englishRatio,
        englishWords: analysis1.englishWords,
      })

      const status = isUntranslated ? '❌ 漏翻' : '✅ 通过'
      const featureStatus = analysis1.hasFeatures ? '有特征' : '无特征'
      const englishStatus = `英文占比 ${(analysis1.englishRatio * 100).toFixed(1)}%`

      console.log(`\n[${i}] ${status} | ${featureStatus} | ${englishStatus}`)
      console.log(`  源文: ${src.slice(0, 60).replace(/\n/g, '\\n')}...`)
      console.log(`  译文: ${trans.slice(0, 60).replace(/\n/g, '\\n')}...`)
      if (analysis1.englishWords.length > 0) {
        console.log(`  英文词: ${analysis1.englishWords.join(', ')}`)
      }
    }

    return {
      lang: targetLang,
      duration,
      untranslatedIndices: [...untranslated],
      translations: result,
      analysis,
    }
  } catch (error) {
    console.error(`测试 ${targetLang} 失败:`, error)
    return {
      lang: targetLang,
      duration: Date.now() - startTime,
      untranslatedIndices: [],
      translations: [],
      analysis: [],
    }
  }
}

async function main() {
  console.log('=== ES 翻译问题分析测试 ===')
  console.log(`测试文本数: ${TEST_TEXTS.length}`)
  console.log(`测试语言: ES, DE, FR, JA (对比)`)

  // 测试 ES（重点）
  const esResult = await testLanguage('es')

  // 测试其他语言（对比）
  const deResult = await testLanguage('de')
  const frResult = await testLanguage('fr')
  const jaResult = await testLanguage('ja')

  // 汇总对比
  console.log('\n\n' + '='.repeat(60))
  console.log('汇总对比')
  console.log('='.repeat(60))

  const results = [esResult, deResult, frResult, jaResult]

  console.log('\n| 语言 | 耗时 | 漏翻数 | 漏翻索引 |')
  console.log('|------|------|--------|----------|')
  for (const r of results) {
    const duration = (r.duration / 1000).toFixed(1)
    const count = r.untranslatedIndices.length
    const indices = r.untranslatedIndices.join(', ') || '-'
    console.log(`| ${r.lang.padEnd(4)} | ${duration.padStart(4)}s | ${String(count).padStart(6)} | ${indices.padEnd(20)} |`)
  }

  // 分析 ES 漏翻的共性
  console.log('\n\n=== ES 漏翻共性分析 ===')
  if (esResult.untranslatedIndices.length > 0) {
    console.log('\n漏翻条目的特征:')
    for (const idx of esResult.untranslatedIndices) {
      const a = esResult.analysis[idx]
      if (a) {
        console.log(`  [${idx}] 有特征: ${a.hasFeatures}, 英文占比: ${(a.englishRatio * 100).toFixed(1)}%, 英文词: ${a.englishWords.join(', ')}`)
      }
    }

    // 统计漏翻条目的英文占比
    const untranslatedAnalysis = esResult.untranslatedIndices
      .map(idx => esResult.analysis[idx])
      .filter(Boolean)

    const avgEnglishRatio = untranslatedAnalysis.reduce((sum, a) => sum + a.englishRatio, 0) / untranslatedAnalysis.length
    const hasFeaturesCount = untranslatedAnalysis.filter(a => a.hasFeatures).length

    console.log(`\n漏翻条目统计:`)
    console.log(`  平均英文占比: ${(avgEnglishRatio * 100).toFixed(1)}%`)
    console.log(`  有特征字符: ${hasFeaturesCount}/${untranslatedAnalysis.length}`)
  } else {
    console.log('ES 测试未触发漏翻，可能需要增加测试数据或调整参数')
  }

  // 对比其他语言的英文占比
  console.log('\n\n=== 各语言英文占比对比 ===')
  for (const r of results) {
    if (r.analysis.length === 0) continue
    const avgRatio = r.analysis.reduce((sum, a) => sum + a.englishRatio, 0) / r.analysis.length
    const maxRatio = Math.max(...r.analysis.map(a => a.englishRatio))
    console.log(`${r.lang}: 平均 ${(avgRatio * 100).toFixed(1)}%, 最高 ${(maxRatio * 100).toFixed(1)}%`)
  }
}

main().catch(console.error)
