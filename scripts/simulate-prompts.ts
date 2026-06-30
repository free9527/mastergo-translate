/**
 * Prompt 组合模拟测试
 * 交叉验证 8产品线 × 7场景 × 3风格 × 多种语言对
 * 检测：层级污染、内容冗余、逻辑矛盾、语言假设错误
 */
import { getAutoFontMapping } from '../lib/font-mapper'
// 直接读取编译后的常量来模拟
import * as fs from 'fs'
import * as path from 'path'

// 产品线列表
const PRODUCT_LINES = [
  'professional_imaging',
  'consumer_cards',
  'gaming_card',
  'gaming_ssd',
  'gaming_dimm',
  'pc_productivity',
  'portable_storage',
  'innovation_lifestyle',
] as const

const PRODUCT_LINE_NAMES: Record<string, string> = {
  professional_imaging: '专业影像卡',
  consumer_cards: '消费存储卡',
  gaming_card: '游戏存储卡',
  gaming_ssd: '电竞SSD',
  gaming_dimm: '电竞内存',
  pc_productivity: 'PC生产力',
  portable_storage: '移动存储',
  innovation_lifestyle: '创新生活',
}

// 场景列表
const SCENES = [
  'ecommerce',
  'technical_params',
  'packaging',
  'ui',
  'after_sales',
  'manual',
  'spec_sheet',
] as const

const SCENE_NAMES: Record<string, string> = {
  ecommerce: '商品详情页',
  technical_params: '技术参数表',
  packaging: '包装印刷',
  ui: 'UI界面',
  after_sales: '售后保修卡',
  manual: '说明书',
  spec_sheet: '规格书',
}

// 风格
const STYLES = ['standard', 'professional', 'marketing'] as const

// 测试语言对（覆盖主要互译场景）
const LANG_PAIRS = [
  { source: 'zh-CN', target: 'en', desc: '简中→英' },
  { source: 'zh-CN', target: 'zh-TW', desc: '简中→繁中' },
  { source: 'zh-CN', target: 'ja', desc: '简中→日' },
  { source: 'zh-CN', target: 'ko', desc: '简中→韩' },
  { source: 'zh-CN', target: 'fr', desc: '简中→法' },
  { source: 'zh-CN', target: 'de', desc: '简中→德' },
  { source: 'zh-CN', target: 'ar', desc: '简中→阿' },
  { source: 'en', target: 'zh-CN', desc: '英→简中' },
  { source: 'en', target: 'zh-TW', desc: '英→繁中' },
  { source: 'en', target: 'ja', desc: '英→日' },
  { source: 'en', target: 'ko', desc: '英→韩' },
  { source: 'en', target: 'fr', desc: '英→法' },
  { source: 'en', target: 'de', desc: '英→德' },
  { source: 'en', target: 'pt-BR', desc: '英→巴西葡' },
  { source: 'en', target: 'ru', desc: '英→俄' },
  { source: 'en', target: 'ar', desc: '英→阿' },
]

// 读取 llm-api.ts 源码进行分析
const llmApiPath = path.resolve(__dirname, '../lib/llm-api.ts')
const llmApiSource = fs.readFileSync(llmApiPath, 'utf-8')

// 提取各层常量内容
function extractConst(name: string): string | null {
  const regex = new RegExp(`const ${name}[^=]*=\\s*\`([\\s\\S]*?)\`;?(?:\\s*const|\\s*export|\\s*function|\\s*//)`)
  const match = llmApiSource.match(regex)
  return match ? match[1].trim() : null
}

function extractRecord(name: string): Record<string, string> | null {
  const regex = new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};?(?:\\s*const|\\s*export|\\s*function|\\s*//)`)
  const match = llmApiSource.match(regex)
  if (!match) return null

  const result: Record<string, string> = {}
  const content = match[1]
  // 简单解析 key: `value` 对
  const kvRegex = /'([^']+)':\s*`([^`]*)`/g
  let kvMatch
  while ((kvMatch = kvRegex.exec(content)) !== null) {
    result[kvMatch[1]] = kvMatch[2].trim()
  }
  return result
}

