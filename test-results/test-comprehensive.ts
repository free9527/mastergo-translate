/**
 * 极端压力测试脚本 - 真实例句 + 压力改造 + 人工翻译对比
 *
 * 测试维度：
 * 1. 套件1：20种语言 × 真实例句压力改造（超长文本 + 大量术语）
 * 2. 套件2：20种语言 × 术语冲突 + 多批次测试
 * 3. 与人工翻译对比：检查关键信息保留（数字、品牌名、技术术语）
 *
 * 使用方法：
 *   npx tsx test-results/test-comprehensive.ts
 */

// Node.js 环境没有 XMLHttpRequest，用 xhr2 polyfill 补上
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse/sync'
import { translateBatch, proofreadBatch, detectUntranslatedText } from '../lib/llm-api'
import { detectTranslationExpansion, detectBrandInjection } from '../lib/post-process'
import { renderLangForTranslate, LANG_SPECIFIC } from '../lib/prompt-constants'
import { detectProductLine } from '../lib/llm-api'
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
  enableProofread: true,
  proofreadApiKey: API_KEY,
  proofreadApiUrl: API_URL,
  proofreadModel: MODEL,
}

// ============================================================
// CSV 文件配置
// ============================================================

const TEST_DIR = 'C:/Users/Administrator/Desktop/materGO/translate/测试文本'

// 语言代码映射
const LANG_MAP: Record<string, string> = {
  '德DE': 'de',
  '法FR': 'fr',
  '西班牙ES': 'es',
  '意大利IT': 'it',
  '波兰PL': 'pl',
  '阿拉伯AR': 'ar',
  '日本JP': 'ja',
  '中文CN': 'zh-CN',
  '台湾TC': 'zh-TW',
  '越南VN': 'vi',
  '荷兰NL': 'nl',
  '瑞典SE': 'sv',
  '土耳其TR': 'tr',
}

const TEST_FILES = [
  'Card 卡类-OW&AMZ小语种翻译 - PLAY PRO microSD.csv',
  'Card 卡类-OW&AMZ小语种翻译 - ARMOR GOLD SD.csv',
  'Card 卡类-OW&AMZ小语种翻译 - CFe 4.0 DIAMOND Type B.csv',
]

// ============================================================
// 20种语言配置
// ============================================================

const ALL_LANGUAGES = [
  'zh-CN', 'zh-TW', 'ja', 'ko',           // CJK
  'fr', 'de', 'es', 'pt', 'pt-BR', 'it',  // 欧洲主要
  'nl', 'pl', 'sv', 'tr', 'ru',           // 欧洲次要
  'vi', 'th', 'id', 'ar', 'en',           // 东南亚+中东+英语
]

