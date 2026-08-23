/**
 * v11.14 自动入库守卫 + 句形短路纵深防御回归测试（2026-08-17 实机事故根治）
 *
 * 事故根因链（已闭环）：
 *   CORRECTION_THRESHOLD=1 → 校对每修一条/用户每改一条，整句原文+译文零校验
 *   自动入专属术语库 → ①整句命中 S1 短路（cleanKey 形态无关）→ Bug A 确定性漏翻、
 *   重翻必现；②™乱码值经 短路/enforceGlossaryTerms子串替换/缓存放大 → Bug B 多点扩散。
 *
 * 本测试覆盖两道防线 + 次级加固：
 *   A. 防线2 执行闸：isSentenceLikeGlossaryKey（保守多信号，短术语零误伤）
 *   B. 防线1 入库闸：validateAutoGlossarySource / sanitizeAutoGlossaryValue /
 *      isIdentityAutoAddAllowed / hasMalformedTrademark
 *   C. 执行点接线：enforceGlossaryTerms（精确锁定放开+子串跳过）、maskGlossaryTerms（跳过遮蔽）
 *   D. 术语库 CSV：parseGlossaryCSVText / serializeGlossaryCSV（↵/多行/往返）
 *   E. 术语库现网零误伤：产品名 CSV + 专属 CSV 全部 key 均不得被判句形
 *   F. 事故剧本端到端：脏条目不再能制造 Bug A（短路失效）与 Bug B（扩散失效）
 */

/// <reference types="node" />

import * as fs from 'fs'
import * as path from 'path'
import {
  isSentenceLikeGlossaryKey,
  validateAutoGlossarySource,
  sanitizeAutoGlossaryValue,
  isIdentityAutoAddAllowed,
  hasMalformedTrademark,
  shouldSkipGlossaryEntry,
} from '../lib/glossary-guard'
import { enforceGlossaryTerms, cleanKey } from '../lib/post-process'
import { maskGlossaryTerms, unmaskGlossaryTerms } from '../lib/entity-masker'
import { parseGlossaryCSVText, serializeGlossaryCSV } from '../lib/parse-csv'
import { BUILTIN_THIRD_PARTY_ENTRIES } from '../lib/third-party-models'
import { LANGUAGES } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

const BUG_A_SENTENCE = 'Designed to coordinate with your PS5*, the Lexar PLAY 2280 PCIe 4.0 SSD is made to enhance your gaming experience.'
const BUG_B_CORRUPTED = '最高读取速度 7400MB/s、最高写入速度 6500MB/s 的出色性能，有效缩短加载时间，带来流畅的游戏 p™l™a™y™体验。'
const BUG_B_SOURCE = 'Exceptional performance of 7400MB/s max read and 6500MB/s max write ensures reduced load times and seamless gameplay.'

// ═══════════════════════════════════════════════════════════════
// A. 防线2 执行闸：isSentenceLikeGlossaryKey
// ═══════════════════════════════════════════════════════════════
out.push('═'.repeat(60))
out.push('A. isSentenceLikeGlossaryKey — 句形拦截 & 术语零误伤')
out.push('═'.repeat(60))

const SENTENCE_LIKE: Array<[string, string]> = [
  [BUG_A_SENTENCE, 'Bug A 原句（功能词+动词+标点+词数 4 信号）'],
  [BUG_B_SOURCE, 'Bug B 原句（动词+标点+词数 3 信号）'],
  ['This is the best SSD for your gaming rig, hands down.', '营销句（功能词+动词+标点+词数）'],
  ['The fastest card. The best choice. Built to last forever.', '多句营销文案（句首大写功能词+标点）'],
  ['Most durable and reliable card so you can capture, store, & transfer', '含 & 违反形态门+功能词+词数'],
]
for (const [t, label] of SENTENCE_LIKE) {
  assert(isSentenceLikeGlossaryKey(t) === true, `A-句形拦截: ${label}`, t.slice(0, 50))
}