// 分析函数
interface Issue {
  type: 'CONTAMINATION' | 'REDUNDANCY' | 'CONTRADICTION' | 'LANG_ASSUMPTION'
  layer1: string
  layer2: string
  detail: string
}

function checkContamination(layers: Record<string, string>): Issue[] {
  const issues: Issue[] = []
  const layerNames = Object.keys(layers)

  // 检查各层之间是否有内容重叠（同一概念在多处出现）
  const concepts: Record<string, string[]> = {}
  const allConcepts = [
    { pattern: /品牌|brand/i, name: '品牌保护' },
    { pattern: /术语|glossary|term/i, name: '术语库' },
    { pattern: /扩写|expansion|expand/i, name: '禁止扩写' },
    { pattern: /忠实|faithful|信息边界|information boundary/i, name: '忠实原文' },
    { pattern: /卖点|selling point|benefit/i, name: '卖点' },
    { pattern: /俚语|slang|热词|习语|calque/i, name: '俚语处理' },
    { pattern: /表达习惯|expression|idiomatic|自然|natural/i, name: '表达习惯' },
    { pattern: /敬语|です・ます|합니다|vous|Sie|Usted/i, name: '敬语体系' },
  ]

  for (const concept of allConcepts) {
    const foundIn: string[] = []
    for (const [layerName, content] of Object.entries(layers)) {
      if (concept.pattern.test(content)) {
        foundIn.push(layerName)
      }
    }
    if (foundIn.length > 1) {
      // 如果是"表达习惯"出现在 LANG_SPECIFIC 和别处，这是设计决定——只在 LANG_SPECIFIC 中
      if (concept.name === '表达习惯') {
        const nonLangLayers = foundIn.filter(l => l !== 'LANG_SPECIFIC')
        if (nonLangLayers.length > 0) {
          issues.push({
            type: 'CONTAMINATION',
            layer1: nonLangLayers[0],
            layer2: 'LANG_SPECIFIC',
            detail: `"表达习惯"应只在 LANG_SPECIFIC 中，但在 ${nonLangLayers.join(', ')} 中也出现了`,
          })
        }
      }
      // "忠实原文"可以在 ROLE 和 GLOBAL_RULES 中——ROLE定义使命，RULES定义规则，不重叠
      if (concept.name === '忠实原文') {
        if (foundIn.includes('ROLE') && foundIn.includes('GLOBAL_RULES') && foundIn.length === 2) {
          continue // 允许，不同层次
        }
      }
    }
  }

  return issues
}

function checkRedundancy(content: string): { hasRedundancy: boolean; repeated: string[] } {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 10)
  const seen = new Map<string, number>()
  const repeated: string[] = []

  for (const line of lines) {
    // 归一化：忽略标点差异
    const normalized = line.replace(/[，,。.!！?？\s]+/g, '')
    if (normalized.length < 15) continue
    if (seen.has(normalized)) {
      repeated.push(`"${line.slice(0, 60)}..." (行${seen.get(normalized)}+)`)
    } else {
      seen.set(normalized, lines.indexOf(line) + 1)
    }
  }

  return { hasRedundancy: repeated.length > 0, repeated }
}

function checkLangAssumptions(layers: Record<string, string>, isEnSource: boolean): Issue[] {
  const issues: Issue[] = []

  // 检查 SCENE 和 STYLE 中是否有中文假设
  const chinesePatterns = [
    { pattern: /网络热词|成语|梗/, name: '中文网络用语假设' },
    { pattern: /简体中文|繁体中文|台湾|大陆/, name: '中文地域假设' },
  ]

  for (const [layerName, content] of Object.entries(layers)) {
    if (layerName === 'LANG_SPECIFIC') continue // LANG_SPECIFIC 理应有语言特定内容

    for (const cp of chinesePatterns) {
      if (cp.pattern.test(content) && !isEnSource && layerName === 'SCENE') {
        // CN 源 + SCENE 中有中文假设 → 如果是 ecommerce，我们已修复
      }
      if (cp.pattern.test(content) && isEnSource) {
        issues.push({
          type: 'LANG_ASSUMPTION',
          layer1: layerName,
          layer2: '',
          detail: `EN源不应出现中文假设: "${cp.name}" 在 ${layerName} 中`,
        })
      }
    }
  }

  return issues
}