// 每种语言的术语表（避免跨语言污染）
const glossaries: Record<string, Map<string, string>> = {
  'zh-CN': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 卡'],
    ['Read Speed', '读取速度'],
    ['Write Speed', '写入速度'],
  ]),
  'zh-TW': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 卡'],
    ['Read Speed', '讀取速度'],
    ['Write Speed', '寫入速度'],
  ]),
  'ja': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Expressカード'],
    ['Read Speed', '読み込み速度'],
    ['Write Speed', '書き込み速度'],
  ]),
  'ko': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 카드'],
    ['Read Speed', '읽기 속도'],
    ['Write Speed', '쓰기 속도'],
  ]),
  'fr': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Carte Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Vitesse de lecture'],
    ['Write Speed', "Vitesse d'écriture"],
  ]),
  'de': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express Karte'],
    ['Read Speed', 'Lesegeschwindigkeit'],
    ['Write Speed', 'Schreibgeschwindigkeit'],
  ]),
  'es': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Tarjeta Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Velocidad de lectura'],
    ['Write Speed', 'Velocidad de escritura'],
  ]),
  'pt': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Cartão Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Velocidade de leitura'],
    ['Write Speed', 'Velocidade de gravação'],
  ]),
  'pt-BR': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Cartão Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Velocidade de leitura'],
    ['Write Speed', 'Velocidade de gravação'],
  ]),
  'it': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Scheda Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Velocità di lettura'],
    ['Write Speed', 'Velocità di scrittura'],
  ]),
  'nl': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express kaart'],
    ['Read Speed', 'Leessnelheid'],
    ['Write Speed', 'Schrijfsnelheid'],
  ]),
  'pl': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Karta Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Prędkość odczytu'],
    ['Write Speed', 'Prędkość zapisu'],
  ]),
  'sv': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express kort'],
    ['Read Speed', 'Läshastighet'],
    ['Write Speed', 'Skrivhastighet'],
  ]),
  'tr': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express Kart'],
    ['Read Speed', 'Okuma hızı'],
    ['Write Speed', 'Yazma hızı'],
  ]),
  'ru': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Карта Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Скорость чтения'],
    ['Write Speed', 'Скорость записи'],
  ]),
  'vi': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Thẻ Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Tốc độ đọc'],
    ['Write Speed', 'Tốc độ ghi'],
  ]),
  'th': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'การ์ด Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'ความเร็วในการอ่าน'],
    ['Write Speed', 'ความเร็วในการเขียน'],
  ]),
  'id': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Kartu Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'Kecepatan baca'],
    ['Write Speed', 'Kecepatan tulis'],
  ]),
  'ar': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'بطاقة Lexar PLAY PRO microSDXC Express'],
    ['Read Speed', 'سرعة القراءة'],
    ['Write Speed', 'سرعة الكتابة'],
  ]),
  'en': new Map([
    ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express Card'],
    ['Read Speed', 'Read Speed'],
    ['Write Speed', 'Write Speed'],
  ]),
}

// ============================================================
// CSV 解析
// ============================================================

interface TranslationPair {
  source: string
  reference: string
  lang: string
}

function parseCSV(filePath: string): TranslationPair[] {
  const content = fs.readFileSync(filePath, 'utf-8')

  const records = parse(content, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
  })

  let headerRowIndex = -1
  for (let i = 0; i < Math.min(10, records.length); i++) {
    const row = records[i]
    if (row.some(cell => cell && (cell.includes('Reference') || cell.includes('EN')))) {
      headerRowIndex = i
      break
    }
  }

  if (headerRowIndex === -1) return []

  const header = records[headerRowIndex]
  let enColIndex = -1
  const langColIndices: Record<string, number> = {}

  for (let i = 0; i < header.length; i++) {
    const cell = (header[i] || '').trim()
    if (cell === 'EN' || cell.includes('EN')) {
      enColIndex = i
    }
    for (const [csvLang, stdLang] of Object.entries(LANG_MAP)) {
      if (cell.includes(csvLang)) {
        langColIndices[csvLang] = i
      }
    }
  }

  if (enColIndex === -1) return []

  const pairs: TranslationPair[] = []

  for (let i = headerRowIndex + 1; i < records.length; i++) {
    const row = records[i]
    const sourceCell = (row[enColIndex] || '').trim()

    if (!sourceCell || sourceCell.length < 3) continue

    const sourceLines = sourceCell.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    for (const [csvLang, colIndex] of Object.entries(langColIndices)) {
      const refCell = (row[colIndex] || '').trim()
      if (!refCell || refCell.length < 2) continue

      const refLines = refCell.split('\n').map(l => l.trim()).filter(l => l.length > 0)
      const stdLang = LANG_MAP[csvLang]

      const pairCount = Math.min(sourceLines.length, refLines.length)
      for (let j = 0; j < pairCount; j++) {
        const source = sourceLines[j]
        const reference = refLines[j]

        if (source.length < 3 || reference.length < 2) continue
        if (/^[\d\s.,]+$/.test(source)) continue

        pairs.push({ source, reference, lang: stdLang })
      }
    }
  }

  return pairs
}

// ============================================================
// 对比逻辑：与人工翻译对比
// ============================================================

interface ComparisonResult {
  match: boolean
  score: number  // 0-100
  issues: string[]
}

