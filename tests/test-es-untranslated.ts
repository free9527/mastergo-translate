/**
 * ES 翻译漏翻检测分析测试
 * 使用 NM1090 PRO 真实素材，分析 ES 漏翻检测的误判原因
 */
import XMLHttpRequest from 'xhr2';
(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { translateBatch, detectUntranslatedText, isUntranslatable, detectTargetLanguageFeatures, containsLanguageFunctionWords } from '../lib/llm-api'
import { DEBUG_MODE } from '../lib/constants'

// 强制开启 debug 日志
(globalThis as any).DEBUG_MODE = true

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
const MODEL = 'gpt-5.5'

// 从 NM1090 PRO CSV 提取的测试文本（EN 源文 + ES 参考译文）
const TEST_CASES = [
  {
    en: 'Performance for the Next Level\nLexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    es: 'Rendimiento para el próximo nivel\n Unidad de estado sólido (SSD) Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280',
  },
  {
    en: 'DRAM Cache SLC Dynamic Cache\n\n4K Random Read Up to 2100K IOPS\n\nGen5 SSD\nAccelerate Load Times by up to 200%\n\nUp to 4TB\n\nHeat-Defying 6nm Controller\n\nLexar DiskMaster Easy Drive Management\n\n5 Years Service',
    es: 'Caché dinámica SLC basada en DRAM\n \n Lectura aleatoria 4K hasta 2100K IOPS\n \n Gen5 SSD\n \n Acelera los tiempos de carga hasta en un 200 %\n \n Hasta 4 TB\n \n Controlador de 6 nm que desafía el calor\n \n Gestión sencilla de unidades Lexar DiskMaster\n \n 5 años de servicio',
  },
  {
    en: 'Accelerate Load Times by up to 200%*\nExperience blistering read/write speeds up to 14,000/13,000MB/s* thanks to a combination of PCIe 5.0 technology and next-gen 232-layer 3D TLC NAND.\n\n\n*Speeds based on internal testing. Actual performance may vary.',
    es: 'Acelera los tiempos de carga hasta en un 200 %*\n Experimente increíbles velocidades de lectura/escritura de hasta 14 000/13 000 MB/s* gracias a una combinación de tecnología PCIe 5.0 y NAND 3D TLC de 232 capas de última generación.\n \n \n *Velocidades basadas en pruebas internas. El rendimiento real puede variar.',
  },
  {
    en: 'An Unmatched AMD Partner\nThe NM1090 PRO is the perfect match for AMD Ryzen 9000 series CPUs. It not only delivers extreme storage and computing performance but also ensures fast game loading and smooth operation. It is the ideal choice for users who seek a high-performance gaming experience.',
    es: 'Un socio inigualable de AMD\n El NM1090 PRO es la combinación perfecta para las CPU de la serie AMD Ryzen 9000. No solo ofrece un rendimiento extremo de almacenamiento y procesamiento, sino que también garantiza una carga rápida de juegos y un funcionamiento sin problemas. Es la opción ideal para los usuarios que buscan una experiencia de juego de alto rendimiento.',
  },
  {
    en: 'Heat-Defying 6nm Controller\n\nOffers advanced performance and simultaneously achieves better power management. The controller\'s temperature is reduced by 38%*, ensuring that the hard drive remains cool during high-load operation and provides a smoother performance experience.\n\n\nBIT Running for 30 Minutes Later\nTemperature Comparison with Other Gen 5 SSDs\n\nController Temperature Reduction\nS.M.A.R.T. Temperature Reduction\n\n* Based on internal testing. Actual performance may vary.',
    es: 'Controlador de 6 nm que desafía el calor\n \n Ofrece un rendimiento avanzado y al mismo tiempo logra una mejor gestión de la energía. La temperatura del controlador se reduce en un 38 %*, lo que garantiza que el disco duro se mantenga frío durante el funcionamiento con alta carga y proporciona una experiencia de rendimiento más fluida.\n \n \n BIT se ejecuta más tarde durante 30 minutos\n Comparación de temperatura con otras SSD de quinta generación\n \n Reducción de la temperatura del controlador\n S.M.A.R.T. Reducción de temperatura\n \n * Basado en pruebas internas. El rendimiento real puede variar.',
  },
  {
    en: 'Ultra-fast Response Blazing Speed\n4K Random Reads Up to 2100K IOPS*, significantly speeds up system response and application loading times, especially enhancing efficiency in multitasking and video editing, providing gamers with a smoother experience.\n\n* Speeds based on internal testing. Actual performance may vary.',
    es: 'Respuesta ultrarrápida a una velocidad increíble\n Lecturas aleatorias 4K de hasta 2100K IOPS*, acelera significativamente la respuesta del sistema y los tiempos de carga de las aplicaciones, mejorando especialmente la eficiencia en la multitarea y la edición de vídeo, brindando a los jugadores una experiencia más fluida.\n \n * Velocidades basadas en pruebas internas. El rendimiento real puede variar.',
  },
  {
    en: 'A State-of-the-Art Experience\nDRAM Cache and SLC Dynamic Cache greatly enhance data transfer speeds to reduce wait times and improve system responsiveness.\n\nDram Capacity',
    es: 'Una experiencia de vanguardia\n La caché DRAM y la caché dinámica SLC mejoran enormemente las velocidades de transferencia de datos para reducir los tiempos de espera y mejorar la capacidad de respuesta del sistema.\n \n Capacidad Dram',
  },
  {
    en: 'Up to 4TB\n\nOffers 1TB/2TB/4TB storage options. Easily handles OS, large games, and UHD/8K media storage needs, meeting the high demand for SSD capacity in the AIPC era.\n\nHigh-quality chips ensure ample storage design, offering gamers more space\nActual usable capacity\nA non-full capacity 4TB SSD\nNM1090 PRO 4TB\n\n* Based on internal testing. Actual performance may vary.',
    es: 'Hasta 4 TB\n \n Ofrece opciones de almacenamiento de 1 TB/2 TB/4 TB. Gestiona fácilmente sistemas operativos, juegos grandes y necesidades de almacenamiento de medios UHD/8K, satisfaciendo la alta demanda de capacidad de las SSD en la era AIPC.\n \n Los chips de alta calidad garantizan un amplio diseño de almacenamiento, ofreciendo a los jugadores más espacio.\n Capacidad utilizable real\n Una SSD de 4 TB con capacidad no completa\n NM1090 PRO 4 TB\n \n * Basado en pruebas internas. El rendimiento real puede variar.',
  },
  {
    en: 'Compatible with Microsoft DirectStorage \nBuilt to leverage Microsoft DirectStorage3 and significantly boost game loads, minimize delays, conserve CPU power, and enrich the gaming experience.',
    es: 'Compatible con Microsoft DirectStorage \n Diseñada para aprovechar Microsoft DirectStorage3 y aumentar significativamente las cargas de juegos, minimizar retrasos, conservar energía de la CPU y enriquecer la experiencia de juego.',
  },
  {
    en: 'Unleashing ultimate performance\nPaired with the latest AMD and Intel CPUs and PCIe 5.0 motherboards, it achieves the perfect match for ultimate performance. It is also backward compatible with PCIe 3.0 and PCIe 4.0 systems to ensure extensive applicability.',
    es: 'Liberar el máximo rendimiento\n Combinado con las últimas CPU AMD e Intel y placas base PCIe 5.0, logra la combinación perfecta para lograr el máximo rendimiento. También es compatible con versiones anteriores de sistemas PCIe 3.0 y PCIe 4.0 para garantizar una amplia aplicabilidad.',
  },
  {
    en: 'Lexar DiskMaster\nFirmware upgrades\nHealth monitoring\nPerformance optimization\nData security',
    es: 'Lexar DiskMaster\n Actualizaciones de firmware\n Monitoreo de salud\n Optimización del rendimiento\n Seguridad de los datos',
  },
  {
    en: 'Unleash the Gaming Power\nSupport Microsoft DirectStorage technology significantly reduces game load time.',
    es: 'Libera el poder del juego\n La compatibilidad con la tecnología Microsoft DirectStorage reduce significativamente el tiempo de carga del juego.',
  },
  {
    en: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    es: 'Nueva experiencia creativa\n Aumenta las velocidades de renderizado, convirtiendo las ideas en realidad al instante.',
  },
  {
    en: 'Ultimate Performance for AIPC\nMeets AIPC\'s high-end demands with exceptional performance and vast capacity.',
    es: 'Máximo rendimiento para AIPC\n Cumple con las demandas de alto nivel de AIPC con un rendimiento excepcional y una gran capacidad.',
  },
  {
    en: '5 Years Service',
    es: '5 años de servicio',
  },
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
])