// A' 拦截边界：无任何指纹词/标点的碎片词组，代码层诚实放行（v10.6 原则：代码管形式、
// LLM 管语义——营销语感判定在 prompt 与校对层，不在句形判定器里硬编）
const HONEST_PASS: Array<[string, string]> = [
  ['Unparalleled performance. Superior durability. Ultimate reliability.', '无指纹词多句（规格形态 "." 直通——营销语感归校对层）'],
]
for (const [t, label] of HONEST_PASS) {
  assert(isSentenceLikeGlossaryKey(t) === false, `A'-诚实放行: ${label}`, t.slice(0, 50))
}

const NOT_SENTENCE_LIKE: Array<[string, string]> = [
  ['PLAY', '短词直通'],
  ['THOR', '短词直通'],
  ['NM790', '型号直通'],
  ['Blue', '系列名直通（v11.7 教训原样）'],
  ['Lexar PLAY 2280 PCIe 4.0 SSD', '产品名'],
  ['Lexar Professional SILVER PLUS SDXC UHS-I Card', '长产品名（零信号）'],
  ['Lexar High-Performance 633x microSDHC/microSDXC UHS-I Card', '斜杠双格式产品名'],
  ['CFexpress Type B GOLD 系列 512GB', '中文混排产品名'],
  ['protect your game library', '术语形态逗号句（单信号不达标）'],
  ['Lexar PLAY 2280 PCIe 4.0 SSD 是游戏好搭档，值得买', '中文混排逗号（仅标点 1 信号 → 放行，术语优先）'],
  ['4X Faster than USB 3.0', '专属库短语（功能词单信号 → 放行，v11.12 在库营销短语）'],
  ['DDR5 Performance with Powerful Heatsink', '专属库产品标语（零信号 → 放行）'],
  ['Designed to coordinate', '21 字符短直通（门0豁免）'],
  ['USB Flash Drive', '品类词'],
]
for (const [t, label] of NOT_SENTENCE_LIKE) {
  assert(isSentenceLikeGlossaryKey(t) === false, `A-不误伤: ${label}`, t.slice(0, 50))
}

// ═══════════════════════════════════════════════════════════════
// B. 防线1 入库闸
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('B. 入库闸 — 源文校验 / 译文净化 / identity / ™畸形')
out.push('═'.repeat(60))

// B1 源文校验：拒绝
const SRC_REJECT: Array<[string, string, string]> = [
  [BUG_A_SENTENCE, '长度>60', '整句长度'],
  ['This is the best SSD for gaming.', '含句读标点', '标点'],
  ['the ultimate gaming experience', '功能词', '功能词'],
  ['delivers blazing speed', '动词', '动词'],
  ['__GLOSSARY_0__ Pro', '占位符残留', '占位符'],
  ['p™l™a™y™', '畸形™', '™'],
]
for (const [t, expect, label] of SRC_REJECT) {
  const r = validateAutoGlossarySource(t)
  assert(!r.ok && !!r.reason, `B1-拒绝(${label}): ${expect}`, JSON.stringify(t.slice(0, 40)))
}
// B1 源文校验：放行（术语形态）
const SRC_OK = ['Lexar PLAY 2280 PCIe 4.0 SSD', 'gaming experience', 'THOR PRO DDR5', 'PLAY', '固态硬盘', 'CFexpress Type A']
for (const t of SRC_OK) {
  assert(validateAutoGlossarySource(t).ok === true, `B1-放行: ${t}`)
}

// B2 译文净化
const valCorrupted = sanitizeAutoGlossaryValue(BUG_B_CORRUPTED)
assert(valCorrupted.ok === false, 'B2-乱码™值拒绝')
const valPlaceholder = sanitizeAutoGlossaryValue('配备独特的 __GLOSSARY_0__ 设计')
assert(valPlaceholder.ok === false, 'B2-占位符值拒绝')
const valClean = sanitizeAutoGlossaryValue('游戏体验')
assert(valClean.ok === true && valClean.value === '游戏体验', 'B2-干净值直通')
const valTm = sanitizeAutoGlossaryValue('Lexar® PLAY™ 游戏卡')
assert(valTm.ok === true && valTm.value === 'Lexar PLAY 游戏卡', 'B2-合法™剥除（术语库惯例不带符号）', valTm.value)

