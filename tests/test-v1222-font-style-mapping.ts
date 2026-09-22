/**
 * v12.22 字重映射根治：Avenir → HarmonyOS Sans 字重表单一事实源
 *
 * 背景：HarmonyOS Sans 全家族（SC/TC/Naskh Arabic）字重表统一为
 *   Thin / Light / Regular / Bold / Black —— 无 Medium、无斜体。
 * 旧映射表只有 5 条且含 'Light Italic'/'Bold Italic'（不存在），表外字重
 * （Book/Medium/Light/Oblique/Black…）原样透传 —— setRangeFontName 抛异常被吞，
 * 整条文本保持 Avenir 不换（用户看到的「® 没换字体」实为整条没换成）。
 *
 * 断言分四段：
 *   A 表内字重映射正确（含新增 Book/Medium/Light/Black）
 *   B 斜体降级到对应正体（用户拍板方案 A：保字重丢斜体）
 *   C 表外/未识别字重兜底 Regular（防 setRangeFontName 抛异常）
 *   D 所有映射结果 ∈ HarmonyOS 真实字重表 + 非 Avenir/非 HarmonyOS 场景不受影响
 */
import { normalizeFontStyle } from '@lib/font-mapper'

let passed = 0
let failed = 0
function assert(cond: boolean, name: string, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.error(`  ❌ ${name}`, extra ?? '') }
}
function eq(actual: unknown, expected: unknown, name: string) {
  assert(actual === expected, name, { actual, expected })
}

const HARMONYOS_STYLES = new Set(['Thin', 'Light', 'Regular', 'Bold', 'Black'])
const TC = 'HarmonyOS Sans TC'
const SC = 'HarmonyOS Sans SC'
const AR = 'HarmonyOS Sans Naskh Arabic'

console.log('=== v12.22 字重映射测试 ===\n')

// ---------- A 表内字重映射（含新增）----------
console.log('A 表内字重映射')
eq(normalizeFontStyle('Avenir', 'Roman', TC), 'Regular', 'A1 Roman → Regular')
eq(normalizeFontStyle('Avenir', 'Book', TC), 'Regular', 'A2 Book → Regular（用户实机案例）')
eq(normalizeFontStyle('Avenir', 'Medium', TC), 'Regular', 'A3 Medium → Regular（TC 无 Medium 就近）')
eq(normalizeFontStyle('Avenir', 'Extra Light', TC), 'Light', 'A4 Extra Light → Light')
eq(normalizeFontStyle('Avenir', 'Light', TC), 'Light', 'A5 Light → Light')
eq(normalizeFontStyle('Avenir', 'Heavy', TC), 'Bold', 'A6 Heavy → Bold')
eq(normalizeFontStyle('Avenir', 'Black', TC), 'Black', 'A7 Black → Black')
eq(normalizeFontStyle('Avenir', 'Thin', TC), 'Thin', 'A8 Thin → Thin')

// ---------- B 斜体降级到对应正体（方案 A：保字重丢斜体）----------
console.log('\nB 斜体降级正体')
eq(normalizeFontStyle('Avenir', 'Extra Light Italic', TC), 'Light', 'B1 Extra Light Italic → Light')
eq(normalizeFontStyle('Avenir', 'Light Italic', TC), 'Light', 'B2 Light Italic → Light')
eq(normalizeFontStyle('Avenir', 'Light Oblique', TC), 'Light', 'B3 Light Oblique → Light')
eq(normalizeFontStyle('Avenir', 'Heavy Italic', TC), 'Bold', 'B4 Heavy Italic → Bold（不再掉到不存在的 Bold Italic）')
eq(normalizeFontStyle('Avenir', 'Bold Italic', TC), 'Bold', 'B5 Bold Italic → Bold')
eq(normalizeFontStyle('Avenir', 'Black Oblique', TC), 'Black', 'B6 Black Oblique → Black')
eq(normalizeFontStyle('Avenir', 'Italic', TC), 'Regular', 'B7 裸 Italic → Regular')
eq(normalizeFontStyle('Avenir', 'Medium Oblique', TC), 'Regular', 'B8 Medium Oblique → Regular')

// ---------- C 表外/未识别字重兜底 Regular ----------
console.log('\nC 表外兜底 Regular')
eq(normalizeFontStyle('Avenir', 'UltraBlack', TC), 'Regular', 'C1 未识别字重 → Regular')
eq(normalizeFontStyle('Avenir', 'Condensed Bold', TC), 'Regular', 'C2 Condensed 变体 → Regular')
eq(normalizeFontStyle('Avenir', '', TC), 'Regular', 'C3 空 style → Regular')
eq(normalizeFontStyle('Avenir', 'Weird Style Name', TC), 'Regular', 'C4 任意字符串 → Regular')

// ---------- D 映射结果合法性 + 场景隔离 ----------
console.log('\nD 合法性 + 场景隔离')
// D1: Avenir → 三个 HarmonyOS 家族的任意字重，结果恒在真实字重表内
const avenirStyles = [
  'Thin', 'Thin Italic', 'Extra Light', 'Extra Light Italic', 'Light', 'Light Oblique',
  'Roman', 'Book', 'Regular', 'Italic', 'Medium', 'Medium Oblique',
  'Heavy', 'Heavy Italic', 'Bold', 'Bold Italic', 'Black', 'Black Oblique', 'Unknown Style',
]
let allValid = true
for (const fam of [SC, TC, AR]) {
  for (const st of avenirStyles) {
    const r = normalizeFontStyle('Avenir', st, fam)
    if (!HARMONYOS_STYLES.has(r as string)) { allValid = false; console.error(`    非法映射: Avenir/${st} → ${fam}/${r}`) }
  }
}
assert(allValid, 'D1 Avenir→三 HarmonyOS 家族任意字重，结果恒 ∈ {Thin,Light,Regular,Bold,Black}')

// D2: 非 Avenir 源字体不受影响（原样返回）
eq(normalizeFontStyle('Inter', 'Medium', TC), 'Medium', 'D2 非 Avenir 源字体原样返回')

// D3: Avenir → 非 HarmonyOS 目标（如 Avenir→Avenir）不受影响
eq(normalizeFontStyle('Avenir', 'Book', 'Avenir'), 'Book', 'D3 Avenir→非 HarmonyOS 目标原样返回')

// D4: SC 与 TC 映射结果一致（用户确认字重表一致）
eq(normalizeFontStyle('Avenir', 'Book', SC), normalizeFontStyle('Avenir', 'Book', TC), 'D4 SC 与 TC 映射一致（Book）')
eq(normalizeFontStyle('Avenir', 'Heavy Italic', SC), normalizeFontStyle('Avenir', 'Heavy Italic', TC), 'D5 SC 与 TC 映射一致（斜体）')

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`)
if (failed > 0) process.exit(1)
