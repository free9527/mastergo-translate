/**
 * 当前架构 System Prompt 模拟测试
 *
 * 覆盖：电商/非电商 × CJK/非CJK × 有/无产品线 × 校对
 * 检查：模块完整性、冗余、语言污染、校对闭环
 *
 * Usage: npx tsx scripts/simulate-current-prompts.ts
 */
import { buildSystemPrompt } from '../lib/llm-api'
import {
  IRON_RULES,
  getProductLineTone,
  getStyleGuide,
  getLangSpecificPrompt,
  getCategoryWordGuide,
  getFewShotExamplesV2,
  OUTPUT_ANCHOR,
  PROOFREAD_SYSTEM_PROMPT,
  getProofreadQualityInstruction,
} from '../lib/prompt-constants'

const EN_LANG_NAMES: Record<string, string> = {
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', 'en': 'English',
  'ja': 'Japanese', 'ko': 'Korean', 'fr': 'French', 'de': 'German',
  'es': 'Spanish', 'pt': 'Portuguese', 'pt-BR': 'Brazilian Portuguese',
  'ru': 'Russian', 'it': 'Italian', 'vi': 'Vietnamese', 'th': 'Thai',
  'id': 'Indonesian', 'ar': 'Arabic', 'nl': 'Dutch', 'pl': 'Polish',
  'sv': 'Swedish', 'tr': 'Turkish',
}

interface Scenario {
  id: string; targetLang: string; productLine: string | null
  scene: string; style: string; desc: string
}

const scenarios: Scenario[] = [
  // Ecommerce (full modules)
  { id: 'A1', targetLang: 'ja', productLine: 'gaming_ssd', scene: 'ecommerce', style: 'marketing',
    desc: '日语·电竞SSD·电商·营销 — 完整6模块' },
  { id: 'A2', targetLang: 'zh-CN', productLine: 'professional_imaging', scene: 'ecommerce', style: 'standard',
    desc: '简中·专业影像·电商·标准 — CJK指令' },
  { id: 'A3', targetLang: 'de', productLine: null, scene: 'ecommerce', style: 'standard',
    desc: '德语·无产品线·电商·标准 — 回退+非CJK指令' },
  // Non-ecommerce (no M2/M4)
  { id: 'B1', targetLang: 'de', productLine: 'pc_productivity', scene: 'spec_sheet', style: 'standard',
    desc: '德语·PC生产力·规格书 — 非电商无M2/M4' },
  { id: 'B2', targetLang: 'ja', productLine: 'professional_imaging', scene: 'manual', style: 'professional',
    desc: '日语·专业影像·说明书 — CJK非电商' },
  { id: 'B3', targetLang: 'fr', productLine: null, scene: 'ui', style: 'standard',
    desc: '法语·无产品线·UI — 最简非电商' },
  // RTL & special
  { id: 'C1', targetLang: 'ar', productLine: 'portable_storage', scene: 'ecommerce', style: 'standard',
    desc: '阿语·移动存储·电商 — RTL' },
  { id: 'C2', targetLang: 'th', productLine: 'consumer_cards', scene: 'packaging', style: 'standard',
    desc: '泰语·消费卡·包装 — 非电商SE Asian' },
]

// ============================================================
// Module detection by tag
// ============================================================
const MODULE_TAGS: Array<{ name: string; tag: string; always: boolean; ecommerceOnly: boolean }> = [
  { name: 'M1 IDENTITY',      tag: '[IDENTITY]',        always: true,  ecommerceOnly: false },
  { name: 'IRON_RULES',       tag: '[IRON RULES]',      always: true,  ecommerceOnly: false },
  { name: 'LANG_SPECIFIC',    tag: '[',                 always: true,  ecommerceOnly: false }, // special: check by targetLang
  { name: 'M2 TONE&STYLE',    tag: 'Product Tone·',     always: false, ecommerceOnly: true },
  { name: 'M2 TONE&STYLE',    tag: '[Style]',           always: false, ecommerceOnly: true },
  { name: 'M4 FEW-SHOT',      tag: '[REFERENCE]',       always: false, ecommerceOnly: true },
  { name: 'M5 OUTPUT',        tag: '[OUTPUT]',          always: true,  ecommerceOnly: false },
]

