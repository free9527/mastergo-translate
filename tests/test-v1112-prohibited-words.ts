/**
 * v11.12 电商平台违禁词检测与规避测试
 *
 * 背景：产品图上传京东（中文）/ 各国亚马逊站点（英文及小语种），平台有违禁词
 *   硬规则。方案（用户拍板）：翻译提示词不变，代码检测 → AI 校对语义改写规避 →
 *   代码回检。与 v9.5 三层漏翻 / v10.6 错词同构（代码管形式，LLM 管语义）。
 *
 * 覆盖（对应批准计划 §7）：
 *   A. 词表完整性：20 语种 key 与 LANGUAGES 对表、无空词、test 在 en+de、
 *      zh 词表 ≥40 词、豁免表非空、词条全部可安全编译（无未转义正则元字符炸雷）
 *   B. 检测单元：zh 命中+豁免剔除；en 命中+误伤防护（detection/latest/protest/attest
 *      不命中）；de Test/beste；ja 最高/テスト；同语言连续两条第二条不漏
 *      （无 g flag 回归锁）；CJK 子串；符号词 100%/#1；复合词 stress test
 *   C. proofreadBatch mock 端到端：请求体含违禁词 note（列出具体词）+ 全局
 *      PROHIBITED_NOTE 块；未命中批次零死文本；修正后回检干净
 *   D. 关校对零行为变化：不传 prohibitedFixMap 时 buildProofreadSystemPrompt
 *      输出与 hasProhibitedFix:false 逐字节一致（快照锁）
 *   E. 源语言判定：detectSourceLangForProhibited 混排→zh、纯英→en、空文本→null；
 *      纯规格文本含字母判 en（下游词边界防护保证零误伤——E6 锁定）
 *      （detectSourceLanguage 的 cjk>latin 一票制会把"中文+英文型号"混排误判 en，
 *      本函数是京东词表分支不静默失效的兜底）
 *   F. v11.12+ 术语库最高优先级（2026-08-14 用户拍板）：有限终身质保豁免
 *      （简/繁四形态不误报，裸"终身质保"仍命中）；isGlossaryLockedTranslation
 *      判定口径；proofreadBatch 预豁免（术语库锁定项不进修正链，请求体零 note）
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { PROHIBITED_ZH, PROHIBITED_ZH_EXEMPTIONS, PROHIBITED_AVOID } from '../lib/prohibited-words'
import { detectProhibited, hasProhibited, detectSourceLangForProhibited, _prohibitedCacheSize, isGlossaryLockedTranslation } from '../lib/prohibited-check'
import { proofreadBatch } from '../lib/llm-api'
import { buildProofreadSystemPrompt } from '../lib/prompt-constants'
import { LANGUAGES } from '../messages/types'
import { LLMConfig } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass++
    out.push(`✅ ${name}`)
  } else {
    fail++
    out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock XHR：队列式脚本化响应（与 test-v105/v108/v119 同款）
// ═══════════════════════════════════════════════════════════════
interface MockCall { body: string }
const mockCalls: MockCall[] = []
const responseQueue: string[] = []

;(globalThis as Record<string, unknown>).XMLHttpRequest = class {
  status = 200
  responseText = ''
  timeout = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  open(_m: string, _u: string, _a: boolean) { /* noop */ }
  setRequestHeader(_k: string, _v: string) { /* noop */ }
  send(body?: string) {
    mockCalls.push({ body: body || '' })
    const content = responseQueue.shift() ?? ''
    this.responseText = JSON.stringify({ choices: [{ message: { content } }] })
    setTimeout(() => this.onload && this.onload(), 0)
  }
}

const config: LLMConfig = {
  apiUrl: 'https://mock.local/v1/chat/completions',
  apiKey: 'test',
  model: 'test-model',
  translationStyle: '',
  translationStyleCustom: '',
  scenePreset: '',
  enableProofread: false,
  proofreadApiKey: '',
  proofreadApiUrl: '',
  proofreadModel: '',
}
const emptyGlossary = new Map<string, string>()

function hitWords(text: string, lang: string): string[] {
  return detectProhibited(text, lang).map(h => h.word)
}

