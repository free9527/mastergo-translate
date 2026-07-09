/**
 * 验证品牌注入修复是否解决 vi 测试用例 36 的问题
 *
 * 测试场景：源文无 Lexar，术语库有 Lexar，LLM 按术语库翻译添加 Lexar
 * 期望：不被误杀为品牌注入
 */

import { detectBrandInjection } from '../lib/post-process'

console.log('=== vi 测试用例 36 场景验证 ===\n')

// 模拟测试用例 36 的真实场景
const sourceTexts = [
  'The PLAY PRO microSDXC™ Express Card is backwards-compatible with UHS-I and UHS-II host devices',
]

// LLM 按术语库翻译，添加了 "Lexar"（术语库定义的品牌词）
const translatedTexts = [
  'Thẻ Lexar PLAY PRO microSDXC Express tương thích ngược với các thiết bị chủ UHS-I và UHS-II',
]

// 术语库：源文有 Lexar，译文也有 Lexar
const glossary = new Map([
  ['Lexar PLAY PRO microSDXC Express Card', 'Thẻ Lexar PLAY PRO microSDXC Express'],
])

console.log('源文:', sourceTexts[0])
console.log('译文:', translatedTexts[0])
console.log('术语库:', [...glossary.entries()].map(([k, v]) => `${k} → ${v}`).join(', '))
console.log()

const result = detectBrandInjection(sourceTexts, translatedTexts, glossary)

if (result.injectedIndices.size === 0) {
  console.log('✅ 通过：LLM 按术语库添加 Lexar 不被误杀')
  console.log('译文:', result.texts[0])
  process.exit(0)
} else {
  console.log('❌ 失败：LLM 按术语库添加 Lexar 被误杀')
  console.log('误杀索引:', [...result.injectedIndices])
  console.log('回退结果:', result.texts[0])
  process.exit(1)
}
