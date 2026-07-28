/**
 * NM1090 PRO FR 翻译质量完整对比测试
 * 使用真实 CSV 数据：EN 源文 + FR 参考译文 + LLM 译文
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

// 从 NM1090 PRO CSV 提取的完整测试数据（EN 源文 + FR 参考译文）
const TEST_DATA = [
  {
    en: 'Performance for the Next Level\nLexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    fr: 'Performances pour le niveau supérieur\n SSD Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280',
  },
  {
    en: 'DRAM Cache SLC Dynamic Cache\n\n4K Random Read Up to 2100K IOPS\n\nGen5 SSD\nAccelerate Load Times by up to 200%\n\nUp to 4TB\n\nHeat-Defying 6nm Controller\n\nLexar DiskMaster Easy Drive Management\n\n5 Years Service\n\n',
    fr: 'Cache DRAM Cache dynamique SLC\n \n Lecture aléatoire 4K jusqu\'à 2100K IOPS\n \n SSD Gen5\n \n Accélération des temps de chargement jusqu\'à 200 %\n \n Jusqu\'à 4 To\n \n Contrôleur 6 nm résistant à la chaleur\n \n Gestion facile des lecteurs Lexar DiskMaster\n \n Service de 5 ans',
  },
  {
    en: 'Accelerate Load Times by up to 200%*\nExperience blistering read/write speeds up to 14,000/13,000MB/s* thanks to a combination of PCIe 5.0 technology and next-gen 232-layer 3D TLC NAND.\n\n\n*Speeds based on internal testing. Actual performance may vary.',
    fr: 'Accélération des temps de chargement jusqu\'à 200 %*\n Profitez de vitesses de lecture/écriture fulgurantes allant jusqu\'à 14 000/13 000 Mo/s* grâce à une combinaison de la technologie PCIe 5.0 et de la NAND 3D TLC de 232 couches de dernière génération.\n \n \n *Vitesses basées sur des tests internes. Les performances réelles peuvent varier.',
  },
  {
    en: 'An Unmatched AMD Partner\nThe NM1090 PRO is the perfect match for AMD Ryzen 9000 series CPUs. It not only delivers extreme storage and computing performance but also ensures fast game loading and smooth operation. It is the ideal choice for users who seek a high-performance gaming experience.\n\n\n',
    fr: 'Un partenaire AMD sans pareil\n Le NM1090 PRO est le partenaire idéal pour les processeurs AMD Ryzen série 9000. Il offre non seulement des performances extrêmes de stockage et de calcul, mais assure également un chargement rapide des jeux et un fonctionnement fluide. C\'est le choix idéal pour les utilisateurs en quête d\'une expérience gaming haute performance.',
  },
  {
    en: 'Heat-Defying 6nm Controller\n\nOffers advanced performance and simultaneously achieves better power management. The controller\'s temperature is reduced by 38%*, ensuring that the hard drive remains cool during high-load operation and provides a smoother performance experience.\n\n\nBIT Running for 30 Minutes Later\nTemperature Comparison with Other Gen 5 SSDs\n\nController Temperature Reduction\nS.M.A.R.T. Temperature Reduction\n\n* Based on internal testing. Actual performance may vary.',
    fr: 'Contrôleur 6 nm résistant à la chaleur\n \n Offre des performances avancées et réalise simultanément une meilleure gestion de l\'énergie. La température du contrôleur est réduite de 38 %*, garantissant que le disque dur reste froid pendant les opérations à charge élevée et fournit une expérience de performance plus fluide.\n \n \n BIT exécuté après 30 minutes\n Comparaison de température avec d\'autres SSD Gen 5\n \n Réduction de la température du contrôleur\n Réduction de la température S.M.A.R.T.\n \n * Basé sur des tests internes. Les performances réelles peuvent varier.',
  },
  {
    en: 'Ultra-fast Response Blazing Speed\n4K Random Reads Up to 2100K IOPS*, significantly speeds up system response and application loading times, especially enhancing efficiency in multitasking and video editing, providing gamers with a smoother experience.\n\n* Speeds based on internal testing. Actual performance may vary.',
    fr: 'Réponse ultra-rapide Vitesse fulgurante\n Lectures aléatoires 4K jusqu\'à 2100K IOPS*, accélère considérablement la réactivité du système et les temps de chargement des applications, améliorant particulièrement l\'efficacité en multitâche et en montage vidéo, offrant aux joueurs une expérience plus fluide.\n \n * Vitesses basées sur des tests internes. Les performances réelles peuvent varier.',
  },
  {
    en: 'A State-of-the-Art Experience\nDRAM Cache and SLC Dynamic Cache greatly enhance data transfer speeds to reduce wait times and improve system responsiveness.\n\nDram Capacity',
    fr: 'Une expérience de pointe\n Le cache DRAM et le cache dynamique SLC améliorent considérablement les vitesses de transfert de données pour réduire les temps d\'attente et améliorer la réactivité du système.\n \n Capacité DRAM',
  },
  {
    en: 'Up to 4TB\n\nOffers 1TB/2TB/4TB storage options. Easily handles OS, large games, and UHD/8K media storage needs, meeting the high demand for SSD capacity in the AIPC era.\n\nHigh-quality chips ensure ample storage design, offering gamers more space\nActual usable capacity\nA non-full capacity 4TB SSD\nNM1090 PRO 4TB\n\n* Based on internal testing. Actual performance may vary.',
    fr: 'Jusqu\'à 4 To\n \n Offre des options de stockage de 1 To/2 To/4 To. Gère facilement les systèmes d\'exploitation, les jeux volumineux et les besoins de stockage multimédia UHD/8K, répondant à la forte demande de capacité SSD à l\'ère de l\'AIPC.\n \n Des puces de haute qualité garantissent une conception de stockage ample, offrant plus d\'espace aux joueurs.\n Capacité utilisable réelle\n Un SSD 4 To à capacité non complète\n NM1090 PRO 4 To\n \n * Basé sur des tests internes. Les performances réelles peuvent varier.',
  },
  {
    en: 'Compatible with Microsoft DirectStorage \nBuilt to leverage Microsoft DirectStorage3 and significantly boost game loads, minimize delays, conserve CPU power, and enrich the gaming experience.',
    fr: 'Compatible avec Microsoft DirectStorage \n Conçu pour tirer parti de Microsoft DirectStorage3 et améliorer considérablement les chargements de jeux, minimiser les délais, économiser la puissance du processeur et enrichir l\'expérience gaming.',
  },
  {
    en: 'Unleashing ultimate performance\nPaired with the latest AMD and Intel CPUs and PCIe 5.0 motherboards, it achieves the perfect match for ultimate performance. It is also backward compatible with PCIe 3.0 and PCIe 4.0 systems to ensure extensive applicability.',
    fr: 'Libérer des performances ultimes\n Associé aux derniers processeurs AMD et Intel et aux cartes mères PCIe 5.0, il réalise le match parfait pour des performances ultimes. Il est également rétrocompatible avec les systèmes PCIe 3.0 et PCIe 4.0 pour garantir une applicabilité étendue.',
  },
  {
    en: 'Lexar DiskMaster\nFirmware upgrades\nHealth monitoring\nPerformance optimization\nData security',
    fr: 'Lexar DiskMaster\n Mises à niveau du firmware\n Surveillance de la santé\n Optimisation des performances\n Sécurité des données',
  },
  {
    en: 'Unleash the Gaming Power\nSupport Microsoft DirectStorage technology significantly reduces game load time.',
    fr: 'Libérez la puissance du gaming\n Le support de la technologie Microsoft DirectStorage réduit considérablement le temps de chargement des jeux.',
  },
  {
    en: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    fr: 'Nouvelle expérience créative\n Accélère les vitesses de rendu, transformant les idées en réalité instantanément.',
  },
  {
    en: 'Ultimate Performance for AIPC\nMeets AIPC\'s high-end demands with exceptional performance and vast capacity.',
    fr: 'Performances ultimes pour AIPC\n Répond aux demandes haut de gamme de l\'AIPC avec des performances exceptionnelles et une vaste capacité.',
  },
  {
    en: '5 Years Service\n',
    fr: 'Service de 5 ans',
  },
]

// 模拟术语库（从 CSV 推断）
const glossaryMap = new Map<string, string>([
  ['Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD', 'SSD Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280'],
  ['Lexar', 'Lexar'],
  ['SSD', 'SSD'],
  ['NM1090 PRO', 'NM1090 PRO'],
  ['PCIe 5.0', 'PCIe 5.0'],
  ['NVMe', 'NVMe'],
  ['DRAM Cache', 'Cache DRAM'],
  ['SLC Cache', 'Cache SLC'],
  ['Read Speed', 'Vitesse de lecture'],
  ['Write Speed', 'Vitesse d\'écriture'],
  ['IOPS', 'IOPS'],
  ['Gen5 SSD', 'SSD Gen5'],
  ['Heat-Defying 6nm Controller', 'Contrôleur 6 nm résistant à la chaleur'],
  ['Lexar DiskMaster', 'Lexar DiskMaster'],
  ['Backward Compatible', 'Rétrocompatible'],
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
  console.log('=== NM1090 PRO FR 翻译质量完整对比测试 ===')
  console.log(`测试文本数: ${TEST_DATA.length}`)

  const sources = TEST_DATA.map(t => t.en)
  const references = TEST_DATA.map(t => t.fr)
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
    'fr',
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
  const untranslated = detectUntranslatedText(sources, llmResults, 'fr', glossaryMap)

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
