// ═══════════════════════════════════════════════════════════════
// 文件: post-process.ts — 翻译后处理（代码层兜底、不依赖 LLM）
// ═══════════════════════════════════════════════════════════════
//
// 职责: 翻译完成后对 LLM 输出做确定性修正。全部由代码执行，零出错。
//
// 分为三类:
//
// [修正类] — 修复 LLM 常见错误（确定性规则，不会改错）
//   postProcessTranslation      — 入口，按语种分发
//     postProcessFrench         — 标点空格/千位分隔/Mo替代MB/引号规范
//     postProcessGerman         — ß规范/Sie大写/千位分隔
//     postProcessJapanese       — 片假名长音/外来语规范/全角标点
//     postProcessKorean         — 助词拼写
//     postProcessArabic         — 单位翻译/Hamza规范
//     postProcessThai           — 字符间多余空格移除
//     postProcessRussian        — 引号/容量单位本地化
//     postProcessZhTw           — 全角标点
//     postProcessZhCn           — 全角标点
//     capitalizeFirstLetter     — 拉丁/西里尔首字母大写（排除iPhone等专有名词）
//     restoreStorageUnitFormatting — 数字单位连写修复（900 MB/s → 900MB/s）
//     restoreTrademarkSymbols   — ®™© 还原到译文中
//
// [校准类] — 术语/格式强制对齐（安全网，即使 LLM 做对了也要确认）
//   enforceGlossaryTerms        — 术语库强制替换（精确匹配 + 子串匹配 + 短标签硬守卫）
//
// [检测类] — 异常输出标记（只检测不修复，返回异常索引供上层决策）
//   detectBrandInjection        — 品牌/规格注入检测（命中回退源文）
//   detectTranslationExpansion  — 译文异常扩展检测（命中截断）
//   sanitizeLineBreaks          — 换行保护
//
// 边界:
//   ⛔ 不依赖 LLM — 全部是代码逻辑，确定性执行
//   ⛔ 不处理"不确定"的修正 — 不确定的交给 AI 校对
//   ⛔ 不在翻译中间调用 — 翻译管道中作为末尾步骤执行
// ═══════════════════════════════════════════════════════════════

import { DEBUG_MODE } from '@lib/constants'
import { shouldSkipGlossaryEntry } from '@lib/glossary-guard'

// DEBUG 日志辅助函数
const debugLog = (...args: unknown[]) => DEBUG_MODE && console.log(...args)
const debugWarn = (...args: unknown[]) => DEBUG_MODE && console.warn(...args)

// ============================================================
// v12.4: ™ 散弹检测（形式信号，代码管形式）
// 判据 1（逐字母模式）：™/®/© 出现在字母后且后面紧跟更多字母（逐字母模式中间位），累计 ≥2 次。
//   如 S™I™L™V™E™R™（大写逐字母）/ S™o™n™y™（大小写混合逐字母）/ p™l™a™y™s（小写逐字母）。
//   合法™只跟在完整品牌词尾（Lexar®/CFexpress™/Sony™），™后是空格/标点/数字边界——不命中。
// 判据 2（同符号紧邻重复，v12.6）：™™/®®/©©——任何场景下同一符号紧邻出现都是异常。
//   来源：2026-08-27 ja 实机 CFexpress™™ 事故（restore 同词双™恒锚第一个实例的既有 bug，
//   已修；本判据作为兜底——万一未来 restore 逻辑再出问题，散弹剥离层能兜住）。
// ============================================================
const TM_SPAM_RE = /[A-Za-z][®™©](?=[A-Za-z])/g
const TM_SPAM_DUP_RE = /([®™©])\1/

/** 检测译文是否含 ™ 散弹（逐字母™模式 或 同符号紧邻重复）。20 语言通吃（纯字符形式信号）。 */
export function hasTrademarkSpam(text: string): boolean {
  if (TM_SPAM_DUP_RE.test(text)) return true  // v12.6: ™™/®®/©© 紧邻重复
  const re = new RegExp(TM_SPAM_RE.source, 'g')
  const m1 = re.exec(text)
  if (!m1) return false
  return re.exec(text) !== null  // 第二个命中即确认
}

