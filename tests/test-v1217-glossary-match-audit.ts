/**
 * v12.17 术语库匹配逻辑排查脚本 — ARMOR GOLD 事故驱动
 *
 * 目的：代码级复现 2026-09-04 it/de 实机三事故，验证根因假设：
 *   A. ARMOR GOLD 产品名 S1 短路应命中（cleanKey 去™®+小写化等价）
 *   B. 嵌入句中的产品名应被 S2 遮蔽为 __GLOSSARY_0__，而非被 GOLD/ARMOR 切碎
 *   C. app → __GLOSSARY_2__licability 子串误遮蔽根因定位
 *   D. 其他短术语（THOR/ARES/PLAY/BLUE/ZTE/DJI...）子串误遮蔽普查
 *   E. shouldSkipGlossaryEntry 对 GOLD 等 identity 短词条的行为
 *   F. 模拟 v11.2 adhoc 覆盖：glossaryMap.set 同名 key 后 S1 短路查到什么值
 *
 * 纯代码验证，无 LLM 调用。
 *
 * 用法：
 *   npx tsx tests/test-v1217-glossary-match-audit.ts
 */

import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { readFileSync } from 'fs'
import { maskGlossaryTerms, unmaskGlossaryTerms } from '../lib/entity-masker'
import { shouldSkipGlossaryEntry } from '../lib/glossary-guard'
import { BUILTIN_THIRD_PARTY_ENTRIES } from '../lib/third-party-models'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '../lib/default-glossary'
import { parseGlossaryCSVText, GlossaryCSVEntry } from '../lib/parse-csv'
import { cleanKey } from '../lib/post-process'
import { LANGUAGES } from '../messages/types'

const VALID_LANG_CODES = new Set(LANGUAGES.map(l => l.code))

// ============================================================
// 测试框架（与项目既有套件同风格）
// ============================================================
let passed = 0
let failed = 0
const failures: string[] = []

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

function section(title: string) { console.log(`\n═══ ${title} ═══`) }

// ============================================================
// 数据加载：内置默认库 + 磁盘 CSV（用户最新版）
// ============================================================
function buildGlossaryMap(csvText: string, targetLang: string): Map<string, string> {
  const entries = parseGlossaryCSVText(csvText, VALID_LANG_CODES)
  const map = new Map<string, string>()
  for (const e of entries) {
    if (e.deprecated) continue
    const t = e.translations[targetLang]
    if (t) map.set(e.source, t)
  }
  return map
}

/** 模拟 buildGlossaryMaps().full：EN 源 key + 全语言列 key 注册 */
function buildFullView(csvText: string, targetLang: string): Map<string, string> {
  const entries = parseGlossaryCSVText(csvText, VALID_LANG_CODES)
  const full = new Map<string, string>()
  // EN 源 key 优先（first-wins）
  for (const e of entries) {
    if (e.deprecated) continue
    const t = e.translations[targetLang]
    if (t && !full.has(e.source)) full.set(e.source, t)
  }
  // 全语言列 key 补充
  for (const e of entries) {
    if (e.deprecated) continue
    const tgtVal = e.translations[targetLang]
    if (!tgtVal) continue
    for (const [lang, srcVal] of Object.entries(e.translations)) {
      if (lang === targetLang) continue
      if (srcVal && !full.has(srcVal)) full.set(srcVal, tgtVal)
    }
  }
  return full
}

/** 模拟 llm-api S1 短路的 glossaryLookup（内置第三方 first-wins + 去™®© 小写化） */
function buildS1Lookup(glossaryMap: Map<string, string>): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const [key, value] of glossaryMap.entries()) {
    const k = key.toLowerCase().replace(/[®™©]/g, '').trim()
    if (!lookup.has(k)) lookup.set(k, value)
  }
  return lookup
}

const TARGET = 'it'

const diskProducts = readFileSync('术语素材/Lexar术语库_产品名.csv', 'utf8')
const diskExclusive = readFileSync('术语素材/Lexar术语库_专属.csv', 'utf8')

const builtinProductsMap = buildGlossaryMap(DEFAULT_GLOSSARY_PRODUCTS_CSV, TARGET)
const diskProductsMap = buildGlossaryMap(diskProducts, TARGET)
const diskExclusiveMap = buildGlossaryMap(diskExclusive, TARGET)

// full 视图（产品名库 ∪ 专属库——模拟 UI 层合并后的 glossaryMap）
const fullMap = new Map<string, string>([
  ...buildFullView(DEFAULT_GLOSSARY_PRODUCTS_CSV, TARGET),
  ...buildFullView(diskProducts, TARGET),
  ...buildFullView(DEFAULT_GLOSSARY_EXCLUSIVE_CSV, TARGET),
  ...buildFullView(diskExclusive, TARGET),
])

