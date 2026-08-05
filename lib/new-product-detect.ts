/**
 * new-product-detect.ts — 未收录新产品名检测（v11.2）
 *
 * 背景：产品名未收录进术语库时，型号代码（NM790）与规格 token（PCIe/NVMe）
 * 已被 PRODUCT_CODE_RE / PRESERVED_TERMS 遮蔽，但"新系列名"（THOR Ultra、
 * 未来的 VELOCIS）与"无字母系列的整条产品名"（NF100/ES3 等 42/140 的纯型号
 * 形态）裸奔进 LLM，可能被翻译/音译/乱排序，污染全部 20 语种。
 *
 * v11.2 宏观重构（对比 v11.1）：
 *   1. ® 修复 —— 所有 token 比较前剥离 ®™©；带 ® 的 Lexar 是"完整产品名"强信号
 *   2. 系列名改为【可选槽】—— 锚点后允许直接跟型号/规格（NM790/NF100/E300…）
 *   3. 候选术语 = 整条原文（去®）—— 与 CSV key 惯例对齐（CSV 140 条全部无®），
 *      吃 S1 整条短路 + cleanKey 模糊匹配（天然命中带®/不带®变体）
 *   4. 品类词必含门 —— detectCategory ≠ null 才判定产品名
 *      （规则文档核心品类词严格界定，品类词是"产品名"指纹）
 *   5. 判定语义：代码确定性判定（整条独立出现+无动词/功能词+Lexar锚点+品类词），
 *      不需要 LLM 判定；LLM 不碰产品名（生成走五槽位规则，零 LLM）
 *
 * 紧网原则（错保留 > 错翻译，但过遮蔽=漏翻反向事故）：
 *   1. 整条形态门 — 文本必须是产品名形态（无动词/介词/句读、长度受限）
 *   2. 锚点门 — 必须含 Lexar / Professional（剥离®后比较）
 *   3. 槽位解析 — 锚点 + (系列名|型号|规格开头) + ... + [品类]
 *   4. 品类指纹门 — 必须含规则文档严格界定的核心品类词
 *   5. 新颖性门 — 整条（去®cleanKey）不在术语库
 *
 * 只对产品名生效；营销词、描述性短文本一律不碰。
 */

import { CATEGORY_WORDS } from '@lib/prompt-constants'
import { detectCategory } from '@lib/product-name-generator'

// ═══════════════════════════════════════════════════════════════
// 词表（与 entity-masker / llm-api 同源，避免漂移）
// ═══════════════════════════════════════════════════════════════

/** 规格 token —— 产品名中"系列名之后"的部分。命中即系列串终止。 */
const SPEC_TOKENS = new Set([
  'PCIe', 'NVMe', 'M.2', '2280', '2242', '2230', 'DDR4', 'DDR5', 'CUDIMM',
  'USB', 'USB-C', 'USB-A', 'Type-C', 'CFexpress', 'microSDHC', 'microSDXC',
  'SDHC', 'SDXC', 'UHS-I', 'UHS-II', 'SATA', 'III', 'XMP', 'EXPO',
  'V90', 'V60', 'V30', 'A2', 'A1', 'DirectStorage', 'Thunderbolt',
  'Gen', 'Gen1', 'Gen2', 'Gen3x4', 'Gen4x4', 'Gen5x4', 'Gen4X4', 'Gen5X4',
  '2.5', '3.0', '3.1', '3.2', '4.0', '5.0', '2.0', '4',
  '633x', '800x', '1066x', '1667x', '1800x', '2000x',
  'with', 'Heatsink', 'Magnetic', 'Set', 'Series', '(EOL)', '2nd', '1', '2',
  // 内存/存储容量规格（产品名中的原生参数，命中即系列串终止）
  'UDIMM', 'SODIMM', 'MHz', 'MT/s', 'GB/s', 'MB/s', 'Tb/s',
  'ECC', 'non-ECC', 'CL16', 'CL18', 'CL22', 'CL30', 'CL32', 'CL36', 'CL40',
  // v11.2.1: 全品线扫描补充
  'Express', 'Gaming', 'Fingerprint', 'TouchLock', '2×2', '2x2', '4×4', '4x4',
  'Type', 'B',  // CFexpress Type A/B；'B' 仅在槽位终止语境使用，系列串首字母大写约束不变
])