// ============================================================
// 商标符号还原
// 将原文中的 ® ™ © 符号还原到译文中
// 策略：找到符号前紧邻的单词，在译文中定位该单词并补回符号
// ============================================================
export function restoreTrademarkSymbols(sourceTexts: string[], translatedTexts: string[]): string[] {
  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source) return translated

    // v12.4: 译文已含 ™ 散弹 → 先剥离所有 ™®© 及其后紧跟的空格，再走正常定位插入流程。
    // 散弹是 LLM 输出的垃圾模式（如 "S™ I™ L™..." 或 "S™I™L™..."），保留=把错误锚定进最终译文。
    // 剥离后 restore 按源文重新定位正确位置（源文有几个™译文就恢复几个）。
    if (hasTrademarkSpam(translated)) {
      translated = translated.replace(/[®™©]\s*/g, '')
    }

    // 提取原文中所有商标符号及其前导词
    // 使用 [^\s®™©]+ 排除符号字符，避免贪婪匹配吞噬相邻符号（如 "Lexar®™" 中 ® 被 \S+ 吃掉）
    const symbolPattern = /([^\s®™©]+)\s*([®™©]+)/g
    const symbols: Array<{ word: string; symbol: string }> = []
    let match: RegExpExecArray | null
    while ((match = symbolPattern.exec(source)) !== null) {
      // 去掉该词上已有的商标符号（避免重复匹配）
      const cleanWord = match[1].replace(/[®™©]/g, '')
      if (cleanWord) {
        // 支持连续多个符号（如 Lexar®™），逐个记录
        for (const symbolChar of match[2]) {
          symbols.push({ word: cleanWord, symbol: symbolChar })
        }
      }
    }

    if (symbols.length === 0) return translated

    let result = translated

    // v12.14: 同词同符号逐实例消费（游标锚定，替代 v12.6「锚第一个实例」去重）。
    // v12.6 旧行为（2026-08-27 ja 事故修复）：同词多™（CFexpress™ 4.0 / CFexpress™ 2.0）去重后
    //   只插第一个实例——治了 CFexpress™™ 散弹，但埋下反向缺陷：第二个实例的™丢失
    //   （2026-09-03 zh-TW 实机实锤：上一代 CFexpress™ 2.0 → CFexpress 2.0 丢™）。
    // v12.14 修复：同词同符号不再去重，每次循环用游标消费译文的下一个匹配实例，
    //   源文同词出现几次™就恢复几次（有界=源文实例数，™™ 散弹无产生空间）。
    // ™™ 防线移交（双保险，本函数内不再去重）：
    //   ① hasTrademarkSpam 同符号紧邻重复判据（v12.6 扩充，™™/®®/©©）——
    //      LLM 直出散弹/双重™在翻译层（llm-api 1873）、校对层（3055）、润色层
    //      （validatePolishOutput 第⑤层）一律剥离或回退；
    //   ② 下方「词后已有该符号 → continue」检查——逐实例消费天然不会在同位置叠™
    //      （游标推进到实例词尾之后，第二个实例匹配不到第一个实例词尾位置）。
    const perWordSymbols: Array<{ word: string; symbol: string }> = []
    for (const s of symbols) perWordSymbols.push(s)

    // v12.14: 译文搜索游标——逐实例消费（每个源文™实例锚定译文的下一个未消费匹配）。
    // 游标推进到已消费实例词尾（不含符号位），同词下一实例从该位置之后开始找；
    // 找不到（译文合并了重复产品名/语序大改）→ 静默放弃该实例（漏™风险远小于™泛滥）。
    let tmCursor = 0

    for (const { word, symbol } of perWordSymbols) {
      // 在译文中查找该词（不区分大小写，游标之后起找）
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const wordRegex = new RegExp(escapedWord, 'i')
      const wordMatch = wordRegex.exec(result.slice(tmCursor))
      const wordAbsIndex = wordMatch ? tmCursor + wordMatch.index : -1

      // v12.4: 该词在译文中的"专属符号位置"检查——只有词后跟™（词尾位置）才算已有，
      // 译文中其他位置的™（如 CFexpress™ 的™）不能算在 Sony 头上。
      // 旧逻辑 result.includes(symbol) 是全局检查，会把 CFexpress™ 的™当成 Sony™ 跳过插入（B5 bug）。
      if (wordMatch) {
        const insertPos = wordAbsIndex + wordMatch[0].length
        if (result[insertPos] === symbol) {
          // 词后已有该符号（合法位置）→ 验证符号前无空格即可
          if (result[insertPos - 1] === ' ') {
            result = result.slice(0, insertPos - 1) + result.slice(insertPos)
          }
          tmCursor = insertPos  // v12.14: 游标推进到实例词尾——同词下一实例从这里之后找
          continue
        }
      }

      // v12.4: 插入前检查目标位置是否处于"逐字母大写"模式（S-I-L-V-E-R 的 I 位置）。
      // 源文词（如 SILVER/Sony/Lexar）在译文中被拆成单字母时，逐字母位置插入™=散弹。
      // 命中则放弃本次插入（找不到正确位置，符号丢失风险远小于™泛滥——与144行注释同哲学）。
      // 判据：插入点前后都是大写字母 → 处于连续大写序列中间（逐字母模式）。
      //   完整品牌词（SILVER）的插入点在词尾（后字符是空格/标点/小写），不会触发。
      const isSpamPosition = (pos: number): boolean => {
        if (pos <= 0 || pos >= result.length) return false
        const before = result[pos - 1]
        const after = result[pos]
        return /[A-Z]/.test(before) && /[A-Z]/.test(after)
      }

      if (wordMatch) {
        // 找到该词，在它后面插入符号
        const insertPos = wordAbsIndex + wordMatch[0].length
        if (isSpamPosition(insertPos)) { tmCursor = insertPos; continue }  // v12.4: 逐字母模式位置，放弃插入（游标仍推进——防死循环复锚同位置）
        // 如果后面紧跟标点，符号放在标点后
        const after = result.slice(insertPos)
        const punctMatch = after.match(/^(\s*[.,;:!?)]?)/)
        const punctLen = punctMatch ? punctMatch[0].length : 0
        result = result.slice(0, insertPos + punctLen) + symbol + result.slice(insertPos + punctLen)
        tmCursor = insertPos  // v12.14: 游标推进到实例词尾
      } else {
        // v7.5.5: 词未匹配到 → 多重兜底定位
        // Layer A: 词首3字符子串匹配（处理被术语库轻微修改的词）
        if (word.length >= 4) {
          const prefix = escapedWord.slice(0, Math.max(3, Math.floor(word.length * 0.6)))
          const prefixRe = new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          const prefixMatch = prefixRe.exec(result)
          if (prefixMatch && prefixMatch.index < Math.min(40, result.length)) {
            const insertPos = prefixMatch.index + prefixMatch[0].length
            if (isSpamPosition(insertPos)) continue  // v12.4: 逐字母模式位置，放弃插入
            const after = result.slice(insertPos)
            const punctMatch = after.match(/^(\s*[.,;:!?)]?)/)
            const punctLen = punctMatch ? punctMatch[0].length : 0
            result = result.slice(0, insertPos + punctLen) + symbol + result.slice(insertPos + punctLen)
            continue
          }
        }
        // Layer B: 源文首词 → 译文首词位置兜底
        // 品牌名通常在句首，译文中也在前20字符内
        const srcStartsWithWord = new RegExp(`^\\s*${escapedWord}\\b`, 'i').test(source)
        if (srcStartsWithWord) {
          const firstCapitalized = result.match(/^[^A-Za-z]*([A-Z][a-z]{2,})/)
          if (firstCapitalized && firstCapitalized.index !== undefined && firstCapitalized.index < 20) {
            const insertPos = firstCapitalized.index! + firstCapitalized[1].length
            if (isSpamPosition(insertPos)) continue  // v12.4: 逐字母模式位置，放弃插入
            const after = result.slice(insertPos)
            const punctMatch = after.match(/^(\s*[.,;:!?)]?)/)
            const punctLen = punctMatch ? punctMatch[0].length : 0
            result = result.slice(0, insertPos + punctLen) + symbol + result.slice(insertPos + punctLen)
            continue
          }
        }
        // v12.14: 词形变化兜底已退役（原 Layer C 前 4 字符全文匹配）。
        //   根因实锤（2026-09-03 调试）：「找不到词=找不到正确位置」——全词精确匹配都失败了，
        //   用更弱的前缀信号全文撞位置必然撞进词中间（CFexpress 未匹配时 Layer A 插"CFexp™"，
        //   Layer C 再撞"CFex™"→ CFex™p™ress 散弹，恰好落在 hasTrademarkSpam 同符号紧邻
        //   判据的检测盲区——™p™ 跨字符非紧邻）。漏™可接受，散弹不可接受（v7.5.5 同哲学）。
        //   找不到也不追加到末尾 — 符号丢失风险远小于 ™ 泛滥。
      }
    }

    // v12.14: 锚点后检查——™词是不可翻译实体的强不变量终检（品牌词位确认制）。
    // 业务事实（用户拍板 2026-09-03，两条）：
    //   ① ™/® 前导词恒为商标（Lexar®/CFexpress™/Sony™），不可翻译——译文恒保留拉丁原形；
    //   ② ™ 恢复位置恒在品牌词后——游离™（不在任何源文™词词尾的）恒为散弹/误插，一律清除。
    // 机制（源文实例序列为唯一事实源，确认位白名单制）：
    //   ① 顺次确认：实例在游标后锚到（词+可选标点+™）→ 记录™位置进白名单，游标推进；
    //   ② 未锚定 → 该实例「词+™」原子补插在最近已确认实例后（上界达成，不漏™）；
    //   ③ 全文清场：剥离所有非白名单™®©（兜底层误插/LLM 自插/词中间残骸一律清除）——
    //      剥后残骸自然合并（CFexp™ress→CFexpress），输出™集合 ⊆ 品牌词尾且与源文同序同数。
    // 与 LLM 自插™的关系：译文词后™但源文无对应实例（Sony™ 源文无™）——③清场剥除
    //   （源文无™译文有™历来是散弹管辖，v12.4 职责划分一致）。
    {
      const srcSymbolsOrdered: Array<{ word: string; symbol: string }> = []
      const anchorRe = /([^\s®™©]+)\s*([®™©]+)/g
      let am: RegExpExecArray | null
      while ((am = anchorRe.exec(source)) !== null) {
        const cw = am[1].replace(/[®™©]/g, '')
        if (cw) for (const sc of am[2]) srcSymbolsOrdered.push({ word: cw, symbol: sc })
      }
      if (srcSymbolsOrdered.length > 0) {
        const confirmed = new Set<number>()  // 确认™位置白名单（™字符的下标）
        let cursor = 0
        for (const { word, symbol } of srcSymbolsOrdered) {
          const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const anchoredRe = new RegExp(esc + '[\\s.,;:!?)]?' + symbol, 'i')
          const m = anchoredRe.exec(result.slice(cursor))
          if (m) {
            const symPos = cursor + m.index + m[0].length - 1  // ™字符位置（匹配末位恒为™）
            confirmed.add(symPos)
            cursor = symPos + 1
            continue
          }
          // 未锚定 → 原子补插「词+™」在最近已确认实例后（或句首）
          const insertPos = confirmed.size > 0 ? Math.max(...confirmed) + 1 : 0
          const atom = (insertPos > 0 && result[insertPos - 1] !== ' ' ? ' ' : '') + word + symbol
          result = result.slice(0, insertPos) + atom + result.slice(insertPos)
          // 插入位移：白名单中 ≥ insertPos 的旧位置全部后移 atom.length
          const shifted = new Set<number>()
          for (const p of confirmed) shifted.add(p >= insertPos ? p + atom.length : p)
          shifted.add(insertPos + atom.length - 1)  // 新补插™的位置
          confirmed.clear()
          for (const p of shifted) confirmed.add(p)
          cursor = insertPos + atom.length
        }
        // ③ 全文清场：剥离非白名单™®©
        let cleaned = ''
        for (let ci = 0; ci < result.length; ci++) {
          const ch = result[ci]
          if ((ch === '™' || ch === '®' || ch === '©') && !confirmed.has(ci)) continue
          cleaned += ch
        }
        result = cleaned
      }
    }

    // 商标符号间距规范化：去掉符号前的空格，符号后紧跟字母/数字时补空格
    result = result.replace(/\s+([®™©])/g, '$1')
    result = result.replace(/([®™©])([a-zA-Z0-9À-ɏЀ-ӿ])/g, '$1 $2')

    return result
  })
}