// ============================================================
section('A. ARMOR GOLD S1 短路判定复现')
// ============================================================
{
  const SOURCE_VARIANTS = [
    'Lexar ARMOR GOLD SDXC UHS-II Card',      // 磁盘 CSV 原 key 形态
    'Lexar® ARMOR GOLD SDXC™ UHS-II Card',     // 实机源文形态（用户实锤）
    'Lexar® ARMOR GOLD SDXC UHS-II Card',
    'Lexar ARMOR GOLD SDXC™ UHS-II Card',
  ]
  const builtinKey = 'Lexar ARMOR GOLD SDXC UHS-II Card'
  const EXPECTED = builtinProductsMap.get(builtinKey) || diskProductsMap.get(builtinKey)

  console.log(`  内置库收录: ${builtinProductsMap.has(builtinKey)} → "${EXPECTED}"`)
  console.log(`  磁盘库收录: ${diskProductsMap.has(builtinKey)} → "${diskProductsMap.get(builtinKey)}"`)

  const s1Lookup = buildS1Lookup(fullMap)
  for (const src of SOURCE_VARIANTS) {
    const lookupKey = src.toLowerCase().replace(/[®™©]/g, '').trim()
    const hit = s1Lookup.get(lookupKey)
    const dirty = hit ? shouldSkipGlossaryEntry(src, hit) : false
    console.log(`\n  源文: "${src}"`)
    console.log(`    lookupKey: "${lookupKey}"`)
    console.log(`    S1 命中: ${hit ? `✅ "${hit}"` : '❌ 未命中'}`)
    console.log(`    脏条目拦截: ${dirty ? '⚠️ 是（跳过短路）' : '否'}`)
    assert(!!hit && !dirty, `S1 短路命中且不拦截: "${src}"`,
      hit ? (dirty ? '被脏条目拦截' : '') : 'lookupKey 未在 glossaryLookup')
    if (hit) assert(hit === EXPECTED, `S1 短路值 == 术语库钦定值`, `got "${hit}" want "${EXPECTED}"`)
  }
}

// ============================================================
section('B. 嵌入句遮蔽：产品名应整词遮蔽，不被 GOLD/ARMOR 切碎')
// ============================================================
{
  const embedded = [
    'The Lexar ARMOR GOLD SDXC UHS-II Card is the world’s first memory card that uses stainless steel.',
    'Equipped with an IP68 rating, the Lexar ARMOR GOLD SDXC UHS-II Card safeguards your data.',
    'Lexar ARMOR GOLD SDXC UHS-II Card Q&A',
  ]
  for (const src of embedded) {
    const { texts, termMap } = maskGlossaryTerms([src], fullMap)
    const masked = texts[0]
    console.log(`\n  源文: "${src.slice(0, 70)}…"`)
    console.log(`  遮蔽: "${masked.slice(0, 100)}${masked.length > 100 ? '…' : ''}"`)
    console.log(`  termMap: ${JSON.stringify([...termMap.entries()].map(([k, v]) => `${k}→${v.slice(0, 30)}`))}`)
    // 整词遮蔽断言：产品名 key 的 target 应出现在 termMap 中
    const expectedTarget = fullMap.get('Lexar ARMOR GOLD SDXC UHS-II Card')
    const wholeMasked = [...termMap.values()].some(v => v === expectedTarget)
    assert(wholeMasked, `嵌入句整词遮蔽（termMap 含钦定值 "${expectedTarget}"）`,
      `实际遮蔽值: ${[...termMap.values()].map(v => v.slice(0, 40)).join(' | ') || '（无）'}`)
    // 切碎检测：源文 ARMOR/GOLD 不应作为独立遮蔽值出现
    const chopped = [...termMap.values()].filter(v => v === 'ARMOR' || v === 'GOLD')
    assert(chopped.length === 0, `未被 ARMOR/GOLD 切碎`, `切碎值: ${chopped.join(', ')}`)
  }
}

// ============================================================
section('C. app → __GLOSSARY_2__licability 根因定位')
// ============================================================
{
  const src = 'Broad applicability across PCIe 3.0 and PCIe 4.0 systems.'
  const { texts, termMap } = maskGlossaryTerms([src], fullMap)
  console.log(`  源文: "${src}"`)
  console.log(`  遮蔽: "${texts[0]}"`)
  console.log(`  termMap: ${JSON.stringify([...termMap.entries()])}`)
  const polluted = [...termMap.entries()].filter(([ph, v]) => {
    // 占位符落在单词内部 = 遮蔽值是源文某单词的子串且两侧有字母
    return /[a-z]__GLOSSARY|GLOSSARY_\d+__[a-z]/i.test(texts[0])
  })
  assert(polluted.length === 0, 'applicability 不被子串切碎',
    `遮蔽产物 "${texts[0]}" 含占位符内嵌单词`)
}

