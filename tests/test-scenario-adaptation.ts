/**
 * 多场景适配测试 v2
 * 修复测试用例的精确匹配问题，聚焦真实 bug
 */

import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { translateBatch, detectUntranslatedText } from '../lib/llm-api'
import { LLMConfig } from '../messages/types'

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
const MODEL = 'gpt-5.5'

const config: LLMConfig = {
  apiKey: API_KEY,
  apiUrl: API_URL,
  model: MODEL,
  translationStyle: 'standard',
  translationStyleCustom: '',
  scenePreset: 'ecommerce',
  manualProductLine: undefined,
  enableProofread: false,
  proofreadApiKey: API_KEY,
  proofreadApiUrl: API_URL,
  proofreadModel: MODEL,
}

// ============================================================
// 测试用例 v2 - 更精确的验证
// ============================================================

interface TestCase {
  name: string
  sourceLang: string
  targetLang: string
  texts: string[]
  validate: (src: string[], trans: string[]) => { passed: boolean; errors: string[] }
}

const testCases: TestCase[] = [
  // ── 场景1: CN→TW 简繁转换 ──
  {
    name: 'CN→TW: 简繁转换 + 台湾用语',
    sourceLang: 'zh-CN',
    targetLang: 'zh-TW',
    texts: ['高速固态硬盘', '支持PCIe 4.0协议'],
    validate: (src, trans) => {
      const errors: string[] = []
      // "硬盘" 台湾应译为 "硬碟"（不是"硬盤"）
      if (trans.some(t => t.includes('硬盤'))) errors.push('"硬盘"应转为台湾用法"硬碟"')
      // "协议" 台湾应译为 "協定"（不是"協議"）
      if (trans.some(t => t.includes('協議'))) errors.push('"协议"应转为台湾用法"協定"')
      // 至少有部分繁体特征（态→態, 盘→碟, 协→協 等）
      const allText = trans.join('')
      const hasTraditional = /[態碟協議讀速條幀為後優]/.test(allText)
      if (!hasTraditional) errors.push('未检测到繁体字转换')
      return { passed: errors.length === 0, errors }
    },
  },
  {
    name: 'CN→TW: 简繁相同字不应被误判',
    sourceLang: 'zh-CN',
    targetLang: 'zh-TW',
    texts: ['防磁', '防摔'],
    validate: (src, trans) => {
      const errors: string[] = []
      // "防磁" 和 "防摔" 简繁写法相同，LLM 应原样返回
      // 关键是漏翻检测不应误报
      const detected = detectUntranslatedText(src, trans, 'zh-TW', new Map())
      if (detected.size > 0) errors.push(`漏翻检测误报: ${JSON.stringify(Array.from(detected))}`)
      return { passed: errors.length === 0, errors }
    },
  },

  // ── 场景2: PT→PT-BR 变体转换 ──
  {
    name: 'PT→PT-BR: 词汇差异',
    sourceLang: 'pt',
    targetLang: 'pt-BR',
    texts: ['O portátil é muito rápido', 'Utilizar o dispositivo'],
    validate: (src, trans) => {
      const errors: string[] = []
      // "portátil" 在巴西更常用 "notebook"
      // "Utilizar" 在巴西更常用 "Usar"
      const allText = trans.join(' ').toLowerCase()
      if (allText.includes('portátil')) errors.push('PT→PT-BR: "portátil"应转为巴西用法"notebook"')
      const detected = detectUntranslatedText(src, trans, 'pt-BR', new Map())
      if (detected.size > 0) errors.push(`漏翻检测误报: ${JSON.stringify(Array.from(detected))}`)
      return { passed: errors.length === 0, errors }
    },
  },

  // ── 场景3: FR→ES ──
  {
    name: 'FR→ES: 法语译成西班牙语',
    sourceLang: 'fr',
    targetLang: 'es',
    texts: ['Le disque SSD est très rapide', 'Vitesse de lecture élevée'],
    validate: (src, trans) => {
      const errors: string[] = []
      // 不应保留法语特征词
      const allText = trans.join(' ').toLowerCase()
      if (allText.includes('très') || allText.includes('disque')) {
        errors.push('译文中保留了法语词汇')
      }
      // 应包含西班牙语功能词（es, la, de, muy 等）
      if (!/es|la|muy|de|del/i.test(allText)) {
        errors.push('译文缺少西班牙语功能词')
      }
      // 关键：漏翻检测不应误报（"Alta velocidad de lectura" 是合法西班牙语）
      const detected = detectUntranslatedText(src, trans, 'es', new Map())
      if (detected.size > 0) {
        errors.push(`漏翻检测误报: 索引 ${JSON.stringify(Array.from(detected))}`)
        for (const idx of detected) {
          errors.push(`  源文: "${src[idx]}" → 译文: "${trans[idx]}"`)
        }
      }
      return { passed: errors.length === 0, errors }
    },
  },

  // ── 场景4: DE→IT ──
  {
    name: 'DE→IT: 德语译成意大利语',
    sourceLang: 'de',
    targetLang: 'it',
    texts: ['Die SSD ist sehr schnell', 'Lesegeschwindigkeit'],
    validate: (src, trans) => {
      const errors: string[] = []
      const allText = trans.join(' ').toLowerCase()
      // 不应保留德语特征词
      if (allText.includes('sehr') || allText.includes('schnell') || allText.includes('ist')) {
        errors.push('译文中保留了德语词汇')
      }
      // 应包含意大利语功能词
      if (!/è|di|molto|la|veloc/i.test(allText)) {
        errors.push('译文缺少意大利语特征')
      }
      const detected = detectUntranslatedText(src, trans, 'it', new Map())
      if (detected.size > 0) errors.push(`漏翻检测误报: ${JSON.stringify(Array.from(detected))}`)
      return { passed: errors.length === 0, errors }
    },
  },

  // ── 场景5: 混合语言 ──
  {
    name: '混合语言: EN夹杂FR→ES',
    sourceLang: 'en',
    targetLang: 'es',
    texts: ['The vitesse de lecture is very rapide'],
    validate: (src, trans) => {
      const errors: string[] = []
      const allText = trans.join(' ').toLowerCase()
      // 法语词应被翻译
      if (allText.includes('vitesse') || allText.includes('rapide')) {
        errors.push('混合文本中法语词未被翻译')
      }
      // 应全部是西班牙语
      if (!/velocidad|lectura|r[áa]pida/i.test(allText)) {
        errors.push('译文缺少西班牙语翻译')
      }
      const detected = detectUntranslatedText(src, trans, 'es', new Map())
      if (detected.size > 0) errors.push(`漏翻检测误报: ${JSON.stringify(Array.from(detected))}`)
      return { passed: errors.length === 0, errors }
    },
  },

  // ── 场景6: 西班牙语无声调句子（核心 bug 验证）──
  {
    name: 'ES: 无声调句子不应被误判（核心bug验证）',
    sourceLang: 'en',
    targetLang: 'es',
    texts: ['High speed reading', 'Fast data transfer', 'Solid state drive'],
    validate: (src, trans) => {
      const errors: string[] = []
      // 这些译文可能完全不包含 áéíóúñü
      // 例如 "Lectura de alta velocidad" 不含声调
      // 漏翻检测不应误报
      const detected = detectUntranslatedText(src, trans, 'es', new Map())
      if (detected.size > 0) {
        errors.push(`无声调西班牙语句子被误判为漏翻:`)
        for (const idx of detected) {
          errors.push(`  源文: "${src[idx]}" → 译文: "${trans[idx]}"`)
        }
      }
      return { passed: errors.length === 0, errors }
    },
  },
]