// B3 identity 规则
assert(isIdentityAutoAddAllowed('PLAY', 'PLAY') === true, 'B3-短 identity 允许（PLAY）')
assert(isIdentityAutoAddAllowed('THOR', 'THOR') === true, 'B3-短 identity 允许（THOR）')
assert(isIdentityAutoAddAllowed(BUG_A_SENTENCE, BUG_A_SENTENCE) === false, 'B3-整句 identity 拒绝（Bug A 弹药）')
assert(isIdentityAutoAddAllowed('gaming experience', 'gaming experience') === true, 'B3-短词组 identity 允许（≤3词）')
assert(isIdentityAutoAddAllowed('PLAY', '游戏') === true, 'B3-非 identity 不受限')

// B4 ™畸形检测
assert(hasMalformedTrademark('p™l™a™y™') === true, 'B4-散弹模式')
assert(hasMalformedTrademark('™hello') === true, 'B4-行首悬空')
assert(hasMalformedTrademark('a ™ b') === true, 'B4-空格后悬空')
assert(hasMalformedTrademark('Lexar™ PLAY™ SSD™') === true, 'B4-同符号≥3次')
assert(hasMalformedTrademark('Lexar® PLAY™ SSD') === false, 'B4-合法 ®™ 各一')
assert(hasMalformedTrademark('游戏体验') === false, 'B4-无符号')

// ═══════════════════════════════════════════════════════════════
// C. 执行点接线：enforceGlossaryTerms / maskGlossaryTerms
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('C. 执行点接线 — 句形条目精确锁定放开 + 子串跳过 + 遮蔽跳过')
out.push('═'.repeat(60))

// C1 句形条目精确锁定放开：整句命中时译文不被术语库值锁死（Bug A 经此通道锁死译文）
const dirtyGlossary = new Map<string, string>([[BUG_A_SENTENCE, BUG_A_SENTENCE]])
const enforced = enforceGlossaryTerms([BUG_A_SENTENCE], ['为配合您的 PS5 而设计，Lexar PLAY 2280 PCIe 4.0 固态硬盘'], dirtyGlossary)
assert(enforced[0] !== BUG_A_SENTENCE, 'C1-句形精确锁定放开（译文不被换回整句英文）', enforced[0].slice(0, 40))

// C1b 对照：术语形态条目精确锁定仍生效（不得误伤）
const goodGlossary = new Map<string, string>([['Lexar PLAY 2280 PCIe 4.0 SSD', 'Lexar PLAY 2280 PCIe 4.0 固态硬盘']])
const enforcedGood = enforceGlossaryTerms(['Lexar PLAY 2280 PCIe 4.0 SSD'], ['错误译文'], goodGlossary)
assert(enforcedGood[0] === 'Lexar PLAY 2280 PCIe 4.0 固态硬盘', 'C1b-术语精确锁定仍生效', enforcedGood[0])

// C2 句形 key 子串替换跳过（Bug B 扩散通道：句形 key + 乱码™值 → shouldSkip 命中）
const scatterGlossary = new Map<string, string>([['seamless gameplay experience for your console', 'p™l™a™y™体验']])
const subSource = 'It delivers a seamless gameplay experience for your console every day.'
const enforcedSub = enforceGlossaryTerms([subSource], ['它每天为您的主机提供无缝的游戏体验。'], scatterGlossary)
assert(!enforcedSub[0].includes('p™l™a™y™'), 'C2-句形子串替换跳过（乱码值不注入）', enforcedSub[0])

// C2b 对照：术语形态子串替换仍生效
const goodSubGlossary = new Map<string, string>([['gaming experience', '游戏体验']])
const subSource2 = 'It delivers a great gaming experience every day.'
const enforcedSub2 = enforceGlossaryTerms([subSource2], ['它每天提供很棒的 gaming experience。'], goodSubGlossary)
assert(enforcedSub2[0].includes('游戏体验'), 'C2b-术语子串替换仍生效', enforcedSub2[0])

// C3 遮蔽跳过：句形条目不遮蔽（值不字面回灌）
const maskGlossary = new Map<string, string>([[BUG_B_SOURCE, BUG_B_CORRUPTED]])
const masked = maskGlossaryTerms([BUG_B_SOURCE], maskGlossary)
assert(masked.texts[0] === BUG_B_SOURCE, 'C3-句形条目不遮蔽', masked.texts[0].slice(0, 40))
assert(masked.termMap.size === 0, 'C3-句形条目无占位符')

