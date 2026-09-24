/**
 * product-model-extract.ts — 产品名→型号提取归一（v12.30）
 *
 * 核心认知（用户）：「型号都藏在产品名里面」。文件名一般按提取出的型号命名。
 * 按品线分层从产品名提取型号（ERP/PIM 系统 Model 字段口径）。
 * 单一事实源：xlsx《系列名以及产品命名规则》140 行钦定 Model 列逐条校准。
 * 回归锁：tests/product-model-extract.ts vs tests/golden/product-model-extract.json（140/140）。
 *
 * 规则形态（140 行钦定数据逐条驱动，非抽象优雅规则）：
 *   card:      ①CFexpress[ 4.0] Type A/B [+等级]（等级可前置「GOLD CFexpress」
 *              或后置「Card GOLD Series」，输出归一为 CFexpress 在前、等级在后）
 *              ②速度代号[+PRO][+等级]（800x PRO BLUE / 1066x SILVER）
 *              ③ARMOR+等级（ARMOR GOLD / ARMOR SILVER PRO）
 *              ④纯等级（GOLD/SILVER [PLUS/PRO]/BLUE [PLUS]）
 *              ⑤PLAY [PRO]  ⑥NM Card  ⑦E-series [Plus]  ⑧High-Endurance/Performance
 *   memory:    无系列 → DDRx+形态（DDR4 SODIMM）
 *              ARES → ARES [RGB] DDRx [OC]（DDR 保留；有 2nd Gen 时丢 DDR）
 *              THOR → 有特性词(RGB/OC/Z)：THOR+特性（丢 DDR）；无特性词：THOR DDRx
 *              ※ ARES/THOR 对 DDR 的取舍不对称是 xlsx 钦定数据实际口径，按数据编码
 *   ssd/usb:   ①系列+PRO/X（ARES PRO/THOR PRO/PLAY X）
 *              ②系列+纯数字（ARMOR 700；22xx 形态数字例外→纯数字，PLAY 2230→2230）
 *              ③字母数字代号[+PRO]（NM790/EQ790/F35 PRO/NM610PRO）
 *              ④接口/形态跨度（USB 4 等，SSD Enclosure 类）
 *              ⑤系列即型号（Air/TouchLock/TwistTurn2；Professional Go 特例保留 Professional）
 *   peripheral:①字母数字代号优先（H31 优先于 7-in-1！E300/E6）
 *              ②接口/形态跨度（CFexpress Type A [/SD]、Dual-Slot USB-A/C、
 *                USB-C Dual-Slot、Multi-Card N-in-1、SD/Micro SD、microSDXC Express、2.5 Inch）
 *              ③系列即型号（nCARD NM）
 */

// ============================================================
// 提取规则（按 xlsx 140 行校准）
// ============================================================

// 品类词（品线判定用，最长优先）
const CATEGORY_RES: Array<{ re: RegExp; line: string; cat: string }> = [
  { re: /\bDesktop Memory\b/i, line: 'memory', cat: 'Desktop Memory' },
  { re: /\bLaptop Memory\b/i, line: 'memory', cat: 'Laptop Memory' },
  { re: /\bSolid State Dual Drive\b/i, line: 'usb', cat: 'Solid State Dual Drive' },
  { re: /\bDual Drive\b/i, line: 'usb', cat: 'Dual Drive' },
  { re: /\bFlash Drive\b/i, line: 'usb', cat: 'Flash Drive' },
  // 结构性外设品类词优先于介质词（SSD）——「M.2 SSD Enclosure」的品类是 Enclosure 不是 SSD
  { re: /\bCard Reader\b/i, line: 'peripheral', cat: 'Reader' },
  { re: /\bReader\b/i, line: 'peripheral', cat: 'Reader' },
  { re: /\bEnclosure\b/i, line: 'peripheral', cat: 'Enclosure' },
  { re: /\bHub\b/i, line: 'peripheral', cat: 'Hub' },
  { re: /\bPortable SSD\b/i, line: 'ssd', cat: 'Portable SSD' },
  { re: /\bSSD\b/i, line: 'ssd', cat: 'SSD' },
  { re: /\bCard\b/i, line: 'card', cat: 'Card' },
]