// ============================================================
section('D. 短术语子串误遮蔽普查（identity 词条 ≤5 字符）')
// ============================================================
{
  // 从专属库提取 identity 短词条
  const entries = parseGlossaryCSVText(diskExclusive, VALID_LANG_CODES)
  const shortIdentity: Array<{ source: string; len: number }> = []
  for (const e of entries) {
    if (e.deprecated) continue
    const itVal = e.translations[TARGET]
    if (itVal === e.source && e.source.length <= 5 && e.source.length >= 3) {
      shortIdentity.push({ source: e.source, len: e.source.length })
    }
  }
  console.log(`  专属库 identity 短词条（≤5字符）: ${shortIdentity.map(s => s.source).join(', ')}`)

  // 对每个短词条，构造「该词作为更长英文单词子串」的诱饵文本
  const DECOYS: Record<string, string> = {
    GOLD: 'The golden color option is available.',
    ARMOR: 'The armored vehicle passed testing.',   // armored 含 armor
    THOR: 'The author wrote a thorough analysis.',  // thorough 含 thor
    ARES: 'He shares the areas of expertise.',      // shares/areas 含 ares
    PLAY: 'The player displays great skill.',       // player/displays 含 play
    BLUE: 'The blueprint was blue.',
    ZTE: 'The quartz crystal oscillator.',          // quartz 无 zte——换 bait
    DJI: 'The adjacent room adjoins it.',           // adjacent 无 dji——换 bait
    Sony: 'The episode was a miscarriage of justice.', // episode 无 sony
  }
  let chopCount = 0
  for (const { source } of shortIdentity) {
    const decoy = DECOYS[source]
    if (!decoy) continue
    const { texts, termMap } = maskGlossaryTerms([decoy], fullMap)
    const chopped = texts[0] !== decoy
    if (chopped) {
      // v12.17 边界守卫后：整词命中（占位符两侧是空格/标点）是设计行为，非切碎；
      // 切碎定义 = 占位符嵌入单词内部（如 __GLOSSARY_0__print / __GLOSSARY_0__en）
      const embedded = /[a-z]__GLOSSARY|GLOSSARY_\d+__[a-z]/i.test(texts[0])
      if (embedded) {
        chopCount++
        console.log(`  ⚠️ ${source} 切碎诱饵: "${decoy}" → "${texts[0]}" (termMap: ${JSON.stringify([...termMap.values()])})`)
      } else {
        console.log(`  ✅ ${source} 整词命中（设计行为）: "${decoy}" → "${texts[0]}"`)
      }
    } else {
      console.log(`  ✅ ${source} 未切碎: "${decoy}"`)
    }
  }
  assert(chopCount === 0, `短术语零切碎（当前 ${chopCount} 处）`)
}

// ============================================================
section('E. shouldSkipGlossaryEntry 对 identity 短词条行为')
// ============================================================
{
  const cases = [
    ['GOLD', 'GOLD'],
    ['ARMOR', 'ARMOR'],
    ['Lexar ARMOR GOLD SDXC UHS-II Card', fullMap.get('Lexar ARMOR GOLD SDXC UHS-II Card') || ''],
    ['DirectStorage', 'DirectStorage'],
  ]
  for (const [k, v] of cases) {
    const skip = shouldSkipGlossaryEntry(k, v)
    console.log(`  shouldSkipGlossaryEntry("${k.slice(0, 40)}", "${v.slice(0, 40)}") = ${skip}`)
    assert(!skip, `"${k.slice(0, 30)}" 不被脏条目拦截`)
  }
}

