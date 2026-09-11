// ═══════════════════════════════════════════════════════════════
// 模块: consistency-check — 跨格一致性探测（v12.17，方案 1 探测版）
// ═══════════════════════════════════════════════════════════════
// 定位: 机翻感四类型之「跨格一致性/重复句式掷骰子」的探测层——
//   同一批译文中，同一英文短语在不同格被翻成不同说法。
//   本模块只做【探测+报告】，零修改（不写译文/不进待确认/不加徽章）。
// 架构（代码管形式，LLM 管语义）:
//   ① 代码提取：全部源文中的重复 2-4 词短语（lowercase 归一、去™、
//      ≥2 个不同格出现才算；纯数字/型号行跳过；上限 10 组防 token 膨胀）
//   ② LLM 判定：一次调用 json_object，判定各格译文中该短语的渲染是否一致
// 红线（探测版纪律）:
//   ⛔ 零修改——判定结果只进 uiLog，不回流任何写回路径
//   ⛔ 零硬锁——判定失败/超时静默跳过（与润色同款哲学）
//   ⛔ 一次调用——短语组数硬上限，不与润色/择优抢 token 预算
//   ⛔ 拉丁源文限定——CJK 源文无词边界形式信号，跳过（有效域声明）
// ═══════════════════════════════════════════════════════════════

import { LLMConfig } from '@messages/types'
import { fetchWithRetry, logUsage } from '@lib/llm-api'
import { uiLog } from '@lib/ui-debug-log'

/** 一致性报告（每组不一致短语一条） */
export interface ConsistencyIssue {
  phrase: string                       // 源文短语（归一化小写形态）
  variants: Array<{ form: string; itemIndices: number[] }>  // 各渲染变体 + 出现的格索引
}

export interface ConsistencyReport {
  groupsTotal: number                  // 重复短语总组数
  issues: ConsistencyIssue[]           // 不一致组（一致组不报告——探测版只报病灶）
}

/** 单格文本 → 词序列（lowercase、去™®©、拉丁词边界；数字 token 保留用于对齐） */
function tokenize(text: string): string[] {
  return text
    .replace(/[™®©]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9À-ɏЀ-ӿ]+/)
    .filter(Boolean)
}

/** 判断 token 是否纯数字（数字 token 不参与短语起点，但可在短语内） */
const NUM_TOKEN_RE = /^\d+$/

/**
 * 从全部源文提取跨格重复短语（2-4 词 n-gram）。
 * 规则：
 *   - 短语起点不能是纯数字 token（"205MB/s read" 不以 205 开头）
 *   - 同一格内重复只记一次（短语在格内自重复不算跨格）
 *   - 只保留出现在 ≥2 个不同格的短语
 *   - 重叠短语取最长（"plug and play" 与 "and play" 同时命中时只报长的）
 * @returns 归一化短语 → 出现的格索引数组（有序去重）
 */
export function extractRepeatedPhrases(
  sources: string[],
  maxGroups = 10,
): Map<string, number[]> {
  // 短语 → 格索引集合
  const hits = new Map<string, Set<number>>()

  for (let idx = 0; idx < sources.length; idx++) {
    const tokens = tokenize(sources[idx])
    if (tokens.length < 2) continue
    const seenInItem = new Set<string>()  // 格内去重
    for (let n = 4; n >= 2; n--) {
      for (let i = 0; i + n <= tokens.length; i++) {
        if (NUM_TOKEN_RE.test(tokens[i])) continue  // 数字不开头
        const gram = tokens.slice(i, i + n).join(' ')
        if (seenInItem.has(gram)) continue
        seenInItem.add(gram)
        if (!hits.has(gram)) hits.set(gram, new Set())
        hits.get(gram)!.add(idx)
      }
    }
  }

  // 只留跨格（≥2 格）
  const crossItem = new Map<string, number[]>()
  for (const [gram, idxSet] of hits) {
    if (idxSet.size >= 2) crossItem.set(gram, [...idxSet].sort((a, b) => a - b))
  }

  // 重叠取最长：一个短语若完全被某个更长短语包含且格集合相同 → 删短的
  const grams = [...crossItem.keys()].sort((a, b) => b.length - a.length)
  const removed = new Set<string>()
  for (let i = 0; i < grams.length; i++) {
    if (removed.has(grams[i])) continue
    for (let j = i + 1; j < grams.length; j++) {
      if (removed.has(grams[j])) continue
      const shorter = grams[j]
      const longer = grams[i]
      if (!longer.includes(shorter)) continue
      const sameItems = crossItem.get(shorter)!.every(x => crossItem.get(longer)!.includes(x))
      if (sameItems) removed.add(shorter)
    }
  }

  // 按出现格数降序（病灶密度高的优先）+ 上限
  const sorted = [...crossItem.entries()]
    .filter(([g]) => !removed.has(g))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxGroups)

  return new Map(sorted)
}

