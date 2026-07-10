import { PluginMessage, UIMessage, TextItem, LLMConfig, GlossaryEntry, TranslationCorrection } from '@messages/types'
import { sendMsgToUI } from '@messages/main-sender'
import { STORAGE_KEY_GLOSSARY_VERSION, STORAGE_KEY_GLOSSARY_PRODUCTS, STORAGE_KEY_GLOSSARY_EXCLUSIVE, STORAGE_KEY_SETTINGS, STORAGE_KEY_ORIGINALS, STORAGE_KEY_TRANSLATION_CACHE, STORAGE_KEY_CORRECTIONS, CORRECTION_THRESHOLD, UI_WIDTH, UI_HEIGHT, MAX_CACHE_SIZE, GLOSSARY_VERSION, makeFontKey } from '@lib/constants'
import { collectTextNodes, mergeDuplicates, TraversableNode } from '@lib/text-collector'
import { exportCSV, importCSV } from '@lib/csv-handler'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '@lib/default-glossary'
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

    sendMsgToUI(PluginMessage.SCAN_RESULT, { items: [], pageName: page.name, fileName: mg.document.name })
    sendMsgToUI(PluginMessage.STATUS, '当前页面未找到文本节点（已输出诊断日志，请按 F12 查看控制台）')
    return
  }

  // 扫描时立即保存原始文本，确保撤销时还原的是最原始的设计稿文字
  for (const node of textNodes) {
    if (node.characters) originalTexts.set(node.id, node.characters)
  }

  const items = mergeDuplicates(textNodes)
  pruneStaleOriginals(items)
  console.log('[translate] final merged items:', items.length)
  sendMsgToUI(PluginMessage.SCAN_RESULT, { items, pageName: page.name, fileName: mg.document.name })
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

  // 扫描时立即保存原始文本，确保撤销时还原的是最原始的设计稿文字
  for (const node of allTextNodes) {
    if (node.characters) originalTexts.set(node.id, node.characters)
  }

  const items = mergeDuplicates(allTextNodes)
  pruneStaleOriginals(items)
  const page = mg.document.currentPage
  sendMsgToUI(PluginMessage.SCAN_RESULT, { items, pageName: page.name, fileName: mg.document.name })
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
  // Avenir 字体的 ® 符号渲染异常（过大且非上标），单独替换为 HarmonyOS Sans SC
  function fixAvenirRegisterSymbol(node: TextNode, item: TextItem) {
    const effectiveFamily = item.targetFontFamily || item.fontFamily
    if (effectiveFamily !== 'Avenir') return
    const text = item.translatedText
    const symbol = '®'
    let idx = -1
    const effectiveStyle = item.targetFontStyle || item.fontStyle || 'Regular'
    while ((idx = text.indexOf(symbol, idx + 1)) !== -1) {
      try {
        node.setRangeFontName(idx, idx + 1, {
          family: 'HarmonyOS Sans SC',
          style: effectiveStyle,
        })
      } catch (_) { /* 单字符字体设置失败不影响整体 */ }
    }
  }

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

  sendMsgToUI(PluginMessage.APPLY_PROGRESS, { current: 0, total })

  const yieldLoop = typeof setTimeout !== 'undefined'
    ? function () { return new Promise<void>(function (r) { setTimeout(r, 0) }) }
    : function () { return Promise.resolve() }

  for (let i = 0; i < itemsWithTranslation.length; i++) {
    const item = itemsWithTranslation[i]
    // 译文与源文相同，跳过无意义替换
    if (item.translatedText === item.sourceText) {
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
            fixAvenirRegisterSymbol(node, item)
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
          // ® 符号修复：所有字体替换后都执行，防止 ® 渲染异常（过大/非上标）
          const text = node.characters
          let idx = -1
          while ((idx = text.indexOf('®', idx + 1)) !== -1) {
            try {
              node.setRangeFontName(idx, idx + 1, {
                family: 'HarmonyOS Sans SC',
                style: p.targetFontStyle || p.fontStyle || 'Regular',
              })
            } catch (_) {}
          }
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
        console.error('[translate] applyFonts failed for node', nodeId, e)
      }
    }
  }

  sendMsgToUI(PluginMessage.APPLY_FONTS_DONE, { count: done, failed })
  mg.notify('字体替换完成：' + done + ' 处' + (failed > 0 ? '，' + failed + ' 处失败' : ''), { type: failed > 0 ? 'error' : 'success' })
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