function compareWithReference(
  source: string,
  reference: string,
  ai: string,
): ComparisonResult {
  const issues: string[] = []
  let score = 100

  // 1. 检查是否为空
  if (!ai || ai.length === 0) {
    issues.push('译文为空')
    return { match: false, score: 0, issues }
  }

  // 2. 提取关键信息
  const srcNumbers = source.match(/\d+/g) || []
  const aiNumbers = ai.match(/\d+/g) || []

  // 3. 检查数字保留（允许格式差异）
  const missingNumbers = srcNumbers.filter(n => !aiNumbers.includes(n))
  if (missingNumbers.length > 0) {
    issues.push(`丢失数字: ${missingNumbers.join(', ')}`)
    score -= 20
  }

  // 4. 检查品牌名保留
  const brandPatterns = [
    { pattern: /Lexar/i, name: 'Lexar' },
    { pattern: /PLAY\s*PRO/i, name: 'PLAY PRO' },
    { pattern: /microSD/i, name: 'microSD' },
    { pattern: /ARMOR\s*GOLD/i, name: 'ARMOR GOLD' },
    { pattern: /DIAMOND/i, name: 'DIAMOND' },
    { pattern: /CFexpress/i, name: 'CFexpress' },
  ]

  for (const { pattern, name } of brandPatterns) {
    const srcHas = pattern.test(source)
    const aiHas = pattern.test(ai)
    if (srcHas && !aiHas) {
      issues.push(`丢失品牌: ${name}`)
      score -= 15
    }
  }

  // 5. 检查技术术语保留
  // 注意：只检查不可翻译的技术标准名称（microSDXC/PCIe/NVMe）
  // "Express Card" 是可翻译的术语（中文"Express 卡"、日文"Express カード"），不在此检查
  const techPatterns = [
    { pattern: /microSDXC/i, name: 'microSDXC' },
    { pattern: /PCIe/i, name: 'PCIe' },
    { pattern: /NVMe/i, name: 'NVMe' },
  ]

  for (const { pattern, name } of techPatterns) {
    const srcHas = pattern.test(source)
    const aiHas = pattern.test(ai)
    if (srcHas && !aiHas) {
      issues.push(`丢失术语: ${name}`)
      score -= 10
    }
  }

  // 6. 检查译文长度合理性
  const srcLen = source.length
  const aiLen = ai.length

  if (aiLen < srcLen * 0.3 && srcLen > 50) {
    issues.push(`译文过短: 源文 ${srcLen} 字符，译文 ${aiLen} 字符`)
    score -= 15
  }
  if (aiLen > srcLen * 3 && srcLen > 50) {
    issues.push(`译文过长: 源文 ${srcLen} 字符，译文 ${aiLen} 字符`)
    score -= 10
  }

  return { match: issues.length === 0, score: Math.max(0, score), issues }
}

// ============================================================
// 压力测试文本生成器
// ============================================================

// 硬编码的极端压力测试文本（用于没有真实 CSV 数据的语言）
const HARDCODED_EXTREME_TEXTS = [
  `Lexar® PLAY PRO™ microSDXC™ Express Card delivers revolutionary performance with Read speed up to 900MB/s and Write speed up to 800MB/s. Perfect for gaming, photography, and videography. Compatible with Lexar® AIR PRO™ SD Card Reader for ultra-fast data transfer. The Lexar PLAY PRO microSDXC Express Card is designed for professionals who demand the best performance from their Lexar® storage solutions. With advanced error correction technology and lifetime warranty, you can trust Lexar to deliver quality and reliability.`,
  `Lexar® ARMOR GOLD™ SD Card offers exceptional durability and performance. With Read speed up to 500MB/s and Write speed up to 400MB/s, this card is perfect for outdoor photography and videography. The ARMOR GOLD series is designed to withstand extreme conditions including water, shock, and temperature variations. Available in capacities from 64GB to 512GB, the Lexar ARMOR GOLD SD Card is the ultimate choice for adventure photographers and content creators who need reliable storage in challenging environments.`,
  `Lexar® NM790™ PCIe 4.0 NVMe SSD delivers blazing-fast performance with Read speeds up to 7400MB/s and Write speeds up to 6500MB/s. Perfect for gaming, content creation, and professional workloads. The NM790 features advanced thermal management and error correction technology to ensure data integrity and reliability. With capacities ranging from 512GB to 4TB, the Lexar NM790 SSD is the ultimate storage solution for demanding applications.`,
]