// CFexpress 跨度（TypeB 粘连/Cfexpress 小写均被 canonicalize）
const CF_SPAN_RE = /\bCFexpress(?:\s+4\.0)?\s*Type\s*[AB](?:\s*\/\s*SD)?/i

// 等级词（卡类 GOLD/SILVER/BLUE/DIAMOND/PLATINUM [+PLUS/PRO]）
const GRADE_RE = /\b(GOLD|SILVER|BLUE|DIAMOND|PLATINUM)(?:\s+(?:PLUS|PRO))?\b/i

// 字母数字代号（NM790/NM610PRO/EQ790/SL500/ES3/D70E/F35/H31/E300/E6/V40…）+ 可选独立 PRO 后缀
const ALNUM_RE = /\b([A-Z]{1,2}\d{1,4}[A-Za-z]{0,3})(\s+PRO)?\b/

// 系列+PRO/X（ssd：ARES PRO / THOR PRO / PLAY X）
const SERIES_PROX_RE = /\b(ARES|THOR|PLAY|ARMOR|BLAZE)\s+(PRO|X)\b/i

// 系列+纯数字（ssd：ARMOR 700；22xx 形态数字例外→纯数字型号，PLAY 2230→2230）
const SERIES_NUM_RE = /\b(ARES|THOR|PLAY|ARMOR|BLAZE)\s+(\d{3,4})\b/i

// 接口/形态跨度（外设与 SSD Enclosure 类；不含 CFexpress——单独 canonicalize）
const SPAN_RES: RegExp[] = [
  /\bDual-Slot\s+USB-A\/C\b/i,
  /\bDual-Slot\s+USB-A\b/i,
  /\bUSB-C\s+Dual-Slot\b/i,
  /\bDual-Slot\s+SD\b/i,
  /\bMulti-Card\s+\d+-in-1\b/i,
  /\bSD\s*\/\s*Micro\s*SD\b/i,
  /\bmicroSD\s*\/\s*SD\b/i,
  /\bmicroSDXC\s+Express\b/i,
  /\bUSB\s+4\b/i,
  /\b\d+(?:\.\d+)?\s*Inch\b/i,
]

// 系列即型号的终止词（命中即系列串结束；小写比较）
const SERIES_STOP_TOKENS = new Set([
  'portable', 'ssd', 'card', 'reader', 'hub', 'enclosure', 'flash', 'drive',
  'dual', 'solid', 'state', 'desktop', 'laptop', 'memory', 'hard', 'inch',
  'usb', 'usb-c', 'usb-a', 'type-c', 'pcie', 'nvme', 'm.2', 'sata', 'iii',
  'uhs-i', 'uhs-ii', 'sdhc', 'sdxc', 'microsd', 'microsdhc', 'microsdxc',
  'cfexpress', 'gen', '1st', '2nd', '3rd', 'with', 'magnetic', 'gaming',
  'fingerprint', 'elite', 'legends', 'series', 'heatsink', 'set',
  'ultra-slim', 'slim',
])

export interface ExtractedModel {
  /** 品线（card/ssd/memory/usb/peripheral/subbrand/unknown） */
  line: string
  /** 品类词（CATEGORY_WORDS key 或 null） */
  category: string | null
  /** 提取的型号（藏在产品名里的核心标识，= 文件名用的型号） */
  model: string
  /** 系列词（若有） */
  series: string
}

