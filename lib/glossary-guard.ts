/**
 * glossary-guard.ts — 自动入库守卫 + 句形短路纵深防御（v11.14）
 *
 * 背景（2026-08-17 实机事故，根因链已闭环）：
 *   CORRECTION_THRESHOLD = 1 意味着【校对每修一条、用户每改一条】，
 *   整句原文 + 修正译文立刻无条件变成一条锁死的专属术语库条目（零校验）。
 *   事故运行中，™ 乱码译文被校对"修好"时，乱码句与整句营销文案就这样进了库：
 *     Bug A：整句条目命中 S1 短路（cleanKey 形态无关匹配）→ 译文原样返回，
 *             被标记漏翻/翻译失败，重翻走同一条短路 → 确定性失败、重试无效。
 *     Bug B：带 ™ 乱码（p™l™a™y™）的条目值经 ①S1短路 ②enforceGlossaryTerms
 *             子串替换 ③缓存放大，撒回多个句子。
 *   用户刷新术语库后不再复现，与"脏条目是源头"完全吻合。
 *
 * 本模块是单一事实源，两道防线共用：
 *   防线 1（入库闸）  validateAutoGlossarySource / sanitizeAutoGlossaryValue /
 *                     isIdentityAutoAddAllowed —— 只拦【自动入库】（Path C 修正建议、
 *                     Path B 歧义词收割）。用户手动上传 CSV / 手动编辑术语库不受限
 *                     （用户意图至高无上，入错由 G4 兜底不失控）。
 *   防线 2（执行闸）  isSentenceLikeGlossaryKey —— 句形术语 key 一律不走整条短路/
 *                     遮蔽/锁定，只走正常 LLM 翻译。防历史脏条目 + 手动入错的整句。
 *                     保守多信号设计：短文本永远豁免（PLAY/THOR/NM790/Blue 绝不被误伤），
 *                     单信号不够必须≥2 独立信号（protect your game library 不会被误杀）。
 *
 * 紧网原则（与 new-product-detect 同源）：错杀一条术语 = 该句退化为正常 LLM 翻译
 * （无害）；放过一条句形条目 = 整句被锁死（有害）。但短术语是术语库的正当主体，
 * 必须零误伤。
 */

import { FUNCTION_WORDS_RE, VERB_RE, PRODUCT_NAME_SHAPE_PASS_RE, stripTrademark } from '@lib/new-product-detect'

/**
 * 非 ASCII 字符存在性（v11.14 最终口径）：CJK / 西欧变音符 / 西里尔 / 阿拉伯 等
 * 一切非 ASCII 文本。句形判定的信号词表（功能词/动词）是【英文】指纹——对任何
 * 非英文文本零区分度（法语 pour、德语 für、中文"是"都不是英文句子信号）。
 * 含非 ASCII 字符的 key 一律不算句形：
 *   - 术语库的正当多语言注册值（v9.9）零误伤；
 *   - 中文混排产品名/短语（"CFexpress Type B GOLD 系列 512GB"、"…是游戏好搭档"）零误伤；
 *   - Bug A/B 的事故弹药是纯英文营销句/乱码，不在豁免范围内（不被放行）。
 */
const HAS_NON_ASCII_RE = /[^\x00-\x7F]/

/** 入库闸 R3 专用动词表：剔 'experience'（名词用法是正当术语，见 R3 注释） */
const VERB_NO_EXPERIENCE_RE = /\b(is|are|delivers?|offers?|provides?|features?|supports?|enables?|designed|engineered|built|makes?|gives?|gets?|boosts?|enjoy|upgrade|meet|meets)\b/i

// ═══════════════════════════════════════════════════════════════
// 句形判定（防线 2，保守多信号）
// ═══════════════════════════════════════════════════════════════

/** 句末/句读标点（产品名形态门 NAME_SHAPE_RE 不允许这些字符出现） */
const SENTENCE_PUNCT_RE = /[.!?;:,，。！？；：]/