// ============================================================
// 产品名术语库（独立存储）
// ============================================================
function parseDefaultGlossaryProducts(): GlossaryEntry[] {
  return parseCSVToGlossary(DEFAULT_GLOSSARY_PRODUCTS_CSV)
}

async function loadGlossaryProducts(): Promise<GlossaryEntry[]> {
  // 版本检测：内置术语库更新后自动覆盖旧版
  const storedVersion = await mg.clientStorage.getAsync(STORAGE_KEY_GLOSSARY_VERSION)
  if (storedVersion == null || storedVersion < GLOSSARY_VERSION) {
    const defaults = parseDefaultGlossaryProducts()
    if (defaults.length > 0) {
      await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY_PRODUCTS, defaults)
    }
    return defaults
  }

  const fromLocal = await mg.clientStorage.getAsync(STORAGE_KEY_GLOSSARY_PRODUCTS)
  if (fromLocal && fromLocal.length > 0) return fromLocal

  const defaults = parseDefaultGlossaryProducts()
  if (defaults.length > 0) {
    await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY_PRODUCTS, defaults)
  }
  return defaults
}

async function saveGlossaryProducts(entries: GlossaryEntry[]): Promise<void> {
  await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY_PRODUCTS, entries)
  await mg.clientStorage.setAsync(STORAGE_KEY_TRANSLATION_CACHE, {})
  const json = JSON.stringify(entries)
  for (const page of mg.document.children) {
    try {
      (page as BaseNode).setSharedPluginData('translate', STORAGE_KEY_GLOSSARY_PRODUCTS, json)
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
  // 版本检测：内置术语库更新后自动覆盖旧版
  const storedVersion = await mg.clientStorage.getAsync(STORAGE_KEY_GLOSSARY_VERSION)
  if (storedVersion == null || storedVersion < GLOSSARY_VERSION) {
    const defaults = parseDefaultGlossaryExclusive()
    if (defaults.length > 0) {
      await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY_EXCLUSIVE, defaults)
    }
    return defaults
  }

  const fromLocal = await mg.clientStorage.getAsync(STORAGE_KEY_GLOSSARY_EXCLUSIVE)
  if (fromLocal && fromLocal.length > 0) return fromLocal

  const defaults = parseDefaultGlossaryExclusive()
  if (defaults.length > 0) {
    await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY_EXCLUSIVE, defaults)
  }
  return defaults
}

async function saveGlossaryExclusive(entries: GlossaryEntry[]): Promise<void> {
  await mg.clientStorage.setAsync(STORAGE_KEY_GLOSSARY_EXCLUSIVE, entries)
  await mg.clientStorage.setAsync(STORAGE_KEY_TRANSLATION_CACHE, {})
  const json = JSON.stringify(entries)
  for (const page of mg.document.children) {
    try {
      (page as BaseNode).setSharedPluginData('translate', STORAGE_KEY_GLOSSARY_EXCLUSIVE, json)
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

async function loadSettings(): Promise<LLMConfig | null> {
  const fromLocal = await mg.clientStorage.getAsync(STORAGE_KEY_SETTINGS)
  if (fromLocal) return fromLocal

  // 尝试从文档 SharedPluginData 中读取（跨客户端同步）
  for (const page of mg.document.children) {
    try {
      const json = (page as BaseNode).getSharedPluginData('translate', STORAGE_KEY_SETTINGS)
      if (json) {
        const config = JSON.parse(json)
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
      (page as BaseNode).setSharedPluginData('translate', STORAGE_KEY_SETTINGS, json)
    } catch (_) { /* 页面不支持 SharedPluginData 则跳过 */ }
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
