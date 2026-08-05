/**
 * v11.5 Prompt 减肥测试 — 补救指令移到重试层
 *
 * 架构复盘方向 #4：prompt 正反馈循环（越长→注意力稀释→失败→加条款→更长）止血。
 * 改动：
 *   1. CORE_PRINCIPLES 拆 LEAN（首调）+ REMEDIATION（重试注入），旧常量=组合
 *   2. BRAND 段移出首调（buildSystemPrompt includeRemediation=true 才注入）
 *   3. renderLangForTranslate includeCommonErrors 参数（首调 false / 重试 true）
 *   4. 统一重试瘦身（forceTranslate 时 styleCard/fewShot 空 + 补救全量回归）
 *   5. 校对 VARIANT_CHECKS（变体对才注入）+ EXPANSION_NOTE（expansionFlags 非空才注入）
 *
 * 覆盖：
 *  A. 首调 prompt 瘦身（不含补救条款、含核心规则）——20 语种全覆盖
 *  B. 重试 prompt 补救全量回归（含 BRAND/MISSPELLED/补全/品类精度/commonErrors）
 *  C. 校对条件注入（变体对 / expansionFlags）
 *  D. 规模回归（首调 prompt 显著短于旧版组合）
 *  E. 旧常量兼容（组合形式含全部原文本，防漏引用点）
 *
 * 输出：tests/tmp-v115-test-out.txt，末行 "v11.5 测试：N 通过，M 失败"
 */

import { buildSystemPrompt } from '../lib/llm-api'
import {
  CORE_PRINCIPLES,
  CORE_PRINCIPLES_ZH,
  CORE_PRINCIPLES_LEAN,
  CORE_PRINCIPLES_LEAN_ZH,
  CORE_PRINCIPLES_REMEDIATION,
  CORE_PRINCIPLES_REMEDIATION_ZH,
  BRAND_NAME_RULE,
  BRAND_NAME_RULE_ZH,
  LANG_SPECIFIC,
  renderLangForTranslate,
  buildProofreadSystemPrompt,
  PROOFREAD_SYSTEM_PROMPT,
  PROOFREAD_SYSTEM_PROMPT_ZH,
  PROOFREAD_VARIANT_CHECKS,
  PROOFREAD_VARIANT_CHECKS_ZH,
  PROOFREAD_EXPANSION_NOTE,
} from '../lib/prompt-constants'
import { writeFileSync } from 'fs'

let pass = 0
let fail = 0
const out: string[] = []