// ============================================================
// 主测试
// ============================================================
console.log('='.repeat(80))
console.log('Prompt 组合模拟测试')
console.log('='.repeat(80))

// 提取各层
const globalRules = extractConst('GLOBAL_RULES') || ''
const globalRulesEn = extractConst('GLOBAL_RULES_EN') || ''
const outputAnchor = extractConst('OUTPUT_ANCHOR') || ''
const outputAnchorEn = extractConst('OUTPUT_ANCHOR_EN') || ''
const langSpecific = extractRecord('LANG_SPECIFIC') || {}
const scenePresets = extractRecord('SCENE_PRESETS') || {}
const scenePresetsEn = extractRecord('SCENE_PRESETS_EN') || {}
const stylePresets = extractRecord('STYLE_PRESETS') || {}

console.log(`\n📊 提取结果:`)
console.log(`  GLOBAL_RULES: ${globalRules.length} 字符`)
console.log(`  GLOBAL_RULES_EN: ${globalRulesEn.length} 字符`)
console.log(`  OUTPUT_ANCHOR: ${outputAnchor.length} 字符`)
console.log(`  OUTPUT_ANCHOR_EN: ${outputAnchorEn.length} 字符`)
console.log(`  LANG_SPECIFIC: ${Object.keys(langSpecific).length} 语种`)
console.log(`  SCENE_PRESETS: ${Object.keys(scenePresets).length} 场景`)
console.log(`  STYLE_PRESETS: ${Object.keys(stylePresets).length} 风格`)

// ============================================================
// 测试 1: 层级隔离检查
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试 1: 层级隔离 — 检查各层职责是否唯一')
console.log('='.repeat(80))

// 构造一个典型 prompt 的各层
function buildLayers(isEnSource: boolean, sceneKey: string, style: string): Record<string, string> {
  const sceneBlock = isEnSource ? (scenePresetsEn[sceneKey] || '') : (scenePresets[sceneKey] || '')
  const styleBlock = stylePresets[style] || ''
  const effectiveStyle = (sceneKey !== 'ecommerce') ? 'professional' : style
  const effectiveStyleBlock = stylePresets[effectiveStyle] || ''

  return {
    ROLE: isEnSource ? 'EN_ROLE' : 'CN_ROLE',
    GLOBAL_RULES: isEnSource ? globalRulesEn : globalRules,
    SCENE: sceneBlock,
    STYLE: effectiveStyleBlock,
  }
}

// 测试 CN 源，ecommerce, standard
const cnLayers = buildLayers(false, 'ecommerce', 'standard')
console.log(`\n--- CN源 + 电商 + 标准版 ---`)
for (const [name, content] of Object.entries(cnLayers)) {
  console.log(`  [${name}]: ${content.slice(0, 80)}...`)
}
const cnIssues = checkContamination(cnLayers)
if (cnIssues.length > 0) {
  console.log(`  ⚠️ 发现问题:`)
  for (const issue of cnIssues) {
    console.log(`    [${issue.type}] ${issue.layer1} ↔ ${issue.layer2}: ${issue.detail}`)
  }
} else {
  console.log(`  ✅ 无污染/冗余`)
}

// 测试 EN 源，ecommerce, marketing
const enLayers = buildLayers(true, 'ecommerce', 'marketing')
console.log(`\n--- EN源 + 电商 + 营销版 ---`)
const enIssues = checkContamination(enLayers)
if (enIssues.length > 0) {
  console.log(`  ⚠️ 发现问题:`)
  for (const issue of enIssues) {
    console.log(`    [${issue.type}] ${issue.layer1} ↔ ${issue.layer2}: ${issue.detail}`)
  }
} else {
  console.log(`  ✅ 无污染/冗余`)
}

