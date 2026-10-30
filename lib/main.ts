import { PluginMessage, UIMessage, TextItem, LLMConfig, GlossaryEntry, TranslationCorrection, PendingReviewTerm } from '@messages/types'
import { sendMsgToUI } from '@messages/main-sender'
import { STORAGE_KEY_GLOSSARY_PRODUCTS, STORAGE_KEY_GLOSSARY_EXCLUSIVE, STORAGE_KEY_SETTINGS, STORAGE_KEY_ORIGINALS, STORAGE_KEY_APPLIED, STORAGE_KEY_TRANSLATION_CACHE, STORAGE_KEY_CORRECTIONS, STORAGE_KEY_PROHIBITED_WHITELIST, STORAGE_KEY_PENDING_REVIEW_TERMS, STORAGE_KEY_UI_LOGS, CORRECTION_THRESHOLD, UI_WIDTH, UI_HEIGHT, MAX_CACHE_SIZE, MAX_SCAN_NODES, GLOSSARY_VERSION, DEFAULT_MODEL, makeFontKey, DEBUG_MODE } from '@lib/constants'
import { collectTextNodes, mergeDuplicates } from '@lib/text-collector'
import { exportCSV, importCSV } from '@lib/csv-handler'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '@lib/default-glossary'
import { loadGlossaryWithMerge, saveGlossaryWithVersion } from '@lib/glossary-store'
import { parseCSVRow } from '@lib/parse-csv'
import { normalizeFontStyle } from '@lib/font-mapper'
import { finalizeForCanvas } from '@lib/post-process'
import { loadHumanCorpus } from '@lib/human-corpus-loader'

// DEBUG 日志辅助函数
const debugLog = (...args: unknown[]) => DEBUG_MODE && console.log(...args)

// v10.3: 主线程日志推送到 UI 诊断缓冲（跨线程可见 — 扫描/应用/撤销等行为不再不可见）
function mainLog(tag: string, message: string): void {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  sendMsgToUI(PluginMessage.MAIN_LOG, {
    time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    tag,
    message,
  })
}

// v12.22: Avenir → HarmonyOS 字重映射移到 @lib/font-mapper（normalizeFontStyle 单一事实源）。
// ® 单格的 style 与整条文本走同一张映射表，避免两处实现漂移（旧表 Light/Bold Italic 不存在致异常被吞）。

const originalTexts = new Map<string, string>()
/** v9.1 #3/#15: 记录每个节点最近一次被插件写入的译文快照。
 *  撤销时三方对比（original/applied/current）：只有 current===applied 的节点才恢复原文，
 *  用户在画布上手改过的节点跳过，避免撤销吞掉用户改动。 */
const appliedTexts = new Map<string, string>()

// ® 符号修复：仅 Avenir 字体的 ® 渲染异常（过大且非上标），统一替换为 HarmonyOS Sans SC。
// 已手动设为 HarmonyOS 的单字符跳过，避免覆盖用户设置。
const REGISTER_FIX_FAMILY = 'HarmonyOS Sans SC'
function fixRegisterSymbolFont(node: TextNode, rawStyle: string, effectiveFamily: string) {
  if (effectiveFamily !== 'Avenir') return
  const text = node.characters
  if (text.indexOf('®') === -1) return
  const effectiveStyle = normalizeFontStyle(effectiveFamily, rawStyle, REGISTER_FIX_FAMILY)
  let idx = -1
  while ((idx = text.indexOf('®', idx + 1)) !== -1) {
    try {
      // 注意：MasterGo 文本节点目前无 getRangeFontName，无法按字符读字体；直接写 ® 区间。
      node.setRangeFontName(idx, idx + 1, {
        family: REGISTER_FIX_FAMILY,
        style: effectiveStyle,
      })
    } catch (_) { /* 单字符字体设置失败不影响整体 */ }
  }
}

mg.showUI(__html__, { width: UI_WIDTH, height: UI_HEIGHT })

// v12.49: 语料库合并日志初始化刷一次（loadCorrections 在翻译中被反复调用，避免刷 N 次）
logCorpusMergeOnce()

// v9.1 #8: 选区变化实时推送，UI 据此禁用"选中对象扫描"（无选区时点击只会报错）
function pushSelectionState(): void {
  const sel = mg.document.currentPage.selection
  sendMsgToUI(PluginMessage.SELECTION_STATE, { count: sel ? sel.length : 0 })
}
mg.on('selectionchange', pushSelectionState)

// ============================================================
// 全页扫描
// ============================================================
function scanAllTextNodes(): void {
  const page = mg.document.currentPage
  debugLog('[translate] scanAllTextNodes, page:', page.name, 'page.type:', page.type)
  mainLog('main:scan', `全页扫描开始（页面: ${page.name}）`)

  const reportProgress = (found: number) => sendMsgToUI(PluginMessage.SCAN_PROGRESS, { found })
  let textNodes = collectTextNodes(page, reportProgress)

  if (textNodes.length === 0) {
    debugLog('[translate] page scan returned 0, trying mg.document...')
    const docNodes = collectTextNodes(mg.document, reportProgress)
    debugLog('[translate] mg.document scan returned', docNodes.length, 'nodes')
    if (docNodes.length > 0) {
      textNodes = docNodes
    }
  }

  // v9.1 #11: 节点数上限 — 超大文档提示用户改用局部扫描，避免长时间无响应
  if (textNodes.length > MAX_SCAN_NODES) {
    mainLog('main:scan', `扫描超上限：${textNodes.length} > ${MAX_SCAN_NODES}，中止`)
    sendMsgToUI(PluginMessage.SCAN_RESULT, { items: [], pageName: page.name, fileName: mg.document.name })
    sendMsgToUI(PluginMessage.ERROR, `本页文本节点过多（${textNodes.length} > ${MAX_SCAN_NODES}），请选中局部对象后使用"选中对象扫描"`)
    return
  }

  if (textNodes.length === 0) {
    const pageChildren = page.children
    if (pageChildren) {
      debugLog('[translate] page has', pageChildren.length, 'direct children')
      for (let i = 0; i < Math.min(pageChildren.length, 10); i++) {
        debugLog('[translate]   child[' + i + '] type=' + pageChildren[i].type, 'name=' + pageChildren[i].name)
      }
    } else {
      console.error('[translate] page.children is undefined! page keys:', Object.keys(page))
    }

    mainLog('main:scan', '扫描结果：0 个文本节点')
    sendMsgToUI(PluginMessage.SCAN_RESULT, { items: [], pageName: page.name, fileName: mg.document.name })
    sendMsgToUI(PluginMessage.STATUS, '当前页面未找到文本节点（已输出诊断日志，请按 F12 查看控制台）')
    return
  }

  // 扫描时保存原始文本，确保撤销时还原的是最原始的设计稿文字。
  // v9.1 #15: 已有快照的节点不覆盖 — 节点当前可能已是译文，覆盖会让"原文"变成译文，撤销失效
  for (const node of textNodes) {
    if (node.characters && !originalTexts.has(node.id)) originalTexts.set(node.id, node.characters)
  }

  const items = mergeDuplicates(textNodes)
  pruneStaleOriginals(items)
  debugLog('[translate] final merged items:', items.length)
  mainLog('main:scan', `扫描完成：${textNodes.length} 节点 → 合并 ${items.length} 条目`)
  sendMsgToUI(PluginMessage.SCAN_RESULT, { items, pageName: page.name, fileName: mg.document.name })
  sendUndoState()
}