// ============================================================
section('F. 模拟 v11.2 adhoc 覆盖：同名 key set 后 S1 查到什么')
// ============================================================
{
  const simulated = new Map<string, string>(fullMap)
  const adhocTerm = 'Lexar ARMOR GOLD SDXC UHS-II Card'
  const adhocGenerated = 'Scheda Lexar ARMOR GOLD SDXC UHS-II'  // 假设生成器产出（语序不同）
  const before = simulated.get(adhocTerm)
  simulated.set(adhocTerm, adhocGenerated)  // ui/App.vue:1608 同款操作
  const after = simulated.get(adhocTerm)
  console.log(`  覆盖前: "${before}"`)
  console.log(`  覆盖后: "${after}"`)
  assert(after !== before, 'glossaryMap.set 同名 key 会覆盖 CSV 钦定值（事实确认）',
    '未覆盖——Map.set 行为与假设不符')

  // 新颖性门验证：detectAdhocProductTerms 的 glossaryKeys.has(ck) 是否拦住
  const ck = cleanKey(adhocTerm)
  const glossaryKeys = new Set<string>()
  for (const [k, v] of fullMap.entries()) {
    glossaryKeys.add(cleanKey(k))
    if (v) glossaryKeys.add(cleanKey(v))
  }
  assert(glossaryKeys.has(ck), `新颖性门 1 应拦住已收录产品名（cleanKey="${ck}"）`,
    'glossaryKeys 未包含该 cleanKey → v11.2 会误检出并覆盖')
}

// ============================================================
section('G. unmaskGlossaryTerms 还原后形态（Microsoft 连写复现）')
// ============================================================
{
  const masked = ['Unterstützt die __GLOSSARY_0__ __GLOSSARY_1__3 zu nutzen.']
  const termMap = new Map([
    ['__GLOSSARY_0__', 'Microsoft'],
    ['__GLOSSARY_1__', 'DirectStorage'],
  ])
  const { texts } = unmaskGlossaryTerms(masked, termMap)
  console.log(`  遮蔽态: "${masked[0]}"`)
  console.log(`  还原后: "${texts[0]}"`)
  // 若 LLM 把 __GLOSSARY_1__3 写成 __GLOSSARY_1__3（占位符紧跟数字），还原后 = DirectStorage3 连写
  assert(texts[0].includes('DirectStorage3'), '还原后 DirectStorage3 连写（事故形态复现）',
    `实际: "${texts[0]}"`)
}

// ============================================================
section('H. Microsoft DirectStorage 整词内置（v12.17 修复验证）')
// ============================================================
{
  // 模拟 v12.17 后的完整术语链：fullMap（用户库）+ 内置第三方（llm-api 合并顺序：
  //   内置先注册——撞 key 内置优先）。BUILTIN_THIRD_PARTY_ENTRIES 与 llm-api 内部
  //   BUILTIN_THIRD_PARTY_MASK_MAP 同源的冗余设计（豁免链不依赖外部注入）。
  const builtinMask = new Map<string, string>(
    BUILTIN_THIRD_PARTY_ENTRIES.map(e => [e.source, e.source])
  )
  assert(builtinMask.has('Microsoft DirectStorage'),
    '内置第三方遮蔽表含 Microsoft DirectStorage')

  const src = 'Developed to leverage Microsoft DirectStorage 3, speeding up game load times significantly.'
  // 遮蔽链 = 内置 ∪ 用户库（entity-masker 收到的 glossaryMap 在 llm-api 里已含内置层）
  const chainMap = new Map<string, string>([
    ...builtinMask,
    ...fullMap,
  ])
  const { texts, termMap } = maskGlossaryTerms([src], chainMap)
  console.log(`  源文: "${src}"`)
  console.log(`  遮蔽: "${texts[0]}"`)
  console.log(`  termMap: ${JSON.stringify([...termMap.entries()].map(([k, v]) => `${k}→${v}`))}`)
  // 整词遮蔽断言：'Microsoft DirectStorage' 被一个占位符整体替换，
  //   后面的 ' 3' 是自由文本但与占位符有空格分隔——LLM 看到 '__GLOSSARY_N__ 3' 形态
  assert(texts[0].includes('__GLOSSARY_'), '整词被遮蔽')
  const dsEntry = [...termMap.entries()].find(([, v]) => v === 'Microsoft DirectStorage')
  assert(!!dsEntry, 'termMap 含整词值 Microsoft DirectStorage',
    `实际值: ${[...termMap.values()].join(' | ')}`)
  if (dsEntry) {
    const [ph] = dsEntry
    assert(texts[0].includes(`${ph} 3`), `占位符与版本号空格分隔（${ph} 3）——LLM 无法产出连写`,
      `遮蔽产物: "${texts[0]}"`)
    // 还原后形态
    const { texts: restored } = unmaskGlossaryTerms(texts, termMap)
    assert(restored[0].includes('Microsoft DirectStorage 3'), '还原后整词形态正确',
      `实际: "${restored[0]}"`)
    console.log(`  还原: "${restored[0]}"`)
  }
}

// ============================================================
console.log(`\n═══ 结果: ${passed} 通过 / ${failed} 失败 ═══`)
if (failures.length > 0) {
  console.log('失败项:')
  failures.forEach(f => console.log(`  - ${f}`))
  process.exit(1)
}