// ============================================================
// 执行
// ============================================================

async function runTest(tc: TestCase) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`测试: ${tc.name}`)
  console.log(`${'='.repeat(60)}`)
  console.log(`源: ${tc.sourceLang} → 目标: ${tc.targetLang}`)
  console.log(`源文: ${JSON.stringify(tc.texts)}`)

  try {
    const translations = await translateBatch(tc.texts, tc.targetLang, new Map(), config, tc.sourceLang)
    console.log(`译文: ${JSON.stringify(translations)}`)

    const { passed, errors } = tc.validate(tc.texts, translations)
    if (passed) {
      console.log(`✅ 通过`)
    } else {
      console.log(`❌ 失败:`)
      errors.forEach(e => console.log(`   ${e}`))
    }
    return { name: tc.name, passed, errors }
  } catch (error) {
    console.log(`❌ 异常: ${(error as Error).message}`)
    return { name: tc.name, passed: false, errors: [(error as Error).message] }
  }
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗')
  console.log('║       多场景适配测试 v2 - 精确验证                      ║')
  console.log('╚═══════════════════════════════════════════════════════════╝')

  const results = []
  for (const tc of testCases) {
    results.push(await runTest(tc))
  }

  console.log(`\n\n${'='.repeat(60)}`)
  console.log('汇总')
  console.log('='.repeat(60))

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  for (const r of results) {
    console.log(`${r.passed ? '✅' : '❌'} ${r.name}`)
  }

  console.log(`\n通过: ${passed}/${results.length}  失败: ${failed}/${results.length}`)

  if (failed > 0) process.exit(1)
  else console.log('\n✅ 全部通过')
}

main().catch(e => { console.error(e); process.exit(1) })
