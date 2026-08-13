import { TextItem, PluginMessage } from '@messages/types'
import { sendMsgToUI } from '@messages/main-sender'
import { parseCSVRecords, csvEncodeCell, csvDecodeCell } from '@lib/parse-csv'

export function exportCSV(items: TextItem[]): void {
  const rows: string[][] = []
  rows.push(['# MasterGo 翻译扫描结果'])
  rows.push(['# 导出时间', new Date().toLocaleString()])
  rows.push(['# 页面名称', mg.document.currentPage.name])
  rows.push([])
  rows.push(['序号', '节点ID', '原文', '译文', '重复'])
  rows.push([])

  let idx = 1
  for (const item of items) {
    rows.push([
      String(idx++),
      item.nodeIds.join(' | '),
      item.sourceText,
      item.translatedText || '',
      item.nodeIds.length > 1 ? item.nodeIds.length + '处相同' : '1',
    ])
  }

  rows.push([])
  rows.push(['# 原文条目', String(items.length)])
  rows.push(['# 总节点数', String(items.reduce(function (s, it) { return s + it.nodeIds.length }, 0))])

  const csv = rows
    .map(function (row) {
      return row.map(function (cell) { return csvEncodeCell(cell || '') }).join(',')
    })
    .join('\n')

  sendMsgToUI(PluginMessage.CSV_EXPORT_READY, csv)
}


export function importCSV(csvText: string): void {
  const text = csvText.replace(/^﻿/, '').trim()
  // v11.11: 用 RFC 4180 记录解析替代 split('\n')，支持跨行引号字段（旧格式/Excel Alt+Enter）
  const rows = parseCSVRecords(text)
  const dataRows = rows.filter(function (r) {
    const first = (r[0] || '').trim()
    return first && !first.startsWith('#')
  })
  if (dataRows.length < 2) {
    sendMsgToUI(PluginMessage.ERROR, 'CSV 文件格式不正确')
    return
  }

  const headerIdx = dataRows.findIndex(function (r) {
    return r.some(function (c) { return c.includes('序号') }) && r.some(function (c) { return c.includes('原文') })
  })
  if (headerIdx < 0) {
    sendMsgToUI(PluginMessage.ERROR, '未找到 CSV 表头')
    return
  }

  const result: { nodeIds: string[]; translatedText: string }[] = []
  for (let i = headerIdx + 1; i < dataRows.length; i++) {
    const cells = dataRows[i]
    if (cells.length < 4) continue
    const nodeIdsStr = (cells[1] || '').trim()
    // v11.11: 导入时把 ↵ 占位符还原回真实换行（用户人工翻译时保留 ↵ 或 Excel Alt+Enter 均可）
    const translatedText = csvDecodeCell((cells[3] || '').trim())
    if (!nodeIdsStr || !translatedText) continue
    result.push({
      nodeIds: nodeIdsStr.split(' | ').map(function (s) { return s.trim() }),
      translatedText: translatedText,
    })
  }

  sendMsgToUI(PluginMessage.CSV_IMPORT_DONE, result)
}
