// ============================================================
// v12.31 技术语域卡 + 场景×营销两层矩阵
// ============================================================
// 背景（用户拍板）：翻译配置的产品线 tone + style guide 是围绕「商品详情页」
//   的营销受众/语气设计；非详情页（规格书/说明书/包装/UI/合规）默认严谨专业，
//   由技术语域卡统一承载，跳过营销两层。
// 注入矩阵（冲突审计定稿）：
//   详情页 ecommerce  → 跳过技术语域卡；注入产品线 tone + style guide
//   非详情页其余      → 注入技术语域卡（第1-6条）；跳过产品线 tone + style guide
// 覆盖：
//   A 技术语域卡 20 语种渲染（关键语种非空 + 接口名/版本命名/速度代号/单位在卡内）
//   B 场景×营销两层矩阵（详情页有 tone+style 无技术卡；非详情页有技术卡无 tone+style）
//   C 技术语域卡内容（第5条限定规格描述、第6条非详情页；第1-4条纯形式）
//   D 冲突护栏（详情页不注技术卡第5条「去营销」；非详情页不注营销 tone）
// ============================================================

/// <reference types="node" />

import { getStyleCard, getTechnicalRegister, TECHNICAL_REGISTER } from '../lib/prompt-constants'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

// ────────────────────────────────────────────────────────────
console.log('\nA. 技术语域卡 20 语种渲染')

// A1: 关键语种技术卡非空
for (const lang of ['zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr']) {
  const card = getTechnicalRegister(lang)
  assert(card.length > 0, `A1-${lang} 技术语域卡非空`)
}
// A2: 无 override 的语种回退 default（英文）
const fallback = getTechnicalRegister('xx-XX')
assert(fallback === TECHNICAL_REGISTER['default'], 'A2 未知语种回退英文 default')
// A3: 接口名/版本/速度代号/单位在卡内（en）
const enCard = getTechnicalRegister('en')
assert(/PCIe|NVMe|CFexpress/.test(enCard), 'A3-接口名 在卡内（PCIe/NVMe/CFexpress）')
assert(/USB 3\.2 Gen 1|Gen 2x2/.test(enCard), 'A3-版本命名 在卡内（USB 3.2 Gen 1/Gen 2x2）')
assert(/V30|V60|V90/.test(enCard), 'A3-速度代号 在卡内（V30/V60/V90）')
assert(/500 GB|MB\/s|TBW|DWPD/.test(enCard), 'A3-单位 在卡内（500 GB/MB/s/TBW/DWPD）')

// ────────────────────────────────────────────────────────────
console.log('\nB. 场景×营销两层矩阵')

// B1: 详情页 → 无技术语域卡，有产品线 tone
const ecommerce = getStyleCard('zh-CN', 'gaming_dimm', 'marketing', 'ecommerce')
assert(!/技术语域|Technical Register/.test(ecommerce), 'B1 详情页不注入技术语域卡')
assert(/产品调性|Product Tone/.test(ecommerce), 'B2 详情页注入产品线 tone guide')

// B2: 详情页无产品线时 → 有 style guide（营销调）
//   注意：getProductLineTone(null) 返回「通用存储」调性非空，v8.6 既有逻辑会抑制 style guide
//   （这是 v8.6 既有行为不是 v12.31 改动）——style guide 抑制键是 productTone 非空
const ecommerceStyle = getStyleCard('zh-CN', null, 'marketing', 'ecommerce')
assert(/产品调性|Product Tone/.test(ecommerceStyle), 'B3 详情页（无产品线）通用调性在（v8.6 抑制 style guide 的既有行为）')
assert(!/风格·营销|Style·Marketing/.test(ecommerceStyle), 'B3b 详情页（无产品线）style guide 被通用调性抑制（v8.6 既有）')

// B3: 规格书 → 有技术语域卡，无产品线 tone
const spec = getStyleCard('zh-CN', 'gaming_dimm', 'marketing', 'spec_sheet')
assert(/技术语域|Technical Register/.test(spec), 'B4 规格书注入技术语域卡')
assert(!/产品调性|Product Tone/.test(spec), 'B5 规格书跳过产品线 tone guide')
assert(!/风格·营销|Style·Marketing/.test(spec), 'B6 规格书跳过 style guide 营销调')

// B4: 说明书/包装/UI/合规 → 有技术语域卡
for (const scene of ['manual', 'packaging', 'ui', 'after_sales']) {
  const card = getStyleCard('zh-CN', 'gaming_dimm', 'marketing', scene)
  assert(/技术语域|Technical Register/.test(card), `B7-${scene} 非详情页注入技术语域卡`)
  assert(!/产品调性|Product Tone/.test(card), `B8-${scene} 非详情页跳过产品线 tone`)
}

// ────────────────────────────────────────────────────────────
console.log('\nC. 技术语域卡内容（第5条限定 + 第6条非详情页）')

const zhCard = getTechnicalRegister('zh-CN')
// C1: 第5条限定「规格描述」，UI 操作指引/包装正面营销不受限
assert(/UI 操作指引|包装正面营销/.test(zhCard), 'C1 第5条限定范围（UI 操作指引/包装正面营销不受限）')
// C2: 第6条耐力术语
assert(/TBW|DWPD|MTBF|有限终身质保/.test(zhCard), 'C2 第6条耐力/可靠性术语')
// C3: 第1条接口名
assert(/接口\/协议名|Interface\/protocol/.test(zhCard), 'C3 第1条接口名保英文')

// ────────────────────────────────────────────────────────────
console.log('\nD. 冲突护栏')

// D1: 详情页不注入「去营销」第5条（避免和营销 tone 打架）
const ecommerceCheck = getStyleCard('zh-CN', 'gaming_dimm', 'marketing', 'ecommerce')
assert(!/规格.*陈述客观化|Spec.*objective/.test(ecommerceCheck), 'D1 详情页不注入技术卡第5条「去营销」')
// D2: 规格书注入技术卡第5条（和 v12.26 规格书语体同向加强）
const specCheck = getStyleCard('zh-CN', null, null as any, 'spec_sheet')
assert(/客观化|objective|objectively/i.test(specCheck), 'D2 规格书注入技术卡第5条客观化（同向加强）')
// D3: 非详情页多语种（de）技术卡 + 无 tone
const specDe = getStyleCard('de', 'gaming_dimm', 'marketing', 'spec_sheet')
assert(/Technical Register|技术语域/.test(specDe), 'D3 de 规格书注入技术语域卡')
assert(!/Product Tone|产品调性/.test(specDe), 'D4 de 规格书跳过产品线 tone')

// ────────────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
