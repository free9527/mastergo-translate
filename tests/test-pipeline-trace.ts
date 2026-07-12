/**
 * BIT Running 漏翻追踪测试
 * 端到端调用 translateBatch，全程打印管道状态
 */
import XMLHttpRequest from 'xhr2';
(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { translateBatch } from './lib/llm-api'
import { detectUntranslatedText, isUntranslatable } from './lib/llm-api'
import { normalizeText, DEBUG_MODE } from './lib/constants'

// 强制开启 debug 日志
(globalThis as any).DEBUG_MODE = true

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-FS2AGf1vcZU1OpIIho7nBd8bQGcm45nII6UlZAECxj5Iaamn'
const MODEL = 'qwen3.7-max'

// 模拟真实页面的文本集合（包含 BIT Running 和常见产品文本）
const TEXTS = [
  'Lexar® Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
  'BIT Running for 30 Minutes Later Temperature Comparison with Other Gen 5 SSDs',
  'Offers advanced performance and simultaneously achieves better power management',
  '4000GB',
  '700TBW',
  '4TB',
  'Lexar® PLAY PRO 1TB SSD',
]

// 模拟术语库
const glossaryMap = new Map<string, string>([
  ['Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD', 'Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD'],
  ['Lexar PLAY PRO 1TB SSD', 'Lexar PLAY PRO 1TB SSD'],
  ['Lexar', 'Lexar'],
  ['SSD', 'SSD'],
  ['PRO', 'PRO'],
])

async function main() {
  for (const targetLang of ['ja', 'vi', 'de']) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`测试语言: ${targetLang}`)
    console.log('='.repeat(60))

    // 译前检查
    console.log('\n--- 译前检查 ---')
    for (let i = 0; i < TEXTS.length; i++) {
      const txt = TEXTS[i]
      const untranslatable = isUntranslatable(txt, glossaryMap)
      console.log(`  [${i}] untranslatable=${untranslatable} "${txt.slice(0, 80)}"`)
    }

    const result = await translateBatch(
      TEXTS,
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
      undefined,
      undefined,
    )

    console.log('\n--- 翻译结果 ---')
    for (let i = 0; i < result.length; i++) {
      const src = TEXTS[i]
      const trans = result[i]
      const isSame = src === trans
      const normalizedSame = src.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase() ===
        trans.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
      const hasSourceReg = /[®™©]/.test(src)
      const hasTransReg = /[®™©]/.test(trans)
      console.log(`  [${i}] ${isSame ? '❌漏翻' : (normalizedSame ? '⚠️归一化相同' : '✅')} ${hasSourceReg && !hasTransReg ? '掉®' : ''} "${trans.slice(0, 100)}"`)
    }

    // 译后检测
    console.log('\n--- detectUntranslatedText ---')
    const untranslated = detectUntranslatedText(TEXTS, result, targetLang, glossaryMap)
    console.log(`  漏翻索引: ${untranslated.size > 0 ? [...untranslated].join(', ') : '无'}`)
  }
}

main().catch(console.error)