interface ConsistencyApiResult {
  groups: Array<{
    phrase?: string
    consistent?: boolean
    variants?: Array<{ form?: string; items?: number[] }>
  }>
}

/** 平衡括号提取 {"groups":[...]}（v12.0 范式复用） */
function extractGroupsObject(text: string): ConsistencyApiResult | null {
  let searchFrom = 0
  while (true) {
    const keyIdx = text.indexOf('"groups"', searchFrom)
    if (keyIdx < 0) return null
    let braceStart = -1
    for (let k = keyIdx - 1; k >= 0; k--) {
      if (text[k] === '{') { braceStart = k; break }
      if (text[k] === '}') break
    }
    if (braceStart < 0) { searchFrom = keyIdx + 8; continue }
    let depth = 0
    let inStr = false
    let esc = false
    for (let k = braceStart; k < text.length; k++) {
      const c = text[k]
      if (esc) { esc = false; continue }
      if (c === '\\' && inStr) { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          try {
            const obj = JSON.parse(text.slice(braceStart, k + 1))
            if (obj && Array.isArray(obj.groups)) return obj
          } catch { /* 找下一个 */ }
          break
        }
      }
    }
    searchFrom = keyIdx + 8
  }
}

/**
 * 一致性探测主函数：提取重复短语 → LLM 判定渲染一致性 → 返回报告。
 * 任何一步失败（无短语/API 失败/解析失败）→ 返回 null（静默跳过，探测版哲学）。
 *
 * @param sources 本批次全部源文
 * @param translations 与 sources 等长的译文数组
 * @param targetLang 目标语言
 * @param config LLM 配置（复用 proofread 通道，与判定/润色一致）
 */