const HARDCODED_CONFLICT_TEXTS = [
  'Card reader for SD Card',
  'Card and Card reader bundle',
  'Memory Card vs Memory',
  'SSD vs HDD storage',
  'Read speed and Write speed comparison',
  'Lexar PLAY PRO microSDXC Express Card with NVMe protocol',
  'Read speeds up to 7400MB/s with PCIe 4.0',
  'Compatible with USB 3.2 and Thunderbolt',
  'Available in 128GB, 256GB, and 512GB',
  '*Speeds may vary based on device and conditions',
  'Lexar® PLAY PRO™ microSDXC™ Express Card',
  'Good for Today Great for Tomorrow',
  'Level-up Your Handheld Gaming Experience',
  'Read speeds up to 800MB/s let you play, create, and store more',
  '*Comparison of theoretical maximum speeds (Data source: SDA)',
]

function generateExtremeTexts(pairs: TranslationPair[]): {
  extremeLongTexts: string[]
  extremeLongRefs: string[]
  conflictTexts: string[]
  conflictRefs: string[]
} {
  // 套件1：超长文本（拼接多条真实文本，达到 1000+ 字符）
  const extremeLongTexts: string[] = []
  const extremeLongRefs: string[] = []

  // 取前 10 条真实文本拼接
  const longPair = pairs.slice(0, 10)
  if (longPair.length >= 5) {
    const longText = longPair.map(p => p.source).join('\n\n')
    const longRef = longPair.map(p => p.reference).join('\n\n')
    extremeLongTexts.push(longText)
    extremeLongRefs.push(longRef)
  }

  // 再取 5 条中等长度文本
  const mediumPairs = pairs.filter(p => p.source.length > 100 && p.source.length < 300).slice(0, 5)
  if (mediumPairs.length >= 3) {
    const mediumText = mediumPairs.map(p => p.source).join('\n\n')
    const mediumRef = mediumPairs.map(p => p.reference).join('\n\n')
    extremeLongTexts.push(mediumText)
    extremeLongRefs.push(mediumRef)
  }

  // 套件2：术语冲突 + 多批次（15 条/批次）
  const conflictTexts: string[] = []
  const conflictRefs: string[] = []

  // 取 15 条包含术语的真实文本
  const termPairs = pairs.filter(p =>
    p.source.includes('Lexar') ||
    p.source.includes('Card') ||
    p.source.includes('SSD') ||
    p.source.includes('speed')
  ).slice(0, 15)

  if (termPairs.length >= 10) {
    conflictTexts.push(...termPairs.map(p => p.source))
    conflictRefs.push(...termPairs.map(p => p.reference))
  }

  return { extremeLongTexts, extremeLongRefs, conflictTexts, conflictRefs }
}

// ============================================================
// 测试执行器
// ============================================================

interface TestResult {
  name: string
  lang: string
  passed: boolean
  errors: string[]
  warnings: string[]
  duration: number
  score: number  // 与人工翻译对比得分
  comparisons: Array<{
    source: string
    reference: string
    ai: string
    score: number
    issues: string[]
  }>
}

