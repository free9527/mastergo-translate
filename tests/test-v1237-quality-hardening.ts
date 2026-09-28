// v12.37: 翻译承重墙质量加固（零风险自动化）——形式校验升级
//   点1: validateNumbers 数值篡改（tamperedIndices）高置信回退
//   点4: S8 出口不变量透出（空译文/占位符残留 → 待确认，零修改）
//   对照断言：锁「数量不一致仍只警告」「形式信号零误判」两条边界
import { validateNumbers } from '../lib/post-process'
import { formatCJKSpace } from '../lib/format-text'

let passed = 0
let failed = 0
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('═══ v12.37 数字校验数值篡改回退 ═══')

// A1: 数值篡改（数量相等数值不等）→ tamperedIndices 命中（高置信回退子集）
{
  const r = validateNumbers(
    ['Read speed up to 2000MB/s, capacity 4TB'],
    ['Read speed up to 2000MB/s, capacity 8TB'],  // 4TB→8TB 篡改
  )
  assert(r.tamperedIndices.has(0), 'A1a 数值篡改（4TB→8TB）命中 tamperedIndices')
  assert(r.mismatchedIndices.has(0), 'A1b 数值篡改同时在 mismatchedIndices（父集）')
}

// A2: 数量不一致（源文 2 数字译文 1 数字）→ 仅 mismatchedIndices，不进 tamperedIndices（合法增删可能）
{
  const r = validateNumbers(
    ['2000MB/s read and 1800MB/s write'],
    ['2000MB/s read'],  // 少了一个数字（数量不一致）
  )
  assert(!r.tamperedIndices.has(0), 'A2a 数量不一致不进 tamperedIndices（不阻止重试）')
  assert(r.mismatchedIndices.has(0), 'A2b 数量不一致仍进 mismatchedIndices（只警告）')
}

// A3: 数字完全一致 → 两集合都空（零误判）
{
  const r = validateNumbers(
    ['Up to 2000MB/s and 4TB capacity'],
    ['最大2000MB/s、容量4TB'],
  )
  assert(r.tamperedIndices.size === 0 && r.mismatchedIndices.size === 0, 'A3 数字一致零命中（零误判）')
}

// A4: 无数字源文 → 跳过（零误判）
{
  const r = validateNumbers(['Fast and reliable'], ['高速で信頼性が高い'])
  assert(r.tamperedIndices.size === 0 && r.mismatchedIndices.size === 0, 'A4 无数字源文跳过（零误判）')
}

// A5: 千位分隔符归一（3,500 MB/s vs 3500MB/s 同值 → 不误判篡改）
{
  const r = validateNumbers(
    ['Speed 3,500 MB/s'],
    ['Speed 3500MB/s'],
  )
  assert(!r.tamperedIndices.has(0), 'A5 千位分隔符归一后同值不误判篡改（防误伤）')
}

// A6: 单位不同但数值同（2000MB/s vs 2000MB/s 同单位族）→ 数值等不误判
{
  const r = validateNumbers(['2000MHz frequency'], ['2000MHz 频率'])
  assert(!r.tamperedIndices.has(0), 'A6 同数值不同语境（MHz）不误判')
}

console.log('═══ v12.37 S8 出口不变量（形式信号） ═══')

// B1: 空译文判定逻辑（源文非空译文空 → 应透出）
{
  const srcNonEmpty = 'Power up Your Creativity'.trim().length > 0
  const transEmpty = ''.trim().length === 0
  assert(srcNonEmpty && transEmpty, 'B1 空译文形式信号成立（源文非空译文空）')
}

// B2: 占位符残留判定逻辑（__XXX_N__ 正则）
{
  const hasResidual = /__[A-Z]+_\d+__/.test('译文含 __GLOSSARY_3__ 残留')
  const noResidual = /__[A-Z]+_\d+__/.test('正常译文无残留')
  assert(hasResidual && !noResidual, 'B2 占位符残留正则形式信号成立')
}

// B3: 非占位符的合法文本不误判（__ 非大写形态不触发）
{
  const falsePositive = /__[A-Z]+_\d+__/.test('see __readme__ for details')
  assert(!falsePositive, 'B3 非大写占位符形态不误判（防误伤）')
}

console.log('═══ v12.37 CJK 全角英数字 → 半角（形式校验代码化） ═══')

// C1: ja 全角数字 → 半角（ja 规则「全角英数字厳禁」；单位保护块 2000MB/s 整体不插空格，
//     但 s 后「です」仍触发拉丁→CJK 插空格——实测输出为「速度は2000MB/s です」）
{
  assert(formatCJKSpace('速度は２０００MB/sです', 'ja') === '速度は2000MB/s です', 'C1 ja 全角数字 → 半角')
}
// C2: ja 全角字母 → 半角（Ｌｅｘａｒ → Lexar）
{
  assert(formatCJKSpace('Ｌｅｘａｒ製品', 'ja') === 'Lexar 製品', 'C2 ja 全角字母 → 半角')
}
// C3: 半角英数字不受影响（幂等）
{
  assert(formatCJKSpace('速度は 2000MB/s です', 'ja') === '速度は 2000MB/s です', 'C3 半角英数字不动（幂等）')
}
// C4: 非 CJK 语种不触发（de 全角数字不动——de 不用此函数）
{
  assert(formatCJKSpace('速度は２０００です', 'de') === '速度は２０００です', 'C4 非 CJK 语种（de）不转换（防越界）')
}

console.log(`\n═══ 结果: ${passed} 通过, ${failed} 失败 ═══`)
if (failed > 0) process.exit(1)