/** CFexpress 跨度归一（Cfexpress TypeB → CFexpress Type B；含 4.0 与 /SD 尾巴） */
function canonCF(raw: string): string {
  const has4 = /4\.0/.test(raw)
  const letter = (raw.match(/Type\s*([AB])/i) || [])[1]?.toUpperCase() || ''
  let out = 'CFexpress' + (has4 ? ' 4.0' : '') + (letter ? ' Type ' + letter : '')
  if (/\/\s*SD\b/i.test(raw)) out += ' / SD'
  return out
}

/** 系列+PRO/X（ssd：ARES PRO / THOR PRO / PLAY X） */
function matchSeriesProX(text: string): string {
  const m = text.match(SERIES_PROX_RE)
  return m ? `${m[1]} ${m[2]}` : ''
}

/** 字母数字代号（+可选独立 PRO 后缀） */
function matchAlnum(text: string): string {
  const m = text.match(ALNUM_RE)
  return m ? m[1] + (m[2] || '') : ''
}

/** 接口/形态跨度（CFexpress 先 canonicalize，其余按钦定序逐条尝试） */
function matchSpan(text: string): string {
  const cf = text.match(CF_SPAN_RE)
  if (cf) return canonCF(cf[0])
  for (const re of SPAN_RES) {
    const m = text.match(re)
    if (m) return m[0]
  }
  return ''
}

