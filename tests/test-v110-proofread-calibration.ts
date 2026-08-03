/**
 * v11.0 校对市场语感校准测试
 *
 * 背景（2026-08-03 决策）：翻译 prompt 注入了分段市场语感（getMarketNote），
 * 允许译文使用目标市场原生词汇（满血版/가성비/Preis-Leistung）。校对 prompt 此前
 * 看不到这份参照 → 会把故意使用的正确市场词误当不自然表达拦下（翻译和校对看到的世界不一致）。
 *
 * 方案：
 *   1. buildProofreadCalibration(targetLang, productLine, useEnInstruction)
 *      — 与翻译同源同段（getMarketNote），带双向边界：
 *        ① 白名单校准（不许拦正确市场词）② 禁止加词（源文没有的风味词仍须拦）
 *   2. buildProofreadSystemPrompt(opts) — 校对 prompt 组装提取为纯函数（可测）
 *      模块顺序：MISSION → PROOFREAD_PROMPT → glossaryHint → calibration → langBlock
 *
 * 覆盖：
 *   A. 校准块分段注入（8 产品线抽样：命中段+shared，无无关段）
 *   B. 双向边界指令（白名单 + 禁止加词，中英指令两套）
 *   C. 组装完整性（MISSION/PROOFREAD/VALIDATION 保留 + calibration 位置在 VALIDATION 前）
 *   D. CJK/非 CJK 指令语言路由（中文版边界指令 vs 英文版）
 *   E. 无产品线/未映射 → 全段校准
 *   F. 20 语种校准块非空 + 与翻译同段一致性（校对段 == 翻译段）
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import {
  buildProofreadSystemPrompt,
  buildProofreadCalibration,
  getMarketNote,
  getStyleCard,
} from '../lib/prompt-constants'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

const ALL_LANGS = ['zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'pt-BR', 'it',
  'nl', 'pl', 'sv', 'tr', 'ru', 'vi', 'th', 'id', 'ar', 'en']

// ═══════════════════════════════════════════════════════════════
// A. 校准块分段注入（命中段+shared，无无关段）
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. 校准块分段注入（与翻译同源同段）')

// gaming 产品线 → gaming 段 + shared
const calGamingDe = buildProofreadCalibration('de', 'gaming_ssd', true)
assert(calGamingDe.includes('Overclocking-Speicher'), 'A1 gaming_ssd de 校准含 gaming 段')
assert(!calGamingDe.includes('Preis-Leistung'), 'A2 gaming_ssd de 校准不含 consumer 段')
assert(calGamingDe.includes('Keine Übertreibungen'), 'A3 gaming_ssd de 校准含 shared 段')

const calGamingZh = buildProofreadCalibration('zh-CN', 'gaming_dimm', false)
assert(calGamingZh.includes('满血版'), 'A4 gaming_dimm zh-CN 校准含 gaming 段（满血版）')
assert(!calGamingZh.includes('性价比'), 'A5 gaming_dimm zh-CN 校准不含 consumer 段（性价比）')
assert(calGamingZh.includes('参数党友好'), 'A6 gaming_dimm zh-CN 校准含 shared 段')

// professional 产品线 → professional 段 + shared
const calProJa = buildProofreadCalibration('ja', 'professional_imaging', true)
assert(calProJa.includes('安定稼働'), 'A7 professional_imaging ja 校准含 professional 段')
assert(!calProJa.includes('ゲーム体験'), 'A8 professional_imaging ja 校准不含 gaming 段')

// consumer 产品线 → consumer 段 + shared
const calConsumerKo = buildProofreadCalibration('ko', 'portable_storage', true)
assert(calConsumerKo.includes('가성비'), 'A9 portable_storage ko 校准含 consumer 段（가성비）')
assert(!calConsumerKo.includes('프레임 방어'), 'A10 portable_storage ko 校准不含 gaming 段')

// ═══════════════════════════════════════════════════════════════
// B. 双向边界指令（白名单 + 禁止加词）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('B. 双向边界指令')

const calEn = buildProofreadCalibration('de', 'gaming_dimm', true)
assert(/APPROVED/.test(calEn), 'B1 英文校准含白名单声明（APPROVED）')
assert(/do NOT flag or rewrite/.test(calEn), 'B2 英文校准含"不许拦"指令')
assert(/NO basis in the source/.test(calEn), 'B3 英文校准含禁止加词指令（源文无依据须拦）')
assert(/not a license to embellish/.test(calEn), 'B4 英文校准含"不是加戏许可证"边界')

const calZh = buildProofreadCalibration('zh-CN', 'gaming_dimm', false)
assert(calZh.includes('已获准使用'), 'B5 中文校准含白名单声明')
assert(calZh.includes('不得当作不自然或误译而拦截'), 'B6 中文校准含"不许拦"指令')
assert(calZh.includes('源文中没有依据'), 'B7 中文校准含禁止加词指令')
assert(calZh.includes('不是加戏许可证'), 'B8 中文校准含"不是加戏许可证"边界')

// ═══════════════════════════════════════════════════════════════
// C. 组装完整性（buildProofreadSystemPrompt）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('C. 校对 prompt 组装完整性')

const sysDe = buildProofreadSystemPrompt({
  targetLang: 'de', productLine: 'gaming_dimm', useEnInstruction: true, glossaryHint: '\n[GLOSSARY]\nfoo',
})
assert(sysDe.includes('[MISSION·de]'), 'C1 组装含 MISSION 块')
assert(sysDe.includes('[ROLE]'), 'C2 组装含 PROOFREAD_SYSTEM_PROMPT（[ROLE]）')
assert(sysDe.includes('[GLOSSARY]'), 'C3 组装保留 glossaryHint')
assert(sysDe.includes('[MARKET CALIBRATION · de]'), 'C4 组装含校准块')
assert(sysDe.includes('[VALIDATION: de]'), 'C5 组装含 VALIDATION 块（renderLangForProofread）')
// 位置：校准块必须在 VALIDATION 检查清单之前（先建立"不许拦什么"的边界）
assert(
  sysDe.indexOf('[MARKET CALIBRATION') > sysDe.indexOf('[ROLE]') &&
  sysDe.indexOf('[MARKET CALIBRATION') < sysDe.indexOf('[VALIDATION: de]'),
  'C6 校准块位于 PROOFREAD_PROMPT 之后、VALIDATION 之前',
)

const sysNoHint = buildProofreadSystemPrompt({
  targetLang: 'de', productLine: 'gaming_dimm', useEnInstruction: true,
})
assert(!sysNoHint.includes('[GLOSSARY]'), 'C7 无 glossaryHint 时不含 GLOSSARY 块（默认空串）')

// ═══════════════════════════════════════════════════════════════
// D. CJK / 非 CJK 指令语言路由
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('D. 指令语言路由')

const sysJa = buildProofreadSystemPrompt({ targetLang: 'ja', productLine: 'gaming_dimm', useEnInstruction: false })
assert(sysJa.includes('[角色]'), 'D1 useEnInstruction=false → 中文校对 prompt（[角色]）')
assert(sysJa.includes('[市场语感校准 · ja]'), 'D2 useEnInstruction=false → 中文校准块头')

const sysFr = buildProofreadSystemPrompt({ targetLang: 'fr', productLine: 'gaming_dimm', useEnInstruction: true })
assert(sysFr.includes('[ROLE]'), 'D3 useEnInstruction=true → 英文校对 prompt')
assert(sysFr.includes('[MARKET CALIBRATION · fr]'), 'D4 useEnInstruction=true → 英文校准块头')

// ═══════════════════════════════════════════════════════════════
// E. 无产品线 / 未映射 → 全段校准
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('E. 无产品线/未映射回退全段')

const calNoLine = buildProofreadCalibration('zh-CN', null, false)
assert(calNoLine.includes('满血版') && calNoLine.includes('性价比') && calNoLine.includes('生产力工具'),
  'E1 无产品线 zh-CN 校准含全三段')
const calUnknown = buildProofreadCalibration('zh-CN', 'some_future_line', false)
assert(calUnknown.includes('满血版') && calUnknown.includes('性价比'), 'E2 未映射产品线回退全段')

// ═══════════════════════════════════════════════════════════════
// F. 20 语种：校准块非空 + 与翻译同段一致性
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('F. 20 语种校准块非空 + 校对段与翻译段一致')

for (const lang of ALL_LANGS) {
  const isCJK = ['zh-CN', 'zh-TW', 'ja', 'ko'].includes(lang)
  const cal = buildProofreadCalibration(lang, 'gaming_dimm', !isCJK)
  assert(cal.length > 0, `F-cal-${lang} 校准块非空`)
  // 一致性：校对拿到的市场语感字符串 == 翻译注入的同名字符串（同函数同参数）
  const translationNote = getMarketNote(lang, 'gaming_dimm')
  assert(cal.includes(translationNote), `F-eq-${lang} 校准段 == 翻译段（同源）`)
  // 翻译侧风格卡也确实注入了这段（端到端一致性的另一端）
  const card = getStyleCard(lang, 'gaming_dimm', '', 'ecommerce')
  assert(card.includes(translationNote), `F-card-${lang} 翻译风格卡含同一段`)
}

// ═══════════════════════════════════════════════════════════════
// 结果汇总
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push(`v11.0 测试：${pass} 通过，${fail} 失败`)

console.log(out.join('\n'))

// 落盘（供 CI/人工复查）
import { writeFileSync } from 'fs'
writeFileSync('tests/tmp-v110-test-out.txt', out.join('\n'), 'utf-8')

if (fail > 0) process.exit(1)
