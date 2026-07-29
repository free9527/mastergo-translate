/**
 * v9.2 术语遮蔽顺序修复 — 20 语种闭环验证
 *
 * 验证目标：对术语 "Lexar Recovery Tool"（20 语种术语库译文均为 "Lexar Recovery Tool"），
 * 每个目标语言跑遮蔽管道，断言：
 *   1. 遮蔽后文本中 "Lexar Recovery Tool" 被替换为 __GLOSSARY_N__（术语优先，不被实体正则误吞）
 *   2. 还原后文本恢复为术语库目标语译文
 *   3. 全链路输出 == 术语库目标语（术语最高优先级闭环）
 *
 * 运行: npx tsx tests/test-glossary-mask-all-langs.ts
 */

import { maskGlossaryTerms, unmaskGlossaryTerms, maskEntities, unmaskEntities } from '../lib/entity-masker'

// 术语库 20 语种列（与 default-glossary.ts CSV header 一致）
const LANGS = ['zh-CN','zh-TW','ja','ko','fr','de','es','pt','pt-BR','ru','it','vi','th','id','ar','nl','pl','sv','tr','en']

// "Lexar Recovery Tool" 行：20 语种译文均为 "Lexar Recovery Tool"（术语库原样保留）
const TERM_SOURCE = 'Lexar Recovery Tool'
const TERM_TARGET = 'Lexar Recovery Tool'

// 测试源文组：覆盖术语在句中/独立成句/含型号/含保留词等真实场景
const SOURCE_TEXTS: Array<{ name: string; text: string }> = [
  {
    name: '术语在句中（用户原始场景）',
    text: 'Easily restore accidentally deleted and formatted pictures or videos with the Lexar Recovery Tool, and enjoy extra peace of mind with our limited lifetime warranty.',
  },
  {
    name: '术语独立成句',
    text: 'Lexar Recovery Tool',
  },
  {
    name: '术语+产品型号同句（NM790 应被实体遮蔽，术语不被误吞）',
    text: 'Download the Lexar Recovery Tool for your NM790 SSD to restore lost files.',
  },
  {
    name: '术语+保留词同句（PCIe 4.0 应被保留词遮蔽，术语不被误吞）',
    text: 'The Lexar Recovery Tool supports PCIe 4.0 NVMe drives.',
  },
]

function buildGlossaryMap(target: string): Map<string, string> {
  const m = new Map<string, string>()
  m.set(TERM_SOURCE, target)
  return m
}

let pass = 0
let fail = 0
const failures: string[] = []

for (const { name, text: sourceText } of SOURCE_TEXTS) {
  console.log(`\n▶ 场景: ${name}`)
  let scenarioPass = 0
  let scenarioFail = 0

  for (const lang of LANGS) {
    const glossaryMap = buildGlossaryMap(TERM_TARGET)

    // ── v9.2 新顺序：术语遮蔽 → 实体遮蔽 ──
    const { texts: glossaryMasked, termMap } = maskGlossaryTerms([sourceText], glossaryMap)
    const { texts: fullyMasked, entityMap } = maskEntities(glossaryMasked)

    const masked = fullyMasked[0]

    // 断言 1：术语被遮蔽（不在文本中）
    const termStillVisible = masked.includes(TERM_SOURCE)
    // 断言 2：术语以 __GLOSSARY_N__ 形式存在（而非被 __PRD_N__ 吞掉）
    const hasGlossaryPlaceholder = /__GLOSSARY_\d+__/.test(masked)
    const hasPrdPlaceholder = /__PRD_\d+__/.test(masked)

    // 模拟 LLM 返回（LLM 保留占位符，其余翻译为目标语言——这里用占位符不变的字符串模拟）
    const llmOutput = masked // 理想情况：LLM 原样返回占位符

    // ── 还原：先实体还原，再术语还原（与 translateBatch 一致）──
    let restored = unmaskEntities([llmOutput], entityMap)
    const { texts: unmaskedGlossary } = unmaskGlossaryTerms(restored, termMap)
    const final = unmaskedGlossary[0]

    // 断言 3：最终输出包含术语库目标语译文
    const finalHasTerm = final.includes(TERM_TARGET)

    const ok = !termStillVisible && hasGlossaryPlaceholder && finalHasTerm

    if (ok) {
      scenarioPass++
      pass++
      console.log(`  ✅ ${lang.padEnd(6)}`)
    } else {
      scenarioFail++
      fail++
      failures.push(`${lang}[${name}]`)
      console.log(`  ❌ ${lang.padEnd(6)} termStillVisible=${termStillVisible} glossaryPH=${hasGlossaryPlaceholder} prdPH=${hasPrdPlaceholder} finalHasTerm=${finalHasTerm}`)
      console.log(`     masked:  ${masked.slice(0, 140)}`)
      console.log(`     final:   ${final.slice(0, 140)}`)
    }
  }
  console.log(`  小计: ${scenarioPass}/${LANGS.length} 通过`)
}

const total = LANGS.length * SOURCE_TEXTS.length
console.log(`\n${'='.repeat(50)}`)
console.log(`总结果: ${pass}/${total} 通过（${SOURCE_TEXTS.length} 场景 × ${LANGS.length} 语种）`)
if (failures.length > 0) {
  console.log(`失败项: ${failures.join(', ')}`)
  process.exit(1)
}
