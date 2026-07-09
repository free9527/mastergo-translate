/**
 * 快速验证测试：品牌注入误杀修复
 *
 * 验证 detectBrandInjection 的词边界修复是否有效
 * 重点测试 vi 语言中的 "play" 子串误匹配问题
 */

import { detectBrandInjection } from '../lib/post-process'

console.log('=== 品牌注入误杀修复验证 ===\n')

// 测试用例 1：vi 语言中的 "play" 子串（应该通过，不被误杀）
const viSourceTexts = [
  'Thanks to its next-gen tech of PCIe and NVMe interface technologies that deliver',
  'Up to 900MB/s* read speed, the PLAY PRO microSDXC™ Express Card is a stunning 4x',
]

const viTranslatedTexts = [
  'Nhờ công nghệ thế hệ mới với các công nghệ giao diện PCIe và NVMe mang lại tốc độ đọc lên đến',
  'Với tốc độ đọc lên đến 900MB/s*, Thẻ Lexar PLAY PRO microSDXC Express nhanh hơn',
]

const viGlossary = new Map([
  ['Lexar PLAY PRO microSDXC Express Card', 'Thẻ Lexar PLAY PRO microSDXC Express'],
])

console.log('测试 1：vi 语言中的 "play" 子串')
console.log('源文:', viSourceTexts[0])
console.log('译文:', viTranslatedTexts[0])

const viResult = detectBrandInjection(viSourceTexts, viTranslatedTexts, viGlossary)

if (viResult.injectedIndices.size === 0) {
  console.log('✅ 通过：未被误杀为品牌注入\n')
} else {
  console.log('❌ 失败：仍被误杀为品牌注入')
  console.log('误杀索引:', [...viResult.injectedIndices])
  console.log('回退结果:', viResult.texts[0], '\n')
}

// 测试用例 2：真正的品牌注入（应该被检测到）
const enSourceTexts = [
  'High-speed storage solution',
]

const enInjectedTexts = [
  'Lexar PLAY PRO high-speed storage solution',  // 注入了 Lexar 和 PLAY PRO
]

console.log('测试 2：真正的品牌注入')
console.log('源文:', enSourceTexts[0])
console.log('注入译文:', enInjectedTexts[0])

const enResult = detectBrandInjection(enSourceTexts, enInjectedTexts)

if (enResult.injectedIndices.size > 0) {
  console.log('✅ 通过：正确检测到品牌注入')
  console.log('检测到索引:', [...enResult.injectedIndices])
  console.log('回退结果:', enResult.texts[0], '\n')
} else {
  console.log('❌ 失败：未能检测到真正的品牌注入\n')
}

// 测试用例 3：源文包含品牌词（应该通过）
const enSourceWithBrand = [
  'Lexar PLAY PRO microSDXC Express Card',
]

const enTranslatedWithBrand = [
  'Lexar PLAY PRO microSDXC Express Card',
]

console.log('测试 3：源文包含品牌词')
console.log('源文:', enSourceWithBrand[0])
console.log('译文:', enTranslatedWithBrand[0])

const enBrandResult = detectBrandInjection(enSourceWithBrand, enTranslatedWithBrand)

if (enBrandResult.injectedIndices.size === 0) {
  console.log('✅ 通过：源文包含品牌词时不被误杀\n')
} else {
  console.log('❌ 失败：源文包含品牌词时仍被误杀\n')
}

// 总结
const allPassed = viResult.injectedIndices.size === 0 &&
                  enResult.injectedIndices.size > 0 &&
                  enBrandResult.injectedIndices.size === 0

if (allPassed) {
  console.log('✅ 所有测试通过！品牌注入误杀修复有效')
  process.exit(0)
} else {
  console.log('❌ 部分测试失败')
  process.exit(1)
}
