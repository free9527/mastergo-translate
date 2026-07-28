/**
 * v8.7 单复数术语库豁免验证测试
 * 覆盖：pt-BR 单数豁免、zh-CN 不豁免、真漏翻仍判漏翻、复数原文原有行为、
 *       class/box/memory 词形边界、de 语 value 不同不误豁免
 */

import { isUntranslatable } from '../lib/llm-api'

// ═══════════════════════════════════════════════════════════
// 测试术语库（模拟 pt-BR / zh-CN / de 三种目标语言）
// ═══════════════════════════════════════════════════════════

// pt-BR: Drone/Tablet 与英文同形（source === target）
const ptBRGlossary = new Map<string, string>([
  ['Drones', 'Drones'],
  ['Tablets', 'Tablets'],
  ['Classes', 'Classes'],
  ['Boxes', 'Boxes'],
  ['Memories', 'Memórias'],  // 不同形：memory → memória（不应豁免单数）
])

// zh-CN: 无人机/平板电脑（不同形，不应豁免）
const zhCNGlossary = new Map<string, string>([
  ['Drones', '无人机'],
  ['Tablets', '平板电脑'],
])

// de: Drohnen/Tablets（不同形，不应豁免）
const deGlossary = new Map<string, string>([
  ['Drones', 'Drohnen'],
  ['Tablets', 'Tablets'],  // de: Tablet 是外来词，同形
])

let pass = 0
let fail = 0

function check(desc: string, actual: boolean, expected: boolean) {
  const ok = actual === expected
  if (ok) pass++; else fail++
  console.log(`${ok ? '✅' : '❌'} ${desc}: isUntranslatable = ${actual} (期望 ${expected})`)
}

console.log('═'.repeat(70))
console.log('场景 1: pt-BR 术语库（source === target 同形）')
console.log('═'.repeat(70))

// 复数原文（原有行为，应豁免）
check('pt-BR "Drones" (复数，术语库有)', isUntranslatable('Drones', ptBRGlossary), true)
check('pt-BR "Tablets" (复数，术语库有)', isUntranslatable('Tablets', ptBRGlossary), true)

// 单数原文（v8.7 新增豁免）
check('pt-BR "Drone" (单数，术语库只有复数)', isUntranslatable('Drone', ptBRGlossary), true)
check('pt-BR "Tablet" (单数，术语库只有复数)', isUntranslatable('Tablet', ptBRGlossary), true)

console.log('')
console.log('═'.repeat(70))
console.log('场景 2: zh-CN 术语库（不同形，不应豁免）')
console.log('═'.repeat(70))

// zh-CN 的 target 是中文，与源文不同 → 不应豁免
check('zh-CN "Drones" (复数，target=无人机)', isUntranslatable('Drones', zhCNGlossary), false)
check('zh-CN "Drone" (单数，target=无人机)', isUntranslatable('Drone', zhCNGlossary), false)
check('zh-CN "Tablets" (复数，target=平板电脑)', isUntranslatable('Tablets', zhCNGlossary), false)
check('zh-CN "Tablet" (单数，target=平板电脑)', isUntranslatable('Tablet', zhCNGlossary), false)

console.log('')
console.log('═'.repeat(70))
console.log('场景 3: de 术语库（部分同形、部分不同形）')
console.log('═'.repeat(70))

// de: Tablets 同形（豁免），Drohnen 不同形（不豁免）
check('de "Tablets" (复数，target=Tablets 同形)', isUntranslatable('Tablets', deGlossary), true)
check('de "Tablet" (单数，target=Tablets 同形)', isUntranslatable('Tablet', deGlossary), true)
check('de "Drones" (复数，target=Drohnen 不同形)', isUntranslatable('Drones', deGlossary), false)
check('de "Drone" (单数，target=Drohnen 不同形)', isUntranslatable('Drone', deGlossary), false)

console.log('')
console.log('═'.repeat(70))
console.log('场景 4: 词形还原边界（ies / es / s）')
console.log('═'.repeat(70))

// ies → y: cities → city（术语库有 Memories=Memórias 不同形，不应豁免）
check('pt-BR "Memory" (术语库 Memories=Memórias 不同形)', isUntranslatable('Memory', ptBRGlossary), false)

// es 词干: classes → class（术语库 Classes=Classes 同形，应豁免）
check('pt-BR "Class" (术语库 Classes=Classes 同形)', isUntranslatable('Class', ptBRGlossary), true)
check('pt-BR "Classes" (复数，术语库有)', isUntranslatable('Classes', ptBRGlossary), true)

// (s|x|z|ch|sh)es: boxes → box（术语库 Boxes=Boxes 同形，应豁免）
check('pt-BR "Box" (术语库 Boxes=Boxes 同形)', isUntranslatable('Box', ptBRGlossary), true)
check('pt-BR "Boxes" (复数，术语库有)', isUntranslatable('Boxes', ptBRGlossary), true)

// 以 s 结尾的非复数词（不应误还原）
check('pt-BR "Bus" (以s结尾，不应还原为bu)', isUntranslatable('Bus', ptBRGlossary), false)
check('pt-BR "Gas" (以s结尾，不应还原为ga)', isUntranslatable('Gas', ptBRGlossary), false)

console.log('')
console.log('═'.repeat(70))
console.log('场景 5: 真漏翻仍应判漏翻（术语库无此词）')
console.log('═'.repeat(70))

// 术语库完全没有的词 → 不豁免
check('"Hello" (术语库无)', isUntranslatable('Hello', ptBRGlossary), false)
check('"World" (术语库无)', isUntranslatable('World', ptBRGlossary), false)
check('"Speed" (术语库无)', isUntranslatable('Speed', ptBRGlossary), false)

// 无术语库时也不豁免
check('"Drone" (无术语库)', isUntranslatable('Drone'), false)
check('"Tablet" (无术语库)', isUntranslatable('Tablet'), false)

console.log('')
console.log('═'.repeat(70))
console.log('场景 6: 短词保护（<4 字符不还原）')
console.log('═'.repeat(70))

// 短词不做单复数还原，避免误伤
check('"SSD" (3字符，不还原)', isUntranslatable('SSD', ptBRGlossary), true)  // SSD 是技术缩写，走其他豁免
check('"USB" (3字符，不还原)', isUntranslatable('USB', ptBRGlossary), true)  // USB 是技术缩写，走其他豁免

console.log('')
console.log('═'.repeat(70))
console.log(`结果: ${pass} 通过, ${fail} 失败`)
console.log('═'.repeat(70))

if (fail > 0) {
  process.exit(1)
}