function checkModulePresence(s: Scenario, prompt: string): string[] {
  const issues: string[] = []
  const isEcommerce = s.scene === 'ecommerce'

  if (!prompt.includes('[IDENTITY]')) issues.push('❌ 缺 M1 IDENTITY')
  if (!prompt.includes('[IRON RULES]')) issues.push('❌ 缺 IRON_RULES')
  if (!prompt.includes('[OUTPUT]')) issues.push('❌ 缺 M5 OUTPUT')

  // LANG_SPECIFIC: check by looking for the target language's section header
  const langHeaders: Record<string, string> = {
    'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'ja': 'ja',
    'ko': 'ko', 'de': 'German-specific', 'fr': 'French-specific',
    'ar': 'Arabic-specific', 'th': 'Thai-specific',
  }
  const expectedHeader = langHeaders[s.targetLang]
  if (expectedHeader && !prompt.includes(expectedHeader)) {
    issues.push(`❌ 缺 LANG_SPECIFIC (${s.targetLang})`)
  }

  // M2/M4 should be present ONLY for ecommerce
  if (isEcommerce) {
    if (!prompt.includes('Product Tone·') && !prompt.includes('製品トーン') && !prompt.includes('产品调性') && !prompt.includes('Produkt-Ton')) {
      issues.push('⚠️ 电商场景缺 Product Tone')
    }
    if (!prompt.includes('[REFERENCE]')) {
      issues.push('⚠️ 电商场景缺 M4 FEW-SHOT')
    }
  } else {
    if (prompt.includes('Product Tone·') || prompt.includes('製品トーン') || prompt.includes('产品调性')) {
      issues.push('❌ 非电商场景不应有 Product Tone')
    }
    if (prompt.includes('[REFERENCE]')) {
      issues.push('❌ 非电商场景不应有 M4 FEW-SHOT')
    }
    if (prompt.includes('[Style]') || prompt.includes('[风格]') || prompt.includes('[スタイル]')) {
      issues.push('❌ 非电商场景不应有 Style Guide')
    }
  }

  return issues
}

function checkRedundancy(prompt: string): string[] {
  const issues: string[] = []

  // "highest authority" should appear exactly once
  const authCount = (prompt.match(/highest authority/gi) || []).length
  if (authCount > 1) issues.push(`⚠️ "highest authority" 出现 ${authCount} 次`)

  // "GLOSSARY SUPREMACY" should appear exactly once
  const supremacyCount = (prompt.match(/GLOSSARY SUPREMACY/gi) || []).length
  if (supremacyCount > 1) issues.push(`⚠️ "GLOSSARY SUPREMACY" 出现 ${supremacyCount} 次`)

  // ZZ[N]ZZ should not have separate PRESERVATION RULE
  if (prompt.includes('PRESERVATION RULE')) {
    issues.push('⚠️ 存在独立的 PRESERVATION RULE (应合并到 IRON_RULES #6)')
  }

  // "No additions" / "No omissions" should not repeat
  const noAddCount = (prompt.match(/no additions|no omissions|no parentheticals/gi) || []).length
  if (noAddCount > 2) issues.push(`⚠️ "no additions/omissions" 出现 ${noAddCount} 次`)

  return issues
}

function checkLanguageContamination(s: Scenario, prompt: string): string[] {
  const issues: string[] = []
  const isCJK = ['zh-CN', 'zh-TW', 'ja', 'ko'].includes(s.targetLang)

  // IRON_RULES section must be English
  const rulesStart = prompt.indexOf('[IRON RULES]')
  const rulesEnd = prompt.indexOf('\n\n', prompt.indexOf('COMPLIANCE & PLACEHOLDERS'))
  if (rulesStart >= 0) {
    const rulesSection = prompt.slice(rulesStart, rulesEnd > 0 ? rulesEnd : undefined)
    // Remove brand name 雷克沙 (intentional in role section, not in rules)
    const rulesClean = rulesSection.replace(/雷克沙/g, '')
    if (/[一-鿿]/.test(rulesClean)) {
      issues.push('❌ IRON_RULES 段出现 CJK 字符')
    }
  }

  // OUTPUT section must be English
  const outStart = prompt.lastIndexOf('[OUTPUT]')
  if (outStart >= 0) {
    const outSection = prompt.slice(outStart)
    if (/[一-鿿]/.test(outSection)) {
      issues.push('❌ OUTPUT 段出现 CJK 字符')
    }
  }

  return issues
}

function checkProofreadAssembly(): string[] {
  const issues: string[] = []

  // Simulate proofread prompt assembly (matching proofreadBatch logic)
  const proofSystemPrompt = IRON_RULES + '\n\n' + PROOFREAD_SYSTEM_PROMPT

  if (!proofSystemPrompt.includes('[IRON RULES]')) {
    issues.push('❌ 校对缺 IRON_RULES')
  }
  if (!proofSystemPrompt.includes('[CHECKLIST]')) {
    issues.push('❌ 校对缺 CHECKLIST')
  }

  // Check all 9 checklist items
  const checks = ['GLOSSARY', 'PLACEHOLDERS', 'ACCURACY', 'TONE', 'NATURALNESS',
    'CJK SPACING', 'BRAND/SPEC INJECTION', 'CATEGORY PRECISION', 'SHORT LABEL']
  for (const c of checks) {
    if (!PROOFREAD_SYSTEM_PROMPT.includes(c)) {
      issues.push(`❌ 校对清单缺: ${c}`)
    }
  }

  // OUTPUT format
  if (!PROOFREAD_SYSTEM_PROMPT.includes('JSON')) {
    issues.push('❌ 校对缺 JSON 输出格式')
  }

  return issues
}

// ============================================================
// Main
// ============================================================

console.log('='.repeat(90))
console.log('  当前架构 System Prompt 模拟测试')
console.log('  模块: M1 → M3 → LANG_SPECIFIC → M2 → M4 → M5')
console.log('  校对: IRON_RULES + PROOFREAD_SYSTEM_PROMPT + glossary + category + lang + quality')
console.log('='.repeat(90))