/**
 * 入库闸 R2 专用标点表：剔 '.' 与 ',' —— 版本号/规格写法（PCIe 4.0、M.2、2.5、
 * 德语小数逗号 2,5、千位分隔 7,400）是产品名与多语言术语值的正当字符。
 * 顿号、冒号、叹问号等句读标点不含歧义，仍是强句子指纹。
 */
const AUTO_ADD_PUNCT_RE = /[!?;:：，。！？；、]/

/**
 * 入库闸句读判定（规格写法豁免）：
 *   - 逗号仅允许夹在数字间（2,5 / 7,400）；其他逗号 = 句子
 *   - 句号仅允许 字母|数字.数字 规格形态（4.0 / M.2 / 2.5）；句尾/词后句号 = 句子
 */
function hasAutoAddSentencePunct(t: string): boolean {
  if (AUTO_ADD_PUNCT_RE.test(t)) return true
  if (t.replace(/\d,\d/g, '').includes(',')) return true
  if (t.replace(/[A-Za-z0-9]\.\d/g, '').includes('.')) return true
  return false
}

/**
 * 判定术语库 key 是否为"句子形态"（不应参与整条短路/遮蔽/锁定）。
 *
 * 门 0（短文本豁免）：< 30 字符 → false。整条短路对短文本是正当核心场景
 *   （PLAY=30 字符以下的所有产品名/系列名/品牌词全部直通）。
 *
 * ≥ 30 字符时按信号计分，≥ 2 个独立信号才判句形：
 *   S1 命中功能词（the/a/for/your/and/that...）
 *   S2 命中动词（is/are/delivers/designed/experience...）
 *   S3 含句读标点（. ! ? ; : , 及中文句读）
 *   S4 形态违反产品名命名规则（PRODUCT_NAME_SHAPE_PASS_RE 不通过——与
 *       parseProductName 同一口径：字符集门 + 收窄功能词/动词；产品名带
 *       "with Heatsink"、"Type A"、"and"/"for" 字样不影响豁免）
 *   S5 词数 ≥ 6
 *
 * 典型判定：
 *   "Designed to coordinate with your PS5*, ..."        → S1+S2+S3+S4+S5 句形 ✓
 *   "Lexar PLAY 2280 PCIe 4.0 SSD 是游戏好搭档，值得买"   → S3 唯一信号 → 放行（术语优先）
 *   "Lexar Professional SILVER PLUS SDXC UHS-I Card"    → 零信号 → 放行 ✓
 *   "Lexar EQ790 with Heatsink M.2 2280 PCIe Gen4x4 NVMe SSD" → S4 豁免（产品名直通）✓
 *   "CFexpress Type B GOLD 系列 512GB"                   → 短 → 放行 ✓
 */
export function isSentenceLikeGlossaryKey(key: string): boolean {
  const t = key.trim()
  if (t.length < 30) return false
  // 非 ASCII 直通：句形信号词表是英文指纹，对任何非英文文本零区分度
  // （术语库 v9.9 全语言注册值/中文混排形态必须零误伤；事故弹药是纯英文句不受影响）
  if (HAS_NON_ASCII_RE.test(t)) return false
  // 产品名直通：命名规则认的产品名永远不是句形（现网产品名库全部走此通道）
  if (PRODUCT_NAME_SHAPE_PASS_RE.test(t)) return false
  let signals = 0
  if (FUNCTION_WORDS_RE.test(t)) signals++
  if (VERB_RE.test(t)) signals++
  if (SENTENCE_PUNCT_RE.test(t)) signals++
  signals++  // 已过两道直通说明非产品名形态 → 记一个基础信号
  const wordCount = t.split(/\s+/).filter(Boolean).length
  if (wordCount >= 6) signals++
  return signals >= 2
}

// ═══════════════════════════════════════════════════════════════
// 自动入库源文校验（防线 1，较防线 2 更严——入口多拦无害）
// ═══════════════════════════════════════════════════════════════