// ============================================================
// v12.7: 润色前格式净化（轻量，代码管形式零 LLM）
// 背景：润色判定 LLM 看到格式噪音（SILVERCFexpress 连写/™™/多余空格）会被干扰，
//   判定质量下降（把格式问题当机翻感 issues 输出，或漏判真实搭配问题）。
// 原则：只做「形式信号零误判」的修复——™ 去重（hasTrademarkSpam 扩充判据已兜）、
//   驼峰连写拆分（仅修已知品牌词表内的形态，如 SILVERCFexpress→SILVER CFexpress）、
//   多余空格压缩。不做语义判断（不断言"该不该连写"）。
// ============================================================

/** 已知品牌词表（连写拆分白名单——只拆这些词的连写形态，防误伤正常驼峰词） */
const BRAND_WORDS_FOR_SPLIT = ['SILVER', 'GOLD', 'DIAMOND', 'BLUE', 'PLAY', 'THOR', 'ARES', 'CFexpress', 'Professional', 'Lexar']

/**
 * 润色前格式净化：™ 去重 + 品牌词连写拆分 + 多余空格压缩。
 * @param texts 译文数组（restoreTrademarkSymbols 之后、personaJudgeBatch 之前）
 * @returns 净化后译文数组 + 净化计数（日志用）
 */
export function prePolishFormatCleanup(texts: string[]): { texts: string[]; cleanedCount: number } {
  let cleanedCount = 0
  const cleaned = texts.map(text => {
    let result = text
    const before = result

    // ① ™ 去重（hasTrademarkSpam 扩充判据的主动修复——散弹剥离层是被动兜底，这里是主动净化）
    if (/([®™©])\1/.test(result)) {
      result = result.replace(/([®™©])\1+/g, '$1')
    }

    // ② 品牌词连写拆分（如 SILVERCFexpress → SILVER CFexpress）
    //   只拆「全大写词+驼峰词」的连写形态（SILVERCFexpress），不拆正常驼峰词（microSDXC）。
    //   判据：大写字母序列 ≥2 + 紧跟大写字母开头的小写词，且大写序列在品牌词表内。
    //   v12.7 修复：品牌词表匹配需大小写不敏感——SILVER 是全大写，但 CFexpress 是驼峰，
    //   连写形态是 SILVERCFexpress（SILVER 全大写 + CFexpress 驼峰），正则需分别处理。
    for (const brand of BRAND_WORDS_FOR_SPLIT) {
      if (brand.length < 2) continue
      // 匹配 brand（任意大小写形态）紧跟另一个大写字母开头的词（无空格）
      // 如 SILVERCFexpress（SILVER 全大写 + CFexpress 驼峰）、silvercfexpress（全小写，罕见但防御）
      const re = new RegExp(`\\b(${brand})(?=[A-Z][a-z])`, 'gi')
      result = result.replace(re, '$1 ')
    }

    // ③ 多余空格压缩（两个以上连续空格→一个，行首行尾空格剥除）
    result = result.replace(/ {2,}/g, ' ')

    if (result !== before) cleanedCount++
    return result
  })
  return { texts: cleaned, cleanedCount }
}

// ============================================================
// v12.5: LLM 自发星号清理（源文无 * 时）
// 背景：zh-TW 实机反馈「AI 生成文字中有出现 * 等符号」——LLM 把营销文案当 markdown
//   输出 *强调* / **粗体** / 孤立 * 脚注符，源文并没有 *。设计稿是画布文本不是
//   markdown 渲染器，星号会原样上稿。
// 原则（代码管形式）：只有源文整条不含 * 时才清理——源文有 * 时（900MB/s* 速率
//   脚注、行首列表符）一个都不碰，那些由 ※ 转义链路和 restoreStorageUnitFormatting
//   的 * 连写规则负责。
// ============================================================
export function stripSpuriousAsterisks(source: string, translated: string): string {
  if (source.includes('*') || source.includes('※')) return translated
  if (!translated.includes('*')) return translated

  let result = translated
  // ① 成对 markdown 标记：**bold** / *em* —— 剥标记留内容
  //    内容段不允许跨 *（防贪婪吞掉两个独立星号之间的文案）
  let prev = ''
  while (prev !== result) {
    prev = result
    result = result.replace(/\*\*([^*]+)\*\*/g, '$1')
    result = result.replace(/\*([^*\n]+)\*/g, '$1')
  }
  // ② 剩余孤立星号（脚注符/半截标记）——剥掉并吸掉其前导空格
  //    豁免：数字/单位后紧跟的 *（如 900MB/s* —— 即使源文没写 *，剥掉会改变速率语义，
  //    保守保留交由人工判断；LLM 极少自发产出这种形态，真产出也比误剥安全）
  //    正向空格吸收用 [ \t]* 不用 \s* —— 防止吸掉换行把 ↵ 还原的断行结构吃掉
  result = result.replace(/(?<![\dA-Za-z])[ \t]*\*[ \t]*/g, (m, offset: number, s: string) => {
    // 行首的星号连同缩进一起剥（列表符形态）
    if (offset === 0 || s[offset - 1] === '\n') return ''
    // 星号左右都是空格时剥完留一个空格（词间孤立）
    return m.startsWith(' ') && m.endsWith(' ') ? ' ' : ''
  })
  // ③ 行首前导空格清尾：①②剥完行首星号/标记后残留的缩进（多行逐行处理）
  result = result.split('\n').map(line => line.trimStart()).join('\n')
  return result
}

// ============================================================
// 存储单位格式还原
// 原文中数字和存储单位连写时（如 900MB/s），AI 经常误加空格变成 900 MB/s
// 需要恢复原文的连写格式，保持技术规格一致
// 覆盖: MB/s, GB/s, TB/s, KB/s, MB, GB, TB, KB, GByte, MByte 等
// ============================================================
export function restoreStorageUnitFormatting(sourceTexts: string[], translatedTexts: string[]): string[] {
  // 常见存储单位模式 - 这些单位在技术规格中通常保持连写
  // 匹配: 数字 + (可选空格) + 单位
  const unitPatterns: Array<{ re: RegExp; replacement: string }> = [
    { re: /(\d+)\s+(MB|GB|TB|KB|GByte|MByte|TByte|KByte)(\/s)\b/gi, replacement: '$1$2$3' },
    { re: /(\d+)\s+(MB|GB|TB|KB|GByte|MByte|TByte|KByte)\b(?!\/)/gi, replacement: '$1$2' },
  ]

  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source) return translated

    let result = translated

    // 仅当原文中数字和单位是连写时，才在译文中恢复连写
    // 检查原文是否存在连写模式 (\d+[A-Z]{2})
    const hasConnectedUnits = /\d+[A-Z]{2}/.test(source)

    if (hasConnectedUnits) {
      for (const pattern of unitPatterns) {
        result = result.replace(pattern.re, pattern.replacement)
      }
      // v7.5.9: 清理 pattern 2 ($1$2$3 只有2组) 可能引入的字面量 $N 残留
      result = result.replace(/(\d+[A-Za-z]*)\s*\$\d+/g, '$1')
      result = result.replace(/(\d+\s*[A-Za-z]+)\s*\$\d+/g, '$1')
    }

    // 特殊处理星号后缀：900MB/s* → 保持 900MB/s* 不要变成 900 MB/s*
    // 使用更激进的正则直接修复所有情况
    result = result.replace(/(\d+)\s+([KMGT][B])(\/s\*)/g, '$1$2$3')
    result = result.replace(/(\d+)\s+([KMGT][B]\/s)\*/g, '$1$2*')

    return result
  })
}

// ============================================================
// 术语库强制校准
// 翻译完成后，将术语库中的固定译法强制替换到译文中
// 优先精确匹配，其次子串匹配
// ============================================================

/**
 * 文本归一化：去除商标符号 + 空白归一化 + 连字符处理。
 * 用于术语匹配时忽略 ®™©、多余空格和连字符的干扰。
 */
export function cleanKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 写画布前最终还原（v12.12 不变量收敛——判定方式五条之②能还原就还原）。
 * 任何写画布的文本最后一站统一过此函数：↵ 占位符 → 真实换行（画布需要真换行，
 * ↵ 只是管道内占位符）。翻译 S5 postProcessTranslation 内联同语义代码既有，
 * 新增写回路径（润色/择优/未来新 pass）必须调本函数——防 v12.10.2 型「字面 ↵ 上画布」事故。
 */
export function finalizeForCanvas(text: string): string {
  return text.replace(/\s*↵\s*/g, '\n')
}