// ============================================================
// 选中扫描
// ============================================================
function scanSelectedTextNodes(): void {
  const selection = mg.document.currentPage.selection
  if (!selection || selection.length === 0) {
    mainLog('main:scan', '选中扫描：无选区，中止')
    sendMsgToUI(PluginMessage.ERROR, '请先在画布中选中至少一个图层')
    return
  }

  mainLog('main:scan', `选中扫描开始（${selection.length} 个图层）`)
  const allTextNodes: TextNode[] = []
  const reportProgress = (found: number) => sendMsgToUI(PluginMessage.SCAN_PROGRESS, { found })
  for (let i = 0; i < selection.length; i++) {
    const node = selection[i]
    const found = collectTextNodes(node, reportProgress)
    for (let j = 0; j < found.length; j++) {
      allTextNodes.push(found[j])
    }
  }

  if (allTextNodes.length === 0) {
    mainLog('main:scan', '选中扫描：未找到文本节点')
    sendMsgToUI(PluginMessage.ERROR, '选中的图层中未找到文本节点')
    return
  }

  if (allTextNodes.length > MAX_SCAN_NODES) {
    mainLog('main:scan', `选中扫描超上限：${allTextNodes.length} > ${MAX_SCAN_NODES}，中止`)
    sendMsgToUI(PluginMessage.SCAN_RESULT, { items: [], pageName: mg.document.currentPage.name, fileName: mg.document.name })
    sendMsgToUI(PluginMessage.ERROR, `选中图层文本节点过多（${allTextNodes.length} > ${MAX_SCAN_NODES}），请缩小选中范围`)
    return
  }

  // 扫描时保存原始文本（已有快照不覆盖，理由同全页扫描）
  for (const node of allTextNodes) {
    if (node.characters && !originalTexts.has(node.id)) originalTexts.set(node.id, node.characters)
  }

  const items = mergeDuplicates(allTextNodes)
  pruneStaleOriginals(items)
  mainLog('main:scan', `选中扫描完成：${allTextNodes.length} 节点 → 合并 ${items.length} 条目`)
  const page = mg.document.currentPage
  sendMsgToUI(PluginMessage.SCAN_RESULT, { items, pageName: page.name, fileName: mg.document.name })
  sendUndoState()
}