/** 斜杠双格式规格 token（microSDHC/microSDXC、SDHC/SDXC、microSD/SD、USB-A/C…） */
const SLASH_SPEC_RE = /^[A-Za-z0-9.\-]+\/[A-Za-z0-9.\-/]+$/

/** 容量 token（2TB / 1TB / 512GB / 256GB…），命中即系列串终止
 *  含粘连形式（TITAN2TB 不写空格时仍视为容量结尾，防容量被吞进系列串） */
const CAPACITY_TOKEN_RE = /^\d{1,5}(GB|TB|MB)$/i

/** 括号规格 token（(6Gb/s)、(EOL)…），命中即系列串终止 */
const PAREN_SPEC_RE = /^\(.*\)$/

/** v11.2.1: 功能词豁免 —— 命名规则文档定义的"单个字母规格后缀"语境
 *  CFexpress Type A / Type B、USB-A / USB-A/C 中的单字母 A/B/C 不是冠词/缩写，是规格代号 */
const SPEC_LETTER_CONTEXT_RE = /\b(Type|USB|Gen)\s+[A-C]\b|\/[A-C]\b|-[A-C]\//i

/** 品类词（英文 key 的单词集合 + 常见组成词）—— 命中即系列串终止。 */
const CATEGORY_TOKEN_SET = new Set<string>()
for (const key of Object.keys(CATEGORY_WORDS)) {
  for (const w of key.split(/\s+/)) CATEGORY_TOKEN_SET.add(w.toLowerCase())
}
// 品类词的常见组成词/相关词
for (const w of ['ssd', 'card', 'reader', 'hub', 'enclosure', 'drive', 'memory',
  'flash', 'desktop', 'laptop', 'portable', 'dual', 'solid', 'state', 'inch', 'hard'])
  CATEGORY_TOKEN_SET.add(w)

/** 锚点词 */
const ANCHOR_TOKENS = new Set(['lexar', 'professional'])

/** 已知品牌/系列词（已在术语库或品牌正则覆盖）—— 单独出现不算"新" */
const KNOWN_SERIES = new Set([
  'ares', 'thor', 'armor', 'play', 'blue', 'jumpdrive', 'blaze', 'touchlock',
  'workflow', 'go', 'silver', 'gold', 'diamond', 'pro', 'plus', 'max', 'oc',
  'rgb', 'elite', 'legends', 'high-endurance', 'high-performance', 'dual',
])

/** 营销/描述性形容词 —— 系列串若仅为这些词之一则拒绝（防 "Lexar Fast" 误遮蔽） */
const DESCRIPTIVE_WORDS = new Set([
  'high', 'fast', 'speed', 'new', 'super', 'ultra-fast', 'performance', 'endurance',
  'advanced', 'premium', 'extreme', 'pro', 'plus',
])

/** 产品型号形态（NM790 / D40E / E300 / A30E / SL500 / H31 / P30 / 纯数字） */
const MODEL_TOKEN_RE = /^([A-Z]{1,4}\d{1,5}[A-Za-z]?|\d{2,5}|[A-Z]\d{1,3}[A-Za-z]?)$/