export function enforceGlossaryTerms(
  sourceTexts: string[],
  translatedTexts: string[],
  glossaryMap: Map<string, string>,
  skipIndices?: Set<number>,
  precomputedNormalizedMap?: Map<string, string>,
): string[] {
  // 使用预计算的 normalizedGlossaryMap，避免每次调用都重新构建
  const normalizedGlossaryMap = precomputedNormalizedMap || new Map<string, string>()
  if (!precomputedNormalizedMap) {
    for (const [key, value] of glossaryMap.entries()) {
      const normalizedKey = cleanKey(key)
      if (!normalizedGlossaryMap.has(normalizedKey)) {
        normalizedGlossaryMap.set(normalizedKey, value)
      }
    }
  }

  function isCJK(ch: string): boolean {
    const c = ch.charCodeAt(0)
    return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
           (c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff) ||
           (c >= 0xac00 && c <= 0xd7af) || (c >= 0x0e00 && c <= 0x0e7f)
  }

  function truncateAtBoundary(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    if (isCJK(text[0])) return text.slice(0, maxLen)
    const truncated = text.slice(0, maxLen)
    const lastSpace = truncated.lastIndexOf(' ')
    if (lastSpace > maxLen * 0.6) return truncated.slice(0, lastSpace)
    return truncated
  }

  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source) return translated
    // 跳过被标记为"需要重翻"的索引（避免在回退源文上做术语校准）
    if (skipIndices?.has(i)) return translated

    const normalizedSource = cleanKey(source)
    let result = translated

    // v11.14: 脏条目（句形 key + identity/乱码™值）精确匹配锁定放开——整句译文不得
    // 被脏值整条锁死（2026-08-17 事故：乱码值经此通道灌回译文）。value 先取出再判定，
    // 保证 Bug A 的 identity 条目（value===source）被识别。
    const exactRaw = glossaryMap.get(source)
    const skipExactRaw = exactRaw !== undefined && shouldSkipGlossaryEntry(source, exactRaw)
    const exactCk = glossaryMap.get(normalizedSource)
    const skipExactCk = exactCk !== undefined && shouldSkipGlossaryEntry(normalizedSource, exactCk)
    const exactNorm = normalizedGlossaryMap.get(normalizedSource)
    const skipExactNorm = exactNorm !== undefined && shouldSkipGlossaryEntry(normalizedSource, exactNorm)

    // 1. 精确匹配（三层：原文 → 去商标原文 → 术语库去商标key）
    // v11.14: 句形 key + 正经译文值的正当策展条目（专属库免责声明/兼容性文案）照常
    // 锁定（v11.12+ 术语库最高优先级）；仅 identity/乱码™值条目放开。
    if (!skipExactRaw && glossaryMap.has(source)) {
      const target = glossaryMap.get(source)!
      if (target !== result) {
        debugLog('[enforceGlossaryTerms] exact match (raw):', source.slice(0, 60), '→', target.slice(0, 60))
        result = target
      }
    }
    if (!skipExactCk && glossaryMap.has(normalizedSource)) {
      const target = glossaryMap.get(normalizedSource)!
      if (target !== result) {
        debugLog('[enforceGlossaryTerms] exact match (cleanKey):', normalizedSource.slice(0, 60), '→', target.slice(0, 60))
        result = target
      }
    }
    if (!skipExactNorm && normalizedGlossaryMap.has(normalizedSource)) {
      const target = normalizedGlossaryMap.get(normalizedSource)!
      if (target !== result) {
        debugLog('[enforceGlossaryTerms] exact match (normalizedMap):', normalizedSource.slice(0, 60), '→', target.slice(0, 60))
        result = target
      }
    }

    // 2. 子串匹配：源文本包含术语库条目
    // v8.2: 按术语长度降序匹配，长术语优先（避免短术语覆盖长术语的一部分）
    // v8.2: 删除 CJK fallback 位置推算，因为 CJK→CJK 不是 1:1 字符映射，位置推算不可靠
    if (result === translated) {
      const sortedEntries = [...glossaryMap.entries()].sort((a, b) => b[0].length - a[0].length)
      for (const [glossarySource, glossaryTarget] of sortedEntries) {
        const normalizedGlossarySource = cleanKey(glossarySource)
        if (normalizedGlossarySource.length < 3) continue
        // v11.14: 脏条目（句形 key + identity/乱码™值）不参与子串替换——Bug B 扩散
        // 通道封堵；正当句形策展条目照常替换（术语库最高优先级）。
        if (shouldSkipGlossaryEntry(glossarySource, glossaryTarget)) continue
        if (normalizedSource.includes(normalizedGlossarySource)) {
          if (!result.includes(glossaryTarget)) {
            const escapedSource = normalizedGlossarySource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const termInTranslation = new RegExp(escapedSource, 'i').exec(result)
            if (termInTranslation) {
              result = result.slice(0, termInTranslation.index) + glossaryTarget + result.slice(termInTranslation.index + termInTranslation[0].length)
            } else {
              // v8.2: 术语在译文中找不到，只记录日志，不强制插入
              // 避免 CJK fallback 位置推算导致的错误插入
              console.warn('[enforceGlossaryTerms] term not found in translation:', glossarySource, '→', glossaryTarget)
            }
          }
        }
      }
    }

    // 3. 短标签硬守卫：源文<10字符 且 译文长度>5x源文长度 时硬截断
    // v7.5: 阈值从 <15/3x 调整为 <10/5x，防止德语等膨胀率高的语言被误截
    if (source.length < 10 && result.length > source.length * 5) {
      // 再次尝试术语匹配（更低阈值）
      let bestMatch: { target: string; len: number } | null = null
      for (const [gs, gt] of normalizedGlossaryMap.entries()) {
        const gsClean = cleanKey(gs)
        if (gsClean.length < 3) continue
        if (normalizedSource.includes(gsClean)) {
          if (!bestMatch || gsClean.length > bestMatch.len) {
            bestMatch = { target: gt, len: gsClean.length }
          }
        }
      }
      if (bestMatch && bestMatch.len / normalizedSource.length > 0.4) {
        result = bestMatch.target
      } else {
        const maxLen = Math.max(Math.ceil(source.length * 1.5), 3)
        result = truncateAtBoundary(result, maxLen)
      }
    }

    return result
  })
}

// ============================================================
// 主入口
// ============================================================
export function postProcessTranslation(text: string, lang: string): string {
  let result = text

  // 还原换行符占位符 ↵（U+21B5）→ 实际换行
  // 由 text-normalizer 在预处理时替换，此处还原以保留源文断行
  result = result.replace(/\s*↵\s*/g, '\n')

  // 还原 ※ → *（译前转义避免 LLM 将其解析为 markdown 列表标记）
  result = result.replace(/※\s*/g, '* ')

  // 清理 LLM 偶尔输出的 $N 伪引用标记（如 3.725GB$3 → 3.725GB, 8TB$3 → 8TB）
  // 必须在早期执行：后续语言特定处理可能会在$N前加空格
  result = result.replace(/(\d+[A-Za-z]*)\s*\$\d+/g, '$1')
  result = result.replace(/(\d+\s*[A-Za-z]+)\s*\$\d+/g, '$1')

  switch (lang) {
    case 'fr':
      result = postProcessFrench(result)
      break
    case 'de':
      result = postProcessGerman(result)
      break
    case 'ja':
      result = postProcessJapanese(result)
      break
    case 'ko':
      result = postProcessKorean(result)
      break
    case 'ar':
      result = postProcessArabic(result)
      break
    case 'th':
      result = postProcessThai(result)
      break
    case 'ru':
      result = postProcessRussian(result)
      break
    case 'zh-TW':
      result = postProcessZhTw(result)
      break
    case 'zh-CN':
      result = postProcessZhCn(result)
      break
  }

  // 所有欧洲语言的通用后处理
  if (['de', 'fr', 'es', 'it', 'pt', 'pt-BR', 'nl', 'pl', 'sv', 'tr'].includes(lang)) {
    result = postProcessEuropeanNumbers(result, lang)
  }

  // v7.5.7: 最终$N清理 — 在所有处理之后执行，确保$N伪引用彻底清除
  result = result.replace(/(\d+[A-Za-z]*)\s*\$\d+/g, '$1')

  return result
}

// ============================================================
// 首字母大写（拉丁/西里尔字母语言）
// 安全策略：仅当首字符为小写字母且第二个字符也是小写字母时才转换
// 避免误伤 "iPhone"、"eBay"、"microSD" 等专有名词
// ============================================================

