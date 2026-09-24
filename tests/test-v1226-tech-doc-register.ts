// ============================================================
// v12.26 规格书语体场景卡扩充——20 语种 ja 评审同类问题预防性覆盖
// ============================================================
// 背景（2026-09-24 外部 agent ja 规格书评审驱动）：
//   ja 规格书译文被评「电商语体」（敬语/广告修饰/动词直译/连文），根因=
//   SCENE_CONSTRAINTS.technical_doc.langOverrides.ja 只有 2 条（常体+耐久用語），
//   兜不住语体错位。v12.24 方法论复用：全部 ❌坏→✅好 具体对照，不写抽象形容词。
//
// 关键架构约束（代码实锤）：
//   getStyleCard L2575 调 getSceneConstraints(scenePreset, targetLang, suppressExpression=true)
//   ——只保留 Format/Terminology/Success，抑制所有 Expression: 前缀行。
//   因此扩充规则全部无 Expression: 前缀，才能穿透进 prompt。
//
// 红线（从外部 agent 越界点提炼）：
//   「排除修饰语」不能执行成「删除修饰语」=漏翻。修饰语替换为客观等价词保持原意。
//
// 覆盖：
//   A ja 扩充规则注入（穿透 suppressExpression + 具体反例存在）
//   B 20 语种 override 全覆盖（每语种至少 1 条新增语体规则）
//   C 红线规则全语种存在（修饰语不删除保持原意）
//   D 既有规则不回退（ja 常体/耐久 + zh-CN 极端词等）
//   E 场景隔离（ecommerce 不受影响）
// ============================================================

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { SCENE_CONSTRAINTS, getSceneConstraints, getStyleCard } from '../lib/prompt-constants'
import { LANGUAGES } from '../messages/types'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

// ────────────────────────────────────────────────────────────
console.log('\nA. ja 扩充规则注入（穿透 suppressExpression）')

// A1: technical_doc ja override 经 getStyleCard 注入（suppressExpression=true 路径）
const styleCardJa = getStyleCard('ja', null, 'standard', 'technical_params')
assert(styleCardJa.includes('ご利用いただけます'), 'A1 ja 敬语反例穿透 suppressExpression 注入')
assert(styleCardJa.includes('利用可能です'), 'A1b ja 敬语正确形态注入')
assert(styleCardJa.includes('洗練された'), 'A2 ja 广告修饰反例注入')
assert(styleCardJa.includes('なめらかな'), 'A2b ja 修饰替换目标注入')
assert(styleCardJa.includes('コネクタ'), 'A3 ja 業界慣用表記注入')
assert(styleCardJa.includes('互換性を提供する'), 'A4 ja 動詞直訳反例注入')
assert(styleCardJa.includes('対応する'), 'A4b ja 動詞直訳替换目标注入')
assert(styleCardJa.includes('長い連文'), 'A5 ja 断句规则注入')

// ────────────────────────────────────────────────────────────
console.log('\nB. 20 语种 override 全覆盖')

const ALL_LANGS = LANGUAGES.map(l => l.code)
for (const lang of ALL_LANGS) {
  const override = SCENE_CONSTRAINTS.technical_doc?.langOverrides?.[lang]
  assert(Array.isArray(override) && override.length >= 3, `B ${lang} override ≥3 条（含语体扩充）`)
}

// ────────────────────────────────────────────────────────────
console.log('\nC. 红线规则全语种存在（修饰语不删除保持原意）')

for (const lang of ALL_LANGS) {
  const override = SCENE_CONSTRAINTS.technical_doc?.langOverrides?.[lang] || []
  const hasRedLine = override.some(l => /不删除|不刪除|削除せず|삭제하지|not delete|Do not delete|nicht löschen|ne pas supprimer|no eliminar|non eliminare|niet verwijderen|nie usuwaj|inte radera|silmeyin|не удаляйте|không xóa|อย่าลบ|jangan hapus/i.test(l))
  assert(hasRedLine, `C ${lang} 红线规则存在（修饰语不删除）`)
}

// ────────────────────────────────────────────────────────────
console.log('\nD. 既有规则不回退')

const jaOverride = SCENE_CONSTRAINTS.technical_doc.langOverrides.ja
assert(jaOverride.some(l => l.includes('常体')), 'D1 ja 常体/である form 保留')
assert(jaOverride.some(l => l.includes('耐摩耗')), 'D2 ja 耐久用語統一保留')
const zhCnOverride = SCENE_CONSTRAINTS.technical_doc.langOverrides['zh-CN']
assert(zhCnOverride.some(l => l.includes('极致')), 'D3 zh-CN 极端词规则保留')
const frOverride = SCENE_CONSTRAINTS.technical_doc.langOverrides.fr
assert(frOverride.some(l => l.includes('Decimal comma')), 'D4 fr 小数逗号规则保留')

// ────────────────────────────────────────────────────────────
console.log('\nE. 场景隔离（ecommerce 不受影响）')

const styleCardEcom = getStyleCard('ja', null, 'standard', 'ecommerce')
assert(!styleCardEcom.includes('仕様書は敬語'), 'E1 ecommerce 不注入仕様書语体规则')
const techScene = getSceneConstraints('technical_params', 'ja', true)
const ecomScene = getSceneConstraints('ecommerce', 'ja', true)
assert(techScene !== ecomScene, 'E2 technical_params 与 ecommerce 场景卡不同')

// ────────────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