function analyzeTranslation(source: string, translation: string, targetLang: string): {
  hasFeatures: boolean
  featureRatio: number
  hasFunctionWords: boolean
  englishRatio: number
  verdict: string
} {
  const featureCheck = detectTargetLanguageFeatures(translation, targetLang)

  // 模拟 containsLanguageFunctionWords 的逻辑
  const ES_FUNCTION_WORDS = new Set(['y', 'o', 'pero', 'que', 'porque', 'con', 'para', 'por', 'desde', 'hasta', 'entre', 'sin', 'sobre', 'según', 'durante', 'antes', 'después', 'mientras', 'cuando', 'como', 'si', 'aunque', 'sino', 'también', 'muy', 'más', 'menos', 'aquí', 'ahí', 'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'tiene', 'tienen'])

  const textWords = translation.toLowerCase().split(/[\s,.;:!?()\[\]{}\-\/]+/).filter(w => w.length >= 2)
  let matchCount = 0
  for (const w of textWords) {
    if (ES_FUNCTION_WORDS.has(w)) matchCount++
  }
  const hasFunctionWords = matchCount >= 1 && matchCount / textWords.length >= 0.03

  // 计算英文占比
  const englishWords = translation.match(/\b[a-zA-Z]+\b/g) || []
  const glossaryLower = new Set([...glossaryMap.keys()].map(k => k.toLowerCase()))
  const nonGlossaryWords = englishWords.filter(w => !glossaryLower.has(w.toLowerCase()))
  const totalWords = translation.split(/\s+/).filter(w => w.length > 0)
  const englishRatio = totalWords.length > 0 ? nonGlossaryWords.length / totalWords.length : 0

  // 判定
  let verdict = '✅ 通过'
  if (!featureCheck.hasFeatures) {
    if (hasFunctionWords && englishRatio > 0.5) {
      verdict = `❌ 漏翻（有功能词但英文占比${(englishRatio*100).toFixed(0)}%>50%）`
    } else if (!hasFunctionWords && englishRatio > 0.6) {
      verdict = `❌ 漏翻（无功能词且英文占比${(englishRatio*100).toFixed(0)}%>60%）`
    } else {
      verdict = '⚠️ 无特征但英文占比合理'
    }
  }

  return {
    hasFeatures: featureCheck.hasFeatures,
    featureRatio: featureCheck.featureRatio,
    hasFunctionWords,
    englishRatio,
    verdict,
  }
}

async function main() {
  console.log('=== ES 翻译漏翻检测分析测试 ===')
  console.log(`测试文本数: ${TEST_CASES.length}`)
  console.log('')

  const sources = TEST_CASES.map(t => t.en)
  const referenceTranslations = TEST_CASES.map(t => t.es)

  // 1. 先分析参考译文的质量
  console.log('--- 参考译文质量分析 ---')
  for (let i = 0; i < TEST_CASES.length; i++) {
    const ref = referenceTranslations[i]
    const analysis = analyzeTranslation(sources[i], ref, 'es')
    console.log(`  [${i}] ${analysis.verdict}`)
    console.log(`      特征字符: ${analysis.hasFeatures ? '有' : '无'}, 功能词: ${analysis.hasFunctionWords ? '有' : '无'}, 英文占比: ${(analysis.englishRatio*100).toFixed(1)}%`)
    console.log(`      源文: "${sources[i].slice(0, 60)}..."`)
  }

  // 2. 调用 LLM 翻译
  console.log('\n--- LLM 翻译 ---')
  const startTime = Date.now()

  const result = await translateBatch(
    sources,
    'es',
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

  // 3. 分析 LLM 译文
  console.log('\n--- LLM 译文质量分析 ---')
  const untranslated = detectUntranslatedText(sources, result, 'es', glossaryMap)

  for (let i = 0; i < result.length; i++) {
    const src = sources[i]
    const trans = result[i]
    const ref = referenceTranslations[i]
    const analysis = analyzeTranslation(src, trans, 'es')
    const isFlagged = untranslated.has(i)

    console.log(`\n  [${i}] ${isFlagged ? '❌ 被标记漏翻' : '✅ 通过'}`)
    console.log(`      分析: ${analysis.verdict}`)
    console.log(`      特征字符: ${analysis.hasFeatures ? '有' : '无'}, 功能词: ${analysis.hasFunctionWords ? '有' : '无'}, 英文占比: ${(analysis.englishRatio*100).toFixed(1)}%`)
    console.log(`      源文: "${src.slice(0, 80).replace(/\n/g, '\\n')}..."`)
    console.log(`      LLM译文: "${trans.slice(0, 80).replace(/\n/g, '\\n')}..."`)
    console.log(`      参考译文: "${ref.slice(0, 80).replace(/\n/g, '\\n')}..."`)
  }

  // 4. 统计
  console.log('\n--- 统计 ---')
  console.log(`总文本数: ${sources.length}`)
  console.log(`被标记漏翻: ${untranslated.size}`)
  console.log(`漏翻索引: ${[...untranslated].join(', ') || '无'}`)

  // 5. 分析误判原因
  if (untranslated.size > 0) {
    console.log('\n--- 误判原因分析 ---')
    for (const idx of untranslated) {
      const trans = result[idx]
      const analysis = analyzeTranslation(sources[idx], trans, 'es')
      console.log(`\n  [${idx}] 误判原因:`)
      if (!analysis.hasFeatures) {
        console.log(`    - 无西班牙语特征字符 (áéíóúñü)`)
      }
      if (analysis.hasFunctionWords && analysis.englishRatio > 0.5) {
        console.log(`    - 有功能词但英文占比过高 (${(analysis.englishRatio*100).toFixed(1)}%)`)
      }
      if (!analysis.hasFunctionWords) {
        console.log(`    - 无西班牙语功能词`)
      }
      console.log(`    - 译文: "${trans.slice(0, 100).replace(/\n/g, '\\n')}..."`)
    }
  }
}

main().catch(console.error)