// 品牌名例外列表：这些词不应被首字母大写
const BRAND_EXCEPTIONS = new Set([
  'microSD', 'microSDXC', 'microSDHC', 'microUSB', 'microHDMI',
  'iPhone', 'iPad', 'iPod', 'iMac', 'iOS',
  'eBay', 'eBook',
])

export function capitalizeFirstLetter(text: string): string {
  if (!text || text.length === 0) return text
  const first = text[0]
  const second = text.length > 1 ? text[1] : ''

  // 拉丁小写字母 a-z
  if (first >= 'a' && first <= 'z') {
    // 提取第一个单词用于品牌例外检查
    const firstWord = text.match(/^[a-zA-Z]+/)?.[0] || ''
    if (BRAND_EXCEPTIONS.has(firstWord)) return text

    // 仅当第二个字符也是小写字母时才大写（排除 iPhone、eBay、microSD 等）
    if (second && (second < 'a' || second > 'z')) return text
    return first.toUpperCase() + text.slice(1)
  }

  // 西里尔小写字母 а-я (Unicode: 0430-044F), ё (0451)
  if ((first >= 'а' && first <= 'я') || first === 'ё') {
    if (second && (second < 'а' && second !== 'ё') || (second > 'я')) return text
    return first.toUpperCase() + text.slice(1)
  }

  return text
}

// ============================================================
// 德语 (de)
// ============================================================
function postProcessGerman(text: string): string {
  let result = text

  // ß vs SS 规范：sz 不能写成 ss（Maße ≠ Masse）
  // 常见错误修复
  result = result.replace(/\bStrasse\b/g, 'Straße')
  result = result.replace(/\bSpass\b/g, 'Spaß')
  result = result.replace(/\bgross\b/g, 'groß')
  result = result.replace(/\bschliess\b/g, 'schließ')
  result = result.replace(/\banschliess\b/g, 'anschließ')
  result = result.replace(/\bausser\b/g, 'außer')
  result = result.replace(/\bFuss\b/g, 'Fuß')
  result = result.replace(/\bmuss\b/g, 'muss')
  result = result.replace(/\bgeniess\b/g, 'genieß')

  // Sie 敬语大写（在正式产品文案中）
  // 检测小写的 sie（代指读者时）→ 大写 Sie
  result = result.replace(/([.!?]\s+)sie\b/g, '$1Sie')
  result = result.replace(/([.!?]\s+)ihre\b/g, '$1Ihre')

  // GB → GByte（德文习惯）
  // MB → MByte 不强制，但保留一致性

  return result
}

// ============================================================
// 法语 (fr)
// ============================================================
function postProcessFrench(text: string): string {
  let result = text

  // 法语标点前应加窄空格 (espace fine insécable)
  // : ; ! ? « »
  const PUNCT_WITH_SPACE = /([a-zA-Z0-9%]) *([:;!?])/g
  result = result.replace(PUNCT_WITH_SPACE, '$1 $2')

  // 引号两侧空格
  result = result.replace(/« */g, '« ')
  result = result.replace(/ *»/g, ' »')

  // 数字千位分隔 → 法语用空格（仅5位以上）
  result = result.replace(/\b\d{5,}\b/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ' '))

  // Mo 而非 MB（法语习惯）
  // 保留 MB/s 不处理，仅处理单独出现的 MB
  result = result.replace(/(\d+)\s*MB\b(?!\/)/gi, '$1 Mo')
  result = result.replace(/(\d+)\s*GB\b(?!\/)/gi, '$1 Go')
  result = result.replace(/(\d+)\s*TB\b(?!\/)/gi, '$1 To')

  // 引号规范：确保使用 « » 而非 " "
  // 仅在已有英文引号时替换
  if (result.includes('"')) {
    // 只替换成对的引号，不处理英寸符号
    result = result.replace(/"([^"]{3,})"/g, '« $1 »')
  }

  return result
}

// ============================================================
// 日语 (ja)
// ============================================================
function postProcessJapanese(text: string): string {
  let result = text

  // 确保片假名长音使用「ー」而非「−」或「-」
  result = result.replace(/([ァ-ヶ])−/g, '$1ー')
  result = result.replace(/([ァ-ヶ])-(?!\d)/g, '$1ー')

  // 常见外来语规范
  // v8.2: 删除无效自替换（替换为自身），保留有效替换
  result = result.replace(/インターフェイス/g, 'インターフェース')
  result = result.replace(/クリエーター/g, 'クリエイター')

  // 确保使用全角标点
  result = result.replace(/(?<![0-9]), /g, '、')
  result = result.replace(/\. /g, '。')

  return result
}

// ============================================================
// 韩语 (ko)
// ============================================================
function postProcessKorean(text: string): string {
  let result = text

  // 助词拼写：은/는 和 이/가
  // 有终声 → 은/이, 无终声 → 는/가
  // 这里主要做已知常见错误修正
  // v8.2: HMB 可能是 HDD 的拼写错误（Host Memory Buffer 是 SSD 技术，但文案中极少出现）
  result = result.replace(/\b(SSD|HDD|ECC|TBW)는\b/gi, '$1은')
  result = result.replace(/\b(SSD|HDD|ECC|TBW)가\b/gi, '$1이')

  return result
}

// ============================================================
// 阿拉伯语 (ar) — 最小处理，避免破坏复杂 RTL 逻辑
// ============================================================
function postProcessArabic(text: string): string {
  let result = text

  // 确保数字使用阿拉伯语数字上下文
  // 常见：MB/s → ميجابايت/ثانية
  result = result.replace(/MB\/s/gi, 'ميجابايت/ثانية')
  result = result.replace(/GB/gi, 'جيجابايت')
  result = result.replace(/(\d+)\s*TB/g, '$1 تيرابايت')

  // Hamza 规范：确保 أ/إ/ؤ/ئ 正确
  // 仅做最常见的修正
  result = result.replace(/\bاسرع\b/g, 'أسرع')
  result = result.replace(/\bاقصى\b/g, 'أقصى')
  result = result.replace(/\bاداء\b/g, 'أداء')

  return result
}

// ============================================================
// 泰语 (th)
// ============================================================
function postProcessThai(text: string): string {
  let result = text

  // 泰语不应在词之间有空格的常见英文错误
  // 移除泰文字符之间的多余空格
  // 但保留句子/短语边界空格和数字/英文周围的空格
  // 保守处理：只移除两个泰文字符间的空格

  // 泰文Unicode范围: ฀-๿
  result = result.replace(/([฀-๿])\s+([฀-๿])/g, '$1$2')

  // 确保泰文标点规范
  result = result.replace(/\.([฀-๿])/g, '。$1')

  return result
}

// ============================================================
// 泰文断行结构硬锁（v12.1 已回退，函数保留为占位——管道不调用）
// ============================================================
// 背景：judge 基线（迭代 1）发现 th naturalness 2.69 崩塌式低分，根因是
//       LLM 对泰文多行文本的断行决策——把源文 N 个独立标题/卖点合并成 1-2 行
//       泰文长句（换行保留率 41% vs 其他语种 65%）。
//
// ⚠️ 2026-08-25 回退决定：断点选择需要泰文分词器（dictionary-based
//    segmentation），元音规则近似会在前导元音（เ แ โ ใ ไ）场景切错词
//    （"ค↵ุณ"），断错词比连写更糟（judge 评"ข้อความแตกคำ"质量事故）。
//    可靠性第一原则：不为排版美观冒切词风险。管道调用已移除（llm-api.ts
//    S5 + proofreadBatch 两处），函数保留——未来若引入泰文分词能力可重启。
//
// 遗留问题（记录在 HANDOFF 迭代 1）：th 断行问题标记为「需泰文分词器，
// 超当前架构」；th naturalness 2.6 为已知薄弱点，方案 B 处理搭配问题。
// ============================================================

/** 泰文字符判定（U+0E00–U+0E7F） */
function isThaiChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code >= 0x0e00 && code <= 0x0e7f
}

/** 泰文元音/符号（断点安全位置——元音前切开不切词） */
function isThaiVowel(ch: string): boolean {
  const code = ch.charCodeAt(0)
  // 泰文元音 U+0E30–U+0E39, U+0E40–U+0E44（สระ）
  return (code >= 0x0e30 && code <= 0x0e39) || (code >= 0x0e40 && code <= 0x0e44)
}

