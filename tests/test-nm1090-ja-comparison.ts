/**
 * NM1090 PRO JA 翻译质量完整对比测试
 * 使用真实 CSV 数据：EN 源文 + JA 参考译文 + LLM 译文
 * 对比分析：LLM 翻译质量 vs 检测误判
 *
 * JA 是 CJK 语言，特征字符检测应该很强，误判应该很少。
 * 这个测试作为对照组。
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

// 从 NM1090 PRO CSV 提取的完整测试数据（EN 源文 + JA 参考译文）
const TEST_DATA = [
  {
    en: 'Performance for the Next Level\nLexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    ja: '次のレベルを実現するパフォーマンス\nLexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
  },
  {
    en: 'DRAM Cache SLC Dynamic Cache\n\n4K Random Read Up to 2100K IOPS\n\nGen5 SSD\nAccelerate Load Times by up to 200%\n\nUp to 4TB\n\nHeat-Defying 6nm Controller\n\nLexar DiskMaster Easy Drive Management\n\n5 Years Service\n\n',
    ja: 'DRAMキャッシュ SLCダイナミックキャッシュ\n\n4Kランダムリード 最大2100K IOPS\n\nGen5 SSD\nロード時間を最大200%加速\n\n最大4TB\n\n熱に強い6nmコントローラー\n\nLexar DiskMasterによる容易なドライブ管理\n\n5年保証',
  },
  {
    en: 'Accelerate Load Times by up to 200%*\nExperience blistering read/write speeds up to 14,000/13,000MB/s* thanks to a combination of PCIe 5.0 technology and next-gen 232-layer 3D TLC NAND.\n\n\n*Speeds based on internal testing. Actual performance may vary.',
    ja: 'ロード時間を最大200%加速*\nPCIe 5.0テクノロジーと次世代232層3D TLC NANDの組み合わせにより、最大14,000/13,000MB/s*の超高速読み書きを実現。\n\n\n*速度は内部テストに基づくものです。実際のパフォーマンスは異なる場合があります。',
  },
  {
    en: 'An Unmatched AMD Partner\nThe NM1090 PRO is the perfect match for AMD Ryzen 9000 series CPUs. It not only delivers extreme storage and computing performance but also ensures fast game loading and smooth operation. It is the ideal choice for users who seek a high-performance gaming experience.\n\n\n',
    ja: '比類なきAMDパートナー\nNM1090 PROはAMD Ryzen 9000シリーズCPUに最適なマッチです。極限のストレージ・コンピューティング性能を提供するだけでなく、ゲームの高速ロードとスムーズな動作を保証します。ハイパフォーマンスなゲーミング体験を求めるユーザーに最適な選択です。',
  },
  {
    en: 'Heat-Defying 6nm Controller\n\nOffers advanced performance and simultaneously achieves better power management. The controller\'s temperature is reduced by 38%*, ensuring that the hard drive remains cool during high-load operation and provides a smoother performance experience.\n\n\nBIT Running for 30 Minutes Later\nTemperature Comparison with Other Gen 5 SSDs\n\nController Temperature Reduction\nS.M.A.R.T. Temperature Reduction\n\n* Based on internal testing. Actual performance may vary.',
    ja: '熱に強い6nmコントローラー\n\n高度なパフォーマンスを提供すると同時に、優れた電力管理を実現。コントローラーの温度を38%*低減し、高負荷動作時でもドライブを冷却状態に保ち、よりスムーズなパフォーマンス体験を提供します。\n\n\nBIT 30分稼働後\n他のGen5 SSDとの温度比較\n\nコントローラー温度低減\nS.M.A.R.T. 温度低減\n\n*内部テストに基づくものです。実際のパフォーマンスは異なる場合があります。',
  },
  {
    en: 'Ultra-fast Response Blazing Speed\n4K Random Reads Up to 2100K IOPS*, significantly speeds up system response and application loading times, especially enhancing efficiency in multitasking and video editing, providing gamers with a smoother experience.\n\n* Speeds based on internal testing. Actual performance may vary.',
    ja: '超高速レスポンス 驚異的なスピード\n4Kランダムリード最大2100K IOPS*により、システムレスポンスとアプリケーションのロード時間を大幅に高速化。マルチタスクや動画編集の効率を特に向上させ、ゲーマーによりスムーズな体験を提供します。\n\n*速度は内部テストに基づくものです。実際のパフォーマンスは異なる場合があります。',
  },
  {
    en: 'A State-of-the-Art Experience\nDRAM Cache and SLC Dynamic Cache greatly enhance data transfer speeds to reduce wait times and improve system responsiveness.\n\nDram Capacity',
    ja: '最先端の体験\nDRAMキャッシュとSLCダイナミックキャッシュがデータ転送速度を大幅に向上させ、待ち時間を短縮し、システムの応答性を改善します。\n\nDRAM容量',
  },
  {
    en: 'Up to 4TB\n\nOffers 1TB/2TB/4TB storage options. Easily handles OS, large games, and UHD/8K media storage needs, meeting the high demand for SSD capacity in the AIPC era.\n\nHigh-quality chips ensure ample storage design, offering gamers more space\nActual usable capacity\nA non-full capacity 4TB SSD\nNM1090 PRO 4TB\n\n* Based on internal testing. Actual performance may vary.',
    ja: '最大4TB\n\n1TB/2TB/4TBのストレージオプションを提供。OS、大型ゲーム、UHD/8Kメディアのストレージニーズを簡単に処理し、AIPC時代におけるSSD容量の高い需要に応えます。\n\n高品質チップが十分なストレージ設計を保証し、ゲーマーにさらに多くのスペースを提供\n実際の使用可能容量\nフル容量ではない4TB SSD\nNM1090 PRO 4TB\n\n*内部テストに基づくものです。実際のパフォーマンスは異なる場合があります。',
  },
  {
    en: 'Compatible with Microsoft DirectStorage \nBuilt to leverage Microsoft DirectStorage3 and significantly boost game loads, minimize delays, conserve CPU power, and enrich the gaming experience.',
    ja: 'Microsoft DirectStorage対応\nMicrosoft DirectStorage3を活用して構築され、ゲームロードを大幅に高速化、遅延を最小化、CPU電力を節約し、ゲーミング体験を豊かにします。',
  },
  {
    en: 'Unleashing ultimate performance\nPaired with the latest AMD and Intel CPUs and PCIe 5.0 motherboards, it achieves the perfect match for ultimate performance. It is also backward compatible with PCIe 3.0 and PCIe 4.0 systems to ensure extensive applicability.',
    ja: '究極のパフォーマンスを解き放つ\n最新のAMDおよびIntel CPUとPCIe 5.0マザーボードと組み合わせ、究極のパフォーマンスのための完璧なマッチを実現。PCIe 3.0およびPCIe 4.0システムとも下位互換し、広範な適用性を確保します。',
  },
  {
    en: 'Lexar DiskMaster\nFirmware upgrades\nHealth monitoring\nPerformance optimization\nData security',
    ja: 'Lexar DiskMaster\nファームウェアアップグレード\nヘルスモニタリング\nパフォーマンス最適化\nデータセキュリティ',
  },
  {
    en: 'Unleash the Gaming Power\nSupport Microsoft DirectStorage technology significantly reduces game load time.',
    ja: 'ゲーミングパワーを解き放つ\nMicrosoft DirectStorage技術対応により、ゲームロード時間を大幅に短縮。',
  },
  {
    en: 'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
    ja: '新しいクリエイティブ体験\nレンダリング速度を向上させ、アイデアを瞬時に現実に。',
  },
  {
    en: 'Ultimate Performance for AIPC\nMeets AIPC\'s high-end demands with exceptional performance and vast capacity.',
    ja: 'AIPCのための究極のパフォーマンス\n卓越したパフォーマンスと豊富な容量で、AIPCのハイエンドな要求に応えます。',
  },
  {
    en: '5 Years Service\n',
    ja: '5年保証',
  },
]

// 模拟术语库（从 CSV 推断 - JA 版本）
const glossaryMap = new Map<string, string>([
  ['Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD', 'Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD'],
  ['Lexar', 'Lexar'],
  ['SSD', 'SSD'],
  ['NM1090 PRO', 'NM1090 PRO'],
  ['PCIe 5.0', 'PCIe 5.0'],
  ['NVMe', 'NVMe'],
  ['DRAM Cache', 'DRAMキャッシュ'],
  ['SLC Cache', 'SLCキャッシュ'],
  ['Read Speed', 'リード速度'],
  ['Write Speed', 'ライト速度'],
  ['IOPS', 'IOPS'],
  ['Gen5 SSD', 'Gen5 SSD'],
  ['Heat-Defying 6nm Controller', '熱に強い6nmコントローラー'],
  ['Lexar DiskMaster', 'Lexar DiskMaster'],
  ['Backward Compatible', '下位互換'],
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

/**
 * 分析日文字符占比（假名 + 汉字）
 */