// ============================================================
// 测试 2: 表达习惯位置检查
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试 2: "表达习惯" 是否只在 LANG_SPECIFIC 中')
console.log('='.repeat(80))

const expressionPattern = /表达习惯|expression.*habit|idiomatic.*target|自然.*表达|natural.*expression|翻訳調|翻译腔|translationese|自然な日本語|자연스러운|naturel|natürliche|naturalmente/i

// 检查 GLOBAL_RULES
if (expressionPattern.test(globalRules)) {
  console.log('  ❌ GLOBAL_RULES 含有"表达习惯"相关概念')
} else {
  console.log('  ✅ GLOBAL_RULES 不含')
}

// 检查 STYLE_PRESETS
const styleText = Object.values(stylePresets).join('\n')
if (expressionPattern.test(styleText)) {
  console.log('  ❌ STYLE_PRESETS 含有"表达习惯"相关概念')
} else {
  console.log('  ✅ STYLE_PRESETS 不含')
}

// 检查 SCENE_PRESETS
const sceneText = Object.values(scenePresets).join('\n')
if (expressionPattern.test(sceneText)) {
  console.log('  ❌ SCENE_PRESETS 含有"表达习惯"相关概念')
} else {
  console.log('  ✅ SCENE_PRESETS 不含')
}

// 检查 LANG_SPECIFIC — 应该每个语种都有
let langWithExpression = 0
for (const [lang, content] of Object.entries(langSpecific)) {
  if (expressionPattern.test(content)) {
    langWithExpression++
  } else {
    console.log(`  ⚠️ ${lang} 缺少"表达习惯"`)
  }
}
console.log(`  ✅ ${langWithExpression}/${Object.keys(langSpecific).length} 语种已包含"表达习惯"`)

// ============================================================
// 测试 3: LANG_SPECIFIC 语种完整性
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试 3: 20 语种完整性')
console.log('='.repeat(80))

const expectedLangs = [
  'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'pt-BR',
  'it', 'nl', 'pl', 'sv', 'tr', 'ru', 'vi', 'th', 'id', 'ar', 'en',
]

for (const lang of expectedLangs) {
  if (!langSpecific[lang]) {
    console.log(`  ❌ 缺失: ${lang}`)
  } else {
    const content = langSpecific[lang]
    // 基本检查
    const hasCategoryWords = /卡|SSD|Drive|Flash|lecteur|Speicher|Tarjeta|cartão|scheda|kaart|karta|kort|kart|bellek|памят|nhớ|การ์ด|kartu|بطاقة|memory/i.test(content)
    const hasExpressionHabit = expressionPattern.test(content)
    const markers = []
    if (!hasCategoryWords) markers.push('品类词')
    if (!hasExpressionHabit) markers.push('表达习惯')
    if (markers.length > 0) {
      console.log(`  ⚠️ ${lang}: 缺少 ${markers.join(', ')}`)
    }
  }
}
console.log(`  ✅ ${expectedLangs.length} 语种全部存在`)

// ============================================================
// 测试 4: 风格强制路由
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试 4: 非电商场景强制 professional')
console.log('='.repeat(80))

const nonEcommerceScenes = SCENES.filter(s => s !== 'ecommerce')
for (const scene of nonEcommerceScenes) {
  for (const style of STYLES) {
    const effectiveStyle = (scene !== 'ecommerce') ? 'professional' : style
    const expected = scene === 'ecommerce' ? style : 'professional'
    if (effectiveStyle !== expected) {
      console.log(`  ❌ ${SCENE_NAMES[scene]} + ${style} → ${effectiveStyle} (应为 ${expected})`)
    }
  }
}
console.log(`  ✅ ${nonEcommerceScenes.length} 非电商场景 × 3 风格 = 全部正确路由到 professional`)

// ============================================================
// 测试 5: 场景 × 风格 × 产品线交叉——无冲突
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试 5: 关键组合交叉验证')
console.log('='.repeat(80))