export async function detectConsistencyIssues(
  sources: string[],
  translations: string[],
  targetLang: string,
  config: LLMConfig,
): Promise<ConsistencyReport | null> {
  const phrases = extractRepeatedPhrases(sources)
  if (phrases.size === 0) return null

  // 组装 user：每组短语列出出现格的源文+译文
  const sections: string[] = []
  const phraseList = [...phrases.entries()]
  for (let g = 0; g < phraseList.length; g++) {
    const [phrase, idxList] = phraseList[g]
    const items = idxList
      .map(i => `  [item ${i + 1}] Source: ${sources[i].replace(/\n/g, ' ↵ ')}\n  [item ${i + 1}] Translation: ${(translations[i] || '').replace(/\n/g, ' ↵ ')}`)
      .join('\n')
    sections.push(`[group ${g + 1}] phrase: "${phrase}"\n${items}`)
  }

  const system = `You are a localization consistency auditor.
You will be given groups of items. Each group shares a repeated English phrase that appears in multiple source texts.
For EACH group, find how the phrase is rendered in EACH item's ${targetLang} translation, then judge whether the renderings are CONSISTENT (same wording for the same phrase) across items.

Output ONLY a valid JSON object:
{"groups":[{"phrase":"<the phrase>","consistent":<true|false>,"variants":[{"form":"<the rendered form as it appears in the translation>","items":[<1-based item numbers using this form>]}]}]}
- Include ALL groups
- consistent=true if the phrase is rendered with the same wording in every item (minor inflection/case differences from grammar requirements count as consistent)
- consistent=false if different wordings are used for the same phrase across items
- variants: list each distinct rendered form and the item numbers where it appears (empty if consistent=true)
- If the phrase does not actually appear in some item's translation (omitted), note it as a variant form "(omitted)"
- Raw JSON only, no markdown code blocks`

  const user = sections.join('\n\n')

  // v12.17: 一致性探测可观测性（裁决调用是否执行/耗时/结果透出——
  //   与 proofreadBatch 三点日志同构：开始/返回/完成）
  const consistencyStart = Date.now()
  uiLog('consistency', `裁决调用开始: ${phrases.size}组短语 → ${targetLang}`)

  let parsed: ConsistencyApiResult | null = null
  try {
    const res = await fetchWithRetry(config.proofreadApiUrl || config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.proofreadApiKey || config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.proofreadModel || config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      // 探测版：零重试零长超时——失败即静默（重试翻倍延迟与 90s 超时是生产翻译的配置，
      //   探测层不配享用：一次失败就跳过本批，下批再来）。
      // v12.19: 15s → 8s——实机 71% 超时率（网关高负载下 15s 全烧穿），探测层
      //   不值得为它等 15 秒；8s 足够覆盖健康网关的 2-12s 响应。
    }, 0, 0, 8000)
    if (res.ok) {
      const resData = res.json as Record<string, unknown> | undefined
      const choices = resData?.choices as Array<{ message?: { content?: string } }> | undefined
      const content = choices?.[0]?.message?.content || res.text || ''
      logUsage('consistency', resData)
      parsed = extractGroupsObject(content)
      uiLog('consistency', `裁决 LLM 返回: ${phrases.size}组, 耗时 ${Date.now() - consistencyStart}ms, 解析 ${parsed ? '成功' : '失败'}`)
    } else {
      uiLog('consistency', `裁决 LLM 失败 (${res.status}): 耗时 ${Date.now() - consistencyStart}ms——静默跳过`)
    }
  } catch (e) {
    uiLog('consistency', `裁决调用异常: ${(e as Error).message.slice(0, 60)}, 耗时 ${Date.now() - consistencyStart}ms——静默跳过`)
    return null  // 探测版哲学：失败静默
  }
  if (!parsed) return null

  // 按提取顺序对齐 LLM 返回（phrase 字符串匹配，防 LLM 改写短语形态）
  const issues: ConsistencyIssue[] = []
  const groupByPhrase = new Map<string, ConsistencyApiResult['groups'][0]>()
  for (const g of parsed.groups) {
    if (g.phrase) groupByPhrase.set(g.phrase.toLowerCase().trim(), g)
  }
  for (const [phrase] of phraseList) {
    const g = groupByPhrase.get(phrase)
    if (!g || g.consistent !== false) continue
    const variants = (g.variants || [])
      .filter(v => v.form && Array.isArray(v.items) && v.items.length > 0)
      .map(v => ({
        form: String(v.form).slice(0, 60),
        itemIndices: v.items!.map(n => n - 1).filter(n => n >= 0 && n < sources.length),
      }))
      .filter(v => v.itemIndices.length > 0)
    if (variants.length >= 2) {
      issues.push({ phrase, variants })
    } else if (variants.length === 1 && variants[0].form !== '(omitted)') {
      // 只有一个变体但 consistent=false（LLM 判不一致却只给了一个形态）——保守不报
      continue
    } else if (variants.length > 0) {
      issues.push({ phrase, variants })
    }
  }

  // v12.17: 裁决完成透出（开始/返回/完成三点闭环——与 proofreadBatch 同构）
  uiLog('consistency', `裁决完成: ${phrases.size}组 → 不一致 ${issues.length}组, 总耗时 ${Date.now() - consistencyStart}ms`)

  return { groupsTotal: phrases.size, issues }
}