function ok(cond: boolean, name: string, extra?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${extra ? '  | ' + extra : ''}`) }
}

const ALL_LANGS = Object.keys(LANG_SPECIFIC)

// ═══════════════════════════════════════════════════════════════
// A. 首调 prompt 瘦身（20 语种全覆盖）
// ═══════════════════════════════════════════════════════════════
out.push('─'.repeat(50))
out.push('A. 首调 prompt 瘦身（20 语种）')

// A1: 英文指令（de）首调不含补救条款
const a1 = buildSystemPrompt({ targetLang: 'de', langBlock: '', styleCard: '', fewShotBlock: '' })
ok(!/MISSPELLED/.test(a1), 'A1 首调(en指令)不含 MISSPELLED 错词条款')
ok(!/Panasionic/.test(a1), 'A2 首调(en指令)不含 Panasionic 反例')
ok(!/NEVER "complete" partial product names/.test(a1), 'A3 首调(en指令)不含补全产品名条款')
ok(!/Read speed.*Write speed.*never interchange/.test(a1), 'A4 首调(en指令)不含品类精度条款')
ok(!/BRAND & PRODUCT NAMES/.test(a1), 'A5 首调(en指令)不含 BRAND 段')
ok(!/NEVER translate, transliterate/.test(a1), 'A6 首调(en指令)不含品牌直译禁令')

// A7-A10: 中文指令（zh-TW）首调不含补救条款
const a7 = buildSystemPrompt({ targetLang: 'zh-TW', langBlock: '', styleCard: '', fewShotBlock: '' })
ok(!/疑似错词/.test(a7), 'A7 首调(zh指令)不含错词条款')
ok(!/品牌与产品名/.test(a7), 'A8 首调(zh指令)不含 BRAND 段')
ok(!/绝不直译/.test(a7), 'A9 首调(zh指令)不含品牌直译禁令')
ok(!/严禁"补全"/.test(a7), 'A10 首调(zh指令)不含补全条款')

// A11-A14: 首调保留核心规则（结构不破）
ok(/TRANSLATE ALL MEANING/.test(a1), 'A11 首调保留原则1（全翻）')
ok(/FAITHFUL TO SOURCE/.test(a1), 'A12 首调保留原则2（忠实）')
ok(/Placeholders \(__XXX_N__\)/.test(a1), 'A13 首调保留占位符保留条款（结构性要求不搬）')
ok(/NATURAL EXPRESSION/.test(a1), 'A14 首调保留原则3（自然）')

// A15: 20 语种全覆盖——首调 langBlock 均不含 commonErrors 对照表
// commonErrors 特征：以"常见错误/常见错误/よくある誤り"等开头（各语种本地化）
// 用"❌"符号判定（commonErrors 块全部含 ❌→✅ 对照，rules/compliance 不含 ❌）
let langsMissingRules = 0
let langsWithCommonErrors = 0
for (const lang of ALL_LANGS) {
  const lb = renderLangForTranslate(lang, null, false)
  if (LANG_SPECIFIC[lang].rules && !lb.includes(LANG_SPECIFIC[lang].rules.slice(0, 20))) langsMissingRules++
  const ce = LANG_SPECIFIC[lang].commonErrors
  if (ce && lb.includes(ce.slice(0, 30))) langsWithCommonErrors++
}
ok(langsMissingRules === 0, `A15 20语种首调 rules 全保留（${ALL_LANGS.length} 语种）`, `${langsMissingRules} 语种缺 rules`)
ok(langsWithCommonErrors === 0, `A16 20语种首调 commonErrors 全剔除（${ALL_LANGS.length} 语种）`, `${langsWithCommonErrors} 语种仍含 commonErrors`)

// A17: 20 语种重试 langBlock 均含 commonErrors
let langsRetryMissing = 0
for (const lang of ALL_LANGS) {
  const lb = renderLangForTranslate(lang, null, true)
  const ce = LANG_SPECIFIC[lang].commonErrors
  if (ce && !lb.includes(ce.slice(0, 30))) langsRetryMissing++
}
ok(langsRetryMissing === 0, `A17 20语种重试 commonErrors 全回归（${ALL_LANGS.length} 语种）`, `${langsRetryMissing} 语种缺`)

// ═══════════════════════════════════════════════════════════════
// B. 重试 prompt 补救全量回归
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push('B. 重试 prompt（includeRemediation=true）补救全量回归')

const b1 = buildSystemPrompt({ targetLang: 'de', langBlock: '', styleCard: '', fewShotBlock: '', includeRemediation: true })
ok(/MISSPELLED/.test(b1) && /Panasionic/.test(b1), 'B1 重试(en)含错词条款+反例')
ok(/NEVER "complete" partial product names/.test(b1), 'B2 重试(en)含补全产品名条款')
ok(/BRAND & PRODUCT NAMES/.test(b1) && /NEVER translate, transliterate/.test(b1), 'B3 重试(en)含 BRAND 段+直译禁令')

const b4 = buildSystemPrompt({ targetLang: 'zh-TW', langBlock: '', styleCard: '', fewShotBlock: '', includeRemediation: true })
ok(/疑似错词/.test(b4) && /帕納西奧尼克/.test(b4), 'B4 重试(zh)含错词条款+反例')
ok(/品牌与产品名/.test(b4) && /绝不直译/.test(b4), 'B5 重试(zh)含 BRAND 段+直译禁令')
ok(/严禁"补全"/.test(b4) && /读取速度/.test(b4), 'B6 重试(zh)含补全+品类精度条款')

// ═══════════════════════════════════════════════════════════════
// C. 校对条件注入
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push('C. 校对条件注入')

// C1-C2: 变体对注入
const c1 = buildProofreadSystemPrompt({ targetLang: 'zh-TW', productLine: null, useEnInstruction: false, sourceLang: 'zh-CN' })
ok(/变体专项检查/.test(c1) && /简体→繁体/.test(c1), 'C1 zh-CN→zh-TW 注入变体专项检查')
const c2 = buildProofreadSystemPrompt({ targetLang: 'pt-BR', productLine: null, useEnInstruction: true, sourceLang: 'pt' })
ok(/VARIANT-SPECIFIC CHECKS/.test(c2) && /ficheiro/.test(c2), 'C2 pt→pt-BR 注入变体检查(en指令)')

// C3-C4: 非变体对不注入
const c3 = buildProofreadSystemPrompt({ targetLang: 'de', productLine: null, useEnInstruction: true, sourceLang: 'en' })
ok(!/VARIANT-SPECIFIC CHECKS/.test(c3), 'C3 en→de 不注入变体检查')
const c4 = buildProofreadSystemPrompt({ targetLang: 'ja', productLine: null, useEnInstruction: false, sourceLang: 'en' })
ok(!/变体专项检查/.test(c4), 'C4 en→ja 不注入变体检查')

// C5-C6: expansionFlags 条件注入
const c5 = buildProofreadSystemPrompt({ targetLang: 'de', productLine: null, useEnInstruction: true, sourceLang: 'en', hasExpansionFlags: true })
ok(/EXPANSION NOTE/.test(c5), 'C5 有 expansionFlags 时注入超长提示')
const c6 = buildProofreadSystemPrompt({ targetLang: 'de', productLine: null, useEnInstruction: true, sourceLang: 'en', hasExpansionFlags: false })
ok(!/EXPANSION NOTE/.test(c6), 'C6 无 expansionFlags 时不注入超长提示')

// C7-C8: 主干常量已抽出（proofread 常量本身不再含条件块）
ok(!/VARIANT-SPECIFIC CHECKS/.test(PROOFREAD_SYSTEM_PROMPT), 'C7 EN 校对主干不含变体块（已抽出）')
ok(!/EXPANSION NOTE/.test(PROOFREAD_SYSTEM_PROMPT), 'C8 EN 校对主干不含超长提示（已抽出）')
ok(!/变体专项检查/.test(PROOFREAD_SYSTEM_PROMPT_ZH), 'C9 ZH 校对主干不含变体块（已抽出）')
ok(!/超长提示/.test(PROOFREAD_SYSTEM_PROMPT_ZH), 'C10 ZH 校对主干不含超长提示（已抽出）')

// C11: CHECK 3 homographs 例外保留（通用语种都可能触发，不抽）
ok(/Cross-language homographs/.test(PROOFREAD_SYSTEM_PROMPT) && /Drone/.test(PROOFREAD_SYSTEM_PROMPT), 'C11 校对主干保留 homographs 例外')

// ═══════════════════════════════════════════════════════════════
// D. 规模回归（首调 prompt 显著短于旧版组合）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push('D. 规模回归')

// 旧版首调 = LEAN + REMEDIATION + BRAND（模拟 v11.5 前）
const oldPromptLen = CORE_PRINCIPLES.length + BRAND_NAME_RULE.length
const newPromptLen = CORE_PRINCIPLES_LEAN.length
ok(newPromptLen < oldPromptLen * 0.7, `D1 首调 core+brand 减 30%+（旧 ${oldPromptLen} → 新 ${newPromptLen} 字符）`)

// D2: 重试 prompt 与首调同量级（精简骨架+补救，不再双倍）
const retryPrompt = buildSystemPrompt({ targetLang: 'de', langBlock: '', styleCard: '', fewShotBlock: '', includeRemediation: true })
const firstPrompt = buildSystemPrompt({ targetLang: 'de', langBlock: '', styleCard: '', fewShotBlock: '' })
// 重试含补救但无 styleCard/fewShot（此处本来就空），规模应 ≈ 首调 + 补救段
ok(retryPrompt.length > firstPrompt.length, 'D2 重试 prompt 含补救段（>首调）')

// ═══════════════════════════════════════════════════════════════
// E. 旧常量兼容（组合形式含全部原文本，防漏引用点）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push('E. 旧常量兼容')

ok(CORE_PRINCIPLES === CORE_PRINCIPLES_LEAN + '\n' + CORE_PRINCIPLES_REMEDIATION, 'E1 CORE_PRINCIPLES = LEAN + REMEDIATION')
ok(CORE_PRINCIPLES_ZH === CORE_PRINCIPLES_LEAN_ZH + '\n' + CORE_PRINCIPLES_REMEDIATION_ZH, 'E2 CORE_PRINCIPLES_ZH = LEAN_ZH + REMEDIATION_ZH')
ok(/MISSPELLED/.test(CORE_PRINCIPLES) && /Panasionic/.test(CORE_PRINCIPLES), 'E3 旧常量仍含错词条款（v10.6 A 组断言不破）')
ok(/疑似错词/.test(CORE_PRINCIPLES_ZH) && /帕納西奧尼克/.test(CORE_PRINCIPLES_ZH), 'E4 旧 ZH 常量仍含错词条款')
ok(/TRANSLATE ALL MEANING/.test(CORE_PRINCIPLES) && /NATURAL EXPRESSION/.test(CORE_PRINCIPLES), 'E5 旧常量含三原则主干')

// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('─'.repeat(50))
out.push(`v11.5 测试：${pass} 通过，${fail} 失败`)
writeFileSync('tests/tmp-v115-test-out.txt', out.join('\n'), 'utf-8')
console.log(out.join('\n'))
process.exit(fail > 0 ? 1 : 0)
