import { PluginMessage, UIMessage, TextItem, LLMConfig, GlossaryEntry, TranslationCorrection } from '@messages/types'
import { sendMsgToUI } from '@messages/main-sender'
import { STORAGE_KEY_GLOSSARY, STORAGE_KEY_SETTINGS, STORAGE_KEY_ORIGINALS, STORAGE_KEY_TRANSLATION_CACHE, STORAGE_KEY_CORRECTIONS, CORRECTION_THRESHOLD, UI_WIDTH, UI_HEIGHT, MAX_CACHE_SIZE, makeFontKey } from '@lib/constants'
import { collectTextNodes, mergeDuplicates, TraversableNode } from '@lib/text-collector'
import { exportCSV, importCSV } from '@lib/csv-handler'
import { DEFAULT_GLOSSARY_CSV } from '@lib/default-glossary'
import { parseCSVRow } from '@lib/parse-csv'

const originalTexts = new Map<string, string>()

mg.showUI(__html__, { width: UI_WIDTH, height: UI_HEIGHT })

// ============================================================
// 全页扫描
// ============================================================
function scanAllTextNodes(): void {
  const page = mg.document.currentPage
  console.log('[translate] scanAllTextNodes, page:', page.name, 'page.type:', page.type)

  let textNodes = collectTextNodes(page)

  if (textNodes.length === 0) {
    console.log('[translate] page scan returned 0, trying mg.document...')
    const docNodes = collectTextNodes(mg.document)
    console.log('[translate] mg.document scan returned', docNodes.length, 'nodes')
    if (docNodes.length > 0) {
      textNodes = docNodes
    }
  }

  if (textNodes.length === 0) {
    const pageChildren = page.children
    if (pageChildren) {
      console.log('[translate] page has', pageChildren.length, 'direct children')
      for (let i = 0; i < Math.min(pageChildren.length, 10); i++) {
        console.log('[translate]   child[' + i + '] type=' + pageChildren[i].type, 'name=' + pageChildren[i].name)
      }
    } else {
      console.error('[translate] page.children is undefined! page keys:', Object.keys(page))
    }

    sendMsgToUI(PluginMessage.SCAN_RESULT, [])
    sendMsgToUI(PluginMessage.STATUS, '当前页面未找到文本节点（已输出诊断日志，请按 F12 查看控制台）')
    return
  }

  const items = mergeDuplicates(textNodes)
  pruneStaleOriginals(items)
  // 保留遍历顺序（层级从上到下=设计阅读顺序），不按长度排序，以保持上下文关联
  console.log('[translate] final merged items:', items.length)
  sendMsgToUI(PluginMessage.SCAN_RESULT, items)
}

