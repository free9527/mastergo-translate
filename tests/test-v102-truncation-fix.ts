/**
 * v10.2 修复验证：截断误杀根治（代码管形式 / LLM 管语义）
 *
 * 根因（2026-07-31 实机日志）：pt→ja 翻译 "Resistente a altas temperaturas"(31字符)
 *   → "高温に強い"(6字符，比例0.19)，被 detectTruncatedTexts 旧长度比 0.25 误杀，
 *   重试链空转后标记失败。拉丁→CJK 字符密度差 3-5 倍，长度代理跨语系必然失效。
 *
 * 修复：detectTruncatedTexts 第三参 targetLang —— 非拉丁目标只判"目标脚本存在性"
 *   （译文不含 ja/ko/zh/th/ar/ru 字符才算截断），长度比仅拉丁→拉丁保留且降为 0.15。
 *
 * 覆盖：20 语种全暴露面（拉丁→CJK 收缩、拉丁→拉丁膨胀、空值、跨字符集）。
 */

import { detectTruncatedTexts, detectUntranslatedText } from '../lib/llm-api'
import { TARGET_SCRIPT_PATTERNS, getTargetScript } from '../lib/lang-detect'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ═══════════════════════════════════════════════════════════════
// 核心场景：pt→ja 误杀修复（本次实机 bug）
// ═══════════════════════════════════════════════════════════════
console.log('═'.repeat(60))
console.log('核心场景：拉丁→CJK 合法短译文不再误杀')
console.log('═'.repeat(60))

const ptSources = [
  'Resistente a altas temperaturas',   // 31
  'Resistente a baixas temperaturas',  // 32
  'Alta velocidade durante todo o uso', // 33
]
const jaTranslations = ['高温に強い', '低温に強い', '常時高速動作']
{
  const r = detectTruncatedTexts(ptSources, jaTranslations, 'ja')
  assert(r.size === 0, 'pt→ja 6字符日文译文不误杀（旧逻辑必杀）', `got [${Array.from(r)}]`)
}

// ko 目标同理
{
  const r = detectTruncatedTexts(ptSources, ['고온에 강함', '저온에 강함', '항상 고속 동작'], 'ko')
  assert(r.size === 0, 'pt→ko 短译文不误杀', `got [${Array.from(r)}]`)
}

// zh-CN / zh-TW 目标
{
  const r = detectTruncatedTexts(ptSources, ['耐高温', '耐低温', '全程高速运行'], 'zh-CN')
  assert(r.size === 0, 'pt→zh-CN 短译文不误杀', `got [${Array.from(r)}]`)
  const r2 = detectTruncatedTexts(ptSources, ['耐高溫', '耐低溫', '全程高速運行'], 'zh-TW')
  assert(r2.size === 0, 'pt→zh-TW 短译文不误杀', `got [${Array.from(r2)}]`)
}

// ═══════════════════════════════════════════════════════════════
// 真截断仍能检出：非拉丁目标译文不含目标脚本字符
// ═══════════════════════════════════════════════════════════════
console.log('')
console.log('═'.repeat(60))
console.log('真截断/假翻译仍检出（非拉丁目标）')
console.log('═'.repeat(60))

{
  // ja 目标译文是纯拉丁（LLM 回显源文或翻成了别的拉丁语）→ 截断
  const r = detectTruncatedTexts(ptSources, ['Resistant to heat', '低温に強い', 'Still English text here'], 'ja')
  assert(r.size === 2 && r.has(0) && r.has(2), 'ja 目标纯拉丁译文检出', `got [${Array.from(r)}]`)
}
{
  // 空译文仍然检出（零误判铁律）
  const r = detectTruncatedTexts(ptSources, ['', '低温に強い', ''], 'ja')
  assert(r.size === 2 && r.has(0) && r.has(2), '空译文检出（非拉丁目标）', `got [${Array.from(r)}]`)
}
{
  // th / ar / ru 目标脚本校验
  const r = detectTruncatedTexts(['Resistente a altas temperaturas'], ['ทนต่ออุณหภูมิสูง'], 'th')
  assert(r.size === 0, 'th 目标泰文译文不误杀', `got [${Array.from(r)}]`)
  const r2 = detectTruncatedTexts(['Resistente a altas temperaturas'], ['مقاوم لدرجات الحرارة'], 'ar')
  assert(r2.size === 0, 'ar 目标阿拉伯文译文不误杀', `got [${Array.from(r2)}]`)
  const r3 = detectTruncatedTexts(['Resistente a altas temperaturas'], ['Жаростойкий'], 'ru')
  assert(r3.size === 0, 'ru 目标西里尔译文不误杀', `got [${Array.from(r3)}]`)
}

