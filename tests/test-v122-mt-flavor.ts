/**
 * v12.2 机翻味反面词表（commonErrors 回填首调）测试
 *
 * 背景：v12.1 judge 基线判定 GO（5/19 语种 naturalness<3.5），方案 B 启动——
 * de/es/ru/tr 四语种机翻味反面搭配清单写入 LANG_SPECIFIC.commonErrors，
 * includeCommonErrors 回填首调（llm-api.ts L948，v11.5 半回滚）。
 *
 * 实据纪律：全部条目来自 judge 基线对实机译文的多次独立批评，非凭空归纳。
 * 数字格式 3 条已剔除改修 postProcess（B1a）；tr 语序 1 条已剔除改修生成器配置（B1b）。
 *
 * 用法：
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true,"types":["node"],"rootDir":".","importHelpers":false}' TS_NODE_TRANSPILE_ONLY=true npx ts-node -r tsconfig-paths/register tests/test-v122-mt-flavor.ts
 */

import { buildSystemPrompt } from '../lib/llm-api'
import { buildProofreadSystemPrompt } from '../lib/prompt-constants'

let passed = 0
let failed = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

const baseParams = {
  targetLang: 'de',
  langBlock: '',
  styleCard: '',
  fewShotBlock: '',
  glossaryHint: undefined as string | undefined,
  includeRemediation: false,
}

console.log('═══ A 首调注入（forceTranslate=false 路径）═══')

// A1: de 首调 prompt 含机翻味条目
{
  const prompt = buildSystemPrompt({ ...baseParams, targetLang: 'de', langBlock: '\n[de Guidelines]\n- ❌ Inflated marketing calque (beeindruckende 4-mal schneller) → ✅ Objective statement' })
  assert(prompt.includes('beeindruckende 4-mal schneller'), 'A1 de 首调含机翻味条目（beeindruckende）')
}

// A2: es 首调 prompt 含机翻味条目
{
  const prompt = buildSystemPrompt({ ...baseParams, targetLang: 'es', langBlock: '\n[es Guidelines]\n- ❌ "Level-up" calque (Suba de nivel su experiencia)' })
  assert(prompt.includes('Suba de nivel'), 'A2 es 首调含机翻味条目（Suba de nivel）')
}

// A3: ru 首调 prompt 含机翻味条目
{
  const prompt = buildSystemPrompt({ ...baseParams, targetLang: 'ru', langBlock: '\n[ru Guidelines]\n- ❌ Inflated marketing calque (впечатляюще в 4 раза быстрее)' })
  assert(prompt.includes('впечатляюще'), 'A3 ru 首调含机翻味条目（впечатляюще）')
}

// A4: tr 首调 prompt 含机翻味条目
{
  const prompt = buildSystemPrompt({ ...baseParams, targetLang: 'tr', langBlock: '\n[tr Guidelines]\n- ❌ "Level-up" calque (seviye atlat)' })
  assert(prompt.includes('seviye atlat'), 'A4 tr 首调含机翻味条目（seviye atlat）')
}

console.log('\n═══ B 重试回归（forceTranslate=true 路径）═══')

// B1: 重试路径 commonErrors 仍注入（行为不变）
{
  const prompt = buildSystemPrompt({ ...baseParams, targetLang: 'de', langBlock: '\n[de Guidelines]\n- ❌ Inflated marketing calque (beeindruckende 4-mal schneller)', includeRemediation: true })
  assert(prompt.includes('beeindruckende'), 'B1 重试路径 commonErrors 仍注入')
}

console.log('\n═══ C 校对隔离（校对 prompt 不含 commonErrors）═══')

// C1: 校对 prompt 不含 de 机翻味条目
{
  const proofreadPrompt = buildProofreadSystemPrompt({ targetLang: 'de', productLine: null, useEnInstruction: true })
  assert(!proofreadPrompt.includes('beeindruckende'), 'C1 校对 prompt 不含 de 机翻味条目（白名单纪律）')
}

// C2: 校对 prompt 不含 es/ru/tr 机翻味条目
{
  const esP = buildProofreadSystemPrompt({ targetLang: 'es', productLine: null, useEnInstruction: true })
  const ruP = buildProofreadSystemPrompt({ targetLang: 'ru', productLine: null, useEnInstruction: true })
  const trP = buildProofreadSystemPrompt({ targetLang: 'tr', productLine: null, useEnInstruction: true })
  assert(!esP.includes('Suba de nivel') && !ruP.includes('впечатляюще') && !trP.includes('seviye atlat'), 'C2 校对 prompt 不含 es/ru/tr 机翻味条目')
}

console.log('\n═══ D 规模回归（首调 prompt 长度预算）═══')

// D1: 首调 prompt 总长在预算内（v11.5 基线 + 增量 <5%）
{
  // v11.5 首调 core+brand = 1008 字符；langBlock 增量每语种 ~120-200 字符
  // 此处断言 de 首调 prompt 总长不超过 3500 字符（含 styleCard/fewShot 等全部模块）
  const prompt = buildSystemPrompt({ ...baseParams, targetLang: 'de', langBlock: '\n[de Guidelines]\n- ❌ Inflated marketing calque (beeindruckende 4-mal schneller) → ✅ Objective statement\n- ❌ English-style long preposed modifiers → ✅ Split or restructure' })
  assert(prompt.length < 3500, `D1 首调 prompt 总长 ${prompt.length} < 3500 预算`)
}

console.log(`\n═══ 结果: ${passed} 通过, ${failed} 失败 ═══`)
process.exit(failed > 0 ? 1 : 0)