let totalIssues = 0

for (const s of scenarios) {
  const isEcommerce = s.scene === 'ecommerce'
  const useEnInstruction = !['zh-CN', 'zh-TW', 'ja', 'ko'].includes(s.targetLang)
  const sourceName = EN_LANG_NAMES['en'] || 'English'
  const targetDisplayName = EN_LANG_NAMES[s.targetLang] || s.targetLang

  const categoryWordGuide = getCategoryWordGuide(s.targetLang, s.productLine)
  const langBlock = getLangSpecificPrompt(s.targetLang)
  const fewShot = getFewShotExamplesV2('en', s.targetLang, s.productLine, s.style, 2)

  // Mock glossary
  const glossaryHint = '[GLOSSARY]\n"Lexar" → "Lexar"\n"THOR" → "THOR"\n"SSD" → "SSD"'

  const prompt = buildSystemPrompt({
    targetLang: s.targetLang,
    sourceName,
    targetDisplayName,
    productLine: s.productLine,
    scenePreset: s.scene,
    style: s.style,
    glossaryHint,
    categoryWordGuide,
    langBlock,
    fewShot,
    useEnInstruction,
  })

  console.log(`\n${'─'.repeat(90)}`)
  console.log(`  ${s.id}: ${s.desc}`)
  console.log(`  ${s.targetLang} | ${s.productLine || 'NO-PL'} | ${s.scene} | ${s.style} | ${prompt.length} chars | ecommerce=${isEcommerce}`)
  console.log(`${'─'.repeat(90)}`)

  const allIssues = [
    ...checkModulePresence(s, prompt),
    ...checkRedundancy(prompt),
    ...checkLanguageContamination(s, prompt),
  ]

  if (allIssues.length === 0) {
    console.log(`  ✅ 全部通过`)
  } else {
    for (const issue of allIssues) {
      console.log(`  ${issue}`)
    }
    totalIssues += allIssues.length
  }
}

// ============================================================
// Proofread closed loop check
// ============================================================
console.log(`\n${'─'.repeat(90)}`)
console.log(`  校对闭环检查`)
console.log(`${'─'.repeat(90)}`)

const proofreadIssues = checkProofreadAssembly()
if (proofreadIssues.length === 0) {
  console.log(`  ✅ 校对闭环全部通过`)
} else {
  for (const issue of proofreadIssues) {
    console.log(`  ${issue}`)
  }
  totalIssues += proofreadIssues.length
}

// ============================================================
// Full prompt print: 2 representative scenarios
// ============================================================

console.log(`\n${'='.repeat(90)}`)
console.log('  完整 Prompt 示例 #1: 日语·电商·完整6模块')
console.log('='.repeat(90))

const s1 = scenarios[0] // ja, gaming_ssd, ecommerce, marketing
const p1 = buildSystemPrompt({
  targetLang: s1.targetLang, sourceName: 'English', targetDisplayName: 'Japanese',
  productLine: s1.productLine, scenePreset: s1.scene, style: s1.style,
  glossaryHint: 'Use: "Lexar" → "Lexar"\n  "THOR" → "THOR"\n  "SSD" → "SSD"',
  categoryWordGuide: getCategoryWordGuide(s1.targetLang, s1.productLine),
  langBlock: getLangSpecificPrompt(s1.targetLang),
  fewShot: getFewShotExamplesV2('en', s1.targetLang, s1.productLine, s1.style, 2),
  useEnInstruction: false, // CJK → Chinese instruction
})
console.log(p1)

console.log(`\n${'='.repeat(90)}`)
console.log('  完整 Prompt 示例 #2: 德语·规格书·非电商 (无M2/M4)')
console.log('='.repeat(90))

const s2 = scenarios[3] // de, pc_productivity, spec_sheet, standard
const p2 = buildSystemPrompt({
  targetLang: s2.targetLang, sourceName: 'English', targetDisplayName: 'German',
  productLine: s2.productLine, scenePreset: s2.scene, style: s2.style,
  glossaryHint: 'Use: "SSD" → "SSD"\n  "NVMe" → "NVMe"',
  categoryWordGuide: getCategoryWordGuide(s2.targetLang, s2.productLine),
  langBlock: getLangSpecificPrompt(s2.targetLang),
  fewShot: '', useEnInstruction: true,
})
console.log(p2)

// ============================================================
// Proofread prompt print
// ============================================================
console.log(`\n${'='.repeat(90)}`)
console.log('  校对 System Prompt (日语目标)')
console.log('='.repeat(90))

const proofPrompt = IRON_RULES + '\n\n' + PROOFREAD_SYSTEM_PROMPT +
  '\n[GLOSSARY]\nUse: "Lexar" → "Lexar"' +
  getCategoryWordGuide('ja', 'gaming_ssd') +
  getLangSpecificPrompt('ja') +
  getProofreadQualityInstruction('ja')
console.log(proofPrompt)

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(90)}`)
console.log(`  总结`)
console.log(`  翻译场景: ${scenarios.length} 个`)
console.log(`  发现问题: ${totalIssues} 个`)
console.log('='.repeat(90))