/**
 * 泰文断行结构硬锁：译文换行数不足时按源文断行位置强制拆分。
 * ⚠️ 已回退不在管道调用（2026-08-25，断点切词风险），保留为占位。
 * @param source 源文（英文，含 \n）
 * @param translated 译文（泰文，LLM 输出）
 * @returns 拆分后的译文（换行数 ≥ 源文时原样返回）
 */
export function enforceThaiLineBreaks(source: string, translated: string): string {
  const sourceBreaks = (source.match(/\n/g) || []).length
  if (sourceBreaks === 0) return translated  // 源文无换行，不干预
  const translatedBreaks = (translated.match(/\n/g) || []).length
  if (translatedBreaks >= sourceBreaks) return translated  // LLM 已合法断行，不干预

  // 源文按换行切段（滤空段——源文常见 标题\n\n正文 格式，空段不占断行位置）
  const sourceSegs = source.split(/\n+/).map(s => s.trim()).filter(Boolean)
  if (sourceSegs.length <= 1) return translated

  // 译文按现有换行切段（保留 LLM 已有的断行）
  const transSegs = translated.split(/\n+/)
  if (transSegs.length >= sourceSegs.length) return translated  // 段数已够，不干预

  // 需要拆分的段数差：把译文的某些长段按源文段数比例再切
  // 策略：译文总字符数按源文各段字符数占比映射边界，在译文对应位置找最近安全断点
  const sourceTotalLen = sourceSegs.reduce((a, s) => a + s.length, 0)
  if (sourceTotalLen === 0) return translated
  const transTotalLen = translated.replace(/\n/g, '').length

  // 源文各段的累积字符比例（用于映射到译文位置）
  const boundaries: number[] = []  // 源文第 i 段结束时的累积比例
  let acc = 0
  for (let i = 0; i < sourceSegs.length - 1; i++) {  // 最后一段不需要边界
    acc += sourceSegs[i].length
    boundaries.push(acc / sourceTotalLen)
  }

  // 在译文中按边界比例找拆分点（跳过 LLM 已有换行位置——按字符数近似）
  // 简化处理：把译文视为一个整体（合并已有换行为单空格标记），按边界切
  // 已有换行位置计入"已拆分"，只补足不够的边界数
  const needBreaks = sourceSegs.length - 1  // 源文段数-1 = 需要的断行数
  const haveBreaks = translatedBreaks
  const toAdd = needBreaks - haveBreaks
  if (toAdd <= 0) return translated

  // 在译文中按边界比例插入断行（从后往前插，防位置漂移）
  // 先算出每个边界在译文中的目标字符位置
  const targetPositions = boundaries.map(r => Math.round(r * transTotalLen))
  // 已有换行位置（字符级）
  const existingBreakPos: number[] = []
  {
    let pos = 0
    for (const ch of translated) {
      if (ch === '\n') existingBreakPos.push(pos)
      pos++
    }
  }
  // 过滤掉与已有换行位置过近的边界（±15% 总长内视为已覆盖）
  const margin = Math.max(10, Math.round(transTotalLen * 0.15))
  const toInsert = targetPositions.filter(tp =>
    !existingBreakPos.some(eb => Math.abs(eb - tp) <= margin)
  ).slice(0, toAdd)  // 只补够数量

  if (toInsert.length === 0) return translated

  // 从后往前插入（防位置漂移）
  const sorted = [...toInsert].sort((a, b) => b - a)
  let result = translated
  for (const pos of sorted) {
    // 在 pos 附近找最近的安全断点（优先：泰文元音前 / 数字或英文前 / 空格处）
    let cut = -1
    const searchRadius = Math.max(15, Math.round(transTotalLen * 0.05))
    // 向后搜（切分点落在这段的开头更安全）
    for (let d = 0; d <= searchRadius && pos + d < result.length; d++) {
      const idx = pos + d
      const ch = result[idx]
      const prev = result[idx - 1] || ''
      // 安全断点：泰文元音前（前一个是辅音）、英文/数字前（前一个是泰文）、空格处
      if (isThaiVowel(ch) && isThaiChar(prev) && !isThaiVowel(prev)) { cut = idx; break }
      if ((/[A-Za-z0-9]/.test(ch)) && isThaiChar(prev)) { cut = idx; break }
      if (ch === ' ') { cut = idx; break }
    }
    // 向后找不到就向前搜
    if (cut < 0) {
      for (let d = 1; d <= searchRadius && pos - d > 0; d++) {
        const idx = pos - d
        const ch = result[idx]
        const prev = result[idx - 1] || ''
        if (isThaiVowel(ch) && isThaiChar(prev) && !isThaiVowel(prev)) { cut = idx; break }
        if ((/[A-Za-z0-9]/.test(ch)) && isThaiChar(prev)) { cut = idx; break }
        if (ch === ' ') { cut = idx; break }
      }
    }
    if (cut > 0) {
      // 插入换行（吃掉断点处的空格）
      result = result.slice(0, cut).replace(/\s+$/, '') + '\n' + result.slice(cut).replace(/^\s+/, '')
    }
  }

  return result
}

// ============================================================
// 俄语 (ru)
// ============================================================
function postProcessRussian(text: string): string {
  let result = text

  // 确保引号使用 « » 格式
  if (result.includes('"')) {
    result = result.replace(/"([^"]{3,})"/g, '«$1»')
  }

  // GB → ГБ (容量单位)
  result = result.replace(/(\d+)\s*GB\b(?!\/)/gi, '$1 ГБ')
  result = result.replace(/(\d+)\s*MB\b(?!\/)/gi, '$1 МБ')
  result = result.replace(/(\d+)\s*TB\b(?!\/)/gi, '$1 ТБ')

  // v12.1: 时间/物理单位俄语化（judge 基线发现 1m, 30min, 15000Gauss 未本地化）
  // min → мин（分钟），m → м（米，只在数字后），Gauss → Гс（高斯）
  result = result.replace(/(\d+)\s*min\b/gi, '$1 мин')
  result = result.replace(/(\d+)\s*m\b(?!\w)/gi, '$1 м')
  result = result.replace(/(\d+)\s*Gauss\b/gi, '$1 Гс')
  // 数字千分位空格（10,000 → 10 000）
  result = result.replace(/\b(\d{1,3}),(\d{3})\b/g, '$1 $2')

  return result
}

// ============================================================
// 繁体中文 (zh-TW)
// ============================================================
function postProcessZhTw(text: string): string {
  let result = text

  // 确保使用全角标点
  result = result.replace(/(?<![0-9a-zA-Z]), /g, '，')
  // 不替换引号内的英文句号

  return result
}

// ============================================================
// 简体中文 (zh-CN)
// ============================================================
function postProcessZhCn(text: string): string {
  let result = text

  // 确保使用全角标点
  result = result.replace(/(?<![0-9a-zA-Z]), /g, '，')

  return result
}

// ============================================================
// 欧洲语言数字格式化
// ============================================================
function postProcessEuropeanNumbers(text: string, lang: string): string {
  let result = text

  // 各语言数字千位分隔（仅对5位数以上应用，避免 7400 → 7.400）
  const separator: Record<string, string> = {
    de: '.',  // 10.000 MB/s
    fr: ' ',  // 10 000 Mo/s (窄空格)
    es: '.',  // 10.000 MB/s
    it: '.',  // 10.000 MB/s
    pt: '.',  // 10.000 MB/s
    'pt-BR': '.',  // 10.000 MB/s
    nl: '.',  // 10.000 MB/s
    pl: ' ',  // 10 000 MB/s
    sv: ' ',  // 10 000 MB/s
    tr: '.',  // 10.000 MB/s
  }

  const sep = separator[lang]
  if (sep && sep !== ',') {
    // 仅对5位数及以上添加千位分隔，避免 7400 → 7.400
    result = result.replace(/\b\d{5,}\b/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, sep))

    // v12.1: LLM 输出的英文千分位格式（10,000）→ 本地化格式（10.000 / 10 000）
    // 只在千分位语境替换（数字后跟恰好3位数字），避免误伤小数（1,5）或版本号
    result = result.replace(/\b(\d{1,3}),(\d{3})\b/g, `$1${sep}$2`)

    // v12.1: 小数点本地化（de/es/it/pt/nl/tr 用小数逗号，fr/pl/sv 已用空格不处理小数点）
    const decimalCommaLangs = ['de', 'es', 'it', 'pt', 'pt-BR', 'nl', 'tr']
    if (decimalCommaLangs.includes(lang)) {
      // 英文小数点（1.5m）→ 本地化（1,5 m）——只在小数语境（数字.数字）替换
      result = result.replace(/\b(\d+)\.(\d+)\s*(m|mm|cm|km|g|kg|W|V|A|Hz|GB|MB|TB|MB\/s|GB\/s)\b/gi, '$1,$2 $3')
    }

    // v12.1: 单位前空格规范化（de/es 等欧洲语言单位前应有空格：1,5 m 而非 1,5m）
    // 只处理 LLM 漏加空格的场景（数字紧连单位字母）
    result = result.replace(/(\d)(m|mm|cm|km|g|kg|W|V|A|Hz)\b(?!\w)/g, '$1 $2')
  }

  return result
}

