/**
 * 分析剩余误判原因
 */
import { detectUntranslatedText, detectTargetLanguageFeatures } from '../lib/llm-api'

// 导入 extractNonTargetWords（需要临时导出）
// 由于无法直接导入，我们手动实现一个
const TECH_TERM_EXEMPT = new Set([
  'ssd', 'nvme', 'pcie', 'dram', 'nand', 'slc', 'tlc', 'qlc', 'mlc',
  'iops', 'mb', 'gb', 'tb', 'kb', 'mbps', 'gbps', 'mhz', 'ghz',
  'gen', 'nm', 'uhd', 'os', 'cpu', 'gpu', 'rgb', 'pmic',
  'm.2', 'sata', 'cfexpress', 'cfe', 'sdxc', 'sdhc', 'microsd',
  'ddr', 'ddr4', 'ddr5', 'dimm', 'sodimm',
  'lexar', 'amd', 'intel', 'ryzen', 'microsoft', 'directstorage',
  'aipc', 'smart', 'bit', 'workflow',
  'pro', 'max', 'plus', 'mini', 'ultra', 'elite',
  'fw', 'hw', 'sw', 'usb', 'hdmi', 'dp', 'lan', 'wan',
  'uhs', 'vpg', 'mtbf', 'tbw',
])

function extractNonTargetWords(text: string, glossaryLower?: Set<string> | null): string[] {
  const allTokens = text.split(/[\s,.;:!?()\[\]{}\-\/\\]+/).filter(w => w.length >= 2)
  const asciiWords = allTokens.filter(w => /^[a-zA-Z]+$/.test(w))
  return asciiWords.filter(w => {
    const lower = w.toLowerCase()
    if (glossaryLower?.has(lower)) return false
    if (TECH_TERM_EXEMPT.has(lower)) return false
    return true
  })
}

// 测试几个典型的误判文本
const testCases = [
  {
    lang: 'de',
    text: 'DRAM Cache Dynamischer SLC Cache\n \n 4K Zufälliges Lesen bis zu 2100K IOPS\n \n Gen5 SSD\n \n Beschleunigung der Ladezeiten um bis zu 200%\n \n Bis zu 4 TB\n \n Wärmeabweisender 6nm Controller\n \n Lexar DiskMaster Einfache Laufwerksverwaltung\n \n 5 Jahre Service',
  },
  {
    lang: 'es',
    text: 'Caché dinámica SLC basada en DRAM\n \n Lectura aleatoria 4K hasta 2100K IOPS\n \n Gen5 SSD\n \n Acelera los tiempos de carga hasta en un 200 %\n \n Hasta 4 TB\n \n Controlador de 6 nm que desafía el calor\n \n Gestión sencilla de unidades Lexar DiskMaster\n \n 5 años de servicio',
  },
  {
    lang: 'fr',
    text: 'Service de 5 ans',
  },
]

for (const { lang, text } of testCases) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`语言: ${lang}`)
  console.log(`文本: "${text.slice(0, 100)}..."`)

  const featureCheck = detectTargetLanguageFeatures(text, lang)
  console.log(`特征字符: ${featureCheck.hasFeatures ? '有' : '无'} (${(featureCheck.featureRatio * 100).toFixed(2)}%)`)

  const nonTargetWords = extractNonTargetWords(text, null)
  const totalWords = text.split(/\s+/).filter(w => w.length > 0)
  const englishRatio = totalWords.length > 0 ? nonTargetWords.length / totalWords.length : 0

  console.log(`总词数: ${totalWords.length}`)
  console.log(`非目标词数: ${nonTargetWords.length}`)
  console.log(`英文占比: ${(englishRatio * 100).toFixed(1)}%`)
  console.log(`非目标词: ${nonTargetWords.join(', ')}`)

  // 测试 detectUntranslatedText
  const untranslated = detectUntranslatedText([text], [text], lang, new Map())
  console.log(`检测结果: ${untranslated.size > 0 ? '❌ 误判' : '✅ 通过'}`)
}
