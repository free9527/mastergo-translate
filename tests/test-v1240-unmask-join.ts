/**
 * v12.40 S5 连写修复测试——unmaskGlossaryTerms 还原后术语值粘连补空格
 * 实机事故：SamsungS25 × 3（ja/fr），LLM 把占位符与后文粘连输出（__GLOSSARY_0__S25）
 */
import { unmaskGlossaryTerms } from '../lib/entity-masker'

let pass = 0, fail = 0
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' | ' + detail : ''}`) }
}

// 核心场景：术语值后紧跟字母/数字 → 补空格
{
  const termMap = new Map([['__GLOSSARY_0__', 'Samsung']])
  const { texts } = unmaskGlossaryTerms(['対応デバイス： __GLOSSARY_0__S25（またはそれ以降）'], termMap)
  assert(texts[0] === '対応デバイス： Samsung S25（またはそれ以降）', 'T1 粘连补空格（ja 实机形态）', texts[0])
}
// fr 实机形态
{
  const termMap = new Map([['__GLOSSARY_0__', 'Samsung']])
  const { texts } = unmaskGlossaryTerms(['Appareils compatibles : __GLOSSARY_0__S25 (ou modèles ultérieurs)'], termMap)
  assert(texts[0] === 'Appareils compatibles : Samsung S25 (ou modèles ultérieurs)', 'T2 粘连补空格（fr 实机形态）', texts[0])
}
// 正常形态不受影响（占位符后已有空格）
{
  const termMap = new Map([['__GLOSSARY_0__', 'Samsung']])
  const { texts } = unmaskGlossaryTerms(['Compatible: __GLOSSARY_0__ S25'], termMap)
  assert(texts[0] === 'Compatible: Samsung S25', 'T3 正常空格不误伤', texts[0])
}
// CJK 与术语值相邻不处理（v12.17 同纪律——CJK 无空格天然相邻非连写）
{
  const termMap = new Map([['__GLOSSARY_0__', 'Samsung']])
  const { texts } = unmaskGlossaryTerms(['__GLOSSARY_0__のProRes録画に対応'], termMap)
  assert(texts[0] === 'SamsungのProRes録画に対応', 'T4 CJK 相邻不补空格', texts[0])
}
// 术语值非字母/数字结尾不触发（如术语值是 CJK）
{
  const termMap = new Map([['__GLOSSARY_0__', '有限终身质保']])
  const { texts } = unmaskGlossaryTerms(['享受__GLOSSARY_0__2年'], termMap)
  assert(texts[0] === '享受有限终身质保2年', 'T5 CJK 术语值不触发补空格', texts[0])
}
// 数字结尾术语值粘连也补（如 DirectStorage3 形态）
{
  const termMap = new Map([['__GLOSSARY_0__', 'DirectStorage']])
  const { texts } = unmaskGlossaryTerms(['supports __GLOSSARY_0__3 for fast loading'], termMap)
  assert(texts[0] === 'supports DirectStorage 3 for fast loading', 'T6 数字粘连补空格（v12.17 形态）', texts[0])
}
// 术语值后紧跟标点不补（正常形态）
{
  const termMap = new Map([['__GLOSSARY_0__', 'Samsung']])
  const { texts } = unmaskGlossaryTerms(['Made by __GLOSSARY_0__.'], termMap)
  assert(texts[0] === 'Made by Samsung.', 'T7 标点不补空格', texts[0])
}
// 多占位符混合：一个粘连一个正常
{
  const termMap = new Map([['__GLOSSARY_0__', 'Samsung'], ['__GLOSSARY_1__', 'Apple']])
  const { texts } = unmaskGlossaryTerms(['__GLOSSARY_0__S25 and __GLOSSARY_1__ ProRes'], termMap)
  assert(texts[0] === 'Samsung S25 and Apple ProRes', 'T8 多占位符混合', texts[0])
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail > 0 ? 1 : 0)
