/**
 * v9.8 目标字符集校验测试
 *
 * 场景：pt→ja 翻译中，LLM 微调源语言后返回（如 "Resistente a altas temperaturas"
 *       → "Resistente às altas temperaturas"），绕过 normalize 比对，但译文仍非日文。
 *
 * 修复：translate kind 增加目标字符集校验 — ja/ko/zh 目标译文必须含对应字符。
 */

import { detectUntranslatedText, classifyNecessity } from '../lib/llm-api'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass++
    out.push(`✅ ${name}`)
  } else {
    fail++
    out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// 目标字符集校验：ja 目标
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('目标字符集校验：ja 目标')
out.push('═'.repeat(60))

const ptSources = [
  'Resistente a altas temperaturas',
  'Resistente a baixas temperaturas',
  'Alta velocidade durante todo o uso',
]

// 场景1：纯葡语译文（源文==译文）→ 检出
const r1 = detectUntranslatedText(ptSources, ptSources, 'ja')
assert(r1.size === 3, 'ja目标：纯葡语译文（源文==译文）检出', `got ${r1.size}`)

// 场景2：微调后的葡语译文（加标点/换词）→ 检出（v9.8 新增）
const tweakedPt = [
  'Resistente às altas temperaturas',  // 加 às
  'Resistência a baixas temperaturas', // 换名词
  'Alta velocidade durante todo uso',  // 删词
]
const r2 = detectUntranslatedText(ptSources, tweakedPt, 'ja')
assert(r2.size === 3, 'ja目标：微调后的葡语译文检出（v9.8字符集校验）', `got ${r2.size}`)

// 场景3：真正的日文译文 → 通过
const jaTrans = [
  '高温に強い',
  '低温に強い',
  '使用中常に高速',
]
const r3 = detectUntranslatedText(ptSources, jaTrans, 'ja')
assert(r3.size === 0, 'ja目标：真正日文译文通过', `got ${r3.size}`)

// 场景4：混合日英文（含日文）→ 通过
const mixedJa = [
  '高温に強い design',
  '低温に強い performance',
  '高速 durante todo o uso', // 部分日文
]
const r4 = detectUntranslatedText(ptSources, mixedJa, 'ja')
assert(r4.size === 0, 'ja目标：含日文字符的混合译文通过', `got ${r4.size}`)

// ═══════════════════════════════════════════════════════════════
// 目标字符集校验：ko 目标
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('目标字符集校验：ko 目标')
out.push('═'.repeat(60))

const enSources = ['High speed performance', 'Ideal for gaming']
const koTrans = ['고속 성능', '게임에 이상적']
const notKoTrans = ['High speed performance', 'Ideal for gaming']

const r5 = detectUntranslatedText(enSources, notKoTrans, 'ko')
assert(r5.size === 2, 'ko目标：纯英文译文检出', `got ${r5.size}`)

const r6 = detectUntranslatedText(enSources, koTrans, 'ko')
assert(r6.size === 0, 'ko目标：韩文译文通过', `got ${r6.size}`)

// ═══════════════════════════════════════════════════════════════
// 目标字符集校验：zh 目标
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('目标字符集校验：zh 目标')
out.push('═'.repeat(60))

const zhTrans = ['高速性能', '游戏理想选择']
const notZhTrans = ['High speed performance', 'Ideal for gaming']

const r7 = detectUntranslatedText(enSources, notZhTrans, 'zh-CN')
assert(r7.size === 2, 'zh目标：纯英文译文检出', `got ${r7.size}`)

const r8 = detectUntranslatedText(enSources, zhTrans, 'zh-CN')
assert(r8.size === 0, 'zh目标：中文译文通过', `got ${r8.size}`)

// ═══════════════════════════════════════════════════════════════
// 回归：拉丁目标不受影响（无字符集校验，保持原有逻辑）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('回归：拉丁目标不受影响')
out.push('═'.repeat(60))

const deSources = ['High speed performance']
const deTrans = ['Hohe Geschwindigkeit']
const notDeTrans = ['High speed performance']

const r9 = detectUntranslatedText(deSources, notDeTrans, 'de')
assert(r9.size === 1, 'de目标：纯英文译文检出（原有逻辑）', `got ${r9.size}`)

const r10 = detectUntranslatedText(deSources, deTrans, 'de')
assert(r10.size === 0, 'de目标：德文译文通过（原有逻辑）', `got ${r10.size}`)

// ═══════════════════════════════════════════════════════════════
// 输出
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push(`结果：${pass} 通过，${fail} 失败`)
out.push('═'.repeat(60))

require('fs').writeFileSync(__dirname + '/tmp-v98-test-out.txt', out.join('\n'), 'utf8')
console.log(`v9.8 测试：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