// ============================================================
// 应用译文
// ============================================================
async function applyTranslations(items: TextItem[]): Promise<void> {
  const itemsWithTranslation = items.filter(function (it) { return it.translatedText })
  const total = itemsWithTranslation.length
  let done = 0
  let failed = 0
  const failedNodeIds: string[] = []

  // 应用耗时观测：此前 apply 段只有「完成」一条日志，45s 静默无法切分。
  // 起点打点 → 与上一条校对/一致性日志的时差 = UI 侧点击延迟 + 消息传递。
  mainLog('main:apply', `应用开始：${total} 条待写入`)

  const fontSet = new Set<string>()

  function applyTextStyle(node: TextNode, item: TextItem) {
    const len = item.translatedText.length
    if (item.targetFontFamily) {
      node.setRangeFontName(0, len, {
        family: item.targetFontFamily,
        style: item.targetFontStyle || 'Regular',
      })
    }
    if (item.targetFontSize > 0) {
      node.setRangeFontSize(0, len, item.targetFontSize)
    }
    if (item.targetLineHeight !== null) {
      node.setRangeLineHeight(0, len, { value: item.targetLineHeight, unit: 'PIXELS' })
    }
    if (item.targetLetterSpacing !== null) {
      node.setRangeLetterSpacing(0, len, { value: item.targetLetterSpacing, unit: 'PIXELS' })
    }
    if (item.targetTextAlign) {
      node.textAlignHorizontal = item.targetTextAlign as TextNode['textAlignHorizontal']
    }
  }

  for (const item of itemsWithTranslation) {
    fontSet.add(makeFontKey(item.fontFamily, item.fontStyle))
    if (item.targetFontFamily) {
      fontSet.add(makeFontKey(item.targetFontFamily, item.targetFontStyle || 'Regular'))
    }
  }
  const availableFonts = await mg.listAvailableFontsAsync()
  const fontMap = new Map(availableFonts.map(f => [makeFontKey(f.fontName.family, f.fontName.style), f]))
  for (const fk of fontSet) {
    const font = fontMap.get(fk)
    if (font) await mg.loadFontAsync(font.fontName)
  }

  // 兜底字体：优先 HarmonyOS Sans SC，给缺字体节点使用，样式沿用原字体
  let fallbackFont: { family: string; style: string } | null = null
  const fallbackFamily = 'HarmonyOS Sans SC'
  const fallbackMatch = availableFonts.find(function (f) {
    return f.fontName.family === fallbackFamily
  })
  if (fallbackMatch) {
    fallbackFont = { family: fallbackFamily, style: fallbackMatch.fontName.style }
    // Avenir ® bug 修复：预加载 HarmonyOS Sans SC 用于替换 ® 字符
    // Avenir 字体的 ® 符号过大且不是上标，需单独用 HarmonyOS Sans SC 渲染
    const registerFixStyles = ['Regular', 'Bold', 'Medium', 'Semibold', 'Italic', 'BoldItalic']
    for (const st of registerFixStyles) {
      const fk = makeFontKey(fallbackFamily, st)
      const f = fontMap.get(fk)
      if (f) await mg.loadFontAsync(f.fontName)
    }
  } else {
    const candidates = ['Avenir', 'Inter', 'Sarasa Gothic', 'Roboto', 'Arial', 'PingFang SC']
    for (const name of candidates) {
      const match = fontMap.get(makeFontKey(name, 'Regular'))
      if (match) { fallbackFont = { family: name, style: 'Regular' }; break }
    }
    if (!fallbackFont && availableFonts.length > 0) {
      fallbackFont = { family: availableFonts[0].fontName.family, style: availableFonts[0].fontName.style }
    }
  }
  if (fallbackFont) {
    await mg.loadFontAsync(fallbackFont as Parameters<typeof mg.loadFontAsync>[0])
  }
  // 字体预加载分界：上一打点到这里的时差 = listAvailableFontsAsync + loadFontAsync 字体加载耗时
  mainLog('main:apply', `字体预加载完成（${fontSet.size} 字体 + 兜底 ${fallbackFont ? fallbackFont.family : '无'}）`)

  sendMsgToUI(PluginMessage.APPLY_PROGRESS, { current: 0, total })

  const yieldLoop = typeof setTimeout !== 'undefined'
    ? function () { return new Promise<void>(function (r) { setTimeout(r, 0) }) }
    : function () { return Promise.resolve() }

  for (let i = 0; i < itemsWithTranslation.length; i++) {
    const item = itemsWithTranslation[i]
    // 译文与源文相同，跳过文本替换；但 ® 字体修复仍要执行（同语言/不翻译场景 Avenir 的 ® 也须修复）
    if (item.translatedText === item.sourceText) {
      const rawStyle = item.targetFontStyle || item.fontStyle || 'Regular'
      const effectiveFamily = item.targetFontFamily || item.fontFamily
      for (const nodeId of item.nodeIds) {
        const node = mg.getNodeById<TextNode>(nodeId)
        if (!node) continue
        try {
          fixRegisterSymbolFont(node, rawStyle, effectiveFamily)
        } catch (e) { /* 单字符字体设置失败不影响整体 */ }
      }
      done++
      continue
    }
    try {
      for (const nodeId of item.nodeIds) {
        const node = mg.getNodeById<TextNode>(nodeId)
        if (!node) continue

        // 缺字体时先挂载兜底字体，否则修改文字会被拒绝
        if (node.hasMissingFont) {
          // 优先用原字体的 style 去找兜底字族的对应 variant
          const origStyle = item.fontStyle || 'Regular'
          const styledFallback = fontMap.get(makeFontKey(fallbackFamily, origStyle))
          const useFallback = styledFallback
            ? { family: fallbackFamily, style: origStyle }
            : fallbackFont
          if (useFallback) {
            try {
              await mg.loadFontAsync(useFallback as Parameters<typeof mg.loadFontAsync>[0])
              node.setRangeFontName(0, node.characters.length, useFallback as Parameters<typeof node.setRangeFontName>[2])
            } catch (e) { /* ignore */ }
          }
          if (node.textStyles && node.textStyles[0] && node.textStyles[0].textStyle) {
            try { await mg.loadFontAsync(node.textStyles[0].textStyle.fontName) } catch (e) { /* ignore */ }
          }
        }

        let textApplied = false
        // v12.36: 写画布前统一过 finalizeForCanvas（↵ 占位符 → 真换行）。
        //   管道内翻译 S5/校对已还原，但润色等路径产物可能残留字面 ↵；
        //   应用是写画布唯一物理出口，在此兜底保证任何上游路径都不会把 ↵ 写上画布（幂等）。
        const finalText = finalizeForCanvas(item.translatedText)
        try {
          node.characters = finalText
          textApplied = true
        } catch (e) {
          try {
            node.deleteCharacters(0, node.characters.length)
            node.insertCharacters(0, finalText)
            textApplied = true
          } catch (e2) {
            failed++
            failedNodeIds.push(nodeId)
            console.error('[translate] text set failed for node', nodeId, e2)
          }
        }

        if (textApplied) {
          done++
          appliedTexts.set(nodeId, finalText)
          try {
            applyTextStyle(node, item)
            fixRegisterSymbolFont(
              node,
              item.targetFontStyle || item.fontStyle || 'Regular',
              item.targetFontFamily || item.fontFamily,
            )
          } catch (styleErr) {
            console.warn('[translate] style apply failed for node', nodeId, styleErr)
          }
        }
      }
    } catch (e) {
      failed += item.nodeIds.length
      for (const nid of item.nodeIds) failedNodeIds.push(nid)
      console.error('[translate] item apply failed', item.nodeIds, e)
    }
    sendMsgToUI(PluginMessage.APPLY_PROGRESS, { current: i + 1, total })
    await yieldLoop()
  }

  await persistOriginals()
  const msg = failed > 0
    ? '已应用 ' + done + ' 处译文，' + failed + ' 处失败'
    : '已应用 ' + done + ' 处译文'
  mainLog('main:apply', `应用译文完成：成功 ${done}，失败 ${failed}`)
  sendMsgToUI(PluginMessage.APPLY_DONE, { count: done, failed, failedNodeIds })
  sendUndoState()
  mg.notify(msg, { type: failed > 0 ? 'error' : 'success' })
}

// ============================================================
// 字体替换（独立操作，不修改文字内容）
// ============================================================

