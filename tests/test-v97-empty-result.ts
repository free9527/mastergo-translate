/**
 * v9.7 修复验证：空结果翻译失败标记 + 漏翻重试空结果回退
 *
 * 场景：pt→ja 翻译中，"Resistente a altas temperaturas" 等葡语文本漏翻，
 *       管道内部所有兜底失败后返回空字符串，UI 层显示"待翻译"、无徽章、无重翻按钮。
 *
 * 修复点：
 *   层1（ui/App.vue:1467）：空结果且源文非空 → 标记翻译失败
 *   层2（lib/llm-api.ts:1144）：漏翻重试空结果 → 回退源文触发兜底链
 */

import { detectTruncatedTexts, detectUntranslatedText, classifyNecessity } from '../lib/llm-api'

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
// 层1验证：空结果应被 detectTruncatedTexts 检出（UI 层标记依据）
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('层1：空结果检测（UI 标记翻译失败的依据）')
out.push('═'.repeat(60))

const sources = [
  'Resistente a altas temperaturas',
  'Resistente a baixas temperaturas',
  'Alta velocidade durante todo o uso',
]

// 场景：翻译管道返回空结果
const emptyResults = ['', '', '']
const truncDetected = detectTruncatedTexts(sources, emptyResults)
assert(truncDetected.size === 3, 'detectTruncatedTexts 检出全部空结果', `got ${truncDetected.size}`)

// 场景：部分空 + 部分正常（源文均 >30 字符，触发长度比例检测）
const mixedResults = ['', '高温に強い', '']
const truncMixed = detectTruncatedTexts(sources, mixedResults)
assert(truncMixed.size === 3 && truncMixed.has(0) && truncMixed.has(2), '部分空结果检出正确（含长度比例检测）', `got [${Array.from(truncMixed)}]`)

// 场景：源文为空时不应误检
const emptySource = ['', 'Resistente a baixas temperaturas', '']
const emptySourceResults = ['', '', '']
const truncEmptySrc = detectTruncatedTexts(emptySource, emptySourceResults)
assert(truncEmptySrc.size === 1 && truncEmptySrc.has(1), '源文为空的条目不误检', `got [${Array.from(truncEmptySrc)}]`)

// ═══════════════════════════════════════════════════════════════
// 层2验证：漏翻重试空结果回退源文后，兜底链能检出
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('层2：漏翻重试空结果回退（模拟修复后逻辑）')
out.push('═'.repeat(60))

// 模拟修复前：重试结果为空 → result[j] = '' → detectUntranslatedText 跳过（空字符串）
const retryEmpty = ['', '', '']
const untransBefore = detectUntranslatedText(sources, retryEmpty, 'ja')
assert(untransBefore.size === 0, '修复前：空结果跳过漏翻检测（问题根源）', `got ${untransBefore.size}`)

// 模拟修复后：重试结果为空 → result[j] = texts[j]（回退源文）→ detectUntranslatedText 检出
const retryFallback = [...sources] // 回退源文
const untransAfter = detectUntranslatedText(sources, retryFallback, 'ja')
assert(untransAfter.size === 3, '修复后：回退源文触发漏翻检测', `got ${untransAfter.size}`)

// 验证回退后的 necessity 分类正确（应为 translate，跨字符集）
const necessity = sources.map(src => classifyNecessity(src, 'ja').kind)
assert(necessity.every(k => k === 'translate'), '回退源文的 necessity 分类为 translate', `got ${JSON.stringify(necessity)}`)

// ═══════════════════════════════════════════════════════════════
// 回归：现有 v9.5 三层漏翻检测不受影响
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('回归：v9.5 三层漏翻检测不受影响')
out.push('═'.repeat(60))

// 正常漏翻（源文==译文）仍能检出
const untransNormal = detectUntranslatedText(sources, sources, 'ja')
assert(untransNormal.size === 3, '正常漏翻（源文==译文）仍检出', `got ${untransNormal.size}`)

// 简繁转换漏翻仍能检出
const s2tSources = ['让这说会对开关时间问题']
const s2tTrans = ['让这说会对开关时间问题'] // 简体特征字未转换
const untransS2T = detectUntranslatedText(s2tSources, s2tTrans, 'zh-TW')
assert(untransS2T.size === 1, '简繁转换漏翻仍检出', `got ${untransS2T.size}`)

// 拉丁变体（pt→pt-BR）英文混入仍能检出
const ptSources = ['Resistente a altas temperaturas']
const ptTrans = ['High temperature resistance'] // 英文混入
const untransPt = detectUntranslatedText(ptSources, ptTrans, 'pt-BR')
assert(untransPt.size === 1, '拉丁变体英文混入仍检出', `got ${untransPt.size}`)

// ═══════════════════════════════════════════════════════════════
// 输出
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push(`结果：${pass} 通过，${fail} 失败`)
out.push('═'.repeat(60))

require('fs').writeFileSync(__dirname + '/tmp-v97-test-out.txt', out.join('\n'), 'utf8')
console.log(`v9.7 测试：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