// C3b 对照：术语形态遮蔽仍生效且往返正确
const maskGood = new Map<string, string>([['gaming experience', '游戏体验']])
const maskedGood = maskGlossaryTerms(['It delivers a great gaming experience.'], maskGood)
assert(maskedGood.texts[0] !== 'It delivers a great gaming experience.', 'C3b-术语遮蔽生效')
const unmaskedGood = unmaskGlossaryTerms(maskedGood.texts, maskedGood.termMap)
assert(unmaskedGood.texts[0].includes('游戏体验'), 'C3b-遮蔽往返还原术语库值', unmaskedGood.texts[0])

// ═══════════════════════════════════════════════════════════════
// D. 术语库 CSV：parseGlossaryCSVText / serializeGlossaryCSV
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('D. 术语库 CSV 解析对齐（v11.11 同套原语）')
out.push('═'.repeat(60))

const LANGS = new Set(['zh-CN', 'zh-TW', 'ja', 'en'])

// D1 旧式 split('\n') 会碎的多行引号单元格 → 现在正确解析为一条
const multilineCSV = 'source,zh-CN,en\n"Multi\nLine Term","多行\n术语","multi line"'
const multilineEntries = parseGlossaryCSVText(multilineCSV, LANGS)
assert(multilineEntries.length === 1, 'D1-多行单元格不碎行', `解析出 ${multilineEntries.length} 条`)
assert(multilineEntries[0]?.source === 'Multi\nLine Term', 'D1-多行 source 保留换行')
assert(multilineEntries[0]?.translations['zh-CN'] === '多行\n术语', 'D1-多行译文保留换行')

// D2 ↵ 占位符还原（从翻译导出复制粘贴的场景）
const arrowCSV = 'source,zh-CN\nTerm One,第一行↵第二行'
const arrowEntries = parseGlossaryCSVText(arrowCSV, LANGS)
assert(arrowEntries[0]?.translations['zh-CN'] === '第一行\n第二行', 'D2-↵占位符还原为换行', JSON.stringify(arrowEntries[0]?.translations['zh-CN']))

// D3 序列化 → 解析往返（一条记录恒一物理行）
const roundtripSrc: Array<{ source: string; translations: Record<string, string> }> = [
  { source: 'PLAY', translations: { 'zh-CN': 'PLAY', en: 'PLAY' } },
  { source: 'Seamless Play', translations: { 'zh-CN': '无缝体验↵畅享游戏' } },
]
const serialized = serializeGlossaryCSV(roundtripSrc, ['zh-CN', 'en'])
assert(serialized.split('\n').length === 3, 'D3-序列化一条记录一物理行', `${serialized.split('\n').length} 行`)
const roundtrip = parseGlossaryCSVText(serialized, LANGS)
assert(roundtrip.length === 2, 'D3-往返条数一致')
assert(roundtrip[1]?.source === 'Seamless Play', 'D3-往返 source 保真')
assert(roundtrip[1]?.translations['zh-CN'] === '无缝体验\n畅享游戏', 'D3-往返↵还原保真（↵ 是术语库 CSV 的物理换行占位符，v11.11 规约）', JSON.stringify(roundtrip[1]?.translations['zh-CN']))

// D4 元数据列兼容（旧 CSV 带 处理方式/术语分类 列）
const legacyCSV = 'source,处理方式,术语分类,zh-CN,en\nPLAY,不翻译,产品名,PLAY,PLAY'
const legacyEntries = parseGlossaryCSVText(legacyCSV, LANGS)
assert(legacyEntries.length === 1 && legacyEntries[0].translations['zh-CN'] === 'PLAY', 'D4-旧元数据列跳过')

// ═══════════════════════════════════════════════════════════════
// E. 术语库现网零误伤（真实 CSV 全部 key 不得被判句形）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('E. 现网术语库零误伤（产品名 + 专属 CSV）')
out.push('═'.repeat(60))

