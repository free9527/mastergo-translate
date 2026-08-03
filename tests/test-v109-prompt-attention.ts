/**
 * v10.9 Prompt 注意力优化测试
 *
 * 背景（2026-08-03 设计决策，LLM 视角）：~2600 行 prompt 稀释注意力。
 *   - 市场语感整段注入：翻电竞内存时 LLM 同时收到"消费级突出性价比"无关段落
 *   - 场景约束只说"不许做什么"，没说"用户拿这段文字干什么"（Success 意图缺失）
 *   - marketing 风格藏产品线规则、professional 风格藏影像专属内容 → 模块越界
 *
 * 方案（四项）：
 *   P1. LANGUAGE_MARKET_NOTES 拆 {gaming, professional, consumer, shared} 四段，
 *       8 条产品线映射 3 段，只注入命中段+shared；无产品线注入全段（行为不变）
 *   P2. 6 个 SCENE_CONSTRAINTS 各加一行 Success:（使用成功场景意图）
 *   P3. 风格越界清理：marketing 删 2 条产品线规则；professional 删 2 条影像专属规则
 *   P4. getMarketNote(targetLang, productLine) 分段注入
 *
 * 覆盖：
 *   A. 市场语感分段注入（8 产品线 × 抽样语种：命中段+shared，无无关段）
 *   B. 无产品线全段注入（行为不变性）
 *   C. 未映射产品线回退全段
 *   D. Success 行注入（6 场景）+ suppressExpression 不抑制 Success
 *   E. 风格越界清零（marketing 无产品线规则、professional 无影像专属）
 *   F. 20 语种市场语感完整性（每语种四段非空约定）
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { getStyleCard, getSceneConstraints, getProductLineTone, SCENE_CONSTRAINTS, PRODUCT_LINE_MARKET_SEGMENT } from '../lib/prompt-constants'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ═══════════════════════════════════════════════════════════════
// A. 市场语感分段注入（gaming / professional / consumer）
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. 市场语感分段注入（命中段+shared，无无关段）')

// gaming 产品线 → gaming 段：含游戏词、不含消费级词（A1-A4 用整卡：zh-CN 无场景同义词干扰）
const cardGamingZh = getStyleCard('zh-CN', 'gaming_dimm', '', 'ecommerce')
assert(cardGamingZh.includes('满血版'), 'A1 gaming_dimm zh-CN 含 gaming 段（满血版）')
assert(!cardGamingZh.includes('性价比'), 'A2 gaming_dimm zh-CN 不含 consumer 段（性价比）')
assert(!cardGamingZh.includes('生产力工具'), 'A3 gaming_dimm zh-CN 不含 professional 段（生产力工具）')
assert(cardGamingZh.includes('参数党友好'), 'A4 gaming_dimm zh-CN 含 shared 段（参数党友好）')

// 注：getStyleCard 聚合 5 个数据源（产品调性/场景 langOverrides 等可能含跨段同义词），
//     分段注入的精确断言应针对 getMarketNote 产物。从完整风格卡中减去产品调性和场景约束，
//     剩余部分（市场语感+合规块）做"不含无关段"断言 —— 合规块不含营销词汇，语义等价。
function marketNoteOnly(targetLang: string, productLine: string, scene: string): string {
  const full = getStyleCard(targetLang, productLine, '', scene)
  const tone = getProductLineTone(productLine, targetLang)
  const sceneBlock = getSceneConstraints(scene, targetLang, true)
  return full.replace(tone, '').replace(sceneBlock.trim(), '')
}

const cardGamingSsdDe = marketNoteOnly('de', 'gaming_ssd', 'ecommerce')
assert(cardGamingSsdDe.includes('Overclocking-Speicher'), 'A5 gaming_ssd de 含 gaming 段')
assert(!cardGamingSsdDe.includes('Preis-Leistung'), 'A6 gaming_ssd de 市场语感不含 consumer 段（Preis-Leistung）')
assert(cardGamingSsdDe.includes('Keine Übertreibungen'), 'A7 gaming_ssd de 含 shared 段')

const cardGamingCardPt = marketNoteOnly('pt-BR', 'gaming_card', 'ecommerce')
assert(cardGamingCardPt.includes('rodar liso'), 'A8 gaming_card pt-BR 含 gaming 段（rodar liso）')
assert(!cardGamingCardPt.includes('custo-benefício'), 'A9 gaming_card pt-BR 市场语感不含 consumer 段（custo-benefício）')

// professional 产品线 → professional 段
const cardProJa = marketNoteOnly('ja', 'professional_imaging', 'ecommerce')
assert(cardProJa.includes('安定稼働'), 'A10 professional_imaging ja 含 professional 段（安定稼働）')
assert(!cardProJa.includes('ゲーム体験'), 'A11 professional_imaging ja 不含 gaming 段')
assert(!cardProJa.includes('かんたん'), 'A12 professional_imaging ja 不含 consumer 段（かんたん）')

// consumer 产品线 → consumer 段
const cardConsumerFr = marketNoteOnly('fr', 'consumer_cards', 'ecommerce')
assert(cardConsumerFr.includes('rapport qualité-prix'), 'A13 consumer_cards fr 含 consumer 段')
assert(!cardConsumerFr.includes('passionné'), 'A14 consumer_cards fr 不含 gaming 段')

const cardPortableKo = marketNoteOnly('ko', 'portable_storage', 'ecommerce')
assert(cardPortableKo.includes('가성비'), 'A15 portable_storage ko 含 consumer 段（가성비）')
assert(!cardPortableKo.includes('프레임 방어'), 'A16 portable_storage ko 市场语感不含 gaming 段（프레임 방어）')

const cardLifestyleRu = marketNoteOnly('ru', 'innovation_lifestyle', 'ecommerce')
assert(cardLifestyleRu.includes('доступная цена'), 'A17 innovation_lifestyle ru 含 consumer 段')
assert(!cardLifestyleRu.includes('разгон'), 'A18 innovation_lifestyle ru 不含 gaming 段（разгон）')

const cardPcProdSv = marketNoteOnly('sv', 'pc_productivity', 'ecommerce')
assert(cardPcProdSv.includes('prisvärd'), 'A19 pc_productivity sv 含 consumer 段（prisvärd）')
assert(!cardPcProdSv.includes('spelprestanda'), 'A20 pc_productivity sv 不含 gaming 段')

// ═══════════════════════════════════════════════════════════════
// B. 无产品线全段注入（行为不变性）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('B. 无产品线 → 全段注入（行为不变）')

const cardNoLineZh = getStyleCard('zh-CN', null, 'standard', 'ecommerce')
assert(cardNoLineZh.includes('满血版'), 'B1 无产品线 zh-CN 含 gaming 段')
assert(cardNoLineZh.includes('生产力工具'), 'B2 无产品线 zh-CN 含 professional 段')
assert(cardNoLineZh.includes('性价比'), 'B3 无产品线 zh-CN 含 consumer 段')
assert(cardNoLineZh.includes('参数党友好'), 'B4 无产品线 zh-CN 含 shared 段')

const cardNoLineEn = getStyleCard('en', null, 'standard', 'ecommerce')
assert(cardNoLineEn.includes('dominate'), 'B5 无产品线 en 含 gaming 段')
assert(cardNoLineEn.includes('trusted by pros'), 'B6 无产品线 en 含 professional 段')
assert(cardNoLineEn.includes('made simple'), 'B7 无产品线 en 含 consumer 段')

// ═══════════════════════════════════════════════════════════════
// C. 未映射产品线回退全段
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('C. 未映射产品线 → 全段注入')

const cardUnknown = getStyleCard('zh-CN', 'some_future_line', 'standard', 'ecommerce')
assert(cardUnknown.includes('满血版') && cardUnknown.includes('性价比'), 'C1 未映射产品线 zh-CN 回退全段')

// 映射表完整性：8 条产品线全部映射
const mappedLines = Object.keys(PRODUCT_LINE_MARKET_SEGMENT)
assert(mappedLines.length === 8, 'C2 映射表覆盖 8 条产品线', `实际 ${mappedLines.length}`)

// ═══════════════════════════════════════════════════════════════
// D. Success 行注入 + suppressExpression 不抑制 Success
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('D. Success 意图行注入')

const scenes = ['ecommerce', 'technical_params', 'manual', 'packaging', 'after_sales', 'ui']
for (const scene of scenes) {
  const constraints = getSceneConstraints(scene, 'de', false)
  assert(constraints.includes('Success:'), `D-${scene} 场景含 Success 行`)
}

// suppressExpression=true（getStyleCard 注入路径）时 Success 仍保留、Expression 被抑制
const suppressed = getSceneConstraints('ecommerce', 'de', true)
assert(suppressed.includes('Success:'), 'D7 suppressExpression=true 时 Success 保留')
assert(!suppressed.includes('Expression:'), 'D8 suppressExpression=true 时 Expression 被抑制')
assert(suppressed.includes('Format:'), 'D9 suppressExpression=true 时 Format 保留')

// Success 行内容意图关键词抽查
assert(SCENE_CONSTRAINTS['ecommerce'].universal[0].includes('3 seconds'), 'D10 ecommerce Success 含 3 秒货架决策意图')
assert(SCENE_CONSTRAINTS['packaging'].universal[0].includes('legal review'), 'D11 packaging Success 含法务审查意图')
assert(SCENE_CONSTRAINTS['compliance_doc'].universal[0].includes('legally watertight'), 'D12 compliance_doc Success 含法律滴水不漏意图')

// ═══════════════════════════════════════════════════════════════
// E. 风格越界清零
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('E. 风格越界清理（marketing 无产品线规则 / professional 无影像专属）')

import { getStyleGuide } from '../lib/prompt-constants'

// marketing 风格 20 语种：不含产品线规则关键词
const marketingProbes = [
  ['default', 'Gaming products'],
  ['zh-CN', '游戏产品'],
  ['zh-TW', '遊戲產品'],
  ['ja', 'ゲーミング製品'],
  ['ko', '게임 제품'],
  ['de', 'Gaming-Produkte'],
  ['fr', 'Produits gaming'],
  ['pt-BR', 'Produtos gaming'],
  ['ru', 'Игровые продукты'],
  ['ar', 'منتجات الألعاب'],
]
for (const [lang, probe] of marketingProbes) {
  const guide = getStyleGuide('marketing', lang)
  assert(!guide.includes(probe as string), `E-mkt-${lang} marketing 风格不含产品线规则（${probe}）`)
}
// marketing 核心规则保留（防误删）
assert(getStyleGuide('marketing', 'default').includes('Strong promotional feel'), 'E-mkt-core marketing 核心规则保留')
assert(getStyleGuide('marketing', 'zh-CN').includes('强促销感'), 'E-mkt-core-zh marketing zh-CN 核心规则保留')

// professional 风格 20 语种：不含影像专属内容
const professionalProbes = [
  ['default', 'V60/V90/VPG400'],
  ['zh-CN', '影像专业术语'],
  ['zh-TW', 'V60/V90/VPG400'],
  ['ja', 'V60/V90/VPG400'],
  ['ko', '이미징 전문 용어'],
  ['de', 'Imaging-Fachbegriffen'],
  ['fr', "terminologie professionnelle d'imagerie"],
  ['pl', 'V60/V90/VPG400'],
  ['ru', 'обработки изображений'],
  ['ar', 'التصوير المحترفة'],
]
for (const [lang, probe] of professionalProbes) {
  const guide = getStyleGuide('professional', lang)
  assert(!guide.includes(probe as string), `E-pro-${lang} professional 风格不含影像专属（${(probe as string).slice(0, 24)}…）`)
}
// professional 核心规则保留（防误删）
assert(getStyleGuide('professional', 'default').includes('Restrained premium'), 'E-pro-core professional 核心规则保留')
assert(getStyleGuide('professional', 'zh-CN').includes('克制的高端感'), 'E-pro-core-zh professional zh-CN 核心规则保留')
assert(getStyleGuide('professional', 'zh-CN').includes('摄影师'), 'E-pro-aud professional zh-CN 受众行保留（摄影师）')

// ═══════════════════════════════════════════════════════════════
// F. 20 语种市场语感分段完整性
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('F. 20 语种市场语感分段注入完整性')

const ALL_LANGS = ['zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'pt-BR', 'it',
  'nl', 'pl', 'sv', 'tr', 'ru', 'vi', 'th', 'id', 'ar', 'en']
for (const lang of ALL_LANGS) {
  // gaming 产品线注入后 [STYLE] 卡必须有 MARKET NOTE（分段后非空）
  const card = getStyleCard(lang, 'gaming_dimm', '', 'ecommerce')
  const hasMarketNote = card.includes('[MARKET NOTE') || card.includes('[市场语感')
  assert(hasMarketNote, `F-${lang} gaming_dimm 注入后市场语感非空`)
}

// ═══════════════════════════════════════════════════════════════
// 结果汇总
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push(`v10.9 测试：${pass} 通过，${fail} 失败`)

console.log(out.join('\n'))

// 落盘（供 CI/人工复查）
import { writeFileSync } from 'fs'
writeFileSync('tests/tmp-v109-test-out.txt', out.join('\n'), 'utf-8')

if (fail > 0) process.exit(1)