function analyzeJapaneseFeatures(text: string): {
  hiraganaCount: number
  katakanaCount: number
  cjkCount: number
  asciiCount: number
  totalLength: number
  japaneseRatio: number
} {
  let hiraganaCount = 0
  let katakanaCount = 0
  let cjkCount = 0
  let asciiCount = 0

  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 0x3040 && code <= 0x309F) hiraganaCount++
    else if (code >= 0x30A0 && code <= 0x30FF) katakanaCount++
    else if (code >= 0x4E00 && code <= 0x9FFF) cjkCount++
    else if (code >= 0x20 && code <= 0x7E) asciiCount++
  }

  const totalLength = text.length
  const japaneseRatio = totalLength > 0 ? (hiraganaCount + katakanaCount + cjkCount) / totalLength : 0

  return { hiraganaCount, katakanaCount, cjkCount, asciiCount, totalLength, japaneseRatio }
}

async function main() {
  console.log('=== NM1090 PRO JA 翻译质量完整对比测试 ===')
  console.log(`测试文本数: ${TEST_DATA.length}`)
  console.log('注: JA 是 CJK 语言，特征字符检测应该很强，误判应该很少')

  const sources = TEST_DATA.map(t => t.en)
  const references = TEST_DATA.map(t => t.ja)
  const glossaryLower = new Set([...glossaryMap.keys()].map(k => k.toLowerCase()))

  // 1. 分析参考译文的英文占比（buggy vs fixed）+ 日文字符特征
  console.log('\n--- 参考译文分析（对比 buggy vs fixed 逻辑 + 日文特征）---')
  for (let i = 0; i < references.length; i++) {
    const ref = references[i]
    const buggy = analyzeWithBuggyLogic(ref, glossaryLower)
    const fixed = analyzeWithFixedLogic(ref, glossaryLower)
    const jaFeatures = analyzeJapaneseFeatures(ref)

    console.log(`\n[${i}] 源文: "${sources[i].slice(0, 50).replace(/\n/g, '\\n')}..."`)
    console.log(`  参考译文: "${ref.slice(0, 80).replace(/\n/g, '\\n')}..."`)
    console.log(`  日文特征: ひらがな=${jaFeatures.hiraganaCount} カタカナ=${jaFeatures.katakanaCount} 漢字=${jaFeatures.cjkCount} ASCII=${jaFeatures.asciiCount} 日文占比=${(jaFeatures.japaneseRatio * 100).toFixed(1)}%`)
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
    'ja',
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
  const untranslated = detectUntranslatedText(sources, llmResults, 'ja', glossaryMap)

  // 4. 对比分析
  console.log('\n\n--- LLM 译文 vs 参考译文对比 ---')
  for (let i = 0; i < llmResults.length; i++) {
    const src = sources[i]
    const ref = references[i]
    const llm = llmResults[i]
    const isFlagged = untranslated.has(i)

    const buggy = analyzeWithBuggyLogic(llm, glossaryLower)
    const fixed = analyzeWithFixedLogic(llm, glossaryLower)
    const jaFeatures = analyzeJapaneseFeatures(llm)

    console.log(`\n[${i}] ${isFlagged ? '❌ 被标记漏翻' : '✅ 通过'}`)
    console.log(`  源文: "${src.slice(0, 60).replace(/\n/g, '\\n')}..."`)
    console.log(`  参考译文: "${ref.slice(0, 80).replace(/\n/g, '\\n')}..."`)
    console.log(`  LLM译文: "${llm.slice(0, 80).replace(/\n/g, '\\n')}..."`)
    console.log(`  日文特征: ひらがな=${jaFeatures.hiraganaCount} カタカナ=${jaFeatures.katakanaCount} 漢字=${jaFeatures.cjkCount} ASCII=${jaFeatures.asciiCount} 日文占比=${(jaFeatures.japaneseRatio * 100).toFixed(1)}%`)
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
      const jaFeatures = analyzeJapaneseFeatures(llm)

      if (buggy.englishRatio > 0.5 && fixed.englishRatio <= 0.5) {
        buggyBugCount++
        console.log(`  [${idx}] 🔴 正则 bug 误判 (buggy=${(buggy.englishRatio * 100).toFixed(1)}% → fixed=${(fixed.englishRatio * 100).toFixed(1)}%)`)
      } else {
        realUntranslated++
        console.log(`  [${idx}] 🟡 可能是真实漏翻 (buggy=${(buggy.englishRatio * 100).toFixed(1)}%, fixed=${(fixed.englishRatio * 100).toFixed(1)}%, 日文占比=${(jaFeatures.japaneseRatio * 100).toFixed(1)}%)`)
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

  // 8. CJK 特征检测总结
  console.log('\n\n--- CJK 特征检测总结 ---')
  let cjkPassCount = 0
  let cjkFailCount = 0
  for (let i = 0; i < llmResults.length; i++) {
    const llm = llmResults[i]
    const jaFeatures = analyzeJapaneseFeatures(llm)
    const featureCheck = detectTargetLanguageFeatures(llm, 'ja')
    const isFlagged = untranslated.has(i)

    if (jaFeatures.japaneseRatio > 0.3) {
      cjkPassCount++
    } else {
      cjkFailCount++
    }
    console.log(`  [${i}] 日文占比=${(jaFeatures.japaneseRatio * 100).toFixed(1)}% featureCheck.hasFeatures=${featureCheck.hasFeatures} flagged=${isFlagged}`)
  }
  console.log(`\n  CJK 特征充足 (>30%): ${cjkPassCount}`)
  console.log(`  CJK 特征不足 (<30%): ${cjkFailCount}`)
}

main().catch(console.error)
