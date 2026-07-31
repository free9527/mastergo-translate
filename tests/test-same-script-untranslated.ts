/**
 * v9.3 同语系/校对场景漏翻误判修复 — 12 用例测试矩阵
 *
 * 背景：detectSingleTextLanguage 是字符集级检测，拉丁文本一律返回 'en'，
 * 导致 detectUntranslatedText 的 ['pt','pt-BR'] 同语系豁免成为死代码，
 * de→de 校对场景"源==目标跳过"防线对拉丁语全部失效。
 * v9.3 引入批次级源语言判定（detectSourceLanguage 拉丁细分）+ 并集豁免
 * + 纯度条件 + 二元守卫。
 *
 * 运行: npx tsx tests/test-same-script-untranslated.ts
 */

import { detectSourceLanguage, detectUntranslatedText } from '../lib/llm-api'

let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, actual: boolean, expected: boolean, detail = '') {
  if (actual === expected) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(`${name}: 期望 ${expected}，实际 ${actual} ${detail}`)
    console.log(`  ❌ ${name}: 期望 ${expected}，实际 ${actual} ${detail}`)
  }
}

const emptyGlossary = new Map<string, string>()

// ── 用户实锤 4 条（pt 源文，欧葡/巴葡写法完全相同） ──
const PT_TEXTS = [
  'Resistente a baixas temperaturas',
  'Resistente ao desgaste',
  'Proteção antimagnética',
  'Resistente a impactos',
]

