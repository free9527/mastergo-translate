/**
 * 术语库诊断测试
 *
 * 诊断术语遮蔽 → LLM 翻译 → 占位符还原的全链路
 *
 * 使用方法：
 *   npx tsx test-results/test-glossary-diagnosis.ts
 */

// Node.js 环境没有 XMLHttpRequest，用 xhr2 polyfill 补上
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { maskGlossaryTerms, unmaskGlossaryTerms } from '../lib/entity-masker'
import { translateBatch } from '../lib/llm-api'
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
  enableProofread: false,
  proofreadApiKey: API_KEY,
  proofreadApiUrl: API_URL,
  proofreadModel: MODEL,
}

// ============================================================
// 测试用例
// ============================================================

const testCases = [
  {
    name: '单术语',
    texts: ['Lexar PLAY PRO microSDXC Express Card'],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
    ]),
  },
  {
    name: '多术语',
    texts: [
      'Lexar PLAY PRO microSDXC Express Card',
      'Read speed up to 900MB/s',
      'Lexar ARMOR GOLD SD Card',
    ],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
      ['Read speed', '读取速度'],
      ['Lexar ARMOR GOLD SD Card', 'Lexar ARMOR GOLD SD 存储卡'],
    ]),
  },
  {
    name: '术语+普通文本',
    texts: ['Power Up Your Play with Lexar PLAY PRO microSDXC Express Card'],
    glossary: new Map([
      ['Lexar PLAY PRO microSDXC Express Card', 'Lexar PLAY PRO microSDXC Express 存储卡'],
    ]),
  },
]

// ============================================================
// 诊断流程
// ============================================================

async function diagnose() {
  console.log('=== 术语库诊断测试 ===\n')

  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`测试: ${testCase.name}`)
    console.log(`${'='.repeat(60)}`)

    console.log('\n【1】原始文本:')
    testCase.texts.forEach((t, i) => console.log(`  [${i}] ${t}`))

    console.log('\n【2】术语表:')
    for (const [k, v] of testCase.glossary.entries()) {
      console.log(`  "${k}" → "${v}"`)
    }

    // 术语遮蔽
    console.log('\n【3】术语遮蔽后 (maskGlossaryTerms):')
    const { texts: maskedTexts, termMap } = maskGlossaryTerms(testCase.texts, testCase.glossary)
    maskedTexts.forEach((t, i) => console.log(`  [${i}] ${t}`))

    console.log('\n【4】占位符映射 (termMap):')
    for (const [placeholder, target] of termMap.entries()) {
      console.log(`  ${placeholder} → "${target}"`)
    }

    // LLM 翻译
    console.log('\n【5】LLM 翻译 (translateBatch):')
    try {
      const translated = await translateBatch(
        testCase.texts,
        'zh-CN',
        testCase.glossary,
        config,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      )

      translated.forEach((t, i) => console.log(`  [${i}] ${t}`))

      // 占位符还原
      console.log('\n【6】占位符还原后 (unmaskGlossaryTerms):')
      const { texts: unmaskedTexts, missingIndices } = unmaskGlossaryTerms(translated, termMap)
      unmaskedTexts.forEach((t, i) => console.log(`  [${i}] ${t}`))

      if (missingIndices.size > 0) {
        console.log('\n【7】❌ 缺失占位符的索引:')
        for (const idx of missingIndices) {
          console.log(`  [${idx}] 原始: ${testCase.texts[idx]}`)
          console.log(`       LLM输出: ${translated[idx]}`)
        }
      } else {
        console.log('\n【7】✅ 所有占位符都成功还原')
      }

      // 检查是否包含 ZZ 占位符（说明 LLM 保留了）
      console.log('\n【8】检查 LLM 输出中的占位符:')
      translated.forEach((t, i) => {
        const hasZZ = /ZZ\d+ZZ/i.test(t)
        const hasYY = /YY\d+YY/i.test(t)
        if (hasZZ || hasYY) {
          console.log(`  [${i}] ✅ 包含占位符: ${t}`)
        } else {
          console.log(`  [${i}] ❌ 不包含占位符: ${t}`)
        }
      })

    } catch (error) {
      console.log(`  ❌ 翻译失败: ${error.message}`)
    }
  }
}

diagnose().catch(err => {
  console.error('诊断失败:', err)
  process.exit(1)
})