interface FontPayload {
  nodeIds: string[]
  fontFamily: string
  fontStyle: string
  targetFontFamily: string
  targetFontStyle: string
  targetFontSize: number
  targetLineHeight: number | null
  targetLetterSpacing: number | null
  targetTextAlign: string
}

async function applyFontsOnly(payloads: FontPayload[]): Promise<void> {
  const total = payloads.length
  let done = 0
  let failed = 0

  // 1. 收集所有需要加载的目标字体
  const fontSet = new Set<string>()
  for (const p of payloads) {
    if (p.targetFontFamily) {
      fontSet.add(makeFontKey(p.targetFontFamily, p.targetFontStyle || 'Regular'))
    }
  }
  // Avenir ® 修复：预加载 HarmonyOS Sans SC 的常用样式
  // (与 applyTranslations 中的预加载保持一致，避免非 Regular 字重时修复失效)
  const registerFixStyles = ['Regular', 'Bold', 'Medium', 'Semibold', 'Italic', 'BoldItalic']
  for (const st of registerFixStyles) {
    fontSet.add(makeFontKey('HarmonyOS Sans SC', st))
  }

  const availableFonts = await mg.listAvailableFontsAsync()
  const fontMap = new Map(availableFonts.map(f => [makeFontKey(f.fontName.family, f.fontName.style), f]))

  // 2. 批量加载所有字体（在设置文字前完成，避免文字不显示）
  for (const fk of fontSet) {
    const font = fontMap.get(fk)
    if (font) {
      try {
        await mg.loadFontAsync(font.fontName)
      } catch (_) { /* 字体加载失败不阻塞 */ }
    }
  }

  sendMsgToUI(PluginMessage.APPLY_FONTS_PROGRESS, { current: 0, total })

  // 3. 遍历节点，应用字体替换（不修改文字内容）
  for (const p of payloads) {
    for (const nodeId of p.nodeIds) {
      const node = mg.getNodeById<TextNode>(nodeId)
      if (!node) { failed++; continue }

      const textLen = node.characters.length
      if (textLen === 0) { done++; continue }

      try {
        // 处理缺失字体：先加载原字体确保文字正常渲染
        if (node.hasMissingFont && node.textStyles[0]) {
          try { await mg.loadFontAsync(node.textStyles[0].textStyle.fontName) } catch (_) {}
        }

        // 应用目标字体
        if (p.targetFontFamily) {
          node.setRangeFontName(0, textLen, {
            family: p.targetFontFamily,
            style: p.targetFontStyle || 'Regular',
          })
          // ® 符号修复：替换前后任一字体为 Avenir 时执行（Avenir 的 ® 渲染异常），
          // 每次写入前 MasterGo 内部会合并区间，重复写同字符无额外副作用
          fixRegisterSymbolFont(node, p.targetFontStyle || p.fontStyle || 'Regular', p.targetFontFamily)
          fixRegisterSymbolFont(node, p.targetFontStyle || p.fontStyle || 'Regular', p.fontFamily)
        }
        if (p.targetFontSize > 0) {
          node.setRangeFontSize(0, textLen, p.targetFontSize)
        }
        if (p.targetLineHeight !== null) {
          node.setRangeLineHeight(0, textLen, { value: p.targetLineHeight, unit: 'PIXELS' })
        }
        if (p.targetLetterSpacing !== null) {
          node.setRangeLetterSpacing(0, textLen, { value: p.targetLetterSpacing, unit: 'PIXELS' })
        }
        if (p.targetTextAlign) {
          node.textAlignHorizontal = p.targetTextAlign as TextNode['textAlignHorizontal']
        }
        done++
      } catch (e) {
        failed++
        // v12.40: 字体替换失败诊断——补源文+目标字体+错误信息，定位字符集缺失/字体不可用根因
        // （2026-09-29 fr 实机 17/57 失败，ja 零失败，疑拉丁扩展字符在目标字体缺字形）
        const srcPreview = (node.characters || '').slice(0, 40)
        const errMsg = e instanceof Error ? e.message : String(e)
        console.error('[translate] applyFonts failed for node', nodeId,
          `| 目标字体: ${p.targetFontFamily || '(未指定)'} ${p.targetFontStyle || 'Regular'}`,
          `| 源文: "${srcPreview}"`,
          `| 错误: ${errMsg}`)
      }
    }
  }

  mainLog('main:apply', `字体替换完成：成功 ${done}，失败 ${failed}`)
  sendMsgToUI(PluginMessage.APPLY_FONTS_DONE, { count: done, failed })
  mg.notify('字体替换完成：' + done + ' 处' + (failed > 0 ? '，' + failed + ' 处失败' : ''), { type: failed > 0 ? 'error' : 'success' })
}

// ============================================================
// 撤销
// ============================================================
/** 向 UI 同步当前撤销可用性（真相在画布/originalTexts，而非 UI 列表状态） */
function sendUndoState(): void {
  sendMsgToUI(PluginMessage.UNDO_STATE, { canUndo: originalTexts.size > 0, count: originalTexts.size })
}

async function undoAll(): Promise<void> {
  let count = 0
  let skippedModified = 0
  for (const [nodeId, originalText] of originalTexts) {
    const node = mg.getNodeById<TextNode>(nodeId)
    if (!node) continue
    // v9.1 #15: 三方对比 — 用户在画布上手改过的节点（current !== 当时应用的译文）跳过，
    // 避免撤销把用户手动调整的内容吞掉
    const applied = appliedTexts.get(nodeId)
    if (applied !== undefined && node.characters !== applied) {
      skippedModified++
      continue
    }
    if (node.hasMissingFont && node.textStyles[0]) {
      await mg.loadFontAsync(node.textStyles[0].textStyle.fontName)
    }
    try {
      node.characters = originalText
      count++
    } catch (e) {
      try {
        node.deleteCharacters(0, node.characters.length)
        node.insertCharacters(0, originalText)
        count++
      } catch (e2) {
        console.error('[translate] undo failed for node', nodeId, e2)
      }
    }
  }
  originalTexts.clear()
  appliedTexts.clear()
  await persistOriginals()
  mainLog('main:apply', `撤销完成：恢复 ${count} 条原文` + (skippedModified > 0 ? `，跳过 ${skippedModified} 条手动修改` : ''))
  sendMsgToUI(PluginMessage.UNDO_DONE, { count, skipped: skippedModified })
  sendUndoState()
  mg.notify(
    '已恢复 ' + count + ' 条原文' + (skippedModified > 0 ? '，跳过 ' + skippedModified + ' 条手动修改' : ''),
    { type: 'success' },
  )
}