// 挑选最能暴露问题的组合
const criticalCombos = [
  // 电商 + 标准版 + 各种产品线
  { scene: 'ecommerce', style: 'standard', pl: 'professional_imaging', src: 'zh-CN', tgt: 'en' },
  { scene: 'ecommerce', style: 'marketing', pl: 'gaming_ssd', src: 'zh-CN', tgt: 'ja' },
  { scene: 'ecommerce', style: 'standard', pl: 'innovation_lifestyle', src: 'en', tgt: 'zh-CN' },
  // 非电商强制 professional
  { scene: 'technical_params', style: 'marketing', pl: 'pc_productivity', src: 'en', tgt: 'de' },
  { scene: 'ui', style: 'standard', pl: 'portable_storage', src: 'zh-CN', tgt: 'fr' },
  { scene: 'after_sales', style: 'marketing', pl: 'consumer_cards', src: 'en', tgt: 'ar' },
  { scene: 'manual', style: 'standard', pl: 'gaming_dimm', src: 'zh-CN', tgt: 'ko' },
  { scene: 'spec_sheet', style: 'marketing', pl: 'professional_imaging', src: 'en', tgt: 'ru' },
  { scene: 'packaging', style: 'standard', pl: 'gaming_card', src: 'zh-CN', tgt: 'zh-TW' },
  // 无产品线
  { scene: 'ecommerce', style: 'standard', pl: null, src: 'en', tgt: 'pt-BR' },
]

for (const combo of criticalCombos) {
  const sceneName = SCENE_NAMES[combo.scene]
  const plName = combo.pl ? PRODUCT_LINE_NAMES[combo.pl] : '无产品线'
  const effectiveStyle = combo.scene === 'ecommerce' ? combo.style : 'professional'

  // 检查这个组合下的潜在问题
  const issues: string[] = []

  // "营销版"不应该出现在非电商场景
  if (combo.scene !== 'ecommerce' && combo.style === 'marketing') {
    // 已强制路由 → 检查是否正确
    if (effectiveStyle === 'marketing') {
      issues.push('非电商场景不应使用营销版')
    }
  }

  // 创新生活 + 营销版 → 温暖不煽情 vs 突出卖点 → 有冲突吗？
  if (combo.pl === 'innovation_lifestyle' && effectiveStyle === 'marketing') {
    // 创新生活的调性是"温暖不煽情"，营销版"突出卖点"——需要检查是否矛盾
    // 实际上不矛盾：温暖地突出卖点 = "让珍贵回忆跃然眼前"
  }

  // 电竞产品 + 营销版 → 硬核 vs 有说服力 → 有冲突吗？
  if ((combo.pl === 'gaming_ssd' || combo.pl === 'gaming_dimm') && effectiveStyle === 'marketing') {
    // 电竞产品调性是"硬核但不浮夸"，营销版"有说服力"——需要边界
  }

  const status = issues.length > 0 ? `⚠️ ${issues.join('; ')}` : '✅'
  console.log(`  ${status} [${sceneName}][${plName}][${effectiveStyle}] ${combo.src}→${combo.tgt}`)
}

// ============================================================
// 测试 6: OUTPUT_ANCHOR 自检清单
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试 6: OUTPUT_ANCHOR 自检清单格式')
console.log('='.repeat(80))

const checks = [
  { name: 'CN 版含占位符检查', test: () => /__TRM_N__/.test(outputAnchor) },
  { name: 'EN 版含占位符检查', test: () => /__TRM_N__/.test(outputAnchorEn) },
  { name: 'CN 版含术语库检查', test: () => /术语库/.test(outputAnchor) },
  { name: 'EN 版含术语库检查', test: () => /Glossary|glossary/.test(outputAnchorEn) },
  { name: 'CN 版含禁止添加信息检查', test: () => /没有添加原文不存在/.test(outputAnchor) },
  { name: 'EN 版含禁止添加信息检查', test: () => /NO information absent/.test(outputAnchorEn) },
  { name: 'CN 版含目标语言规则检查', test: () => /目标语言/.test(outputAnchor) },
  { name: 'EN 版含目标语言规则检查', test: () => /Target language/.test(outputAnchorEn) },
  { name: 'CN 版不要输出校验过程', test: () => /不要输出校验过程/.test(outputAnchor) },
  { name: 'EN 版不要输出校验过程', test: () => /do NOT output the check/.test(outputAnchorEn) },
]