export interface AutoGlossaryCheck {
  ok: boolean
  reason?: string
}

/**
 * 校验自动入库的源文（Path C 修正建议 / Path B 歧义词）。
 * 拒绝条件（命中任一即拒）：
 *   R1 长度 > 60 字符或词数 > 6 —— 术语不该是整句
 *   R2 含句读标点 —— 句子指纹（allowPunctuation 豁免术语形态逗号场景，预留）
 *   R3 命中功能词/动词 —— 营销文案指纹（与产品名检测同一套词表，防漂移）
 *   R4 含管道占位符 __XXX_N__ —— 遮蔽残留绝不入库
 *   R5 含畸形商标符号 —— 乱码形态绝不作 key
 */
export function validateAutoGlossarySource(
  source: string,
  opts?: { allowPunctuation?: boolean },
): AutoGlossaryCheck {
  const t = source.trim()
  const wordCount = t.split(/\s+/).filter(Boolean).length
  if (t.length > 60 || wordCount > 6) {
    return { ok: false, reason: `长度过长（${t.length}字符/${wordCount}词），疑似整句而非术语` }
  }
  if (!opts?.allowPunctuation && hasAutoAddSentencePunct(t)) {
    return { ok: false, reason: '含句读标点，疑似句子' }
  }
  // R3 功能词/动词：产品名形态直通（命名规则认的产品名含 "with"/"a" 是正当，
  // 如 "EQ790 with Heatsink"、"Type A"）；非英文文本跳过英文词表（零区分度）。
  // 例外：'experience' 是常用英文营销词且是专属库在库术语名——名词用法直通
  // （'gaming experience' 是正当修正建议；整句营销文案由 R1/R2 长度/标点拦截）。
  if (!HAS_NON_ASCII_RE.test(t) && !PRODUCT_NAME_SHAPE_PASS_RE.test(t)
      && (FUNCTION_WORDS_RE.test(t) || VERB_NO_EXPERIENCE_RE.test(t))) {
    return { ok: false, reason: '含功能词/动词，疑似营销文案' }
  }
  if (/__[A-Z]+_\d+__/.test(t)) {
    return { ok: false, reason: '含管道占位符残留' }
  }
  if (hasMalformedTrademark(t)) {
    return { ok: false, reason: '商标符号形态异常' }
  }
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════
// 自动入库译文净化（防线 1 的值侧）
// ═══════════════════════════════════════════════════════════════

export interface AutoGlossaryValueResult {
  ok: boolean
  value?: string
  reason?: string
}

/**
 * 净化/校验自动入库的译文值：
 *   V1 占位符残留 → 拒绝（管道半成品绝不入库）
 *   V2 商标符号一律剥除 —— 术语库惯例是 key/value 均不带 ®™©（cleanKey 匹配本就
 *      无视商标符号；™ 由 restoreTrademarkSymbols 在译后按源文恢复）。剥除可根治
 *      "™ 乱码值进库"（Bug B 的弹药）且对合法 ™ 零损失。
 *   V3 畸形商标形态 → 拒绝（理论被 V2 覆盖，双保险）
 */
export function sanitizeAutoGlossaryValue(value: string): AutoGlossaryValueResult {
  if (/__[A-Z]+_\d+__/.test(value)) {
    return { ok: false, reason: '译文含管道占位符残留' }
  }
  const stripped = stripTrademark(value)
  if (hasMalformedTrademark(value)) {
    return { ok: false, reason: '译文商标符号形态异常' }
  }
  return { ok: true, value: stripped }
}

/**
 * G3：identity 自动入库（译文===源文）是否允许。
 * 术语形态（短、少词）允许 —— PLAY/THOR 这类全语种保留词是正当条目；
 * 长文 identity 拒绝 —— 整句 identity 条目 = 该句永不再翻译（Bug A 的弹药）。
 */
export function isIdentityAutoAddAllowed(source: string, value: string): boolean {
  if (source.trim() !== value.trim()) return true
  const t = source.trim()
  const wordCount = t.split(/\s+/).filter(Boolean).length
  return t.length <= 20 && wordCount <= 3
}

// ═══════════════════════════════════════════════════════════════
// 商标符号畸形检测（缓存脏数据规则共用）
// ═══════════════════════════════════════════════════════════════

/**
 * 检测乱码形态的 ®™©：
 *   M1 散弹模式 (\w[™®©]){2,} —— p™l™a™y™ 逐字母注入的指纹
 *   M2 商标符号出现在行首/空格后（™ 必须跟在词字符后才是合法用法）
 *   M3 同一符号出现 3 次及以上（合法用法至多 2 次：Lexar® ... microSDXC™）
 */
export function hasMalformedTrademark(s: string): boolean {
  if (/(\w[™®©]){2,}/.test(s)) return true
  if (/(^|\s)[™®©]/.test(s)) return true
  for (const sym of ['™', '®', '©']) {
    const count = s.split(sym).length - 1
    if (count >= 3) return true
  }
  return false
}

// ═══════════════════════════════════════════════════════════════
// 执行闸决策（防线 2 的完整语义：句形 key 的 value 侧）
// ═══════════════════════════════════════════════════════════════

/**
 * 术语库条目是否应跳过执行路径（整条短路/遮蔽/术语锁定/合规锁定/校对锁定）。
 *
 * 精化门（v11.14 最终口径）：仅句形 key 不够 —— 专属库存在【正当整句策展条目】
 * （用户手动上传的免责声明/兼容性文案，如 'Product images are for reference only'
 * → 20 语种官方译文，锁定是用户意图，v11.12+ 术语库最高优先级不可违）；
 * v9.9 全语言值注册也是【key=自然语言译文、value=目标译文】的正当翻译条目。
 * 真正的事故弹药只有两类：
 *   ① identity 值（value===key）：整句自映射 —— 命中短路/锁定时译文被原样锁回英文
 *      源文 = Bug A 的确定性漏翻机制。
 *   ② 畸形 ™ 值：乱码译文值经锁定/子串替换/遮蔽回灌 = Bug B 的扩散弹药。
 * 正当条目（句形 key + 正经译文 value）继续锁定，术语库优先级不打折。
 *
 * 紧网原则不变：错杀 = 该句退化为正常 LLM 翻译（无害）；放过脏条目 = 整句锁死（有害）。
 */
/**
 * cleanKey 同口径归一化（避免 lib 循环依赖，本地实现，必须与
 * entity-masker/post-process/new-product-detect 的 cleanKey 保持完全一致：
 * 小写 + 剥 ®™© + [-_]→空格 + 空白折叠 + trim）。
 *
 * identity 判定必须走归一化比较，不能 === 原文比较：术语库的注册/匹配
 * 全程用 cleanKey（v9.2/v9.9 既有语义），同一条目的"自映射"关系
 * 在归一化后依然成立；原文比较会被大小写差异/商标符号击穿
 * （e.g. cleanKey 注册的 key 是 lowercase，而库里存的 value 保留原大小写）。
 */
function normalizeIdentity(s: string): string {
  return s.toLowerCase().replace(/[®™©]/g, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function shouldSkipGlossaryEntry(key: string, value: string): boolean {
  const k = key.trim()
  const v = (value || '').trim()
  // ② 乱码 ™ 值：任何形态条目的乱码译文都是扩散弹药（经锁定/子串/遮蔽回灌）
  if (hasMalformedTrademark(v)) return true
  // ① 整句 identity 自映射（cleanKey 归一化后 key===value）：命中短路/锁定时
  // 译文被原样锁回源文 = 确定性漏翻（Bug A 机制）。句形判定仅作用于
  // ≥30 字符的非 CJK 非产品名文本，短术语不受影响。
  if (v && normalizeIdentity(k) === normalizeIdentity(v) && isSentenceLikeGlossaryKey(key)) return true
  return false
}