// ============================================================
// 持久化
// ============================================================
function pruneStaleOriginals(items: TextItem[]): void {
  const activeIds = new Set<string>()
  for (const item of items) {
    for (const nid of item.nodeIds) {
      activeIds.add(nid)
    }
  }
  let pruned = 0
  for (const key of originalTexts.keys()) {
    if (!activeIds.has(key)) {
      originalTexts.delete(key)
      appliedTexts.delete(key)
      pruned++
    }
  }
  if (pruned > 0) {
    debugLog('[translate] pruned', pruned, 'stale original entries')
    persistOriginals()
  }
}

async function persistOriginals(): Promise<void> {
  await mg.clientStorage.setAsync(STORAGE_KEY_ORIGINALS, Array.from(originalTexts.entries()))
  await mg.clientStorage.setAsync(STORAGE_KEY_APPLIED, Array.from(appliedTexts.entries()))
}

async function loadOriginals(): Promise<void> {
  const data = await mg.clientStorage.getAsync(STORAGE_KEY_ORIGINALS)
  if (data) {
    originalTexts.clear()
    for (const [k, v] of data) originalTexts.set(k, v)
  }
  const appliedData = await mg.clientStorage.getAsync(STORAGE_KEY_APPLIED)
  if (appliedData) {
    appliedTexts.clear()
    for (const [k, v] of appliedData) appliedTexts.set(k, v)
  }
  sendUndoState()
}

// ============================================================
// 产品名术语库（独立存储）
// ============================================================
function parseDefaultGlossaryProducts(): GlossaryEntry[] {
  return parseCSVToGlossary(DEFAULT_GLOSSARY_PRODUCTS_CSV)
}

async function loadGlossaryProducts(): Promise<GlossaryEntry[]> {
  // Force current defaults on upgrade; each library has its own version stamp.
  return loadGlossaryWithMerge(
    mg.clientStorage,
    STORAGE_KEY_GLOSSARY_PRODUCTS,
    parseDefaultGlossaryProducts,
    GLOSSARY_VERSION,
    () => mainLog('glossary', `术语库已升级覆盖（产品名）：版本 ${GLOSSARY_VERSION}，已清除旧词条与翻译缓存`),
  )
}

async function saveGlossaryProducts(entries: GlossaryEntry[]): Promise<void> {
  await saveGlossaryWithVersion(mg.clientStorage, STORAGE_KEY_GLOSSARY_PRODUCTS, entries, GLOSSARY_VERSION)
  await mg.clientStorage.setAsync(STORAGE_KEY_TRANSLATION_CACHE, {})
  const json = JSON.stringify(entries)
  for (const page of mg.document.children) {
    try {
      asSharedPluginDataPage(page).setSharedPluginData('translate', STORAGE_KEY_GLOSSARY_PRODUCTS, json)
    } catch (_) { /* 页面不支持 SharedPluginData 则跳过 */ }
  }
  sendMsgToUI(PluginMessage.GLOSSARY_PRODUCTS_SAVED)
}

// ============================================================
// 专属术语术语库（独立存储）
// ============================================================
function parseDefaultGlossaryExclusive(): GlossaryEntry[] {
  return parseCSVToGlossary(DEFAULT_GLOSSARY_EXCLUSIVE_CSV)
}

async function loadGlossaryExclusive(): Promise<GlossaryEntry[]> {
  // Force current defaults on upgrade; each library has its own version stamp.
  return loadGlossaryWithMerge(
    mg.clientStorage,
    STORAGE_KEY_GLOSSARY_EXCLUSIVE,
    parseDefaultGlossaryExclusive,
    GLOSSARY_VERSION,
    () => mainLog('glossary', `术语库已升级覆盖（专属）：版本 ${GLOSSARY_VERSION}，已清除旧词条与翻译缓存`),
  )
}

async function saveGlossaryExclusive(entries: GlossaryEntry[]): Promise<void> {
  await saveGlossaryWithVersion(mg.clientStorage, STORAGE_KEY_GLOSSARY_EXCLUSIVE, entries, GLOSSARY_VERSION)
  await mg.clientStorage.setAsync(STORAGE_KEY_TRANSLATION_CACHE, {})
  const json = JSON.stringify(entries)
  for (const page of mg.document.children) {
    try {
      asSharedPluginDataPage(page).setSharedPluginData('translate', STORAGE_KEY_GLOSSARY_EXCLUSIVE, json)
    } catch (_) { /* 页面不支持 SharedPluginData 则跳过 */ }
  }
  sendMsgToUI(PluginMessage.GLOSSARY_EXCLUSIVE_SAVED)
}

// 通用 CSV 解析器
function parseCSVToGlossary(csv: string): GlossaryEntry[] {
  const rows = csv.split('\n')
  if (rows.length < 2) return []
  const headerCells = parseCSVRow(rows[0])

  // 跳过旧版元数据列（兼容旧 CSV 格式），新格式中这些列不存在 → findCol 返回 -1 → 过滤掉
  const findCol = (names: string[]) => headerCells.findIndex((h: string) => {
    const t = h.trim()
    return names.includes(t)
  })
  const skipCols = new Set([
    findCol(['处理方式', 'action']),
    findCol(['术语分类', 'category']),
    findCol(['产品线', 'productLine']),
    findCol(['术语类型', 'termType']),
  ].filter(i => i >= 0))

  // 语言列：跳过 source 和旧元数据列
  const langCols: string[] = []
  const colPositions: number[] = []
  for (let i = 1; i < headerCells.length; i++) {
    if (skipCols.has(i)) continue
    colPositions.push(i)
    langCols.push(headerCells[i].trim())
  }

  const entries: GlossaryEntry[] = []
  for (let i = 1; i < rows.length; i++) {
    const cells = parseCSVRow(rows[i])
    if (cells.length < 2) continue
    const source = cells[0].trim()
    if (!source) continue

    const translations: Record<string, string> = {}
    for (let j = 0; j < colPositions.length; j++) {
      const val = (cells[colPositions[j]] || '').trim()
      if (val) translations[langCols[j]] = val
    }

    entries.push({ source, translations })
  }
  return entries
}

