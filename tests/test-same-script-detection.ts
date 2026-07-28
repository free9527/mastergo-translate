/**
 * 验证同语系漏翻检测修复（v8.5）
 * 运行：npx tsx tests/test-same-script-detection.ts
 *
 * 测试场景：
 * 1. CN→TW 源文=译文（完全相同）→ 应被检测为漏翻
 * 2. CN→TW 译文只加了引号 → 应被检测为漏翻（normalize 剥离引号）
 * 3. CN→TW 译文有实质性转换 → 不应被检测
 * 4. 非 CN→TW 场景不受影响
 */
import { detectUntranslatedText } from '../lib/llm-api'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}: ${(e as Error).message}`)
    failed++
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

console.log('\n=== 同语系漏翻检测测试 ===\n')

// ── Case 1: 源文=译文（完全相同）──
console.log(‘\n【Case 1: CN→TW 源文=译文】’)

test(‘"防磁" → "防磁" (CN→TW) 不应被检测为漏翻（同语系变体放宽检测）’, () => {
  const detected = detectUntranslatedText([‘防磁’], [‘防磁’], ‘zh-TW’, new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

test(‘"防摔" → "防摔" (CN→TW) 不应被检测为漏翻（同语系变体放宽检测）’, () => {
  const detected = detectUntranslatedText([‘防摔’], [‘防摔’], ‘zh-TW’, new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

test(‘"读取速度" → "读取速度" (CN→TW) 不应被检测为漏翻（同语系变体放宽检测）’, () => {
  const detected = detectUntranslatedText([‘读取速度’], [‘读取速度’], ‘zh-TW’, new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

// ── Case 2: 译文只加了引号 ──
console.log(‘\n【Case 2: CN→TW 译文只加了引号】’)

test(‘"防摔" → ""防摔"" (CN→TW) 不应被检测为漏翻（同语系变体放宽检测）’, () => {
  const detected = detectUntranslatedText([‘防摔’], [‘"防摔"’], ‘zh-TW’, new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

test(‘"防磁" → "’防磁’" (CN→TW) 不应被检测为漏翻（同语系变体放宽检测）’, () => {
  const detected = detectUntranslatedText([‘防磁’], [‘’防磁’’], ‘zh-TW’, new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

test(‘"防摔" → "「防摔」" (CN→TW) 不应被检测为漏翻（同语系变体放宽检测）’, () => {
  const detected = detectUntranslatedText([‘防摔’], [‘「防摔」’], ‘zh-TW’, new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

// ── Case 3: 译文有实质性转换（合法翻译）──
console.log('\n【Case 3: CN→TW 译文有实质性转换】')

test('"读取速度" → "讀取速度" (CN→TW) 不应被检测', () => {
  const detected = detectUntranslatedText(['读取速度'], ['讀取速度'], 'zh-TW', new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

test('"防磁" → "防磁" (CN→TW) 不应被检测（同语系变体放宽）', () => {
  const detected = detectUntranslatedText(['防磁'], ['防磁'], 'zh-TW', new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

// ── Case 4: 非 CN→TW 场景不受影响 ──
console.log('\n【Case 4: 非 CN→TW 场景不受影响】')

test('"High Speed" → "High Speed" (EN→FR) 应被检测为漏翻', () => {
  const detected = detectUntranslatedText(['High Speed'], ['High Speed'], 'fr', new Map())
  assert(detected.size === 1, `期望检测到漏翻，实际 size=${detected.size}`)
})

test('"High Speed" → "Haute vitesse" (EN→FR) 不应被检测', () => {
  const detected = detectUntranslatedText(['High Speed'], ['Haute vitesse'], 'fr', new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

test('"防磁" → "防磁" (CN→JA) 不应被检测（不同语言对）', () => {
  // CN→JA 不是同语系语言对，维度1会检测（归一化后相同）
  const detected = detectUntranslatedText(['防磁'], ['防磁'], 'ja', new Map())
  assert(detected.size === 1, `期望检测到漏翻，实际 size=${detected.size}`)
})

// ── Case 5: 品牌名/产品型号豁免 ──
console.log('\n【Case 5: 品牌名/产品型号豁免】')

test('"Lexar NM790" → "Lexar NM790" (CN→TW) 不应被检测（产品型号）', () => {
  const detected = detectUntranslatedText(['Lexar NM790'], ['Lexar NM790'], 'zh-TW', new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

test('"4TB" → "4TB" (CN→TW) 不应被检测（容量单位）', () => {
  const detected = detectUntranslatedText(['4TB'], ['4TB'], 'zh-TW', new Map())
  assert(detected.size === 0, `不应检测到漏翻，实际 size=${detected.size}`)
})

// ── 汇总 ──
console.log(`\n=== 测试结果 ===`)
console.log(`通过: ${passed}`)
console.log(`失败: ${failed}`)
console.log(`总计: ${passed + failed}`)

if (failed > 0) {
  console.log('\n❌ 测试失败')
  process.exit(1)
} else {
  console.log('\n✅ 所有测试通过')
}