/**
 * 批量后处理
 */
export function postProcessBatch(texts: string[], lang: string): string[] {
  return texts.map(t => postProcessTranslation(t, lang))
}

// ============================================================
// 译文扩展检测（v10.8 起：纯检测，不再自动截断）
// 检测 LLM 是否在译文中添加了原文没有的内容（异常扩展）
// v10.8: 代码只量化"是否显著超长"（形式信号），不做语义裁决、不修改译文。
//        长度≠加戏（de/pt/fr 天然长 50-90%），自动截断会把合法详尽译文切成半截句上画布。
//        信号上移校对层，由 LLM 判"真加戏→改写 / 合法详尽→放行"（代码管形式/LLM管语义）。
// ============================================================
export interface ExpansionResult {
  /** v10.8: 原样返回输入译文，不再做任何截断修改（保留字段仅为兼容签名） */
  texts: string[]
  /** 显著超长的条目索引（供校对层作为长度异常 hint） */
  expandedIndices: Set<number>
  /** 每条命中条目的长度比（translatedLen/sourceLen），供校对 hint 量化展示 */
  ratios: Map<number, number>
}

// 各语言相对英语的自然膨胀率（翻译行业经验值）
// 用于 detectTranslationExpansion 按语言设置动态阈值
const LANG_EXPANSION_RATIO: Record<string, number> = {
  // CJK — 翻译后通常比英语短
  'zh-CN': 1.2, 'zh-TW': 1.2, 'ja': 1.3, 'ko': 1.3,
  // 欧洲语言 — 天然比英语长 20-40%
  'pt': 1.8, 'pt-BR': 1.8, 'es': 1.7, 'fr': 1.8,
  'de': 1.9, 'it': 1.7, 'nl': 1.6, 'pl': 1.7,
  'sv': 1.6, 'tr': 1.5, 'ru': 1.5,
  // 东南亚
  'vi': 1.5, 'th': 1.4, 'id': 1.5, 'ms': 1.5,
  // 中东
  'ar': 1.6,
  // 其他（v10.2 补全：消除 ?? 1.5 兜底的不确定性）
  'uk': 1.5,  // 乌克兰语（西里尔，同俄语）
  'el': 1.6,  // 希腊语（词长普遍大于英语）
  'he': 1.2,  // 希伯来语（无元音字母，天然收缩）
}

/**
 * 检测译文异常扩展（v10.8 起：只检测，不修改译文）。
 *
 * 规则：
 * - 按目标语言设置动态阈值（CJK 1.2-1.3x，欧洲语言 1.5-1.9x）
 * - 短源文（<10字符）使用 2x 安全余量，常规文本用 1.4x 安全余量
 * - 安全豁免：如果译文包含源文中的数字（技术参数合法翻译），不标记
 * - v10.8: 命中不再截断，只把索引+长度比透出，由校对 LLM 结合语义裁决
 */
export function detectTranslationExpansion(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang?: string,
): ExpansionResult {
  const expandedIndices = new Set<number>()
  const ratios = new Map<number, number>()

  for (let i = 0; i < translatedTexts.length; i++) {
    const translated = translatedTexts[i]
    const source = sourceTexts[i] || ''
    if (!source || !translated) continue

    const sourceLen = source.length
    const translatedLen = translated.length

    // 按语言动态计算阈值
    const ratio = targetLang ? (LANG_EXPANSION_RATIO[targetLang] ?? 1.5) : 1.5
    // 短源文使用更宽松阈值（2x），常规文本用 1.4x 安全余量
    const threshold = sourceLen < 10 ? ratio * 2.0 : ratio * 1.4

    if (translatedLen > sourceLen * threshold) {
      // 安全豁免：译文包含源文数字 = 技术参数合法翻译，不标记
      const sourceNumbers = source.match(/\d+/g) || []
      const hasSourceNumbers = sourceNumbers.some(n => translated.includes(n))
      if (hasSourceNumbers) continue

      expandedIndices.add(i)
      ratios.set(i, translatedLen / sourceLen)
    }
  }

  // v10.8: 原样返回输入译文，不做任何截断修改
  return { texts: translatedTexts, expandedIndices, ratios }
}

// ============================================================
// 品牌注入检测：检查译文是否添加了源文中不存在的品牌名或技术规格标识。
// 三层检测：
//   1. 品牌标记：Lexar®、pexar 等源文没有的品牌名
//   2. 规格注入：M.2、NVMe、PCIe代数、外形尺寸等源文没有的技术参数
//   3. 数值注入：译文有带单位的数字（5200MB/s、128GB等）但源文没有
// 检测到注入 → 回退到源文（避免显示错误译文）
// ============================================================
export interface InjectionResult {
  texts: string[]
  injectedIndices: Set<number>
}