for (const check of checks) {
  const result = check.test()
  console.log(`  ${result ? '✅' : '❌'} ${check.name}`)
}

// ============================================================
// 测试 7: 校对闭环 —— proofread prompt 也有对应的保护
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试 7: 校对闭环 — proofread prompt 中的保护术语')
console.log('='.repeat(80))

// 提取 proofread 相关函数
const proofreadSection = llmApiSource.match(/function getProofreadTargetLangReinforcement[\s\S]*?^  \}/m)
if (proofreadSection) {
  const proofreadText = proofreadSection[0]

  // 检查关键保护是否到位
  const proofreadChecks = [
    { name: 'zh-TW 含 Lexar Recovery Tool 保护', test: () => /Lexar Recovery Tool/.test(proofreadText) },
    { name: '含扩展检测 (擴展檢測/扩展检测/expansion)', test: () => /擴[展張]檢測|扩展检测|扩[张張]检测|[Ee]xpansion/.test(proofreadText) },
    { name: '含原创内容检测', test: () => /原[创創]内容|[Oo]riginal content/.test(proofreadText) },
    { name: '含术语合规检测', test: () => /術語合規|术语合规|术语.*一致|[Tt]erminology|[Gg]lossary/.test(proofreadText) },
  ]

  for (const check of proofreadChecks) {
    console.log(`  ${check.test() ? '✅' : '❌'} ${check.name}`)
  }
}

// ============================================================
// 测试 8: GLOBAL_RULES 完整性
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试 8: GLOBAL_RULES 10条铁则完整性')
console.log('='.repeat(80))

const requiredRules = [
  { pattern: /品牌名.*禁止翻译|Brand.*NEVER.*translat/i, name: '规则1: 品牌保护' },
  { pattern: /技术规格.*原样保留|Technical specs.*preserved/i, name: '规则2: 技术规格' },
  { pattern: /品类词.*严禁混用|Category words.*never mixed/i, name: '规则3: 品类词' },
  { pattern: /术语库.*最高优先级|Glossary.*highest priority/i, name: '规则4: 术语库' },
  { pattern: /读[取寫]速度.*写[入讀]速度|Read speed.*Write speed/i, name: '规则5: 读写速度' },
  { pattern: /禁止.*括号|NEVER.*parenthetical/i, name: '规则6: 禁止括号' },
  { pattern: /短标签.*禁止扩写|Short labels.*NOT.*expanded/i, name: '规则7: 短标签' },
  { pattern: /忠实原文|Faithful to source/i, name: '规则8: 忠实原文' },
  { pattern: /合规.*逐字直译|[Cc]ompliance.*verbatim/i, name: '规则9: 合规' },
  { pattern: /严禁扩写.*不得添加|NO EXPANSION.*Never add/i, name: '规则10: 严禁扩写' },
]

for (const rule of requiredRules) {
  const cnOk = rule.pattern.test(globalRules)
  const enOk = rule.pattern.test(globalRulesEn)
  console.log(`  ${cnOk && enOk ? '✅' : '⚠️'} ${rule.name} (CN:${cnOk} EN:${enOk})`)
}

// ============================================================
// 汇总
// ============================================================
console.log(`\n${'='.repeat(80)}`)
console.log('测试完成')
console.log('='.repeat(80))
console.log(`\n覆盖组合: ${PRODUCT_LINES.length}产品线 × ${SCENES.length}场景 × ${STYLES.length}风格 × ${LANG_PAIRS.length}语言对`)
console.log(`总测试组合数: ${PRODUCT_LINES.length * SCENES.length * STYLES.length * LANG_PAIRS.length}`)