async function loadTranslationCache(): Promise<Record<string, string>> {
  const cache = await mg.clientStorage.getAsync(STORAGE_KEY_TRANSLATION_CACHE)
  return cache || {}
}

async function saveTranslationCache(cache: Record<string, string>): Promise<void> {
  const keys = Object.keys(cache)
  if (keys.length > MAX_CACHE_SIZE) {
    const pruned: Record<string, string> = {}
    for (const k of keys.slice(-MAX_CACHE_SIZE)) {
      pruned[k] = cache[k]
    }
    cache = pruned
  }
  await mg.clientStorage.setAsync(STORAGE_KEY_TRANSLATION_CACHE, cache)
}

// ============================================================
// v10.3: UI 诊断日志持久化（clientStorage 唯一持有者在主线程）
// ============================================================
interface PersistedLogEntry { time: string; tag: string; message: string }
const MAX_PERSISTED_LOGS = 500

async function saveUiLogs(entries: PersistedLogEntry[]): Promise<void> {
  try {
    const trimmed = entries.length > MAX_PERSISTED_LOGS ? entries.slice(-MAX_PERSISTED_LOGS) : entries
    await mg.clientStorage.setAsync(STORAGE_KEY_UI_LOGS, trimmed)
  } catch (e) {
    // 日志持久化失败不阻塞主流程
    debugLog('[translate] saveUiLogs failed', e)
  }
}

async function loadUiLogs(): Promise<PersistedLogEntry[]> {
  try {
    const data = await mg.clientStorage.getAsync(STORAGE_KEY_UI_LOGS)
    return Array.isArray(data) ? data : []
  } catch (e) {
    debugLog('[translate] loadUiLogs failed', e)
    return []
  }
}

// v12.60: 默认模型一次性升级迁移——旧默认模型(gpt-5.5/gpt-4o/空) → DEFAULT_MODEL。
//   只迁移「还在旧默认值上」的用户：手动改过模型的用户不动（尊重个性化）。
function migrateDefaultModel(config: LLMConfig): boolean {
  const LEGACY_DEFAULT_MODELS = ['gpt-5.5', 'gpt-4o', '']
  const m = (config.model || '').trim()
  // 非法模型值（沿用 app 首次启动的缺省回填）→ 直接替换
  let changed = false
  if (LEGACY_DEFAULT_MODELS.includes(m)) {
    config.model = DEFAULT_MODEL
    changed = true
  }
  if (config.proofreadModel && LEGACY_DEFAULT_MODELS.includes(config.proofreadModel.trim())) {
    config.proofreadModel = DEFAULT_MODEL
    changed = true
  }
  return changed
}

async function loadSettings(): Promise<LLMConfig | null> {
  const fromLocal = await mg.clientStorage.getAsync(STORAGE_KEY_SETTINGS)
  if (fromLocal) {
    // v12.60: 默认模型一次性升级迁移（旧默认值 → DEFAULT_MODEL，改过的不动）
    if (migrateDefaultModel(fromLocal)) {
      await mg.clientStorage.setAsync(STORAGE_KEY_SETTINGS, fromLocal)
      sendMsgToUI(PluginMessage.MODEL_MIGRATED)
    }
    return fromLocal
  }

  // 尝试从文档 SharedPluginData 中读取（跨客户端同步）
  for (const page of mg.document.children) {
    try {
      const json = asSharedPluginDataPage(page).getSharedPluginData('translate', STORAGE_KEY_SETTINGS)
      if (json) {
        const config = JSON.parse(json)
        // v12.60: SharedPluginData 存在的 config 同样走默认模型迁移（与 fromLocal 同源同逻辑）
        if (migrateDefaultModel(config)) {
          sendMsgToUI(PluginMessage.MODEL_MIGRATED)
        }
        await mg.clientStorage.setAsync(STORAGE_KEY_SETTINGS, config)
        return config
      }
    } catch (_) { /* 页面不支持 SharedPluginData 则跳过 */ }
  }
  return null
}

async function saveSettings(config: LLMConfig): Promise<void> {
  await mg.clientStorage.setAsync(STORAGE_KEY_SETTINGS, config)
  // 设置变更后清除翻译缓存，确保使用新模型/api重新翻译
  await mg.clientStorage.setAsync(STORAGE_KEY_TRANSLATION_CACHE, {})
  const json = JSON.stringify(config)
  for (const page of mg.document.children) {
    try {
      asSharedPluginDataPage(page).setSharedPluginData('translate', STORAGE_KEY_SETTINGS, json)
    } catch (_) { /* 页面不支持 SharedPluginData 则跳过 */ }
  }
  sendMsgToUI(PluginMessage.SETTINGS_SAVED)
}

// ============================================================
// 翻译修正记录（用户反馈循环）
// ============================================================
/** v12.52: 只读持久层的用户自身修正（不含语料库合并）——saveCorrection 写回专用，
 *  防止语料库条目被落盘污染持久层（语料库只读动态合并，永不落盘）。 */
async function loadUserCorrectionsRaw(): Promise<TranslationCorrection[]> {
  const data = await mg.clientStorage.getAsync(STORAGE_KEY_CORRECTIONS)
  return (Array.isArray(data) ? data : []) as TranslationCorrection[]
}