/** 整条产品名形态门：仅允许字母/数字/有限标点（含 ®™©、英寸符号、括号、斜杠、×），无句读 */
const NAME_SHAPE_RE = /^[A-Za-z0-9 .®™©/+×x\-–—'"”()]+$/

/** 功能词（含则不是产品名，是句子/营销文案）
 *  v11.2.1: 移除 with —— 命名规则文档定义 "with Heatsink/Magnetic Set/Hub" 为标准配件话术 */
const FUNCTION_WORDS_RE = /\b(the|a|an|for|your|our|their|this|that|these|those|from|have|been|will|would|could|should|may|might|can|must|are|were|was|has|had|its|and|but|or|not|also|very|more|most|than|then|now|when|where|which|who|why|how|about|after|before|between|during|into|over|under|until|upon|within|without)\b/i

/** 动词（含则倾向于句子，非产品名） */
const VERB_RE = /\b(is|are|delivers?|offers?|provides?|features?|supports?|enables?|designed|engineered|built|makes?|gives?|gets?|boosts?|experience|enjoy|upgrade|meet|meets)\b/i

// ═══════════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════════

/** 剥离商标符号（®™©），用于一切 token 比较与入库 key */
export function stripTrademark(s: string): string {
  return s.replace(/[®™©]/g, '')
}

/** cleanKey 归一化（与 entity-masker/post-process 一致） */
function cleanKey(s: string): string {
  return s.toLowerCase().replace(/[®™©]/g, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ═══════════════════════════════════════════════════════════════
// 五槽位解析
// ═══════════════════════════════════════════════════════════════

export interface ParsedProductName {
  /** 锚点（Lexar / Lexar Professional / Professional），原文大小写（不含®） */
  anchor: string
  /** 系列名 token 串（锚点之后、第一个规格/品类/型号之前），原文大小写；纯型号形态为空串 */
  series: string
  /** 锚点后首个 token 是否为型号（纯型号形态=true，如 NF100/NM790/ES3） */
  modelLed: boolean
  /** 是否为合法产品名形态 */
  valid: boolean
}

/**
 * 解析一条文本的产品名五槽位。返回 null 表示不是产品名形态。
 * 系列名 = 锚点之后、第一个 规格词/品类词/型号 之前的连续"其他"token 串（可为空）。
 *
 * v11.2：系列名改可选槽。锚点后直接跟型号/规格（NF100/NM790/ES3/DDR4…）也合法，
 * 此时 series=''、modelLed=true。
 */
export function parseProductName(text: string): ParsedProductName | null {
  if (!text) return null
  const t = text.trim()
  // 形态门 1：长度 + 字符集（允许 ®™© 与英寸符号 ”）
  if (t.length < 4 || t.length > 120) return null
  if (!NAME_SHAPE_RE.test(t)) return null
  // 形态门 2：不含功能词/动词（排除营销文案与句子）
  //   v11.2.1: 功能词命中时检查"单字母规格后缀"豁免（Type A/B、USB-A 中的 A/B 是规格代号不是冠词）
  if (FUNCTION_WORDS_RE.test(t) && !SPEC_LETTER_CONTEXT_RE.test(t)) return null
  if (VERB_RE.test(t)) return null

  const tokens = t.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  // 锚点门：第一个 token 必须是 Lexar（剥离®后比较；允许 Lexar Professional 前缀）
  const first = stripTrademark(tokens[0]).toLowerCase()
  if (first !== 'lexar') return null
  let idx = 1
  let anchor = stripTrademark(tokens[0])
  if (idx < tokens.length && stripTrademark(tokens[idx]).toLowerCase() === 'professional') {
    anchor += ' ' + stripTrademark(tokens[idx])
    idx++
  }

  // 槽位解析：收集锚点之后的连续"其他"token 作为系列串（可为空）
  const seriesTokens: string[] = []
  let modelLed = false
  while (idx < tokens.length) {
    const tok = tokens[idx]
    const bare = stripTrademark(tok)   // v11.2.1: 一切判定基于去®™©后的裸 token
    const low = bare.toLowerCase()
    const isSpec = SPEC_TOKENS.has(bare) || SPEC_TOKENS.has(low)
      || SLASH_SPEC_RE.test(bare)      // 斜杠双格式：microSDHC/microSDXC、SDHC/SDXC、USB-A/C
      || CAPACITY_TOKEN_RE.test(bare)  // 容量：2TB / 512GB
      || PAREN_SPEC_RE.test(bare)      // 括号规格：(6Gb/s)、(EOL)
    const isCategory = CATEGORY_TOKEN_SET.has(low)
    const isModel = MODEL_TOKEN_RE.test(bare)
    const isAnchor = ANCHOR_TOKENS.has(low)
    if (isSpec || isCategory || isModel || isAnchor) {
      // 锚点后首个 token 即为型号/规格/品类 → 纯型号形态（系列名为空槽）
      if (seriesTokens.length === 0) modelLed = true
      break
    }
    seriesTokens.push(bare)
    idx++
  }

  // 系列串为空 = 型号/规格开头形态（v11.2 起合法：NM790/ES3 型号开头、DDR4 内存线规格开头）
  if (seriesTokens.length === 0) {
    return { anchor, series: '', modelLed: true, valid: true }
  }

  // 系列串约束：1-4 个 token；允许单字母修饰 token（X/Z/Pro 子型号后缀），其余 ≥2 字符；
  // 首字母大写或全大写（连字符系列如 High-Endurance 按整体判定）
  // v11.4: 放宽品牌小写 camelCase 形态（nCARD/eSeries——首字母小写+第二字母大写是
  //   商标形态不是普通小写词；'pro'/'fast' 全小写普通词仍被拒）
  // v11.2.1: 系列串尾部容量 token 视为规格，剥离后重新判定（"TITAN 2TB" → "TITAN"）
  while (seriesTokens.length > 0 && CAPACITY_TOKEN_RE.test(stripTrademark(seriesTokens[seriesTokens.length - 1]))) {
    seriesTokens.pop()
  }
  if (seriesTokens.length === 0) {
    return { anchor, series: '', modelLed: true, valid: true }
  }
  if (seriesTokens.length > 4) return { anchor, series: seriesTokens.join(' '), modelLed, valid: false }
  for (const st of seriesTokens) {
    const bare = stripTrademark(st)
    if (bare.length < 2 && !/^[A-Z]$/.test(bare)) {
      return { anchor, series: seriesTokens.join(' '), modelLed, valid: false }
    }
    // v11.4: 首字母大写 OR 品牌 camelCase（小写首字母+大写第二字母，如 nCARD/eSeries）
    if (!/^[A-Z]/.test(bare) && !/^[a-z][A-Z]/.test(bare)) {
      return { anchor, series: seriesTokens.join(' '), modelLed, valid: false }
    }
  }
  // 单 token 且为纯描述词 → 拒绝（"Lexar Fast" 不该保护）
  if (seriesTokens.length === 1 && DESCRIPTIVE_WORDS.has(stripTrademark(seriesTokens[0]).toLowerCase())) {
    return { anchor, series: seriesTokens.join(' '), modelLed, valid: false }
  }

  return { anchor, series: seriesTokens.join(' '), modelLed, valid: true }
}

// ═══════════════════════════════════════════════════════════════
// 检测入口
// ═══════════════════════════════════════════════════════════════

export interface AdhocProductTerm {
  /** 完整候选名（整条原文去®），如 "Lexar NF100 2.5-inch SATA III SSD" */
  term: string
  /** 系列名（纯型号形态为空串），供生成器使用 */
  series: string
  /** 命中的文本索引 */
  hitIndices: number[]
}

/**
 * 检测批次源文中"术语库未收录的新产品名"。
 * 返回去重后的临时术语列表（term=整条原文去®）。
 *
 * v11.2 判定链：形态门 → 锚点门 → 品类指纹门 → 新颖性门
 *
 * @param texts       批次全部源文
 * @param glossaryMap 术语库 full 视图（用于新颖性判断）
 */
export function detectAdhocProductTerms(
  texts: string[],
  glossaryMap: Map<string, string>,
): AdhocProductTerm[] {
  // 预建术语库 cleanKey 集合（keys + values），新颖性门用
  const glossaryKeys = new Set<string>()
  for (const [k, v] of glossaryMap.entries()) {
    glossaryKeys.add(cleanKey(k))
    if (v) glossaryKeys.add(cleanKey(v))
  }

  const found = new Map<string, AdhocProductTerm>() // cleanKey(term) -> term
  texts.forEach((text, i) => {
    const parsed = parseProductName(text)
    if (!parsed || !parsed.valid) return

    // 品类指纹门：整条必须含规则文档严格界定的核心品类词（SSD/Card/Reader…）
    // 裸系列名（"Lexar THOR Ultra"）或无品类词文本不判定为产品名
    if (!detectCategory(text)) return

    // 候选术语 = 整条原文去®（与 CSV key 惯例对齐，吃 S1 短路 + 模糊匹配）
    const term = stripTrademark(text).replace(/\s+/g, ' ').trim()
    const ck = cleanKey(term)
    const seriesCk = cleanKey(parsed.series)

    // 新颖性门 1：整条已在术语库 → 跳过
    if (glossaryKeys.has(ck)) return
    // 新颖性门 2：【v11.2.1 语义修正】仅当整条 == 锚点+系列名（裸系列名，无规格/无品类）
    //   且系列名已知时才跳过。已知系列的【新子型号】（整条不在术语库）必须检出 —
    //   整条新颖性由门 1 判定，系列名已知不影响整条是否需要保护。
    //   例：'Lexar ARES PCIe Gen4x4 M.2 2280 NVMe SSD' 整条不在 CSV → 检出（ARES 已知≠整条已知）
    const isBareSeries = cleanKey(text).split(' ').length === cleanKey(parsed.anchor + ' ' + parsed.series).split(' ').length
    if (!parsed.modelLed && isBareSeries && seriesCk && KNOWN_SERIES.has(seriesCk)) return
    // 新颖性门 3：整条作为子串已出现在任何术语库 key/value 里 → 跳过
    let substringHit = false
    for (const gk of glossaryKeys) {
      if (gk.includes(ck)) { substringHit = true; break }
    }
    if (substringHit) return

    if (found.has(ck)) {
      found.get(ck)!.hitIndices.push(i)
    } else {
      found.set(ck, { term, series: parsed.series, hitIndices: [i] })
    }
  })

  return [...found.values()]
}

/** 扁平化接口（供 UI 提示 / 日志 / 测试断言） */
export function detectAdhocProductTermStrings(
  texts: string[],
  glossaryMap: Map<string, string>,
): string[] {
  return detectAdhocProductTerms(texts, glossaryMap).map(t => t.term)
}

// ═══════════════════════════════════════════════════════════════
// v11.3: LLM 兜底检测 — 代码判定失败但强锚点+品类词指纹成立的候选
// ═══════════════════════════════════════════════════════════════

/** LLM 兜底候选（代码 parseProductName 失败/valid:false，但可能仍是产品名） */
export interface FallbackCandidate {
  /** 整条原文（去®） */
  term: string
  /** 命中的文本索引 */
  hitIndices: number[]
}

/**
 * 检测需要 LLM 兜底解析的候选产品名。
 *
 * 触发条件（三重收窄，可靠性优先）：
 *   1. 强锚点：含 Lexar®（® 是"完整产品名"强信号，设计稿常态写法）
 *   2. 品类指纹：detectCategory ≠ null（规则文档严格界定的 11 个核心品类词）
 *   3. 代码判定失败：parseProductName 返回 null 或 valid:false
 *
 * 不触发（保持现状，不放宽）：
 *   - 无 Lexar® 锚点（纯系列名如 "MUSE Portable SSD"）→ 人工确认通道
 *   - 未知品类词（"Memory Stick" 不在 11 词表）→ 人工确认通道
 *   - parseProductName 成功（正常检出路径已覆盖）
 *
 * @param texts       批次全部源文
 * @param glossaryMap 术语库 full 视图（用于新颖性判断）
 */
export function detectFallbackCandidates(
  texts: string[],
  glossaryMap: Map<string, string>,
): FallbackCandidate[] {
  // 预建术语库 cleanKey 集合（keys + values），新颖性门用
  const glossaryKeys = new Set<string>()
  for (const [k, v] of glossaryMap.entries()) {
    glossaryKeys.add(cleanKey(k))
    if (v) glossaryKeys.add(cleanKey(v))
  }

  const found = new Map<string, FallbackCandidate>()
  texts.forEach((text, i) => {
    const trimmed = text.trim()
    if (!trimmed) return

    // 触发条件 1：强锚点 — 含 Lexar®（® 是强信号；不带®的 Lexar 不触发，保持保守）
    if (!/Lexar®/.test(trimmed)) return

    // 触发条件 2：品类指纹 — 必须含规则文档严格界定的核心品类词
    if (!detectCategory(trimmed)) return

    // 触发条件 3：代码判定失败 — parseProductName 返回 null 或 valid:false
    const parsed = parseProductName(trimmed)
    if (parsed && parsed.valid) return  // 代码已成功解析，不需要 LLM 兜底

    // 新颖性门：整条已在术语库 → 跳过（与 detectAdhocProductTerms 同逻辑）
    const term = stripTrademark(trimmed).replace(/\s+/g, ' ').trim()
    const ck = cleanKey(term)
    if (glossaryKeys.has(ck)) return
    let substringHit = false
    for (const gk of glossaryKeys) {
      if (gk.includes(ck)) { substringHit = true; break }
    }
    if (substringHit) return

    if (found.has(ck)) {
      found.get(ck)!.hitIndices.push(i)
    } else {
      found.set(ck, { term, hitIndices: [i] })
    }
  })

  return [...found.values()]
}