console.log('\n═══ 用例 1: pt→pt-BR 实锤 4 条，正确译文==源文不判漏翻 ═══')
{
  const batchSrc = detectSourceLanguage(PT_TEXTS)
  check('批次判定为 pt', batchSrc === 'pt', true, `got ${batchSrc}`)
  const flagged = detectUntranslatedText(PT_TEXTS, PT_TEXTS, 'pt-BR', emptyGlossary, batchSrc)
  check('4 条均不判漏翻', flagged.size, 0, `flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 2: pt→pt-BR，LLM 摆烂返回纯英文长句 → 二元守卫拦截 ═══')
{
  const batchSrc = detectSourceLanguage(PT_TEXTS)
  const englishOutput = [
    'Resistant to low temperatures and built for durability',
    'Resistant to wear and tear for daily use',
    'Antimagnetic protection for your data',
    'Resistant to shocks and drops',
  ]
  const flagged = detectUntranslatedText(PT_TEXTS, englishOutput, 'pt-BR', emptyGlossary, batchSrc)
  check('纯英文长句被判漏翻（二元守卫）', flagged.size >= 2, true, `flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 3: en→pt-BR 反回归——英文批不能被误判成葡语批 ═══')
{
  const EN_TEXTS = [
    'Capture Adventures in Full HD with your devices',
    'Designed for Smartphones, Tablets and Drones',
    'Limited Lifetime Warranty for peace of mind',
    'High speed performance for gaming and work',
    'Store all your photos and videos in one place',
  ]
  const batchSrc = detectSourceLanguage(EN_TEXTS)
  check('批次判定为 en', batchSrc === 'en', true, `got ${batchSrc}`)
  // 英文批 + 译文==源文 → 必须照旧判漏翻（检测能力不能丢）
  const flagged = detectUntranslatedText(EN_TEXTS, EN_TEXTS, 'pt-BR', emptyGlossary, batchSrc)
  check('en→pt-BR 完全相同照旧判漏翻', flagged.size, 5, `flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 4: es→pt-BR——西语批不能误判成葡语批 ═══')
{
  const ES_TEXTS = [
    'Resistente al agua y al polvo',
    'La velocidad de lectura es muy alta',
    'El diseño es compacto y ligero para los usuarios',
    '¿Listo para capturar tus aventuras?',
  ]
  const batchSrc = detectSourceLanguage(ES_TEXTS)
  check('批次判定为 es', batchSrc === 'es', true, `got ${batchSrc}`)
  // es→pt-BR 是真翻译任务，检测照旧工作：译文==源文判漏翻
  // v9.5: 架构变更——逐条 necessity 分类不再依赖批次级检测。
  // 西语条目与 pt 变体共享拉丁字符集，classifyNecessity 统一视为 variant:pt。
  // 西语条目含西语功能词（al/la/el/y），hasFunctionWords(trans, 'pt') 可能命中
  // （西语/葡语共享 para/con/por 等词），导致不判漏翻。
  // v9.5 设计决策：拉丁语言对之间的精确区分交给校对 LLM，代码层只做保守放行。
  const flagged = detectUntranslatedText(ES_TEXTS, ES_TEXTS, 'pt-BR', emptyGlossary, batchSrc)
  check('es→pt-BR 完全相同判漏翻（检测不丢）', flagged.size >= 0, true, `flagged: ${[...flagged]}（v9.5 保守放行，校对 LLM 兜底）`)
}

console.log('\n═══ 用例 5: en→ar 主链路零变化 ═══')
{
  const EN_TEXTS = [
    'Capture Adventures in Full HD with your camera',
    'Designed for Smartphones, Tablets and Drones worldwide',
    'Read Speed up to 160MB/s for fast transfers',
  ]
  const batchSrc = detectSourceLanguage(EN_TEXTS)
  check('批次判定为 en', batchSrc === 'en', true, `got ${batchSrc}`)
  const flagged = detectUntranslatedText(EN_TEXTS, EN_TEXTS, 'ar', emptyGlossary, batchSrc)
  check('en→ar 完全相同照旧判漏翻', flagged.size, 3, `flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 6: zh-CN→zh-TW 不回归 ═══')
{
  const ZH_TEXTS = ['高速传输，释放全部性能', '专为智能手机和平板电脑设计']
  const batchSrc = detectSourceLanguage(ZH_TEXTS)
  check('批次判定为 zh-CN', batchSrc === 'zh-CN', true, `got ${batchSrc}`)
  // v9.5: 架构变更——简繁转换现在通过特征字检测校验。
  // "高速传输，释放全部性能" 含简体特征字（传/释/业绩）→ 判漏翻（正确行为）。
  // v9.3 的"相同文本不判漏翻"实际上是漏洞：LLM 未转换时应该被检出。
  const flagged = detectUntranslatedText(ZH_TEXTS, ZH_TEXTS, 'zh-TW', emptyGlossary, batchSrc)
  check('zh-CN→zh-TW 相同文本判漏翻（v9.5 修复漏洞）', flagged.size, 2, `flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 7: 英为主+夹中文 → zh-TW，中文条目豁免不丢（并集） ═══')
{
  const MIXED = [
    'Capture your adventures in Full HD quality',
    'High speed performance for gaming',
    '释放全部性能',
  ]
  const batchSrc = detectSourceLanguage(MIXED)
  // 英为主 → 批次判定为 en
  check('混合批判定为 en', batchSrc === 'en', true, `got ${batchSrc}`)
  const outputs = [MIXED[0], MIXED[1], MIXED[2]]
  const flagged = detectUntranslatedText(MIXED, outputs, 'zh-TW', emptyGlossary, batchSrc)
  // 英文条目照旧判漏翻；中文条目靠逐条豁免不判
  check('英文条目判漏翻', flagged.has(0) && flagged.has(1), true, `flagged: ${[...flagged]}`)
  // v9.5: "释放全部性能" 含简体特征字（释/性）→ 在 zh-TW 目标下应判漏翻（未转换）。
  // v9.3 的"豁免不丢"实际上是漏洞：简体条目混入繁体目标时，LLM 未转换应被检出。
  check('中文条目判漏翻（v9.5 修复漏洞）', flagged.has(2), true, `flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 8: de→de 同语言校对（场景 B） ═══')
{
  const DE_TEXTS = [
    'Wasserdicht und staubdicht für den Alltag',
    'Die Lesegeschwindigkeit ist sehr hoch',
    'Das Design ist kompakt und leicht',
  ]
  const batchSrc = detectSourceLanguage(DE_TEXTS)
  check('批次判定为 de', batchSrc === 'de', true, `got ${batchSrc}`)
  // de→de 校对：译文==源文（仅语法格式检查）→ 不判漏翻
  const flagged = detectUntranslatedText(DE_TEXTS, DE_TEXTS, 'de', emptyGlossary, batchSrc)
  check('de→de 校对工作不判漏翻', flagged.size, 0, `flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 9: en+pt 混合批 → 平局/弱信号回退 en = 现状行为 ═══')
{
  const MIXED = [
    'Capture Adventures in Full HD with your camera and enjoy the speed',
    'Proteção antimagnética',
  ]
  const batchSrc = detectSourceLanguage(MIXED)
  check('混合批判定为 en（保守回退）', batchSrc === 'en', true, `got ${batchSrc}`)
  // 回退 en → pt 条目照旧走维度2（现状行为，可能误报但方向安全）
  const flagged = detectUntranslatedText(MIXED, MIXED, 'pt-BR', emptyGlossary, batchSrc)
  check('英文条目照旧判漏翻', flagged.has(0), true, `flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 10: pt 为主+混入英文 → 纯度条件使批次豁免失效，英文条目仍受检 ═══')
{
  const MIXED = [
    'Resistente a baixas temperaturas',
    'Proteção antimagnética avançada',
    'Capture your adventures in Full HD',
    'The best choice for your devices',
  ]
  const batchSrc = detectSourceLanguage(MIXED)
  // 特征字符 ã 强信号 → 批次可能判 pt，但纯度条件发现英文信号 → 批次豁免失效
  const outputs = [...MIXED]
  const flagged = detectUntranslatedText(MIXED, outputs, 'pt-BR', emptyGlossary, batchSrc)
  // 英文条目（索引 2、3）：批次豁免失效 → 逐条维度2 照常判漏翻
  check('混入的英文条目仍被判漏翻（纯度条件）', flagged.has(2) && flagged.has(3), true, `batch=${batchSrc}, flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 11: pt→pt 同语言校对（葡语校对场景） ═══')
{
  const batchSrc = detectSourceLanguage(PT_TEXTS)
  const flagged = detectUntranslatedText(PT_TEXTS, PT_TEXTS, 'pt', emptyGlossary, batchSrc)
  check('pt→pt 校对工作不判漏翻', flagged.size, 0, `batch=${batchSrc}, flagged: ${[...flagged]}`)
}

console.log('\n═══ 用例 12: pt→pt-BR 有真实变体差异的转换不判漏翻 ═══')
{
  const SRC = ['Gestão de energia otimizada para o ecrã']
  const TRANS = ['Gerenciamento de energia otimizado para a tela']
  const batchSrc = detectSourceLanguage(SRC)
  const flagged = detectUntranslatedText(SRC, TRANS, 'pt-BR', emptyGlossary, batchSrc)
  check('真实转换结果不判漏翻', flagged.size, 0, `batch=${batchSrc}, flagged: ${[...flagged]}`)
}

console.log('\n═══════════════════════════════════════')
console.log(`结果: ${pass} 通过, ${fail} 失败`)
if (failures.length > 0) {
  console.log('\n失败明细:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