async function loadCorrections(): Promise<TranslationCorrection[]> {
  const userCorrections = await loadUserCorrectionsRaw()
  // v12.43: 人工钦定语料库合并——lib/human-corpus-data.ts 内联的 20 语种人工钦定译文，
  //   作为 origin='user' 人工验收源并入 TM 数据源（与用户手动验收同级——
  //   都是人工背书的质量锚点）。静态 import（main 构建是 UMD 单文件，动态 import 会触发 code-splitting 报错）。
  try {
    const corpus = loadHumanCorpus()
    if (corpus.length > 0) {
      // 去重：语料库与用户手动验收重叠时，用户手动验收优先（后到者胜——用户是最新意图）
      const userKeys = new Set(userCorrections.map(c => `${c.source}|||${c.targetLang}`))
      const dedupedCorpus = corpus.filter(c => !userKeys.has(`${c.source}|||${c.targetLang}`))
      const merged = [...dedupedCorpus, ...userCorrections]
      return merged
    }
  } catch (e) {
    // 语料库加载失败静默降级（管道仍走 LLM 正常路径）
    console.warn('[main] v12.43 语料库加载失败（静默降级）:', e instanceof Error ? e.message : String(e))
  }
  return userCorrections
}

// v12.49: 语料库合并日志只在插件初始化时刷一次（loadCorrections 在翻译流程中被反复调用——
//   每次 SAVE_CORRECTION → saveCorrection → loadCorrections 都触发，导致一条翻译刷 5+ 次
//   「v12.43 语料库合并」日志淹没诊断视图。改为初始化时单独刷一次，loadCorrections 静默合并）。
async function logCorpusMergeOnce(): Promise<void> {
  try {
    const data = await mg.clientStorage.getAsync(STORAGE_KEY_CORRECTIONS)
    const userCorrections: TranslationCorrection[] = data || []
    const corpus = loadHumanCorpus()
    const userKeys = new Set(userCorrections.map(c => `${c.source}|||${c.targetLang}`))
    const dedupedCorpus = corpus.filter(c => !userKeys.has(`${c.source}|||${c.targetLang}`))
    mainLog('main:init', `v12.43 语料库合并: 语料 ${corpus.length} 条 + 用户验收 ${userCorrections.length} 条（去重后语料 ${dedupedCorpus.length} 条）→ TM 数据源共 ${dedupedCorpus.length + userCorrections.length} 条`)
  } catch (e) {
    console.warn('[main] v12.43 语料库合并日志失败:', e instanceof Error ? e.message : String(e))
  }
}

async function saveCorrection(correction: TranslationCorrection): Promise<void> {
  // v12.52: 只用持久层的用户自身修正（loadUserCorrectionsRaw，含语料库的 loadCorrections
  //   会把 2062 条语料库条目一起截断到 500 条写回 → 语料库污染持久层 + 挤掉用户早期修正）。
  //   持久层存的是用户真实意图，语料库在 loadCorrections 读时动态合并、永不落盘。
  const corrections = await loadUserCorrectionsRaw()
  corrections.push(correction)

  // 只保留最近 500 条记录
  while (corrections.length > 500) corrections.shift()

  await mg.clientStorage.setAsync(STORAGE_KEY_CORRECTIONS, corrections)

  // 检查同一 source+targetLang 被修正的次数
  const sameSource = corrections.filter(
    c => c.source === correction.source && c.targetLang === correction.targetLang
  )
  // v12.6: suppressAutoGlossary 标记的修正（校对来源）只留记录不触发自动入库建议。
  // 红线：自动入库只收用户手动修正——用户意图是入库的唯一合法来源；
  // 校对自动修正量太大（每修一条触发一次），用户反馈「添加到术语库的内容偏多」。
  if (!correction.suppressAutoGlossary && sameSource.length >= CORRECTION_THRESHOLD) {
    sendMsgToUI(PluginMessage.CORRECTION_SUGGESTION, {
      source: correction.source,
      targetLang: correction.targetLang,
      correctedTranslation: correction.correctedTranslation,
      count: sameSource.length,
      // v11.14: 透传来源（用户手改 / 校对自动修正），UI 决定拒绝时是否提示
      origin: correction.origin || 'user',
    })
  }
}

// ============================================================
// 源文违禁词人工合规白名单（v12.21 持久化）
// ============================================================
// v12.20 引入时是会话内 ref<Set>，用户跨会话重开插件需重新点「判定合规」。
// v12.21 落盘 clientStorage：白名单存 cleanKey 字符串列表，主线程持有（clientStorage
// 唯一持有者），UI 经消息读写。语义：用户已人工判定该源文表述合规（审计结论），
// 跨会话仍有效——同一条源文下次扫到仍豁免，不重复打断用户。
async function loadProhibitedWhitelist(): Promise<string[]> {
  const data = await mg.clientStorage.getAsync(STORAGE_KEY_PROHIBITED_WHITELIST)
  return Array.isArray(data) ? data.filter(k => typeof k === 'string') : []
}

async function saveProhibitedWhitelist(keys: string[]): Promise<void> {
  await mg.clientStorage.setAsync(STORAGE_KEY_PROHIBITED_WHITELIST, keys)
}

// ============================================================
// v12.45: 术语待审核池（自动搜集不静默入库，审核后入专属库）
// ============================================================
async function loadPendingReviewTerms(): Promise<PendingReviewTerm[]> {
  const data = await mg.clientStorage.getAsync(STORAGE_KEY_PENDING_REVIEW_TERMS)
  return Array.isArray(data) ? data.filter(t => t && typeof t.source === 'string') : []
}

async function savePendingReviewTerms(terms: PendingReviewTerm[]): Promise<void> {
  await mg.clientStorage.setAsync(STORAGE_KEY_PENDING_REVIEW_TERMS, terms)
}

// ============================================================
// 消息路由
// ============================================================
type UIMessageEvent = { type?: UIMessage; data?: unknown; pluginMessage?: { type: UIMessage; data: unknown } }

type NotifyPayload = { message: string; type?: 'normal' | 'highlight' | 'error' | 'warning' | 'success' }
type SharedPluginDataPage = PageNode & Pick<BaseNodeMixin, 'getSharedPluginData' | 'setSharedPluginData'>

