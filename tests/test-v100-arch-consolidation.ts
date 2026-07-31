/**
 * v10.0 架构收口回归测试（架构复盘优化 #1+#2）
 *
 * 验证两件事：
 *   A. 语言检测单一事实源（lib/lang-detect.ts）——llm-api.ts re-export 与直接导入
 *      是同一实现；三套旧实现（批次级/逐条死代码/逐条拉丁）行为口径统一。
 *   B. 豁免中央注册表（lib/keep-source.ts）——shouldKeepSource / isSameLanguageExempt
 *      与各历史场景（v8.7 单复数 / v9.3 同语系 / v9.5 简繁 / v9.11 F3b 拉丁）行为一致。
 */

import { detectSourceLanguage, detectLatinLang, getScriptClass, getTargetScript, isSameScriptLanguagePair, hasFunctionWords } from '../lib/lang-detect'
import * as fromLlmApi from '../lib/llm-api'
import { shouldKeepSource, isSameLanguageExempt } from '../lib/keep-source'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('═'.repeat(60))
console.log('A. 单一事实源：llm-api re-export 与 lang-detect 同一实现')
console.log('═'.repeat(60))

// A1: re-export 是同一个函数引用（不是复制实现）
assert(fromLlmApi.detectSourceLanguage === detectSourceLanguage, 'A1 detectSourceLanguage 同一引用')
assert(fromLlmApi.detectSingleTextLanguage !== undefined, 'A2 detectSingleTextLanguage 仍可用（兼容旧导入）')
assert(fromLlmApi.getTargetScript === getTargetScript, 'A3 getTargetScript 同一引用')
assert(fromLlmApi.hasFunctionWords === hasFunctionWords, 'A4 hasFunctionWords 同一引用')

// A5: 逐条检测不再是"拉丁恒 en"死代码 —— 委托批次级（拉丁弱信号仍保守回退 en，但不再独立于批次实现）
assert(fromLlmApi.detectSingleTextLanguage('こんにちは世界') === 'ja', 'A5a 逐条 ja 检测正常')
assert(fromLlmApi.detectSingleTextLanguage('高速性能') === 'zh-CN', 'A5b 逐条 zh 检测正常')
// 拉丁单条弱信号回退 en 是刻意的保守（批次级 ≥3 票才细分），口径与批次级一致
assert(fromLlmApi.detectSingleTextLanguage('High speed') === 'en', 'A5c 拉丁单条弱信号保守回退 en（与批次级口径一致）')

// A6: 字符集分类一致性
assert(getScriptClass('Resistente a água') === 'latin', 'A6a pt 文本字符集 latin')
assert(getTargetScript('zh-TW') === 'cjk', 'A6b zh-TW 目标字符集 cjk')
assert(getTargetScript('ja') === 'ja', 'A6c ja 目标字符集 ja')

// A7: 同语系变体对单一实现
assert(isSameScriptLanguagePair('zh-CN', 'zh-TW') === true, 'A7a zh 简繁对')
assert(isSameScriptLanguagePair('pt', 'pt-BR') === true, 'A7b pt 欧巴葡对')
assert(isSameScriptLanguagePair('de', 'de') === false, 'A7c de→de 非同语系变体对（是同语言）')

console.log('')
console.log('═'.repeat(60))
console.log('B. 豁免中央注册表（keep-source）')
console.log('═'.repeat(60))

// B1: shouldKeepSource = isUntranslatable 注册规则
assert(shouldKeepSource('USB NVMe', { targetLang: 'ja' }) === true, 'B1a 技术缩写豁免')
assert(shouldKeepSource('4TB', { targetLang: 'ja' }) === true, 'B1b 容量豁免')
assert(shouldKeepSource('Resistente a altas temperaturas', { targetLang: 'ja' }) === false, 'B1c pt 描述文本不豁免')

// B2: isSameLanguageExempt 三重守卫 — de→de 批次豁免（v9.11 D1 场景）
const DE_BATCH = ['Hohe Geschwindigkeit und Leistung', 'Ideal für Gaming und mehr', 'Robustes Gehäuse für unterwegs']
assert(isSameLanguageExempt(DE_BATCH[0], { targetLang: 'de', batchSources: DE_BATCH }) === true,
  'B2a de→de 同语言批次豁免')

// B3: 守卫 1 — 非拉丁目标不豁免（zh-TW→zh-CN 未转换不逃逸，v9.5 B4 防线）
assert(isSameLanguageExempt('高速性能表現', { targetLang: 'zh-CN', batchSources: ['高速性能表現', '讓遊戲更流暢'] }) === false,
  'B3 zh-TW→zh-CN 不豁免（守卫1：非拉丁目标）')

// B4: 守卫 2 — 混杂批次 en 条目不豁免（v9.5 D4 防线）
const MIXED = ['Hohe Geschwindigkeit und Leistung', 'Ideal für Gaming und mehr', 'The ultimate gaming gear']
assert(isSameLanguageExempt('The ultimate gaming gear', { targetLang: 'de', batchSources: MIXED }) === false,
  'B4 de 批次混入 en 条目：en 条目不豁免（守卫2）')

// B5: 守卫 3 — 批次级复核：整批非目标语言时单条碰巧同语言也不豁免
assert(isSameLanguageExempt('Design', { targetLang: 'de', batchSources: ['Design', 'High speed performance', 'Ideal for gaming'] }) === false,
  'B5 en 批次中单个 de 同形词不豁免（守卫3：批次复核）')

// B6: 跨字符集真漏翻不受豁免影响（v9.11 D2 场景）
assert(isSameLanguageExempt('Resistente a altas temperaturas', { targetLang: 'ja', batchSources: ['Resistente a altas temperaturas'] }) === false,
  'B6 pt→ja 不豁免（跨字符集真漏翻仍检出）')

console.log('')
console.log('═'.repeat(60))
console.log(`结果：${pass} 通过，${fail} 失败`)
console.log('═'.repeat(60))
if (fail > 0) process.exit(1)