const csvDir = path.join(__dirname, '..', '术语素材')
const ALL_LANG_CODES = new Set<string>(LANGUAGES.map((l: { code: string }) => l.code))
for (const fname of ['Lexar术语库_产品名.csv', 'Lexar术语库_专属.csv']) {
  const fpath = path.join(csvDir, fname)
  if (!fs.existsSync(fpath)) { assert(false, `E-文件存在: ${fname}`, '文件不存在'); continue }
  const text = fs.readFileSync(fpath, 'utf8')
  const entries = parseGlossaryCSVText(text, ALL_LANG_CODES)
  assert(entries.length > 50, `E-解析条数: ${fname}`, `${entries.length} 条`)
// 只查 key 列（source）——翻译列本就是自然语言，被全语言注册是 v9.9 修复的本意
  // 专属库存在用户手动策展的【正当整句条目】（免责声明/兼容性文案 → 官方译文），
  // 句形本身是正当形态——执行闸靠 value 侧（identity/乱码™）鉴别脏条目（E2 验证），
  // 产品名库（代码判定+代码生成的纯产品名库）则必须零句形。
  if (fname.includes('专属')) continue
  const flagged = entries.filter(e => isSentenceLikeGlossaryKey(e.source))
  assert(flagged.length === 0, `E-零句形误伤(source 列): ${fname}`, flagged.map(e => e.source.slice(0, 40)).join(' | '))
}

// E2 执行闸决策（shouldSkipGlossaryEntry）：专属库【正当整句策展条目】（句形 key +
// 正经译文 value，如免责声明/兼容性文案）必须照常锁定——v11.12+ 术语库最高优先级；
// 仅 identity 自映射 / 乱码™值条目被跳过（Bug A/B 弹药）。
const curatedSentences = [
  'Product images are for reference only',
  'Transfer speeds may vary by device and environment',
]
for (const s of curatedSentences) {
  assert(isSentenceLikeGlossaryKey(s) === true, `E2-策展句被判句形: ${s.slice(0, 40)}`)
  assert(shouldSkipGlossaryEntry(s, s + '（正经中文译文值）') === false, `E2-策展句+正经译文照常锁定: ${s.slice(0, 40)}`)
}
// 词组形策展条目（<30 字符门 0 直通）：不走句形通道但同样必须锁定（术语库最高优先级）
assert(shouldSkipGlossaryEntry('Seamlessly compatible with Intel XMP 3.0', '与 Intel XMP 3.0 无缝兼容') === false, 'E2-策展词组照常锁定（门0直通）')
assert(shouldSkipGlossaryEntry(BUG_A_SENTENCE, BUG_A_SENTENCE) === true, 'E2-Bug A identity 条目跳过（弹药失效）')
assert(shouldSkipGlossaryEntry(BUG_B_SOURCE, BUG_B_CORRUPTED) === true, 'E2-Bug B 乱码值条目跳过（弹药失效）')
assert(shouldSkipGlossaryEntry('Lexar PLAY 2280 PCIe 4.0 SSD', 'Lexar PLAY 2280 PCIe 4.0 固态硬盘') === false, 'E2-术语形态条目永不跳过')

// E3 内置第三方词条 + 全语言值注册零误伤（对齐 buildGlossaryMaps 行为：
// 任意语言列的值都会成为 full 视图 key——必须全部零句形，否则 S1 短路会跳过在库条目）
const builtinFlagged = BUILTIN_THIRD_PARTY_ENTRIES.filter(e => isSentenceLikeGlossaryKey(e.source))
assert(builtinFlagged.length === 0, 'E3-内置第三方词条 source 零句形', builtinFlagged.map(e => e.source).join(' | '))