async function main() {
  // ═══════════════════════════════════════════════════════════
  out.push('═'.repeat(60))
  out.push('A. 词表完整性')
  out.push('═'.repeat(60))

  // A1: 20 语种 key 与 LANGUAGES 一一对表
  const langCodes = LANGUAGES.map(l => l.code)
  const missing = langCodes.filter(c => !PROHIBITED_AVOID[c])
  const extra = Object.keys(PROHIBITED_AVOID).filter(c => !langCodes.includes(c))
  assert(missing.length === 0, `A1 20 语种 key 齐全（缺失 ${missing.length} 个）`, missing.join(','))
  assert(extra.length === 0, 'A2 无多余语言 key', extra.join(','))

  // A3: 每个语言词表非空、词条无空 word
  let emptyLangs: string[] = []
  let emptyWords: string[] = []
  for (const c of langCodes) {
    const list = PROHIBITED_AVOID[c]
    if (!list || list.length === 0) { emptyLangs.push(c); continue }
    for (const w of list) {
      if (!w.word || !w.word.trim()) emptyWords.push(`${c}:${JSON.stringify(w.word)}`)
    }
  }
  assert(emptyLangs.length === 0, 'A3 每语言词表非空', emptyLangs.join(','))
  assert(emptyWords.length === 0, 'A4 无空词条', emptyWords.join(','))

  // A5: test 在 en + de（用户确认的亚马逊真实拦截词）
  assert(PROHIBITED_AVOID['en'].some(w => w.word === 'test'), 'A5 test 在 en 词表')
  assert(PROHIBITED_AVOID['de'].some(w => w.word === 'Test'), 'A6 Test 在 de 词表')

  // A7: zh 词表 ≥40 词 + 豁免表非空
  assert(PROHIBITED_ZH.length >= 40, `A7 zh 词表 ≥40 词（实际 ${PROHIBITED_ZH.length}）`)
  assert(PROHIBITED_ZH_EXEMPTIONS.length > 0, 'A8 zh 豁免短语表非空')

  // A9: 全部词条可安全编译为词边界正则（防未转义元字符运行时炸雷）
  let compileErrors: string[] = []
  const LETTER_RE = /^[A-Za-zÀ-ɏЀ-ӿ]/
  const LETTER_END_RE = /[A-Za-zÀ-ɏЀ-ӿ]$/
  for (const c of Object.keys(PROHIBITED_AVOID)) {
    for (const w of PROHIBITED_AVOID[c]) {
      try {
        const escaped = w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
        const lb = LETTER_RE.test(w.word) ? '(?<![A-Za-zÀ-ɏЀ-ӿ])' : '(?<!\\d)'
        const la = LETTER_END_RE.test(w.word) ? '(?![A-Za-zÀ-ɏЀ-ӿ])' : '(?!\\d)'
        new RegExp(lb + escaped + la, 'i')
      } catch (e) {
        compileErrors.push(`${c}:${w.word} → ${e}`)
      }
    }
  }
  assert(compileErrors.length === 0, 'A9 全部词条正则编译通过', compileErrors.slice(0, 3).join(' | '))

  // A10: 存储红线词已收录（用户参考文档核心增量——京东/亚马逊政策点名）
  const zhWords = PROHIBITED_ZH.map(w => w.word)
  for (const w of ['扩容卡', '永不掉速', '终身质保', '军工级', '工业级']) {
    assert(zhWords.includes(w), `A10 存储红线词「${w}」已收录 zh 词表`)
  }
  const enWords = PROHIBITED_AVOID['en'].map(w => w.word)
  for (const w of ['lifetime warranty', 'never lose data', 'no speed drop', 'military grade', 'expandable capacity']) {
    assert(enWords.includes(w), `A11 存储红线词「${w}」已收录 en 词表`)
  }

  // A12: 词表增补（2026-08-14 用户拍板：促销词收录 + 只收 eco-friendly 系环保词）
  for (const w of ['唯一', 'NO.1', 'TOP1', '宇宙级', '最高级', '升级盘', '强制扩容', '限时秒杀', '最后一波', '清仓甩卖']) {
    assert(zhWords.includes(w), `A12 增补词「${w}」已收录 zh 词表`)
  }
  for (const w of ['new arrival', 'brand new', 'limited time', 'on sale', 'clearance', 'special offer',
    'giveaway', 'free gift', 'hot sale', 'satisfaction guarantee', 'money back guarantee', 'full refund',
    'eco-friendly', 'environmentally friendly']) {
    assert(enWords.includes(w), `A12 增补词「${w}」已收录 en 词表`)
  }
  const deWords = PROHIBITED_AVOID['de'].map(w => w.word)
  for (const w of ['unglaublich', 'spitzenklasse']) {
    assert(deWords.includes(w), `A12 增补词「${w}」已收录 de 词表`)
  }
  // 反向锁：条件性违规词不收（用户拍板——durable/long lasting 需附寿命参数，代码判不了）
  assert(!enWords.includes('durable') && !enWords.includes('long lasting'),
    'A12 反向锁：durable/long lasting 不收（条件性违规，代码不可判）')
  // 反向锁：促销词命中优先级——zh 词表增补后豁免表语义不变
  assert(hasProhibited('限时秒杀', 'zh-CN'), 'A12 zh 促销词「限时秒杀」可检出')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('B. 检测单元')
  out.push('═'.repeat(60))

  // B1: zh 命中
  let hits = hitWords('这是最佳的选择', 'zh-CN')
  assert(hits.includes('最佳'), 'B1 zh 命中「最佳」', hits.join(','))
  hits = hitWords('100% 兼容所有设备', 'zh-CN')
  assert(hits.includes('100%'), 'B2 zh 命中「100%」', hits.join(','))
  hits = hitWords('性能最强，永不掉速', 'zh-CN')
  assert(hits.includes('最强') && hits.includes('永不掉速'), 'B3 zh 同时命中「最强」「永不掉速」', hits.join(','))

  // B2: zh 豁免短语剔除（不误报）
  assert(!hasProhibited('遵循最佳实践进行开发', 'zh-CN'), 'B4 zh 豁免「最佳实践」不误报')
  assert(!hasProhibited('第一时间联系我们', 'zh-CN'), 'B5 zh 豁免「第一时间」不误报')
  assert(!hasProhibited('读取速度最高可达2050MB/s', 'zh-CN'), 'B6 zh 豁免「最高可达」（Lexar 标准速度表述）')
  assert(!hasProhibited('最大支持2TB容量扩展', 'zh-CN'), 'B7 zh 豁免「最大支持」（spec 陈述）')
  // 混合：豁免部分剔除后其余违禁词仍命中
  hits = hitWords('遵循最佳实践，性能最强', 'zh-CN')
  assert(!hits.includes('最佳') && hits.includes('最强'), 'B8 zh 混合文本：豁免剔除但其余仍命中', hits.join(','))

  // B3: en 命中 + 词边界误伤防护
  assert(hasProhibited('This is a test product', 'en'), 'B9 en 命中「test」')
  assert(hasProhibited('The best SSD ever', 'en'), 'B10 en 命中「best」')
  assert(hasProhibited('We guarantee quality', 'en'), 'B11 en 命中「guarantee」')
  assert(hasProhibited('Stress test passed', 'en'), 'B12 en 命中复合词「stress test」')
  assert(hasProhibited('stress   test with double space', 'en'), 'B13 en 复合词双空格弹性命中')
  // 误伤防护：test 的子串形态绝不能命中（词边界正则的存在意义）
  assert(!hasProhibited('detection of errors', 'en'), 'B14 en 不误伤「detection」')
  assert(!hasProhibited('the latest firmware', 'en'), 'B15 en 不误伤「latest」')
  assert(!hasProhibited('protest against policy', 'en'), 'B16 en 不误伤「protest」')
  assert(!hasProhibited('attest to the quality', 'en'), 'B17 en 不误伤「attest」')
  assert(!hasProhibited('interest rate', 'en'), 'B18 en 不误伤「interest」（rest 类子串双保险）')

  // B4: en 存储红线命中
  assert(hasProhibited('never lose data again', 'en'), 'B19 en 命中「never lose data」')
  assert(hasProhibited('military grade durability', 'en'), 'B20 en 命中「military grade」')
  assert(hasProhibited('expandable capacity design', 'en'), 'B21 en 命中「expandable capacity」')

  // B5: de 命中（i flag 大小写通吃 + 词边界防 Protest）
  assert(hasProhibited('Der beste Speicher', 'de'), 'B22 de 命中「beste」')
  assert(hasProhibited('Im Test bewährt', 'de'), 'B23 de 命中「Test」（i flag 兼配小写）')
  assert(!hasProhibited('Protest gegen die Regel', 'de'), 'B24 de 不误伤「Protest」（词边界防子串）')
  assert(hasProhibited('lebenslange Garantie inklusive', 'de'), 'B25 de 命中「lebenslange Garantie」')

  // B6: ja 命中（CJK 子串）
  assert(hasProhibited('最高の性能を発揮', 'ja'), 'B26 ja 命中「最高」')
  assert(hasProhibited('厳格なテストを実施', 'ja'), 'B27 ja 命中「テスト」')
  assert(hasProhibited('業界最速の転送速度', 'ja'), 'B28 ja 命中「業界最速」（景品表示法点名）')
  assert(hasProhibited('完全防水設計', 'ja'), 'B29 ja 命中「完全」')

  // B7: 无 g flag 回归锁——同语言连续检测两条，第二条不漏
  //     （g flag lastIndex 状态污染会让第二条 exec 从 lastIndex 之后开始 → 漏命中）
  const consec1 = detectProhibited('This is a test', 'en')
  const consec2 = detectProhibited('Another test case', 'en')
  assert(consec1.length > 0 && consec2.length > 0, 'B30 同语言连续两条检测第二条不漏（g-flag 回归锁）',
    `first=${consec1.length} second=${consec2.length}`)
  const consecZh1 = detectProhibited('最佳的体验', 'zh-CN')
  const consecZh2 = detectProhibited('最强的性能', 'zh-CN')
  assert(consecZh1.length > 0 && consecZh2.length > 0, 'B31 zh 连续两条第二条不漏', `first=${consecZh1.length} second=${consecZh2.length}`)

  // B8: 符号词数字端防护
  assert(hasProhibited('100% compatible', 'en'), 'B32 符号词「100%」命中')
  assert(!hasProhibited('1100% growth claimed', 'en'), 'B33 不误伤「1100%」（(?<!\\d) 数字端防护）')
  assert(hasProhibited('We are #1 in storage', 'en'), 'B34 符号词「#1」命中')

  // B9: 重叠命中取最长（badge/note 只报最长的那个，防刷屏稀释信任）
  hits = hitWords('全网最低价促销', 'zh-CN')
  assert(hits.includes('全网最低') && !hits.includes('最低'), 'B35 重叠取最长：「全网最低」吞并「最低」', hits.join(','))

  // B10: 术语库值含违禁词场景——检测器如实报出（评审锁定的兜底语义：
  //      enforceGlossaryTerms 可能把含违禁词的术语值塞回译文，回检必须能抓到）
  assert(hasProhibited('最高の品質をお約束', 'ja'), 'B36 术语库值含违禁词场景：检测器如实报出')

  // B11: 空文本/无词表语言不炸
  assert(detectProhibited('', 'en').length === 0, 'B37 空文本返回空')
  assert(detectProhibited('hello', 'xx-unknown').length === 0, 'B38 未知语言返回空（不炸）')
  assert(_prohibitedCacheSize() > 0, 'B39 编译缓存已工作', `cache=${_prohibitedCacheSize()}`)

  // B12: 增补词命中（2026-08-14 增补轮）
  assert(hasProhibited('限时秒杀全场', 'zh-CN'), 'B40 zh 命中促销词「限时秒杀」')
  assert(hasProhibited('清仓甩卖进行中', 'zh-CN'), 'B41 zh 命中促销词「清仓甩卖」')
  assert(hasProhibited('唯一的选择', 'zh-CN'), 'B42 zh 命中「唯一」')
  assert(hasProhibited('宇宙级性能表现', 'zh-CN'), 'B43 zh 命中「宇宙级」')
  assert(hasProhibited('警惕升级盘陷阱', 'zh-CN'), 'B44 zh 命中红线「升级盘」')
  assert(hasProhibited('Summer clearance event', 'en'), 'B45 en 命中「clearance」')
  assert(hasProhibited('Items on sale now', 'en'), 'B46 en 命中「on sale」')
  assert(hasProhibited('This product is eco-friendly', 'en'), 'B47 en 命中环保词「eco-friendly」（ECGT 无条件违规）')
  assert(hasProhibited('environmentally friendly design', 'en'), 'B48 en 命中环保词「environmentally friendly」')
  assert(hasProhibited('Get a free gift today', 'en'), 'B49 en 命中「free gift」')
  assert(hasProhibited('We offer money back guarantee', 'en'), 'B50 en 命中「money back guarantee」')
  assert(hasProhibited('Das ist unglaublich', 'de'), 'B51 de 命中「unglaublich」（i flag 兼配大写）')
  assert(hasProhibited('Spitzenklasse Qualität', 'de'), 'B52 de 命中「Spitzenklasse」（i flag 兼配小写）')

  // B13: 增补词误伤防护（词边界）
  assert(!hasProhibited('new arrivals terminal at the airport', 'en'), 'B53 en 不误伤「new arrivals」（复数词边界）')
  assert(!hasProhibited('personalized service', 'en'), 'B54 en 不误伤「personalized」（on sale 子串防线）')
  assert(hasProhibited('warehouse clearance racks', 'en'), 'B55 en「clearance」作为独立词命中（复合场景不误伤防线不吞命中）')
  assert(!hasProhibited('salesperson of the month', 'en'), 'B56 en 不误伤「salesperson」（on sale 子串防线 2）')
  assert(hasProhibited('the special offer expired', 'en'), 'B57 en 命中「special offer」')
  assert(hasProhibited('Get a full refund today', 'en'), 'B58 en 命中「full refund」')
  assert(!hasProhibited('a reflexive pronoun itself', 'en'), 'B59 en 不误伤「itself」（full refund 词边界防线）')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('C. proofreadBatch mock 端到端（请求体 note + 全局块 + 修正后回检）')
  out.push('═'.repeat(60))

  // C1: zh-TW 目标（中文指令）——命中条目含违禁词 note 且列出具体词 + 全局块注入
  mockCalls.length = 0
  responseQueue.push('[{"i":1,"text":"高效能隨身碟，傳輸速度優異","reason":"規避違禁詞"}]')
  const c1Items = [
    { sourceText: 'High speed portable drive', translatedText: '最佳高速隨身碟' },  // 最佳 = 违禁词
    { sourceText: 'Fast data transfer', translatedText: '快速資料傳輸' },
  ]
  const c1FixMap = new Map<number, Array<{ word: string; note: string }>>([
    [0, [{ word: '最佳', note: '广告法绝对化用语' }]],
  ])
  const c1Result = await proofreadBatch(c1Items, 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, c1FixMap)
  assert(mockCalls.length === 1, 'C1 校对调用 1 次', `got ${mockCalls.length}`)
  const c1Body = JSON.parse(mockCalls[0].body)
  const c1User = c1Body.messages.find((m: { role: string }) => m.role === 'user').content
  const c1Sys = c1Body.messages.find((m: { role: string }) => m.role === 'system').content
  assert(/平台违禁词/.test(c1User), 'C2 命中条目含违禁词 note', c1User.slice(0, 300))
  assert(/最佳/.test(c1User), 'C3 note 列出具体词「最佳」（语义改写必须列词）')
  assert(/只输出改写后的文本/.test(c1User), 'C4 note 祈使句「只输出改写后的文本」（防解释性输出）')
  assert(!/最佳.*→|最佳.*改为/.test(c1User), 'C5 note 非对照表形态（防 LLM 复述违禁词）')
  assert(/违禁词规避/.test(c1Sys), 'C6 system prompt 注入全局 PROHIBITED_NOTE 块')
  // 未命中条目（第 2 条）的 Trans 行不含 note
  const c1Lines = c1User.split('\n')
  const c1SecondIdx = c1Lines.findIndex((l: string) => l.includes('快速資料傳輸'))
  assert(c1SecondIdx >= 0 && !c1Lines[c1SecondIdx].includes('平台违禁词'), 'C7 未命中条目不含违禁词 note')
  // 修正后回检干净（代码回检闭环的测试侧复刻）
  assert(c1Result[0].text === '高效能隨身碟，傳輸速度優異', 'C8 校对修正结果落地', c1Result[0].text)
  assert(!hasProhibited(c1Result[0].text, 'zh-TW'), 'C9 修正后译文回检干净（检测器确认）', c1Result[0].text)

  // C2: de 目标（英文指令）——note 英文形态 + Test 具体词
  mockCalls.length = 0
  responseQueue.push('[{"i":1,"text":"Hochwertiger Speicher, geprüft","reason":"verbotene Wörter vermieden"}]')
  const c2Items = [
    { sourceText: 'Best storage, well tested', translatedText: 'Bester Speicher, im Test bewährt' },
  ]
  const c2FixMap = new Map<number, Array<{ word: string; note: string }>>([
    [0, [{ word: 'Bester', note: 'Superlativ' }, { word: 'Test', note: 'Amazon 拦截词' }]],
  ])
  await proofreadBatch(c2Items, 'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, c2FixMap)
  const c2Body = JSON.parse(mockCalls[0].body)
  const c2User = c2Body.messages.find((m: { role: string }) => m.role === 'user').content
  const c2Sys = c2Body.messages.find((m: { role: string }) => m.role === 'system').content
  assert(/platform-prohibited word/.test(c2User), 'C10 英文指令 note 含「platform-prohibited word」', c2User.slice(0, 300))
  assert(/Bester/.test(c2User) && /Test/.test(c2User), 'C11 note 列出全部具体词（Bester, Test）')
  assert(/Output ONLY the rewritten text/.test(c2User), 'C12 英文 note 祈使句「Output ONLY the rewritten text」')
  assert(/PROHIBITED WORDS/.test(c2Sys), 'C13 英文 system 注入全局块')

  // C3: 不传 prohibitedFixMap —— user/system 双双零死文本（条件注入的存在意义）
  mockCalls.length = 0
  responseQueue.push('[]')
  await proofreadBatch(c1Items, 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined)
  const c3Body = JSON.parse(mockCalls[0].body)
  const c3User = c3Body.messages.find((m: { role: string }) => m.role === 'user').content
  const c3Sys = c3Body.messages.find((m: { role: string }) => m.role === 'system').content
  assert(!/平台违禁词/.test(c3User), 'C14 不传 fixMap 时 user 零违禁词死文本')
  assert(!/违禁词规避/.test(c3Sys), 'C15 不传 fixMap 时 system 零违禁词死文本')

  // C4: 传空 Map —— 等同不传（hasProhibitedFix 是 size>0 判定）
  mockCalls.length = 0
  responseQueue.push('[]')
  await proofreadBatch(c1Items, 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, new Map())
  const c4Body = JSON.parse(mockCalls[0].body)
  const c4Sys = c4Body.messages.find((m: { role: string }) => m.role === 'system').content
  assert(!/违禁词规避/.test(c4Sys), 'C16 空 Map 不注入全局块（size>0 判定）')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('D. 关校对零行为变化（快照锁）')
  out.push('═'.repeat(60))

  // D1: hasProhibitedFix 未传 === 显式 false（逐字节一致）——
  //     现有调用方不传该参时输出必须与旧版完全相同
  const d1a = buildProofreadSystemPrompt({ targetLang: 'de', productLine: 'ssd', useEnInstruction: true })
  const d1b = buildProofreadSystemPrompt({ targetLang: 'de', productLine: 'ssd', useEnInstruction: true, hasProhibitedFix: false })
  assert(d1a === d1b, 'D1 未传 hasProhibitedFix 与显式 false 逐字节一致')
  assert(!/PROHIBITED WORDS/.test(d1a), 'D2 未传时 system 无违禁词块')

  // D2: true 时才注入（且位置在 expansionBlock 之后——组装顺序锁）
  const d2 = buildProofreadSystemPrompt({ targetLang: 'de', productLine: 'ssd', useEnInstruction: true, hasProhibitedFix: true })
  assert(/PROHIBITED WORDS/.test(d2), 'D3 hasProhibitedFix:true 注入全局块')
  const d3zh = buildProofreadSystemPrompt({ targetLang: 'ja', productLine: null, useEnInstruction: false, hasProhibitedFix: true })
  assert(/违禁词规避/.test(d3zh), 'D4 中文指令形态注入中文全局块')

  // D3: 与 hasExpansionFlags 共存不互扰（两个条件块叠加）
  const d4 = buildProofreadSystemPrompt({ targetLang: 'de', productLine: 'ssd', useEnInstruction: true, hasExpansionFlags: true, hasProhibitedFix: true })
  assert(/PROHIBITED WORDS/.test(d4) && d4.length > d2.length, 'D5 与 expansion 块共存叠加不互扰')
  // 顺序锁：expansion 块在 prohibited 块之前（组装顺序）
  const expIdx = d4.indexOf('EXPANSION')
  const proIdx = d4.indexOf('PROHIBITED WORDS')
  assert(expIdx >= 0 && proIdx > expIdx, 'D6 组装顺序：expansionBlock 在 prohibitedBlock 之前', `exp=${expIdx} pro=${proIdx}`)

  // D4: detectProhibited 不依赖任何 LLM/mock 状态（纯函数）
  const before = mockCalls.length
  detectProhibited('test product', 'en')
  assert(mockCalls.length === before, 'D7 detectProhibited 零 LLM 调用（纯函数）')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('E. 源语言判定（detectSourceLangForProhibited）')
  out.push('═'.repeat(60))

  // E1: 混排（中文+英文型号）→ zh（CJK 优先——detectSourceLanguage 的 cjk>latin
  //     一票制会把这种文案误判 en，本函数是京东词表分支的兜底）
  assert(detectSourceLangForProhibited('Lexar SL500 最快 Portable SSD 移动固态硬盘') === 'zh',
    'E1 混排（中文+型号噪声）判 zh')
  assert(detectSourceLangForProhibited('支持 PCIe 4.0 NVMe 协议，读取速度最高可达2050MB/s') === 'zh',
    'E2 混排（规格噪声超汉字数）仍判 zh')

  // E2: 纯英文 → en
  assert(detectSourceLangForProhibited('High speed portable SSD for creators') === 'en',
    'E3 纯英文判 en')

  // E3: 纯规格文本含字母 → 'en'（设计决定：规格文本会被过一遍 en 词表，
  //     但词边界防护保证零误伤——检测开销可忽略，换来规则无例外）
  assert(detectSourceLangForProhibited('2050MB/s') === 'en', 'E4 纯规格文本判 en（含字母；下游词边界防误伤）')
  assert(detectSourceLangForProhibited('512GB') === 'en', 'E5 纯容量判 en（同上）')
  assert(!hasProhibited('2050MB/s', 'en'), 'E6 en 词表对纯规格零误伤（判 en 也无谓命中）')
  assert(detectSourceLangForProhibited('') === null, 'E7 空文本判 null')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('F. v11.12+ 术语库最高优先级（2026-08-14 用户拍板）')
  out.push('═'.repeat(60))

  // F1: 有限终身质保豁免——简/繁四形态不误报（术语库 Limited Lifetime Warranty
  //     词条 zh-CN/zh-TW 官方译值即此形态，不豁免则术语库值与违禁词表死锁）
  assert(!hasProhibited('有限终身质保', 'zh-CN'), 'F1 zh-CN 豁免「有限终身质保」（Limited Lifetime Warranty 官方译值）')
  assert(!hasProhibited('有限终身保修', 'zh-CN'), 'F2 zh-CN 豁免「有限终身保修」')
  assert(!hasProhibited('有限終身保固', 'zh-TW'), 'F3 zh-TW 豁免「有限終身保固」（繁体形态共用豁免表）')
  assert(!hasProhibited('有限終身保修', 'zh-TW'), 'F4 zh-TW 豁免「有限終身保修」')

  // F2: 裸承诺词仍命中——豁免只放行"有限"前缀形态，京东管控的裸"终身质保/终身保修"照拦
  assert(hasProhibited('本产品终身质保', 'zh-CN'), 'F5 裸「终身质保」仍命中（豁免不放行裸承诺）')
  assert(hasProhibited('终身保修无忧', 'zh-CN'), 'F6 裸「终身保修」仍命中')
  hits = hitWords('有限终身质保，性能最强', 'zh-CN')
  assert(!hits.some(w => w.includes('终身')) && hits.includes('最强'),
    'F7 混合文本：豁免剔除有限终身质保，其余违禁词仍命中', hits.join(','))

  // F3: isGlossaryLockedTranslation 判定口径（与翻译/校对锁定侧同一 cleanKey 归一化）
  const fMap = new Map<string, string>([
    ['limited lifetime warranty', '有限终身质保'],  // cleanKey 后的形态（小写、无®）
    ['lexar nm790', 'Lexar NM790'],
  ])
  assert(isGlossaryLockedTranslation('Limited Lifetime Warranty', '有限终身质保', fMap) === true,
    'F8 源文整条命中+译文==钦定值 → 锁定')
  assert(isGlossaryLockedTranslation('Limited Lifetime Warranty®', '有限终身质保', fMap) === true,
    'F9 源文带®（cleanKey 剥离）仍判锁定')
  assert(isGlossaryLockedTranslation('Limited Lifetime Warranty', '终身质保', fMap) === false,
    'F10 译文≠钦定值（自由发挥含违禁词）→ 不豁免')
  assert(isGlossaryLockedTranslation('Some random sentence', '有限终身质保', fMap) === false,
    'F11 源文不在术语库 → 不豁免')
  assert(isGlossaryLockedTranslation('Limited Lifetime Warranty', '有限终身质保', undefined) === false,
    'F12 无术语表（undefined）→ 不豁免（保守不豁免，照常进修正链）')
  assert(isGlossaryLockedTranslation('', '有限终身质保', fMap) === false, 'F13 空源文不炸')

  // F4: proofreadBatch 预豁免——术语库锁定项不进修正链（改写→锁回→死锁的根治点）
  //     请求体不得含违禁词 note（即使 fixMap 传入该索引）
  mockCalls.length = 0
  responseQueue.push('[]')
  const fGlossary = new Map<string, string>([['Limited Lifetime Warranty', '有限终身质保']])
  const fNorm = new Map<string, string>([['limited lifetime warranty', '有限终身质保']])
  const fItems = [{ sourceText: 'Limited Lifetime Warranty', translatedText: '有限终身质保' }]
  const fFixMap = new Map<number, Array<{ word: string; note: string }>>([
    [0, [{ word: '终身质保', note: '京东管控裸承诺' }]],
  ])
  await proofreadBatch(fItems, 'zh-CN', fGlossary, config,
    undefined, undefined, undefined, fNorm, undefined, fFixMap)
  const fBody = JSON.parse(mockCalls[0].body)
  const fUser = fBody.messages.find((m: { role: string }) => m.role === 'user').content
  assert(!/平台违禁词/.test(fUser), 'F14 术语库锁定项被预豁免：请求体零违禁词 note', fUser.slice(0, 300))
  assert(fFixMap.size === 0, 'F15 预豁免同步清空 fixMap（调用方徽章走 locked 通道）', `size=${fFixMap.size}`)

  // F5: 非锁定项不受豁免影响——同批混合：锁定项 note 消失，普通命中项 note 保留
  mockCalls.length = 0
  responseQueue.push('[{"i":2,"text":"高效能隨身碟","reason":"規避"}]')
  const f2Items = [
    { sourceText: 'Limited Lifetime Warranty', translatedText: '有限终身质保' },  // 锁定
    { sourceText: 'High speed drive', translatedText: '最佳高速隨身碟' },           // 普通命中
  ]
  const f2FixMap = new Map<number, Array<{ word: string; note: string }>>([
    [0, [{ word: '终身质保', note: '京东管控裸承诺' }]],
    [1, [{ word: '最佳', note: '广告法绝对化用语' }]],
  ])
  await proofreadBatch(f2Items, 'zh-TW', fGlossary, config,
    undefined, undefined, undefined, fNorm, undefined, f2FixMap)
  const f2Body = JSON.parse(mockCalls[0].body)
  const f2User = f2Body.messages.find((m: { role: string }) => m.role === 'user').content
  // 按 [n] 条目标题切分条目段（200 字符窗口法会因短条目互相"出血"误伤——
  // 锁定项无 note 后，[2] 的 note 落在 [1] 译文 200 字符内）
  const f2Seg1 = f2User.slice(f2User.indexOf('[1]'), f2User.indexOf('[2]'))
  const f2Seg2 = f2User.slice(f2User.indexOf('[2]'))
  assert(f2Seg1.includes('有限终身质保') && !f2Seg1.includes('平台违禁词'),
    'F16 混合批次：锁定项条目段无 note')
  assert(f2Seg2.includes('最佳高速隨身碟') && f2Seg2.includes('平台违禁词') && f2Seg2.includes('最佳'),
    'F17 混合批次：普通命中项 note 保留且列出「最佳」（豁免不误伤非锁定项）')

  // F6: 译文≠钦定值不豁免——源文命中术语库但译文自由发挥含违禁词，照常进修正链
  mockCalls.length = 0
  responseQueue.push('[]')
  const f3Items = [{ sourceText: 'Limited Lifetime Warranty', translatedText: '终身质保无忧' }]
  const f3FixMap = new Map<number, Array<{ word: string; note: string }>>([
    [0, [{ word: '终身质保', note: '京东管控裸承诺' }]],
  ])
  await proofreadBatch(f3Items, 'zh-CN', fGlossary, config,
    undefined, undefined, undefined, fNorm, undefined, f3FixMap)
  const f3Body = JSON.parse(mockCalls[0].body)
  const f3User = f3Body.messages.find((m: { role: string }) => m.role === 'user').content
  assert(/平台违禁词/.test(f3User) && f3FixMap.size === 1,
    'F18 译文≠钦定值（自由发挥）不豁免：note 保留且 fixMap 未清', `size=${f3FixMap.size}`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('G. v11.15 豁免增补（2026-08-18 用户拍板：Recovery Tool 锚定豁免 + 第一秒）')
  out.push('═'.repeat(60))

  // G1-G4: 实机文案豁免（产品名锚定 + 字符间 \W* 弹性吞修饰词）
  assert(hitWords('Lexar Recovery Tool 专业数据恢复软件', 'zh').length === 0,
    'G1 "Lexar Recovery Tool 专业数据恢复软件" 豁免')
  assert(hitWords('Lexar Recovery Tool 专业数据恢复', 'zh').length === 0,
    'G2 "Lexar Recovery Tool 专业数据恢复" 豁免（无"软件"形态）')
  assert(hitWords('Lexar Recovery Tool 数据恢复工具', 'zh').length === 0,
    'G3 无修饰直连形态豁免')
  assert(hitWords('从开机第一秒到收工最后一刻，稳定输出不掉速', 'zh').length === 0,
    'G4 "从开机第一秒…" 豁免（时间序数，实机文案全文）')

  // G5-G9: 防护断言——豁免不能开洞（裸词/无据吹嘘/绝对化用语仍命中）
  assert(hitWords('支持数据恢复功能', 'zh').includes('数据恢复'),
    'G5 裸"数据恢复"（无 Recovery Tool 锚）仍命中')
  assert(hitWords('100%数据恢复，误删秒找回', 'zh').includes('数据恢复'),
    'G6 "100%数据恢复"无据吹嘘仍命中')
  assert(hitWords('销量第一，品质保证', 'zh').length > 0,
    'G7 "销量第一"绝对化用语仍命中')
  assert(hitWords('行业第一品牌', 'zh').includes('第一'),
    'G8 "第一"裸用仍命中')
  assert(hitWords('专业的数据恢复软件，就找XX', 'zh').includes('数据恢复'),
    'G9 无锚功效宣称仍命中')

  // G10-G12: 既有豁免条目在 \W* 弹性化后语义不变（相邻字符 \W* 恒空串）
  assert(hitWords('遵循最佳实践，第一时间响应', 'zh').length === 0,
    'G10 既有豁免（最佳实践/第一时间）语义不变')
  assert(hitWords('最高可达2050MB/s，有限终身质保', 'zh').length === 0,
    'G11 既有豁免（最高可达/有限终身质保）语义不变')
  assert(hitWords('我们是最好的产品', 'zh').includes('最好'),
    'G12 豁免弹性化不吞真违禁词（最好仍命中）')

  out.push('')
  out.push('═'.repeat(60))
  out.push('H. v12.0 校对输出 schema 化（2026-08-23：response_format json_object + {"results":[...]} 包装）')
  out.push('═'.repeat(60))

  // H1: 请求体含 response_format json_object（API 层硬约束存在）
  mockCalls.length = 0
  responseQueue.push('{"results":[]}')
  await proofreadBatch(c1Items, 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined)
  const h1Body = JSON.parse(mockCalls[0].body)
  assert(h1Body.response_format?.type === 'json_object', 'H1 请求体含 response_format json_object 硬约束',
    JSON.stringify(h1Body.response_format))

  // H2: system prompt 新约定——{"results":[...]} 包装（EN/ZH 双版同步）
  const h2SysZh = h1Body.messages.find((m: { role: string }) => m.role === 'system').content
  assert(/"results"/.test(h2SysZh), 'H2 中文 system prompt 含 "results" 包装约定')
  assert(/\{"results":\[\]\}/.test(h2SysZh), 'H3 中文 prompt 全对示例 {"results":[]}')
  mockCalls.length = 0
  responseQueue.push('{"results":[]}')
  await proofreadBatch(c2Items, 'de', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined)
  const h2SysEn = JSON.parse(mockCalls[0].body).messages.find((m: { role: string }) => m.role === 'system').content
  assert(/"results"/.test(h2SysEn), 'H4 英文 system prompt 含 "results" 包装约定')

  // H5: 新格式 {"results":[...]} 解析落地（主路径）
  mockCalls.length = 0
  responseQueue.push('{"results":[{"i":1,"text":"高效能隨身碟","reason":"術語錯誤","ambiguous":[]}]}')
  const h5Result = await proofreadBatch(c1Items, 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined)
  assert(h5Result[0].text === '高效能隨身碟', 'H5 {"results":[...]} 新格式解析落地', h5Result[0].text)
  assert(h5Result[0].reason === '術語錯誤', 'H6 reason 字段解析', h5Result[0].reason)
  assert(h5Result[1].text === '快速資料傳輸', 'H7 未修改条目回退原译文（防御兜底语义）', h5Result[1].text)

  // H8: 向后兼容裸 [...]（旧软约定输出仍能解析——防御层不死）
  mockCalls.length = 0
  responseQueue.push('[{"i":2,"text":"快速傳輸","reason":"漏翻"}]')
  const h8Result = await proofreadBatch(c1Items, 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined)
  assert(h8Result[1].text === '快速傳輸', 'H8 裸 [...] 旧格式向后兼容解析', h8Result[1].text)
  assert(h8Result[0].text === '最佳高速隨身碟', 'H9 旧格式下未修改条目回退原译文', h8Result[0].text)

  // H10: {"results":[...]} 优先级高于裸 [...]（双形态同时出现时 results 胜出——防 prompt 回显干扰）
  mockCalls.length = 0
  responseQueue.push('Some text [{"i":1,"text":"干扰项","reason":"x"}] {"results":[{"i":2,"text":"正解","reason":"漏翻"}]}')
  const h10Result = await proofreadBatch(c1Items, 'zh-TW', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined)
  assert(h10Result[1].text === '正解' && h10Result[0].text === '最佳高速隨身碟', 'H10 results 包装优先于裸 array（防回显干扰）',
    `[0]=${h10Result[0].text} [1]=${h10Result[1].text}`)

  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v1112-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v11.12 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v1112-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