// ============================================================
// 选中扫描
// ============================================================
function scanSelectedTextNodes(): void {
  const selection = mg.document.currentPage.selection
  if (!selection || selection.length === 0) {
    sendMsgToUI(PluginMessage.ERROR, '请先在画布中选中至少一个图层')
    return
  }

  const allTextNodes: TextNode[] = []
  for (let i = 0; i < selection.length; i++) {
    const node = selection[i]
    const found = collectTextNodes(node)
    for (let j = 0; j < found.length; j++) {
      allTextNodes.push(found[j])
    }
  }

  if (allTextNodes.length === 0) {
    sendMsgToUI(PluginMessage.ERROR, '选中的图层中未找到文本节点')
    return
  }

  const items = mergeDuplicates(allTextNodes)
  pruneStaleOriginals(items)
  items.sort(function (a, b) { return b.sourceText.length - a.sourceText.length })
  sendMsgToUI(PluginMessage.SCAN_RESULT, items)
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
  } else {
    const candidates = ['Inter', 'Sarasa Gothic', 'Roboto', 'Arial', 'PingFang SC']
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

  sendMsgToUI(PluginMessage.APPLY_PROGRESS, { current: 0, total })

  const yieldLoop = typeof setTimeout !== 'undefined'
    ? function () { return new Promise<void>(function (r) { setTimeout(r, 0) }) }
    : function () { return Promise.resolve() }

  for (let i = 0; i < itemsWithTranslation.length; i++) {
    const item = itemsWithTranslation[i]
    try {
      for (const nodeId of item.nodeIds) {
        const node = mg.getNodeById<TextNode>(nodeId)
        if (!node) continue

        if (!originalTexts.has(nodeId)) {
          originalTexts.set(nodeId, item.sourceText)
        }

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
        try {
          node.characters = item.translatedText
          textApplied = true
        } catch (e) {
          try {
            node.deleteCharacters(0, node.characters.length)
            node.insertCharacters(0, item.translatedText)
            textApplied = true
          } catch (e2) {
            failed++
            failedNodeIds.push(nodeId)
            console.error('[translate] text set failed for node', nodeId, e2)
          }
        }

        if (textApplied) {
          done++
          try {
            applyTextStyle(node, item)
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
  sendMsgToUI(PluginMessage.APPLY_DONE, { count: done, failed, failedNodeIds })
  mg.notify(msg, { type: failed > 0 ? 'error' : 'success' })
}

// ============================================================
// 撤销
// ============================================================
async function undoAll(): Promise<void> {
  let count = 0
  for (const [nodeId, originalText] of originalTexts) {
    const node = mg.getNodeById<TextNode>(nodeId)
    if (!node) continue
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
  await persistOriginals()
  sendMsgToUI(PluginMessage.UNDO_DONE, { count })
  mg.notify('已恢复 ' + count + ' 条原文', { type: 'success' })
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
      pruned++
    }
  }
  if (pruned > 0) {
    console.log('[translate] pruned', pruned, 'stale original entries')
    persistOriginals()
  }
}

async function persistOriginals(): Promise<void> {
  await mg.clientStorage.setAsync(STORAGE_KEY_ORIGINALS, Array.from(originalTexts.entries()))
}

async function loadOriginals(): Promise<void> {
  const data = await mg.clientStorage.getAsync(STORAGE_KEY_ORIGINALS)
  if (data) {
    originalTexts.clear()
    for (const [k, v] of data) originalTexts.set(k, v)
  }
}

function parseDefaultGlossary(): GlossaryEntry[] {
  const rows = DEFAULT_GLOSSARY_CSV.split('\n')
  if (rows.length < 2) return []
  const headerCells = parseCSVRow(rows[0])
  const langCols: string[] = []
  for (let i = 1; i < headerCells.length; i++) {
    langCols.push(headerCells[i].trim())
  }
  const entries: GlossaryEntry[] = []
  for (let i = 1; i < rows.length; i++) {
    const cells = parseCSVRow(rows[i])
    if (cells.length < 2) continue
    const source = cells[0].trim()
    if (!source) continue
    const translations: Record<string, string> = {}
    for (let j = 0; j < langCols.length; j++) {
      const val = (cells[j + 1] || '').trim()
      if (val) translations[langCols[j]] = val
    }
    entries.push({ source, translations })
  }
  return entries
}

async function loadGlossary(): Promise<GlossaryEntry[]> {
  const fromLocal = await mg.clientStorage.getAsync(STORAGE_KEY_GLOSSARY)
  if (fromLocal && fromLocal.length > 0) return fromLocal

  for (const page of mg.document.children) {
    try {
      const json = (page as BaseNode).getPluginData(STORAGE_KEY_GLOSSARY)
      if (json) {
        const entries = JSON.parse(json)
        await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY, entries)
        return entries
      }
    } catch (_) { /* 页面不支持 PluginData 则跳过 */ }
  }

  // 首次使用：加载内置默认术语库
  const defaults = parseDefaultGlossary()
  if (defaults.length > 0) {
    await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY, defaults)
  }
  return defaults
}

async function saveGlossary(entries: GlossaryEntry[]): Promise<void> {
  await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY, entries)
  // 术语库变更后清除翻译缓存，确保重新翻译使用新术语
  await mg.clientStorage.setAsync(STORAGE_KEY_TRANSLATION_CACHE, {})
  const json = JSON.stringify(entries)
  for (const page of mg.document.children) {
    try {
      (page as BaseNode).setPluginData(STORAGE_KEY_GLOSSARY, json)
    } catch (_) { /* 页面不支持 PluginData 则跳过 */ }
  }
  sendMsgToUI(PluginMessage.GLOSSARY_SAVED)
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

async function loadSettings(): Promise<LLMConfig | null> {
  const fromLocal = await mg.clientStorage.getAsync(STORAGE_KEY_SETTINGS)
  if (fromLocal) return fromLocal

  // 尝试从文档页面 PluginData 中读取（跨客户端同步）
  for (const page of mg.document.children) {
    try {
      const json = (page as BaseNode).getPluginData(STORAGE_KEY_SETTINGS)
      if (json) {
        const config = JSON.parse(json)
        await mg.clientStorage.setAsync(STORAGE_KEY_SETTINGS, config)
        return config
      }
    } catch (_) { /* 页面不支持 PluginData 则跳过 */ }
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
      (page as BaseNode).setPluginData(STORAGE_KEY_SETTINGS, json)
    } catch (_) { /* 页面不支持 PluginData 则跳过 */ }
  }
  sendMsgToUI(PluginMessage.SETTINGS_SAVED)
}

// ============================================================
// 翻译修正记录（用户反馈循环）
// ============================================================
async function loadCorrections(): Promise<TranslationCorrection[]> {
  const data = await mg.clientStorage.getAsync(STORAGE_KEY_CORRECTIONS)
  return data || []
}

async function saveCorrection(correction: TranslationCorrection): Promise<void> {
  const corrections = await loadCorrections()
  corrections.push(correction)

  // 只保留最近 500 条记录
  while (corrections.length > 500) corrections.shift()

  await mg.clientStorage.setAsync(STORAGE_KEY_CORRECTIONS, corrections)

  // 检查同一 source+targetLang 被修正的次数
  const sameSource = corrections.filter(
    c => c.source === correction.source && c.targetLang === correction.targetLang
  )
  if (sameSource.length >= CORRECTION_THRESHOLD) {
    sendMsgToUI(PluginMessage.CORRECTION_SUGGESTION, {
      source: correction.source,
      targetLang: correction.targetLang,
      correctedTranslation: correction.correctedTranslation,
      count: sameSource.length,
    })
  }
}

// ============================================================
// 消息路由
// ============================================================
type UIMessageEvent = { type?: UIMessage; data?: unknown; pluginMessage?: { type: UIMessage; data: unknown } }

mg.ui.onmessage = async function (msg: UIMessageEvent) {
  console.log('[translate] onmessage raw msg:', JSON.stringify(msg))

  let type = msg.type
  let data: unknown = msg.data
  if (!type && msg.pluginMessage) {
    console.log('[translate] trying pluginMessage wrapper')
    type = msg.pluginMessage.type
    data = msg.pluginMessage.data
  }

  console.log('[translate] onmessage type:', type)

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
    case UIMessage.UNDO_ALL:
      await undoAll()
      break
    case UIMessage.LOAD_GLOSSARY:
      sendMsgToUI(PluginMessage.GLOSSARY_LOADED, await loadGlossary())
      break
    case UIMessage.SAVE_GLOSSARY:
      await saveGlossary(data as GlossaryEntry[])
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
    case UIMessage.LOAD_CORRECTIONS:
      sendMsgToUI(PluginMessage.CORRECTIONS_LOADED, await loadCorrections())
      break
    case UIMessage.SAVE_CORRECTION:
      await saveCorrection(data as TranslationCorrection)
      sendMsgToUI(PluginMessage.CORRECTION_SAVED)
      break
    case UIMessage.NOTIFY:
      mg.notify(data.message, { type: data.type || 'normal' })
      break
  }
}

loadOriginals()