const registeredValues: string[] = []
for (const fname of ['Lexar术语库_产品名.csv', 'Lexar术语库_专属.csv']) {
  const fpath = path.join(csvDir, fname)
  if (!fs.existsSync(fpath)) continue
  const entries = parseGlossaryCSVText(fs.readFileSync(fpath, 'utf8'), ALL_LANG_CODES)
  for (const e of entries) {
    for (const v of Object.values(e.translations)) registeredValues.push(v)
  }
}
// 真实不变量：句形判定的信号词表（功能词/动词/句读）是【英文】指纹——
// 对任何非英文文本零区分度，永不得在含非 ASCII 字符的值上开火。
// （纯 ASCII 英文策展句/标语 —— 专属库 source 列及其 v9.9 en 注册值、
// 意/西/德等拉丁译文 —— 本来就是正当句形，'被判句形'≠误伤；
// 它们的执行闸正确性由 E2/E4 分别验证。）
const nonAsciiValFlagged = registeredValues.filter(v => /[^\x00-\x7F]/.test(v) && isSentenceLikeGlossaryKey(v))
assert(nonAsciiValFlagged.length === 0, `E3-非ASCII注册值零句形（英文指纹永不对非英文文本开火）`, nonAsciiValFlagged.map(v => v.slice(0, 40)).join(' | '))

// E4 兜底真相断言：6580 个注册值中没有任何一个会被执行闸跳过
// （v9.9 全语言注册的语义 = 这些值作为 key 命中时必须锁定其目标译文；
// 若 shouldSkip 对它们开火 = 在库正当条目失效 = v9.9 回归）
const valSkipped = registeredValues.filter(v => shouldSkipGlossaryEntry(v, '正经目标译文'))
assert(valSkipped.length === 0, `E4-全语言注册值执行闸零跳过（${registeredValues.length} 个值）`, valSkipped.map(v => v.slice(0, 40)).join(' | '))

// ═══════════════════════════════════════════════════════════════
// F. 事故剧本端到端（脏条目注入各通道全部失效）
// ═══════════════════════════════════════════════════════════════
out.push('')
out.push('═'.repeat(60))
out.push('F. 事故剧本端到端 — Bug A/B 机制复现验证（修复后不再发生）')
out.push('═'.repeat(60))

// F1 即使脏条目已存在（历史残留），执行层全部通道都不再造事故：
//   短路（UI/llm-api 接线，此处验证判定函数本身）→ 句形 key 直接判 sentence-like
assert(isSentenceLikeGlossaryKey(BUG_A_SENTENCE) === true, 'F1-Bug A 句被判句形（短路/锁定对它们全部失效）')
//   enforce 精确 + 子串 + 遮蔽（C1/C2/C3 已验证）
//   入库闸：同样的内容今天根本进不了库
assert(!validateAutoGlossarySource(BUG_A_SENTENCE).ok, 'F1-Bug A 句入不了库（防线1）')
assert(!isIdentityAutoAddAllowed(BUG_A_SENTENCE, BUG_A_SENTENCE), 'F1-Bug A 整句 identity 入不了库（防线1-G3）')

// F2 Bug B：乱码值入不了库；即便在库，遮蔽/子串/锁定全跳过；缓存层 hasMalformedTrademark 拦截
assert(!sanitizeAutoGlossaryValue(BUG_B_CORRUPTED).ok, 'F2-Bug B 乱码值入不了库（防线1-G2）')
assert(hasMalformedTrademark(BUG_B_CORRUPTED) === true, 'F2-Bug B 乱码值缓存脏规则命中（G5）')
const bugBGlossary = new Map<string, string>([[BUG_B_SOURCE, BUG_B_CORRUPTED]])
const bugBEnforced = enforceGlossaryTerms([BUG_B_SOURCE], ['7400MB/s 最高读取和 6500MB/s 最高写入的出色性能'], bugBGlossary)
assert(!bugBEnforced[0].includes('p™l™a™y™'), 'F2-Bug B 乱码值不经精确锁定回灌')
const bugBMasked = maskGlossaryTerms([BUG_B_SOURCE], bugBGlossary)
assert(bugBMasked.texts[0] === BUG_B_SOURCE && bugBMasked.termMap.size === 0, 'F2-Bug B 乱码值不经遮蔽回灌')

// F3 cleanKey 一致性（post-process 导出，与守卫匹配语义同层）
assert(cleanKey('Lexar® PLAY™ 2280') === 'lexar play 2280', 'F3-cleanKey 形态无关（短路匹配基础语义不变）')

// ═══════════════════════════════════════════════════════════════
console.log(out.join('\n'))
console.log(`\n${'═'.repeat(60)}`)
console.log(`结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