/** 系列即型号：Lexar 之后、终止词之前的连续 token 串；剥 JumpDrive/Professional 前缀 */
function seriesAsModel(text: string): string {
  const tokens = text.split(/\s+/)
  const out: string[] = []
  for (let i = 1; i < tokens.length; i++) {
    const raw = tokens[i].replace(/[®™©]/g, '')
    const low = raw.toLowerCase()
    if (SERIES_STOP_TOKENS.has(low)) break
    if (/^\d/.test(raw)) break            // 数字开头规格（2230/2280 已由系列+数字规则处理）
    if (raw.startsWith('(')) break        // (EOL)/(6Gb/s)
    if (/\//.test(raw)) break             // SDHC/SDXC
    if (/^\d{1,5}(GB|TB|MB)$/i.test(raw)) break  // 容量
    if (/^[A-Z]{1,2}\d{1,4}[A-Za-z]{0,3}$/.test(raw) && out.length > 0) break  // 型号代码前终止
    out.push(raw)
  }
  // JumpDrive 是伞系列：后面还有子系列时剥掉（JumpDrive TwistTurn2 → TwistTurn2）
  if (out[0]?.toLowerCase() === 'jumpdrive' && out.length > 1) out.shift()
  // Professional 剥掉；但 Professional Go 整体是型号（Go 单独过泛）保留
  if (out[0]?.toLowerCase() === 'professional' && out.length > 1 && out[1]?.toLowerCase() !== 'go') out.shift()
  return out.join(' ')
}

/** 卡类型号（等级可前置或后置，输出归一） */
function extractCardModel(text: string): string {
  const gradeM = text.match(GRADE_RE)
  const grade = gradeM ? gradeM[0].replace(/\s+/g, ' ') : ''
  // ① CFexpress [+等级]
  const cf = text.match(CF_SPAN_RE)
  if (cf) return canonCF(cf[0]) + (grade ? ' ' + grade : '')
  // ② 速度代号 [+PRO] [+等级]
  const speed = text.match(/\b(\d{3,4}x)(\s+PRO)?\b/i)
  if (speed) return speed[1] + (speed[2] || '') + (grade ? ' ' + grade : '')
  // ③ ARMOR + 等级
  if (/\bARMOR\b/i.test(text) && grade) return 'ARMOR ' + grade
  // ④ 纯等级
  if (grade) return grade
  // ⑤ PLAY [PRO]
  const play = text.match(/\bPLAY(\s+PRO)?\b/i)
  if (play) return play[0].replace(/\s+/g, ' ')
  // ⑥ NM Card
  if (/\bNM\s+Card\b/i.test(text)) return 'NM Card'
  // ⑦ E-series [Plus]
  const es = text.match(/\bE-?series(?:\s+Plus)?\b/i)
  if (es) return es[0].replace(/\s+/g, ' ')
  // ⑧ High-Endurance / High-Performance
  const hp = text.match(/\bHigh-(?:Endurance|Performance)\b/i)
  if (hp) return hp[0]
  return seriesAsModel(text)
}

/** 内存型号（ARES/THOR 对 DDR 取舍不对称——按 xlsx 钦定数据口径编码） */
function extractMemoryModel(text: string): string {
  const ddr = text.match(/\b(DDR[45])\b/i)
  const form = text.match(/\b(SODIMM|UDIMM)\b/i)
  const seriesM = text.match(/\b(ARES|THOR)\b/i)
  const has2nd = /\b2nd\s+Gen\b/i.test(text)
  if (!seriesM) {
    // 无系列：DDR + 形态（DDR4 SODIMM）
    return [ddr?.[1], form?.[1]].filter(Boolean).join(' ')
  }
  const series = seriesM[1]
  // 特性词（保留源文顺序：THOR Z RGB → Z RGB）
  const feats: string[] = []
  const featRe = /\b(RGB|OC|Z|PRO|Ultra)\b/gi
  let fm: RegExpExecArray | null
  while ((fm = featRe.exec(text))) feats.push(fm[1])
  // 有 2nd Gen：丢 DDR（THOR / ARES RGB）
  if (has2nd) return [series, ...feats].join(' ')
  if (/^ARES$/i.test(series)) {
    // ARES：系列 [RGB] DDRx [OC]（DDR 保留；OC 在 DDR 后）
    const rgb = feats.find(f => /^RGB$/i.test(f))
    const oc = feats.find(f => /^OC$/i.test(f))
    return [series, rgb, ddr?.[1], oc].filter(Boolean).join(' ')
  }
  // THOR：有特性词 → 系列+特性（丢 DDR）；无特性词 → 系列+DDR（丢 UDIMM/SODIMM）
  if (feats.length) return [series, ...feats].join(' ')
  return [series, ddr?.[1]].filter(Boolean).join(' ')
}

/**
 * 从产品名提取型号（按品线分层，xlsx 钦定规则）。
 * @param productName 完整产品名（Lexar ...）
 * @returns 提取结果；非产品名返回 null
 */
export function extractProductModel(productName: string): ExtractedModel | null {
  const text = (productName || '').replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim()
  if (!/^Lexar\b/i.test(text)) return null

  // 子品牌特例：Lexar Professional Workflow[ Go]（无品类词）
  if (/^Lexar\s+Professional\s+Workflow(\s+Go)?$/i.test(text)) {
    return { line: 'subbrand', category: null, model: text.replace(/^Lexar\s+Professional\s+/i, ''), series: 'Workflow' }
  }

  // 品线判定（品类词）
  let line = 'unknown'
  let category: string | null = null
  for (const { re, line: l, cat } of CATEGORY_RES) {
    if (re.test(text)) { line = l; category = cat; break }
  }
  if (line === 'unknown') return null

  const series = seriesAsModel(text)
  let model = ''

  if (line === 'card') {
    model = extractCardModel(text)
  } else if (line === 'memory') {
    model = extractMemoryModel(text)
  } else if (line === 'peripheral') {
    // 外设：代号优先（H31 > 7-in-1）→ 接口/形态跨度 → 系列即型号
    model = matchAlnum(text) || matchSpan(text) || series
  } else {
    // ssd / usb：系列+PRO/X → 系列+数字 → 代号 → 接口/形态跨度 → 系列即型号
    model = matchSeriesProX(text)
      || (() => { const m = text.match(SERIES_NUM_RE); return m ? (/^22\d{2}$/.test(m[2]) ? m[2] : `${m[1]} ${m[2]}`) : '' })()
      || matchAlnum(text)
      || matchSpan(text)
      || series
  }

  // 通用兜底
  if (!model) model = series || matchAlnum(text)

  return { line, category, model: model.trim(), series }
}

// ============================================================
// v12.30: 型号 → 产品线推导（产品名/文件名 → 品线闭环）
// ============================================================
// 闭环逻辑（用户拍板）：品线原从文件名（型号）判，但型号本身不等于品线；
//   产品名判定（品线分层）能直接从内容拿到品类词+型号——指向同一产品，推出同一品线。
//   品类词定「大类」，系列/型号词定「细分品线」，文件名型号做兜底印证。
// 提取出的型号/系列词 → 8 条产品线（与 PRODUCT_LINE_TONE_GUIDES key 严格对齐）。
// ============================================================

/** 游戏系列词（ARES/THOR/PLAY/ARMOR/BLAZE） */
const GAMING_SERIES_RE = /\b(ARES|THOR|PLAY|ARMOR|BLAZE)\b/i
/** 专业影像信号（等级词/CFexpress/高速代号） */
const PRO_IMAGING_RE = /\b(GOLD|DIAMOND|SILVER|CFexpress|1667x|1800x|2000x)\b/i
/** PC 生产力代号前缀（NM/NQ/NS/EQ + 数字；NM Card 除外由卡类线接管）。
 *  精确匹配 NM/NQ/NS/EQ（不用 [NMNQ]|NS|EQ 字符组——[NMNQ] 会误配 M300/Q700 等） */
const PC_PRODUCTIVITY_RE = /\b(?:NM|NQ|NS|EQ)\d+/i

/**
 * 从提取出的型号 + 品线 + 品类词推导产品线（闭环核心）。
 * @param ext      extractProductModel 结果（line/category/model/series）
 * @param fullText 完整产品名（辅助上下文，系列词判定用）
 * @returns 产品线 id（8 条之一），无法判定返回 null
 */
export function deriveProductLineFromModel(
  ext: Pick<ExtractedModel, 'line' | 'category' | 'model' | 'series'>,
  fullText?: string,
): string | null {
  const ctx = `${ext.model} ${ext.series} ${fullText || ''}`

  switch (ext.line) {
    case 'memory':
      // 内存：游戏系列（ARES/THOR）→ gaming_dimm；无系列裸 DDRx → pc_productivity
      return GAMING_SERIES_RE.test(ctx) ? 'gaming_dimm' : 'pc_productivity'

    case 'card': {
      // 卡：游戏系列 → gaming_card；专业影像信号 → professional_imaging；
      //     消费信号 → consumer_cards；其余 → consumer_cards（卡默认消费级）
      if (GAMING_SERIES_RE.test(ctx)) return 'gaming_card'
      if (PRO_IMAGING_RE.test(ctx)) return 'professional_imaging'
      return 'consumer_cards'
    }

    case 'ssd': {
      // SSD：游戏系列 → gaming_ssd；PC 代号 → pc_productivity；
      //      Portable SSD 品类（移动）→ portable_storage；内置 → pc_productivity
      if (GAMING_SERIES_RE.test(ctx)) return 'gaming_ssd'
      if (PC_PRODUCTIVITY_RE.test(ext.model)) return 'pc_productivity'
      if (ext.category === 'Portable SSD') return 'portable_storage'
      return 'pc_productivity'
    }

    case 'usb':
      // U盘（Flash/Dual/SSDD Drive）：统一 portable_storage
      return 'portable_storage'

    case 'peripheral': {
      // 外设：读卡器按卡等级分流（专业 CFexpress 读卡器 → professional_imaging），
      //      Enclosure/Hub/普通 Reader → portable_storage
      if (/Reader/i.test(ext.category || '') && PRO_IMAGING_RE.test(ctx)) return 'professional_imaging'
      return 'portable_storage'
    }

    case 'subbrand':
      // Workflow 子品牌 → portable_storage（移动工作流存储）
      return 'portable_storage'

    default:
      return null
  }
}
