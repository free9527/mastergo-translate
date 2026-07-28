/**
 * NM1090 PRO DE 翻译质量完整对比测试
 * 使用真实 CSV 数据：EN 源文 + DE 参考译文 + LLM 译文
 * 对比分析：LLM 翻译质量 vs 检测误判
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

// 从 NM1090 PRO CSV 提取的完整测试数据（EN 源文 + DE 参考译文）
const TEST_DATA = [
  {
    en: 'Performance for the Next Level\nLexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    de: 'Leistung für das nächste Level\n Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
  },
  {
    en: 'DRAM Cache SLC Dynamic Cache\n\n4K Random Read Up to 2100K IOPS\n\nGen5 SSD\nAccelerate Load Times by up to 200%\n\nUp to 4TB\n\nHeat-Defying 6nm Controller\n\nLexar DiskMaster Easy Drive Management\n\n5 Years Service\n\n',
    de: 'DRAM Cache Dynamischer SLC Cache\n \n 4K Zufälliges Lesen bis zu 2100K IOPS\n \n Gen5 SSD\n \n Beschleunigung der Ladezeiten um bis zu 200%\n \n Bis zu 4 TB\n \n Wärmeabweisender 6nm Controller\n \n Lexar DiskMaster Einfache Laufwerksverwaltung\n \n 5 Jahre Service',
  },
  {
    en: 'Accelerate Load Times by up to 200%*\nExperience blistering read/write speeds up to 14,000/13,000MB/s* thanks to a combination of PCIe 5.0 technology and next-gen 232-layer 3D TLC NAND.\n\n\n*Speeds based on internal testing. Actual performance may vary.',
    de: 'Beschleunigung der Ladezeiten um bis zu 200%*\n Erleben Sie atemberaubende Lese-/Schreibgeschwindigkeiten von bis zu 14.000/13.000 MB/s* dank einer Kombination aus PCIe 5.0 Technologie und 232-Layer 3D TLC NAND der nächsten Generation.\n \n \n *Die Geschwindigkeitsangaben basieren auf internen Tests. Die tatsächliche Geschwindigkeit kann variieren.',
  },
  {
    en: 'An Unmatched AMD Partner\nThe NM1090 PRO is the perfect match for AMD Ryzen 9000 series CPUs. It not only delivers extreme storage and computing performance but also ensures fast game loading and smooth operation. It is the ideal choice for users who seek a high-performance gaming experience.\n\n\n',
    de: 'Ein unübertroffener AMD Partner\n Die NM1090 PRO ist die perfekte Ergänzung für CPUs der AMD Ryzen 9000 Serie. Sie bietet nicht nur eine extreme Speicher- und Rechenleistung, sondern sorgt auch für das schnelle Laden von Spielen und einen reibungslosen Betrieb. Sie ist die ideale Wahl für Benutzer, die ein leistungsstarkes Gaming-Erlebnis suchen.\n \n \n ',
  },
  {
    en: 'Heat-Defying 6nm Controller\n\nOffers advanced performance and simultaneously achieves better power management. The controller\'s temperature is reduced by 38%*, ensuring that the hard drive remains cool during high-load operation and provides a smoother performance experience.\n\n\nBIT Running for 30 Minutes Later\nTemperature Comparison with Other Gen 5 SSDs\n\nController Temperature Reduction\nS.M.A.R.T. Temperature Reduction\n\n* Based on internal testing. Actual performance may vary.',
    de: 'Wärmeabweisender 6nm Controller\n \n Bietet erweiterte Leistung und erreicht gleichzeitig eine bessere Energieverwaltung. Die Temperatur des Controllers wird um 38%* gesenkt, wodurch sichergestellt wird, dass der Datenträger bei hoher Last kühl bleibt und eine bessere Leistung bietet.\n \n \n BIT nach 30 Minuten Ausführung\n Temperaturvergleich mit anderen SSDs der 5. Generation\n \n Temperaturreduzierung des Controllers\n S.M.A.R.T. Temperaturreduzierung\n \n * Basierend auf internen Tests. Die tatsächliche Geschwindigkeit kann variieren.',
  },
  {
    en: 'Ultra-fast Response Blazing Speed\n4K Random Reads Up to 2100K IOPS*, significantly speeds up system response and application loading times, especially enhancing efficiency in multitasking and video editing, providing gamers with a smoother experience.\n\n* Speeds based on internal testing. Actual performance may vary.',
    de: 'Ultraschnelle Reaktionsgeschwindigkeit\n 4K Zufälliges Lesen bis zu 2100K IOPS* beschleunigt die Systemreaktion und die Ladezeiten von Anwendungen erheblich, verbessert insbesondere die Effizienz beim Multitasking und bei der Videobearbeitung und bietet Gamern ein reibungsloseres Erlebnis.\n \n * Die Geschwindigkeitsangaben basieren auf internen Tests. Die tatsächliche Geschwindigkeit kann variieren.',
  },
  {
    en: 'A State-of-the-Art Experience\nDRAM Cache and SLC Dynamic Cache greatly enhance data transfer speeds to reduce wait times and improve system responsiveness.\n\nDram Capacity',
    de: 'Ein Erlebnis auf dem neuesten Stand der Technik\n DRAM Cache und SLC Dynamic Cache verbessern die Datenübertragungsgeschwindigkeit erheblich, um Wartezeiten zu verkürzen und die Reaktionsfähigkeit des Systems zu verbessern.\n \n DRAM Kapazität',
  },
  {
    en: 'Up to 4TB\n\nOffers 1TB/2TB/4TB storage options. Easily handles OS, large games, and UHD/8K media storage needs, meeting the high demand for SSD capacity in the AIPC era.\n\nHigh-quality chips ensure ample storage design, offering gamers more space\nActual usable capacity\nA non-full capacity 4TB SSD\nNM1090 PRO 4TB\n\n* Based on internal testing. Actual performance may vary.',
    de: 'Bis zu 4 TB\n \n Bietet 1 TB/2 TB/4 TB Speicheroptionen. Bewältigt problemlos Betriebssysteme, große Spiele und UHD/8K Medienspeicheranforderungen und erfüllt damit die hohe Nachfrage nach SSD-Kapazität in der AIPC Ära.\n \n Hochwertige Chips sorgen für ein großzügiges Speicherdesign und bieten Gamern mehr Platz\n Tatsächlich nutzbare Kapazität\n Eine 4 TB SSD ohne volle Kapazität\n NM1090 PRO 4TB\n \n * Basierend auf internen Tests. Die tatsächliche Geschwindigkeit kann variieren.',
  },
  {
    en: 'Compatible with Microsoft DirectStorage \nBuilt to leverage Microsoft DirectStorage3 and significantly boost game loads, minimize delays, conserve CPU power, and enrich the gaming experience.',
    de: 'Kompatibel mit Microsoft DirectStorage \n Entwickelt, um Microsoft DirectStorage3 zu nutzen und das Laden von Spielen erheblich zu beschleunigen, Verzögerungen zu minimieren, CPU Leistung zu sparen und das Spielerlebnis zu bereichern.',
  },
  {
    en: 'Unleashing ultimate performance\nPaired with the latest AMD and Intel CPUs and PCIe 5.0 motherboards, it achieves the perfect match for ultimate performance. It is also backward compatible with PCIe 3.0 and PCIe 4.0 systems to ensure extensive applicability.',
    de: 'Ultimative Leistung entfesseln\n Zusammen mit den neuesten AMD und Intel CPUs und PCIe 5.0 Mainboards ist sie die perfekte Kombination für ultimative Leistung. Sie ist auch zu PCIe 3.0 und PCIe 4.0 Systemen abwärtskompatibel, um eine umfassende Anwendbarkeit zu gewährleisten.',
  },
  {
    en: 'Lexar DiskMaster\nFirmware upgrades\nHealth monitoring\nPerformance optimization\nData security',
    de: 'Lexar DiskMaster\n Firmware-Aktualisierungen\n Statusüberwachung\n Leistungsoptimierung\n Datensicherheit',
  },
  {
    en: 'Unleash the Gaming Power\nSupport Microsoft DirectStorage technology significantly reduces game load time.',
    de: 'Entfesseln Sie die Gaming Leistung\n Die Unterstützung der Microsoft DirectStorage Technologie reduziert die Ladezeit von Spielen erheblich.',
  },
  {
    en: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    de: 'Neues Kreativerlebnis\n Erhöht die Geschwindigkeit beim Rendern, sodass Ideen sofort in die Realität umgesetzt werden können.',
  },
  {
    en: 'Ultimate Performance for AIPC\nMeets AIPC\'s high-end demands with exceptional performance and vast capacity.',
    de: 'Ultimative Leistung für AIPC\n Erfüllt die High-End Anforderungen von AIPCs mit außergewöhnlicher Leistung und hoher Kapazität.',
  },
  {
    en: '5 Years Service\n',
    de: '5 Jahre Service',
  },
]

// 模拟术语库（从 CSV 推断）
const glossaryMap = new Map<string, string>([
  ['Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD', 'Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD'],
  ['Lexar', 'Lexar'],
  ['SSD', 'SSD'],
  ['NM1090 PRO', 'NM1090 PRO'],
  ['PCIe 5.0', 'PCIe 5.0'],
  ['NVMe', 'NVMe'],
  ['DRAM Cache', 'DRAM Cache'],
  ['SLC Cache', 'SLC Cache'],
  ['Read Speed', 'Lese-/Schreibgeschwindigkeiten'],
  ['Write Speed', 'Lese-/Schreibgeschwindigkeiten'],
  ['IOPS', 'IOPS'],
  ['Gen5 SSD', 'Gen5 SSD'],
  ['Heat-Defying 6nm Controller', 'Wärmeabweisender 6nm Controller'],
  ['Lexar DiskMaster', 'Lexar DiskMaster'],
  ['Backward Compatible', 'abwärtskompatibel'],
  ['AIPC', 'AIPC'],
  ['DirectStorage', 'DirectStorage'],
])

// 精确模拟 detectUntranslatedText 中的英文词提取逻辑
function extractEnglishWordsBuggy(text: string): string[] {
  // 这是当前代码中的 bug 版本
  return text.match(/\b[a-zA-Z]+\b/g) || []
}

function extractEnglishWordsFixed(text: string): string[] {
  // 修复后的版本：按空白分词 + 纯 ASCII 检查
  const allTokens = text.split(/[\s,.;:!?()\[\]{}\-\/]+/).filter(w => w.length >= 2)
  return allTokens.filter(w => /^[a-zA-Z]+$/.test(w))
}

function analyzeWithBuggyLogic(text: string, glossaryLower: Set<string>): {
  englishWords: string[]
  nonGlossaryWords: string[]
  totalWords: number
  englishRatio: number
} {
  const englishWords = extractEnglishWordsBuggy(text)
  const nonGlossaryWords = englishWords.filter(w => !glossaryLower.has(w.toLowerCase()))
  const totalWords = text.split(/\s+/).filter(w => w.length > 0)
  return {
    englishWords,
    nonGlossaryWords,
    totalWords: totalWords.length,
    englishRatio: totalWords.length > 0 ? nonGlossaryWords.length / totalWords.length : 0,
  }
}

function analyzeWithFixedLogic(text: string, glossaryLower: Set<string>): {
  englishWords: string[]
  nonGlossaryWords: string[]
  totalWords: number
  englishRatio: number
} {
  const englishWords = extractEnglishWordsFixed(text)
  const nonGlossaryWords = englishWords.filter(w => !glossaryLower.has(w.toLowerCase()))
  const totalWords = text.split(/\s+/).filter(w => w.length > 0)
  return {
    englishWords,
    nonGlossaryWords,
    totalWords: totalWords.length,
    englishRatio: totalWords.length > 0 ? nonGlossaryWords.length / totalWords.length : 0,
  }
}

async function main() {
  console.log('=== NM1090 PRO DE 翻译质量完整对比测试 ===')
  console.log(`测试文本数: ${TEST_DATA.length}`)

  const sources = TEST_DATA.map(t => t.en)
  const references = TEST_DATA.map(t => t.de)
  const glossaryLower = new Set([...glossaryMap.keys()].map(k => k.toLowerCase()))

  // 1. 分析参考译文的英文占比（buggy vs fixed）
  console.log('\n--- 参考译文分析（对比 buggy vs fixed 逻辑）---')
  for (let i = 0; i < references.length; i++) {
    const ref = references[i]
    const buggy = analyzeWithBuggyLogic(ref, glossaryLower)
    const fixed = analyzeWithFixedLogic(ref, glossaryLower)

    console.log(`\n[${i}] 源文: "${sources[i].slice(0, 50).replace(/\n/g, '\\n')}..."`)
    console.log(`  参考译文: "${ref.slice(0, 80).replace(/\n/g, '\\n')}..."`)
    console.log(`  Buggy: 英文词=${buggy.nonGlossaryWords.length}/${buggy.totalWords}, 占比=${(buggy.englishRatio * 100).toFixed(1)}%`)
    console.log(`  Fixed: 英文词=${fixed.nonGlossaryWords.length}/${fixed.totalWords}, 占比=${(fixed.englishRatio * 100).toFixed(1)}%`)

    if (buggy.englishRatio > 0.5 && fixed.englishRatio <= 0.5) {
      console.log(`  ⚠️ Buggy 误判! Fixed 逻辑下通过`)
    }
  }

  // 2. 调用 LLM 翻译
  console.log('\n\n--- LLM 翻译 ---')
  const startTime = Date.now()

  const llmResults = await translateBatch(
    sources,
    'de',
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

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`翻译耗时: ${duration}s`)

  // 3. 检测漏翻
  const untranslated = detectUntranslatedText(sources, llmResults, 'de', glossaryMap)

  // 4. 对比分析
  console.log('\n\n--- LLM 译文 vs 参考译文对比 ---')
  for (let i = 0; i < llmResults.length; i++) {
    const src = sources[i]
    const ref = references[i]
    const llm = llmResults[i]
    const isFlagged = untranslated.has(i)

    const buggy = analyzeWithBuggyLogic(llm, glossaryLower)
    const fixed = analyzeWithFixedLogic(llm, glossaryLower)

    console.log(`\n[${i}] ${isFlagged ? '❌ 被标记漏翻' : '✅ 通过'}`)
    console.log(`  源文: "${src.slice(0, 60).replace(/\n/g, '\\n')}..."`)
    console.log(`  参考译文: "${ref.slice(0, 80).replace(/\n/g, '\\n')}..."`)
    console.log(`  LLM译文: "${llm.slice(0, 80).replace(/\n/g, '\\n')}..."`)
    console.log(`  Buggy: 英文词=${buggy.nonGlossaryWords.length}/${buggy.totalWords}, 占比=${(buggy.englishRatio * 100).toFixed(1)}%`)
    console.log(`  Fixed: 英文词=${fixed.nonGlossaryWords.length}/${fixed.totalWords}, 占比=${(fixed.englishRatio * 100).toFixed(1)}%`)

    if (isFlagged) {
      console.log(`  ⚠️ 被标记漏翻! Buggy 英文词: ${buggy.nonGlossaryWords.slice(0, 10).join(', ')}`)
      if (buggy.englishRatio > 0.5 && fixed.englishRatio <= 0.5) {
        console.log(`  🔴 确认是正则 bug 导致的误判!`)
      }
    }
  }

  // 5. 统计
  console.log('\n\n--- 统计 ---')
  console.log(`总文本数: ${sources.length}`)
  console.log(`被标记漏翻: ${untranslated.size}`)
  console.log(`漏翻索引: ${[...untranslated].join(', ') || '无'}`)

  // 6. 分析误判原因
  if (untranslated.size > 0) {
    console.log('\n--- 误判原因分析 ---')
    let buggyBugCount = 0
    let realUntranslated = 0

    for (const idx of untranslated) {
      const llm = llmResults[idx]
      const buggy = analyzeWithBuggyLogic(llm, glossaryLower)
      const fixed = analyzeWithFixedLogic(llm, glossaryLower)

      if (buggy.englishRatio > 0.5 && fixed.englishRatio <= 0.5) {
        buggyBugCount++
        console.log(`  [${idx}] 🔴 正则 bug 误判 (buggy=${(buggy.englishRatio * 100).toFixed(1)}% → fixed=${(fixed.englishRatio * 100).toFixed(1)}%)`)
      } else {
        realUntranslated++
        console.log(`  [${idx}] 🟡 可能是真实漏翻 (buggy=${(buggy.englishRatio * 100).toFixed(1)}%, fixed=${(fixed.englishRatio * 100).toFixed(1)}%)`)
      }
    }

    console.log(`\n误判统计:`)
    console.log(`  正则 bug 误判: ${buggyBugCount}`)
    console.log(`  可能真实漏翻: ${realUntranslated}`)
  }

  // 7. 质量对比
  console.log('\n\n--- LLM 译文质量评估 ---')
  let goodCount = 0
  let acceptableCount = 0
  let poorCount = 0

  for (let i = 0; i < llmResults.length; i++) {
    const ref = references[i]
    const llm = llmResults[i]

    // 简单的相似度评估（去除空白和标点后比较）
    const refNorm = ref.replace(/\s+/g, ' ').replace(/[.,;:!?()]/g, '').toLowerCase().trim()
    const llmNorm = llm.replace(/\s+/g, ' ').replace(/[.,;:!?()]/g, '').toLowerCase().trim()

    // 计算字符级别的相似度
    const commonChars = [...refNorm].filter(c => llmNorm.includes(c)).length
    const similarity = commonChars / Math.max(refNorm.length, llmNorm.length)

    if (similarity > 0.8) {
      goodCount++
      console.log(`[${i}] ✅ 高质量 (${(similarity * 100).toFixed(0)}%)`)
    } else if (similarity > 0.6) {
      acceptableCount++
      console.log(`[${i}] ⚠️ 可接受 (${(similarity * 100).toFixed(0)}%)`)
    } else {
      poorCount++
      console.log(`[${i}] ❌ 质量差 (${(similarity * 100).toFixed(0)}%)`)
      console.log(`    参考: "${ref.slice(0, 60).replace(/\n/g, '\\n')}..."`)
      console.log(`    LLM:  "${llm.slice(0, 60).replace(/\n/g, '\\n')}..."`)
    }
  }

  console.log(`\n质量统计:`)
  console.log(`  高质量 (>80%): ${goodCount}`)
  console.log(`  可接受 (60-80%): ${acceptableCount}`)
  console.log(`  质量差 (<60%): ${poorCount}`)
}

main().catch(console.error)
