/**
 * 验证全部20语种的 LANG_SPECIFIC 正确注入
 * Usage: npx tsx scripts/check-all-langs.ts
 */
import { buildSystemPrompt } from '../lib/llm-api'
import {
  getLangSpecificPrompt,
  getCategoryWordGuide,
} from '../lib/prompt-constants'

const ALL_LANGS = [
  'zh-CN','zh-TW','ja','ko','fr','de','es','pt','pt-BR',
  'it','nl','pl','sv','tr','ru','vi','th','id','ar','en',
]

// Step 1: Check all LANG_SPECIFIC entries are non-empty
console.log('='.repeat(80))
console.log('  1. LANG_SPECIFIC 数据完整性 (20语种)')
console.log('='.repeat(80))

for (const l of ALL_LANGS) {
  const text = getLangSpecificPrompt(l)
  const ok = text && text.trim().length > 0
  const icon = ok ? '✅' : '❌'
  const firstLine = ok ? text.trim().split('\n')[0].slice(0, 60) : 'EMPTY or MISSING'
  console.log(`  ${icon} ${l.padEnd(6)} | ${String(ok ? text.length : 0).padStart(4)} chars | ${firstLine}`)
}

// Step 2: Verify LANG_SPECIFIC appears in full prompt for each lang (ecommerce + non-ecommerce)
console.log(`\n${'='.repeat(80)}`)
console.log('  2. Prompt注入验证 (翻译 + 校对)')
console.log('='.repeat(80))

const EN_LANG_NAMES: Record<string, string> = {
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', 'en': 'English',
  'ja': 'Japanese', 'ko': 'Korean', 'fr': 'French', 'de': 'German',
  'es': 'Spanish', 'pt': 'Portuguese', 'pt-BR': 'Brazilian Portuguese',
  'ru': 'Russian', 'it': 'Italian', 'vi': 'Vietnamese', 'th': 'Thai',
  'id': 'Indonesian', 'ar': 'Arabic', 'nl': 'Dutch', 'pl': 'Polish',
  'sv': 'Swedish', 'tr': 'Turkish',
}

// Unique header markers for each language's LANG_SPECIFIC section
const LANG_HEADERS: Record<string, string> = {
  'zh-CN': '[zh-CN Guidelines]',
  'zh-TW': '[zh-TW Guidelines]',
  'ja': '[ja Guidelines]',
  'ko': '[ko Guidelines]',
  'fr': '[fr Guidelines]',
  'de': '[de Guidelines]',
  'es': '[es Guidelines]',
  'pt': '[pt Guidelines]',
  'pt-BR': '[pt-BR Guidelines]',
  'it': '[it Guidelines]',
  'nl': '[nl Guidelines]',
  'pl': '[pl Guidelines]',
  'sv': '[sv Guidelines]',
  'tr': '[tr Guidelines]',
  'ru': '[ru Guidelines]',
  'vi': '[vi Guidelines]',
  'th': '[th Guidelines]',
  'id': '[id Guidelines]',
  'ar': '[ar Guidelines]',
  'en': '[en Guidelines]',
}

for (const l of ALL_LANGS) {
  const useEnInstruction = !['zh-CN', 'zh-TW', 'ja', 'ko'].includes(l)
  const prompt = buildSystemPrompt({
    targetLang: l, sourceName: 'English',
    targetDisplayName: EN_LANG_NAMES[l] || l,
    productLine: 'gaming_ssd', scenePreset: 'ecommerce', style: 'standard',
    glossaryHint: '', categoryWordGuide: getCategoryWordGuide(l, 'gaming_ssd'),
    langBlock: getLangSpecificPrompt(l),
    useEnInstruction,
  })

  const nonEcomPrompt = buildSystemPrompt({
    targetLang: l, sourceName: 'English',
    targetDisplayName: EN_LANG_NAMES[l] || l,
    productLine: 'pc_productivity', scenePreset: 'spec_sheet', style: 'standard',
    glossaryHint: '', categoryWordGuide: getCategoryWordGuide(l, 'pc_productivity'),
    langBlock: getLangSpecificPrompt(l), fewShot: '', useEnInstruction,
  })

  const header = LANG_HEADERS[l]
  const inEcom = prompt.includes(header)
  const inNonEcom = nonEcomPrompt.includes(header)

  let status = ''
  if (inEcom && inNonEcom) status = '✅ 电商+非电商'
  else if (inEcom && !inNonEcom) status = '⚠️ 非电商缺失'
  else if (!inEcom && inNonEcom) status = '⚠️ 电商缺失'
  else status = '❌ 两场景均缺失'

  console.log(`  ${status.padEnd(24)} | ${l.padEnd(6)} | ${String(prompt.length).padStart(4)} chars (${header.slice(0, 30)})`)
}

// Step 3: Proofread prompt check for all languages
console.log(`\n${'='.repeat(80)}`)
console.log('  3. 校对闭环验证 (全语种)')
console.log('='.repeat(80))

import { IRON_RULES, PROOFREAD_SYSTEM_PROMPT, getProofreadQualityInstruction } from '../lib/prompt-constants'

for (const l of ALL_LANGS) {
  const proofPrompt = IRON_RULES + '\n\n' + PROOFREAD_SYSTEM_PROMPT +
    getLangSpecificPrompt(l) + getProofreadQualityInstruction(l)
  const header = LANG_HEADERS[l]
  const hasLang = proofPrompt.includes(header)
  const hasQuality = proofPrompt.length > IRON_RULES.length + PROOFREAD_SYSTEM_PROMPT.length + 10
  const icon = hasLang && hasQuality ? '✅' : '❌'
  console.log(`  ${icon} ${l.padEnd(6)} | lang=${hasLang} quality=${hasQuality} | ${proofPrompt.length} chars`)
}

console.log(`\n完成.`)