async function runTest(
  name: string,
  texts: string[],
  references: string[],
  lang: string,
  glossary: Map<string, string>,
  enableProofread: boolean = true,
): Promise<TestResult> {
  const result: TestResult = {
    name,
    lang,
    passed: true,
    errors: [],
    warnings: [],
    duration: 0,
    score: 0,
    comparisons: [],
  }

  try {
    const startTime = Date.now()

    // 1. 翻译
    const translated = await translateBatch(
      texts, lang, glossary, config,
      undefined, undefined, undefined, undefined, undefined, false,
    )

    // 2. 翻译后检测
    const untranslatedAfterTranslate = detectUntranslatedText(texts, translated, lang)
    const expandedAfterTranslate = detectTranslationExpansion(texts, translated, lang)
    const injectedAfterTranslate = detectBrandInjection(texts, translated, glossary)

    // 3. 校对（如果启用）
    let finalTranslations = translated
    if (enableProofread) {
      const proofreadItems = texts.map((src, i) => ({
        sourceText: src,
        translatedText: translated[i],
      }))
      const proofreadResult = await proofreadBatch(
        proofreadItems, lang, glossary, config,
        undefined, undefined, undefined, false,
      )
      finalTranslations = proofreadResult.map(r => r.text)

      // 4. 校对后检测
      const untranslatedAfterProofread = detectUntranslatedText(texts, finalTranslations, lang)
      const expandedAfterProofread = detectTranslationExpansion(texts, finalTranslations, lang)

      if (untranslatedAfterProofread.size > 0) {
        result.passed = false
        result.errors.push(`校对后仍有 ${untranslatedAfterProofread.size} 条漏翻`)
      }
      if (expandedAfterProofread.expandedIndices.size > 0) {
        result.passed = false
        result.errors.push(`校对后仍有 ${expandedAfterProofread.expandedIndices.size} 条异常扩展`)
      }
    }

    // 5. 最终断言
    if (untranslatedAfterTranslate.size > 0 && !enableProofread) {
      result.passed = false
      result.errors.push(`翻译后 ${untranslatedAfterTranslate.size} 条漏翻`)
    }
    if (expandedAfterTranslate.expandedIndices.size > 0) {
      result.warnings.push(`翻译后 ${expandedAfterTranslate.expandedIndices.size} 条异常扩展（已截断）`)
    }
    if (injectedAfterTranslate.injectedIndices.size > 0) {
      result.warnings.push(`翻译后 ${injectedAfterTranslate.injectedIndices.size} 条品牌注入（已回退）`)
    }

    // 6. 与人工翻译对比
    let totalScore = 0
    for (let i = 0; i < texts.length; i++) {
      const src = texts[i]
      const ref = references[i] || ''
      const trans = finalTranslations[i]

      if (!trans || trans.length === 0) {
        result.passed = false
        result.errors.push(`[${i}] 译文为空`)
        continue
      }

      const comparison = compareWithReference(src, ref, trans)
      totalScore += comparison.score

      result.comparisons.push({
        source: src,
        reference: ref,
        ai: trans,
        score: comparison.score,
        issues: comparison.issues,
      })

      if (!comparison.match) {
        for (const issue of comparison.issues) {
          result.warnings.push(`[${i}] ${issue}`)
        }
      }
    }

    result.score = totalScore / texts.length
    result.duration = Date.now() - startTime

  } catch (error) {
    result.passed = false
    result.errors.push(`执行异常: ${error.message}`)
  }

  return result
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('=== 极端压力测试 - 真实例句 + 压力改造 + 人工翻译对比 ===\n')
  console.log('测试维度：')
  console.log('  1. 套件1：20种语言 × 真实例句压力改造（超长文本 + 大量术语）')
  console.log('  2. 套件2：20种语言 × 术语冲突 + 多批次测试（15 条/批次）')
  console.log('  3. 与人工翻译对比：检查关键信息保留（数字、品牌名、技术术语）\n')

  // 从真实 CSV 文件中提取翻译对
  console.log('📂 从真实 CSV 文件中提取翻译对...\n')
  const allPairsByLang: Record<string, TranslationPair[]> = {}

  for (const testFile of TEST_FILES) {
    const filePath = path.join(TEST_DIR, testFile)

    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  文件不存在: ${testFile}`)
      continue
    }

    console.log(`📄 ${testFile}`)
    const pairs = parseCSV(filePath)
    console.log(`  提取 ${pairs.length} 条翻译对`)

    // 按语言分组
    for (const pair of pairs) {
      if (!allPairsByLang[pair.lang]) allPairsByLang[pair.lang] = []
      allPairsByLang[pair.lang].push(pair)
    }
  }

  const totalPairs = Object.values(allPairsByLang).reduce((sum, arr) => sum + arr.length, 0)
  console.log(`\n总计提取 ${totalPairs} 条翻译对，覆盖 ${Object.keys(allPairsByLang).length} 种语言\n`)

  // 功能验证
  console.log('【套件0】功能验证：20语种 + 8品类 + 3风格\n')

  console.log('验证 1：20 语种 LANG_SPECIFIC 注入')
  let langSpecificPass = 0
  for (const lang of ALL_LANGUAGES) {
    const langBlock = renderLangForTranslate(lang, null)
    const hasBlock = langBlock.length > 0
    if (hasBlock) langSpecificPass++
    console.log(`  ${hasBlock ? '✅' : '❌'} ${lang}: ${hasBlock ? '已注入' : '未注入'} (${langBlock.length} 字符)`)
  }
  console.log(`  结果: ${langSpecificPass}/${ALL_LANGUAGES.length} 通过\n`)

  console.log('验证 2：8 条产品线检测')
  const productLineTests = [
    { texts: ['Lexar ARES DDR5 32GB Kit'], expected: 'gaming_dimm', name: '电竞内存' },
    { texts: ['Lexar PLAY PRO NVMe SSD'], expected: 'gaming_ssd', name: '电竞SSD' },
    { texts: ['Lexar PLAY PRO microSDXC Card'], expected: 'gaming_card', name: '游戏存储卡' },
    { texts: ['Lexar Professional CFexpress Type B Card'], expected: 'professional_imaging', name: '专业影像' },
    { texts: ['Lexar NS100 2.5" SATA SSD for office'], expected: 'pc_productivity', name: 'PC生产力' },
    { texts: ['Lexar SILVER 64GB SD Card'], expected: 'consumer_cards', name: '消费级存储卡' },
    { texts: ['Lexar JumpDrive S47 128GB USB Flash Drive'], expected: 'portable_storage', name: '便携存储' },
    { texts: ['General storage product'], expected: null, name: '通用（无产品线）' },
  ]

  let productLinePass = 0
  for (const test of productLineTests) {
    const detected = detectProductLine(test.texts)
    const pass = detected === test.expected
    if (pass) productLinePass++
    console.log(`  ${pass ? '✅' : '❌'} ${test.name}: 期望 ${test.expected || 'null'}, 实际 ${detected || 'null'}`)
  }
  console.log(`  结果: ${productLinePass}/${productLineTests.length} 通过\n`)

  console.log('功能验证总结:')
  console.log(`  20语种注入: ${langSpecificPass}/${ALL_LANGUAGES.length}`)
  console.log(`  8品类检测: ${productLinePass}/${productLineTests.length}`)
  console.log()

  // 测试套件
  const results: TestResult[] = []
  let testCount = 0

  // 测试套件 1：20种语言 × 极端边界测试（超长文本 + 大量术语）
  console.log('【套件1】20种语言 × 极端边界测试（超长文本 + 大量术语）')
  for (const lang of ALL_LANGUAGES) {
    testCount++
    console.log(`  [${testCount}] 极端边界 - ${lang}...`)

    const langPairs = allPairsByLang[lang] || []
    let texts: string[]
    let refs: string[]

    if (langPairs.length >= 5) {
      // 有真实 CSV 数据，使用真实数据
      const { extremeLongTexts, extremeLongRefs } = generateExtremeTexts(langPairs)
      if (extremeLongTexts.length > 0) {
        texts = extremeLongTexts
        refs = extremeLongRefs
      } else {
        // 真实数据不足，使用硬编码
        texts = HARDCODED_EXTREME_TEXTS
        refs = HARDCODED_EXTREME_TEXTS.map(() => '')
      }
    } else {
      // 无真实 CSV 数据，使用硬编码
      console.log(`    ℹ️  ${lang} 无真实 CSV 数据，使用硬编码极端文本`)
      texts = HARDCODED_EXTREME_TEXTS
      refs = HARDCODED_EXTREME_TEXTS.map(() => '')
    }

    const result = await runTest(
      `极端边界 - ${lang}`,
      texts,
      refs,
      lang,
      glossaries[lang] || new Map(),
      true,
    )
    results.push(result)
    console.log(`    ${result.passed ? '✅' : '❌'} ${result.errors.length} 错误, ${result.warnings.length} 警告`)
    console.log(`    得分: ${result.score.toFixed(1)}/100, 耗时: ${result.duration}ms`)
  }

  // 测试套件 2：20种语言 × 术语冲突 + 多批次测试
  console.log('\n【套件2】20种语言 × 术语冲突 + 多批次测试（15 条/批次）')
  for (const lang of ALL_LANGUAGES) {
    testCount++
    console.log(`  [${testCount}] 术语冲突 + 多批次 - ${lang}...`)

    const langPairs = allPairsByLang[lang] || []
    let texts: string[]
    let refs: string[]

    if (langPairs.length >= 10) {
      // 有真实 CSV 数据，使用真实数据
      const { conflictTexts, conflictRefs } = generateExtremeTexts(langPairs)
      if (conflictTexts.length > 0) {
        texts = conflictTexts
        refs = conflictRefs
      } else {
        // 真实数据不足，使用硬编码
        texts = HARDCODED_CONFLICT_TEXTS
        refs = HARDCODED_CONFLICT_TEXTS.map(() => '')
      }
    } else {
      // 无真实 CSV 数据，使用硬编码
      console.log(`    ℹ️  ${lang} 无真实 CSV 数据，使用硬编码冲突文本`)
      texts = HARDCODED_CONFLICT_TEXTS
      refs = HARDCODED_CONFLICT_TEXTS.map(() => '')
    }

    const result = await runTest(
      `术语冲突 + 多批次 - ${lang}`,
      texts,
      refs,
      lang,
      glossaries[lang] || new Map(),
      true,
    )
    results.push(result)
    console.log(`    ${result.passed ? '✅' : '❌'} ${result.errors.length} 错误, ${result.warnings.length} 警告`)
    console.log(`    得分: ${result.score.toFixed(1)}/100, 耗时: ${result.duration}ms`)
  }

  // 测试报告
  console.log('\n=== 测试报告 ===\n')
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0)
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length

  console.log(`总计: ${results.length} 个测试`)
  console.log(`通过: ${passed} (${(passed / results.length * 100).toFixed(1)}%)`)
  console.log(`失败: ${failed} (${(failed / results.length * 100).toFixed(1)}%)`)
  console.log(`错误: ${totalErrors}`)
  console.log(`警告: ${totalWarnings}`)
  console.log(`平均得分: ${avgScore.toFixed(1)}/100`)
  console.log(`平均耗时: ${avgDuration.toFixed(0)}ms`)

  if (failed > 0) {
    console.log('\n=== 失败详情 ===')
    for (const r of results.filter(r => !r.passed)) {
      console.log(`\n❌ ${r.name} (${r.lang})`)
      for (const err of r.errors) {
        console.log(`  - ${err}`)
      }
    }
  }

  if (totalWarnings > 0) {
    console.log('\n=== 警告详情（前 10 条）===')
    let count = 0
    for (const r of results.filter(r => r.warnings.length > 0)) {
      if (count >= 10) break
      console.log(`\n⚠️  ${r.name} (${r.lang})`)
      for (const warn of r.warnings.slice(0, 3)) {
        console.log(`  - ${warn}`)
      }
      count++
    }
  }

  console.log('\n=== 按语言统计 ===')
  for (const lang of ALL_LANGUAGES) {
    const langResults = results.filter(r => r.lang === lang)
    const langPassed = langResults.filter(r => r.passed).length
    const langAvgScore = langResults.length > 0
      ? (langResults.reduce((sum, r) => sum + r.score, 0) / langResults.length).toFixed(1)
      : 'N/A'
    console.log(`  ${lang}: ${langPassed}/${langResults.length} 通过, 平均得分: ${langAvgScore}/100`)
  }

  // 示例对比（前 3 条）
  console.log('\n=== 示例对比（前 3 条）===')
  let sampleCount = 0
  for (const r of results) {
    for (const c of r.comparisons) {
      if (sampleCount >= 3) break
      console.log(`\n${r.name} - ${r.lang}:`)
      console.log(`  源文: ${c.source.slice(0, 100)}`)
      console.log(`  参考: ${c.reference.slice(0, 100)}`)
      console.log(`  AI:   ${c.ai.slice(0, 100)}`)
      console.log(`  得分: ${c.score}/100`)
      if (c.issues.length > 0) {
        for (const issue of c.issues) {
          console.log(`    - ${issue}`)
        }
      }
      sampleCount++
    }
  }

  if (failed === 0) {
    console.log('\n✅ 所有极端压力测试通过！')
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