export function detectBrandInjection(
  sourceTexts: string[],
  translatedTexts: string[],
  glossaryMap?: Map<string, string>,
): InjectionResult {
  // 品牌标记（Lexar 生态系统中已知的品牌/系列名）
  // 注意：不含 "雷克沙" — 这是 Lexar 在中文里的合法翻译，术语库会正确处理
  const brandTokens = new Set([
    'lexar', 'lexar®', 'pexar',
    'ares', 'thor', 'armor', 'play',
    'silver', 'gold', 'diamond', 'blue',
  ])
  // v7.5: 与常见英文词重叠的品牌 token，仅在伴随其他品牌特征时才判定注入
  // 防止 "play"/"silver"/"gold"/"diamond"/"armor" 等常见词被误判
  const COMMON_WORD_BRANDS = new Set(['play', 'silver', 'gold', 'diamond', 'armor', 'blue'])

  // 从术语库提取合法的品牌词翻译
  // 只要术语库译文中包含品牌词，该品牌词在译文中就是合法的（术语库是权威参考）
  const glossaryBrandTokens = new Set<string>()
  if (glossaryMap) {
    for (const [, target] of glossaryMap.entries()) {
      const targetLower = target.toLowerCase()
      for (const token of brandTokens) {
        if (targetLower.includes(token)) {
          glossaryBrandTokens.add(token)
        }
      }
    }
  }

  // v8.0: 从术语库只提取已知 Lexar 品牌/系列名作为 brandTokens
  // 旧逻辑将所有首字母大写的首词都加入（包括 "Read", "Water", "High" 等普通词）
  // 导致 detectBrandInjection 误判 → 正确译文被回退为英文
  const KNOWN_LEXAR_BRANDS = new Set([
    'lexar', 'ares', 'thor', 'armor', 'play', 'pexar',
    'silver', 'gold', 'diamond', 'blue',
  ])
  if (glossaryMap) {
    for (const key of glossaryMap.keys()) {
      const firstWord = key.split(/\s+/)[0].toLowerCase().replace(/[™®©]/g, '')
      if (KNOWN_LEXAR_BRANDS.has(firstWord)) {
        brandTokens.add(firstWord)
      }
    }
  }

  // 规格注入模式（不在源文中的技术参数标识）
  // v8.2: 移除 ® 检测 — ® 由 restoreTrademarkSymbols 独立处理，
  // 放在此处会在 restoreTrademarkSymbols 之前误判为"规格注入"
  const specPatterns: Array<{ re: RegExp; name: string }> = [
    { re: /\bM\.2\b/i, name: 'M.2 form factor' },
    { re: /\bNVMe\b/i, name: 'NVMe protocol' },
    { re: /\bPCIe\s*[345]\.0\b/i, name: 'PCIe generation' },
    { re: /\bGen\s*[345]\s*x?\s*4\b/i, name: 'PCIe Gen x4' },
    { re: /\b(2230|2242|2280)\b/, name: 'M.2 form factor size' },
  ]

  // 数值规格注入模式（LLM 编造的带单位的数字：5200MB/s、128GB等）
  const measurePatterns: Array<{ re: RegExp; name: string }> = [
    { re: /\d[\d,]*\s*(?:MB\/s|GB\/s|TB\/s|MBps|GBps)\b/i, name: 'speed value' },
    { re: /\d[\d,]*\s*(?:GB|TB|PB)\b(?!\/s)/i, name: 'capacity value' },
    { re: /\d[\d,]*\s*(?:MHz|GHz)\b/i, name: 'frequency value' },
    { re: /\d[\d,]*\s*(?:MB|KB)\b(?!\/s)/i, name: 'size value' },
  ]

  const injectedIndices = new Set<number>()

  const result = translatedTexts.map((trans, i) => {
    const src = sourceTexts[i] || ''
    if (!src || !trans) return trans

    // 1. 品牌标记注入检测：译文有但源文没有的品牌词
    // 使用词边界检测，避免子串误匹配（如越南语 "play" 被误判为品牌注入）
    for (const token of brandTokens) {
      // 如果该品牌词在术语库中是合法的（源文和译文都包含），跳过检测
      if (glossaryBrandTokens.has(token)) {
        continue
      }

      // 对于短词（< 4 字符），要求更严格的匹配：必须是独立单词
      // 对于长词，使用词边界 \b 检测
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const wordBoundaryRe = new RegExp(`\\b${escapedToken}\\b`, 'i')

      const transHasBrand = wordBoundaryRe.test(trans)
      let srcHasBrand = wordBoundaryRe.test(src)
      // v7.5.8: 源文可能有词尾变化（如 SSDs vs SSD），导致 \b 不匹配
      // 例如源文 "Gen 5 SSDs" 中 \bssd\b 不匹配（s 紧跟 d），但译文 "Gen 5 SSD" 中匹配
      // → 误判为品牌注入。此处对常见英文词尾做宽松匹配。
      if (!srcHasBrand && transHasBrand) {
        const suffixRe = new RegExp(`\\b${escapedToken}(?:s|es|'s|ing|ed)\\b`, 'i')
        srcHasBrand = suffixRe.test(src)
      }

      if (transHasBrand && !srcHasBrand) {
        // v7.5: 常见英文词品牌（play/silver/gold/diamond/armor）仅在伴随
        // 其他品牌特征（如全大写、后跟 PRO/PLUS/MAX）时才判定注入
        if (COMMON_WORD_BRANDS.has(token)) {
          const isUpperCase = /[A-Z]{2,}/.test(trans.match(wordBoundaryRe)![0])
          const hasBrandContext = /\b(PRO|PLUS|MAX|SERIES|DDR\d|SSD|PCIe)\b/i.test(trans)
          if (!isUpperCase && !hasBrandContext) continue  // 常见词，无品牌语境 → 跳过
        }
        injectedIndices.add(i)
        return src // 回退到源文
      }
    }

    // 2. 规格注入检测：译文匹配但源文不匹配的规格模式
    for (const { re } of specPatterns) {
      const transMatch = re.test(trans)
      const srcMatch = re.test(src)
      if (transMatch && !srcMatch) {
        injectedIndices.add(i)
        return src // 回退到源文
      }
    }

    // 3. 数值规格注入检测：译文有带单位的数字但源文没有
    for (const { re } of measurePatterns) {
      const transMatch = re.test(trans)
      const srcMatch = re.test(src)
      if (transMatch && !srcMatch) {
        injectedIndices.add(i)
        return src // 回退到源文
      }
    }

    return trans
  })

  return { texts: result, injectedIndices }
}

// ============================================================
// 换行保护：校对/翻译后如有多余换行，按原文断行方式还原
// 日语/韩语/英语按词断行，不在词中间插入换行
// ============================================================
export function sanitizeLineBreaks(
  sourceTexts: string[],
  translatedTexts: string[],
): string[] {
  return translatedTexts.map((translated, i) => {
    const source = sourceTexts[i] || ''
    if (!source || !translated) return translated

    const sourceBreaks = (source.match(/\n/g) || []).length
    const translatedBreaks = (translated.match(/\n/g) || []).length

    // 原文没有换行但译文有 → 去掉译文中的多余换行
    if (sourceBreaks === 0 && translatedBreaks > 0) {
      return translated.replace(/\n+/g, ' ')
    }

    // 原文有换行但译文换行过多 → 保留与原文数量一致的换行
    if (translatedBreaks > sourceBreaks * 2) {
      const parts = translated.split('\n')
      // 按原文换行数合并：尽可能保留前面的分段
      const targetParts = Math.max(1, sourceBreaks + 1)
      const merged: string[] = []
      const chunkSize = Math.ceil(parts.length / targetParts)
      for (let j = 0; j < targetParts; j++) {
        const chunk = parts.slice(j * chunkSize, (j + 1) * chunkSize).filter(p => p.trim())
        if (chunk.length > 0) merged.push(chunk.join(' '))
      }
      return merged.join('\n')
    }

    return translated
  })
}

// ============================================================
// 数字校验：检测译文中数字是否与源文一致
// 提取源文和译文中的"数字+单位"组合，如果不一致则标记
// ============================================================

/**
 * 检测译文中数字是否与源文一致
 * 规则：提取源文和译文中的"数字+单位"组合，如果不一致则警告
 * 检查范围：存储容量(TB/GB/MB/KB) + 速度(MB/s, GB/s) + 频率(MHz, GHz)
 * 支持所有20种语言的单位格式
 *
 * ⚠️ v7.3 修复：数字不一致时只警告不回退。
 *   回退到源文会导致用户看到英文原文（比数字错误更严重）。
 *   数字合并（如"3.0 and 4.0"→"3.0和4.0"）是LLM的合理简化。
 *
 * 返回：原文数组（不修改）+ 异常索引集合（仅用于日志）
 */
export function validateNumbers(
  sourceTexts: string[],
  translatedTexts: string[],
): { texts: string[]; mismatchedIndices: Set<number> } {
  const mismatchedIndices = new Set<number>()

  // 提取"数字+单位"组合（支持存储/速度/频率单位）
  const extractNumbers = (text: string): number[] => {
    // 匹配所有语言的单位：
    // - 存储容量: TB, GB, MB, KB, PB (及其带/s的形式)
    // - 速度: MB/s, GB/s, TB/s, MBps, GBps
    // - 频率: MHz, GHz
    // - 多语言单位: 法语(To,Go,Mo), 俄语(ТБ,ГБ,МБ) 等
    const pattern = /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|PB|To|Go|Mo|Ko|Po|ТБ|ГБ|МБ|КБ|MB\/s|GB\/s|TB\/s|MBps|GBps|MHz|GHz)/gi
    const matches = text.match(pattern) || []
    // 提取数字部分（去除千位分隔符）
    return matches.map(m => {
      const numMatch = m.match(/^(\d+(?:[.,]\d+)?)/)
      if (!numMatch) return 0
      // 去除千位分隔符（逗号或点）
      return parseFloat(numMatch[1].replace(/[.,]/g, ''))
    })
  }

  for (let i = 0; i < translatedTexts.length; i++) {
    const source = sourceTexts[i] || ''
    const translated = translatedTexts[i] || ''
    if (!source || !translated) continue

    const sourceNumbers = extractNumbers(source)
    const transNumbers = extractNumbers(translated)

    // 如果没有数字，跳过
    if (sourceNumbers.length === 0) continue

    // 如果数量不一致 → 警告（不回退）
    if (sourceNumbers.length !== transNumbers.length) {
      mismatchedIndices.add(i)
      debugWarn(
        `[validateNumbers] 数字数量不一致（保留译文）：源文${sourceNumbers.length}个 [${sourceNumbers.join(', ')}]，译文${transNumbers.length}个 [${transNumbers.join(', ')}]`,
        { idx: i, source: source.slice(0, 80), translated: translated.slice(0, 80) },
      )
      continue
    }

    // 如果数值不一致 → 警告（不回退）
    let hasValueMismatch = false
    for (let j = 0; j < sourceNumbers.length; j++) {
      if (Math.abs(sourceNumbers[j] - transNumbers[j]) > 0.01) {
        hasValueMismatch = true
        break
      }
    }
    if (hasValueMismatch) {
      mismatchedIndices.add(i)
      debugWarn(
        `[validateNumbers] 数值不一致（保留译文）：源文 [${sourceNumbers.join(', ')}]，译文 [${transNumbers.join(', ')}]`,
        { idx: i, source: source.slice(0, 80), translated: translated.slice(0, 80) },
      )
    }
  }

  // ✅ 始终返回原始译文，不回退
  return { texts: [...translatedTexts], mismatchedIndices }
}