// ═══════════════════════════════════════════════════════════════
// 拉丁→拉丁：长度比保留但降为 0.15
// ═══════════════════════════════════════════════════════════════
console.log('')
console.log('═'.repeat(60))
console.log('拉丁→拉丁：长度比 0.15 兜底（真截断仍检出，正常膨胀不误杀）')
console.log('═'.repeat(60))

{
  // pt→de 真截断：源 33 字符，译文 4 字符（0.12 < 0.15）→ 检出
  const r = detectTruncatedTexts(['Alta velocidade durante todo o uso'], ['Sehr'], 'de')
  assert(r.size === 1, '拉丁→拉丁真截断检出（0.12 < 0.15）', `got [${Array.from(r)}]`)
}
{
  // pt→de 正常译文（短但合法）：33 → 7 字符（0.21 > 0.15）→ 不误杀
  const r = detectTruncatedTexts(['Alta velocidade durante todo o uso'], ['Schnell'], 'de')
  assert(r.size === 0, '拉丁→拉丁合法短译文不误杀', `got [${Array.from(r)}]`)
}
{
  // pt→de 空译文
  const r = detectTruncatedTexts(['Alta velocidade durante todo o uso'], [''], 'de')
  assert(r.size === 1, '拉丁→拉丁空译文检出', `got [${Array.from(r)}]`)
}

// ═══════════════════════════════════════════════════════════════
// 兼容性：targetLang 缺省时保持旧行为（0.25）
// ═══════════════════════════════════════════════════════════════
console.log('')
console.log('═'.repeat(60))
console.log('兼容性：无 targetLang 时旧行为')
console.log('═'.repeat(60))

{
  const r = detectTruncatedTexts(ptSources, ['', '', ''], undefined)
  assert(r.size === 3, '无 targetLang：空译文检出', `got [${Array.from(r)}]`)
  // 旧 0.25 比例在无 targetLang 时仍生效（测试/外部直调路径）
  const r2 = detectTruncatedTexts(['Alta velocidade durante todo o uso'], ['abc'], undefined)
  assert(r2.size === 1, '无 targetLang：0.25 比例检出', `got [${Array.from(r2)}]`)
}

// ═══════════════════════════════════════════════════════════════
// TARGET_SCRIPT_PATTERNS 与 getTargetScript 一致性
// ═══════════════════════════════════════════════════════════════
console.log('')
console.log('═'.repeat(60))
console.log('TARGET_SCRIPT_PATTERNS 覆盖与一致性')
console.log('═'.repeat(60))

{
  const nonLatin = ['ja', 'ko', 'zh-CN', 'zh-TW', 'th', 'ar', 'ru']
  for (const lang of nonLatin) {
    const script = getTargetScript(lang)
    assert(!!TARGET_SCRIPT_PATTERNS[script], `${lang} → script=${script} 有存在性正则`)
  }
  // 拉丁目标返回 null（走长度/功能词路径）
  const latinLangs = ['en', 'pt', 'pt-BR', 'es', 'de', 'fr', 'it', 'nl', 'pl', 'sv', 'tr', 'vi', 'id', 'ms']
  for (const lang of latinLangs) {
    assert(getTargetScript(lang) === 'latin', `${lang} → script=latin`)
  }
}

// ═══════════════════════════════════════════════════════════════
// 回归：detectUntranslatedText 不受影响（v9.5/v9.7/v9.8 行为保持）
// ═══════════════════════════════════════════════════════════════
console.log('')
console.log('═'.repeat(60))
console.log('回归：漏翻检测行为不变')
console.log('═'.repeat(60))

{
  const r = detectUntranslatedText(ptSources, ptSources, 'ja')
  assert(r.size === 3, '源文==译文漏翻仍检出', `got [${Array.from(r)}]`)
  const r2 = detectUntranslatedText(ptSources, jaTranslations, 'ja')
  assert(r2.size === 0, '正常日文译文不误报漏翻', `got [${Array.from(r2)}]`)
  // v9.8 脚本校验不变
  const r3 = detectUntranslatedText(['High speed data transfer for professionals'], ['transfert de données à haute vitesse pour les professionnels'], 'ja')
  assert(r3.size === 1, 'ja 目标纯拉丁译文漏翻仍检出（v9.8）', `got [${Array.from(r3)}]`)
}

console.log('')
console.log('═'.repeat(60))
console.log(`v10.2 测试：${pass} 通过，${fail} 失败`)
console.log('═'.repeat(60))
if (fail > 0) process.exit(1)