function asSharedPluginDataPage(page: PageNode): SharedPluginDataPage {
  return page as SharedPluginDataPage
}

function isNotifyPayload(value: unknown): value is NotifyPayload {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { message?: unknown }).message === 'string'
}

mg.ui.onmessage = async function (msg: UIMessageEvent) {
  debugLog('[translate] onmessage raw msg:', JSON.stringify(msg))

  let type = msg.type
  let data: unknown = msg.data
  if (!type && msg.pluginMessage) {
    debugLog('[translate] trying pluginMessage wrapper')
    type = msg.pluginMessage.type
    data = msg.pluginMessage.data
  }

  debugLog('[translate] onmessage type:', type)

  switch (type) {
    case UIMessage.SCAN_ALL:
      scanAllTextNodes()
      break
    case UIMessage.SCAN_SELECTION:
      scanSelectedTextNodes()
      break
    case UIMessage.APPLY_TRANSLATIONS:
      try {
        await applyTranslations(data as TextItem[])
      } catch (e) {
        console.error('[translate] applyTranslations crashed', e)
        sendMsgToUI(PluginMessage.APPLY_DONE, { count: 0, failed: 0, failedNodeIds: [] })
        sendMsgToUI(PluginMessage.ERROR, '应用译文时出错: ' + (e instanceof Error ? e.message : String(e)))
      }
      break
    case UIMessage.APPLY_SINGLE:
      try {
        await applyTranslations(data as TextItem[])
      } catch (e) {
        console.error('[translate] applySingle crashed', e)
        sendMsgToUI(PluginMessage.APPLY_DONE, { count: 0, failed: 0, failedNodeIds: [] })
      }
      break
    case UIMessage.APPLY_FONTS:
      try {
        await applyFontsOnly(data as FontPayload[])
      } catch (e) {
        console.error('[translate] applyFonts crashed', e)
        sendMsgToUI(PluginMessage.APPLY_FONTS_DONE, { count: 0, failed: 0 })
        sendMsgToUI(PluginMessage.ERROR, '替换字体时出错: ' + (e instanceof Error ? e.message : String(e)))
      }
      break
    case UIMessage.UNDO_ALL:
      await undoAll()
      break
    case UIMessage.LOAD_GLOSSARY_PRODUCTS:
      sendMsgToUI(PluginMessage.GLOSSARY_PRODUCTS_LOADED, await loadGlossaryProducts())
      break
    case UIMessage.SAVE_GLOSSARY_PRODUCTS:
      await saveGlossaryProducts(data as GlossaryEntry[])
      break
    case UIMessage.LOAD_GLOSSARY_EXCLUSIVE:
      sendMsgToUI(PluginMessage.GLOSSARY_EXCLUSIVE_LOADED, await loadGlossaryExclusive())
      break
    case UIMessage.SAVE_GLOSSARY_EXCLUSIVE:
      await saveGlossaryExclusive(data as GlossaryEntry[])
      break
    case UIMessage.LOAD_SETTINGS:
      sendMsgToUI(PluginMessage.SETTINGS_LOADED, await loadSettings())
      break
    case UIMessage.SAVE_SETTINGS:
      try {
        await saveSettings(data as LLMConfig)
      } catch (e) {
        sendMsgToUI(PluginMessage.ERROR, '保存配置失败: ' + (e instanceof Error ? e.message : String(e)))
      }
      break
    case UIMessage.EXPORT_CSV:
      exportCSV(data as TextItem[])
      break
    case UIMessage.IMPORT_CSV:
      importCSV(data as string)
      break
    case UIMessage.LOAD_FONTS:
      try {
        const fonts = await mg.listAvailableFontsAsync()
        const list = fonts.map(function (f) { return { family: f.fontName.family, style: f.fontName.style } })
        sendMsgToUI(PluginMessage.FONTS_LOADED, list)
      } catch (e) {
        sendMsgToUI(PluginMessage.FONTS_LOADED, [])
      }
      break
    case UIMessage.LOAD_TRANSLATION_CACHE:
      sendMsgToUI(PluginMessage.TRANSLATION_CACHE_LOADED, await loadTranslationCache())
      break
    case UIMessage.SAVE_TRANSLATION_CACHE:
      await saveTranslationCache(data as Record<string, string>)
      break
    case UIMessage.SAVE_UI_LOGS:
      await saveUiLogs(data as PersistedLogEntry[])
      break
    case UIMessage.LOAD_UI_LOGS:
      sendMsgToUI(PluginMessage.UI_LOGS_LOADED, await loadUiLogs())
      break
    case UIMessage.LOAD_CORRECTIONS:
      sendMsgToUI(PluginMessage.CORRECTIONS_LOADED, await loadCorrections())
      break
    case UIMessage.SAVE_CORRECTION:
      await saveCorrection(data as TranslationCorrection)
      sendMsgToUI(PluginMessage.CORRECTION_SAVED)
      break
    case UIMessage.LOAD_PROHIBITED_WHITELIST:
      sendMsgToUI(PluginMessage.PROHIBITED_WHITELIST_LOADED, await loadProhibitedWhitelist())
      break
    case UIMessage.SAVE_PROHIBITED_WHITELIST:
      await saveProhibitedWhitelist(data as string[])
      break
    case UIMessage.LOAD_PENDING_REVIEW_TERMS:
      sendMsgToUI(PluginMessage.PENDING_REVIEW_TERMS_LOADED, await loadPendingReviewTerms())
      break
    case UIMessage.SAVE_PENDING_REVIEW_TERMS:
      await savePendingReviewTerms(data as PendingReviewTerm[])
      break
    case UIMessage.NOTIFY:
      if (isNotifyPayload(data)) {
        mg.notify(data.message, { type: data.type || 'normal' })
      }
      break
    case UIMessage.LOCATE_NODE: {
      const nodeId = data as string
      const node = mg.getNodeById<SceneNode>(nodeId)
      if (node) {
        mg.document.currentPage.selection = [node]
        mg.viewport.scrollAndZoomIntoView([node])
      }
      break
    }
  }
}

loadOriginals()
pushSelectionState()
