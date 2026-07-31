/**
 * 简繁混杂场景验证
 * 场景1: zh-TW 目标，原文繁体混简体
 * 场景2: zh-CN 目标，原文简体混繁体
 * 场景3: 纯简体 → zh-TW（需转换）
 * 场景4: 纯繁体 → zh-CN（需转换）
 */
import { detectSourceLanguage, detectUntranslatedText } from '../lib/llm-api'

// 繁体特征字（仅繁体使用）
const TW_ONLY = /[臺灣體學國語讓這說會對開關時間問題現發現實義經驗證號誌誌誌]/
// 简体特征字（仅简体使用）
const CN_ONLY = /[台湾体学国语让这说会对开关时间问题现发现实义经验证号志志志]/

const scenarios: Array<{
  name: string
  target: string
  texts: string[]
  expected: 'pass' | 'flag'
  note: string
}> = [
  {
    name: '1a: 繁体为主混简体 → zh-TW',
    target: 'zh-TW',
    texts: [
      '高速性能表現',           // 纯繁体
      '讓你的遊戲體驗更流暢',   // 纯繁体
      '高速性能表现',           // 纯简体（混入）
    ],
    expected: 'pass',
    note: '批次判定 zh-CN，同语系豁免，全部跳过',
  },
  {
    name: '1b: 简体为主混繁体 → zh-CN',
    target: 'zh-CN',
    texts: [
      '高速性能表现',           // 纯简体
      '让你的游戏体验更流畅',   // 纯简体
      '高速性能表現',           // 纯繁体（混入）
    ],
    expected: 'pass',
    note: '批次判定 zh-CN，防线1命中，全部跳过',
  },
  {
    name: '2: 纯简体 → zh-TW（LLM正确转换）',
    target: 'zh-TW',
    texts: ['高速性能表现', '让你的游戏体验更流畅'],
    expected: 'pass',
    note: '同语系对，维度1/2跳过，二元守卫不拦中文',
  },
  {
    name: '3: 纯繁体 → zh-CN（LLM正确转换）',
    target: 'zh-CN',
    texts: ['高速性能表現', '讓你的遊戲體驗更流暢'],
    expected: 'pass',
    note: '同语系对，维度1/2跳过，二元守卫不拦中文',
  },
  {
    name: '4: 纯简体 → zh-TW（LLM摆烂未转换）',
    target: 'zh-TW',
    texts: ['高速性能表现', '让你的游戏体验更流畅'],
    expected: 'flag',
    note: '译文=源文，简体字在繁体目标中应判漏翻',
  },
  {
    name: '5: 纯繁体 → zh-CN（LLM摆烂未转换）',
    target: 'zh-CN',
    texts: ['高速性能表現', '讓你的遊戲體驗更流暢'],
    expected: 'flag',
    note: '译文=源文，繁体字在简体目标中应判漏翻',
  },
]

console.log('场景                          | 批次检测 | 漏翻标记 | 结果')
console.log('------------------------------|----------|----------|-----')

for (const s of scenarios) {
  const batchLang = detectSourceLanguage(s.texts)
  // 模拟 LLM 输出：正确转换 vs 摆烂
  const translated = s.expected === 'pass' && s.target === 'zh-TW'
    ? s.texts.map(t => t.replace(/表现/g, '表現').replace(/让/g, '讓').replace(/游戏/g, '遊戲').replace(/体验/g, '體驗').replace(/流畅/g, '流暢'))
    : s.expected === 'pass' && s.target === 'zh-CN'
    ? s.texts.map(t => t.replace(/表現/g, '表现').replace(/讓/g, '让').replace(/遊戲/g, '游戏').replace(/體驗/g, '体验').replace(/流暢/g, '流畅'))
    : s.texts // 摆烂：不转换

  const result = detectUntranslatedText(s.texts, translated, s.target, undefined, batchLang)
  const flagged = result.size > 0
  const pass = s.expected === 'pass' ? !flagged : flagged
  console.log(`${s.name.padEnd(28)} | ${batchLang.padEnd(8)} | ${result.size}/${s.texts.length}      | ${pass ? '✅' : '❌'}`)
  if (!pass) {
    for (const i of result) console.log(`    └─ [${i}] ${s.texts[i]}`)
  }
  console.log(`    说明: ${s.note}`)
}
