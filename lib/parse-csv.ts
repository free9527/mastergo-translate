// CSV 换行占位符：导出时把 \n 转义为 ↵（U+21B5），保证一条记录只占一物理行，
// Excel 打开后「原文」「译文」严格一列对一列；导入时自动还原。
export const CSV_NEWLINE_PLACEHOLDER = '↵'

/**
 * 导出单元格编码：RFC 4180 引号转义 + 换行占位符。
 * 含真实换行的文本会被压缩成一行显示（↵ 形象提示），避免 Excel 按行分割后列错位。
 */
export function csvEncodeCell(value: string): string {
  // 换行转义为占位符（先处理 \r\n，再处理单独 \n / \r）
  let v = value.replace(/\r\n/g, CSV_NEWLINE_PLACEHOLDER)
               .replace(/\n/g, CSV_NEWLINE_PLACEHOLDER)
               .replace(/\r/g, CSV_NEWLINE_PLACEHOLDER)
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return '"' + v.replace(/"/g, '""') + '"'
  }
  return v
}

/**
 * 导入单元格解码：把 ↵ 还原回真实换行。
 * 用户人工翻译时直接保留 ↵ 或在 Excel 里按 Alt+Enter 换行均可识别。
 */
export function csvDecodeCell(value: string): string {
  return value.split(CSV_NEWLINE_PLACEHOLDER).join('\n')
}

// 纯 CSV 行解析 — 无 mg 依赖，UI 和主线程可共用
export function parseCSVRow(row: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const ch = row.charAt(i)
    if (ch === '"') {
      if (inQuotes && row.charAt(i + 1) === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

/**
 * 解析完整 CSV 文本为记录数组（每条记录 = 一行数据，支持跨行引号字段）。
 *
 * 与 parseCSVRow 的区别：parseCSVRow 只能解析单行，遇到引号内真实换行会切碎；
 * 本函数按 RFC 4180 扫描整个文本，把引号内的换行保留在字段内，保证
「一条记录 = 一条逻辑行」。
 *
 * 返回：字符串数组的数组（每行是一个字段数组）。
 */
export function parseCSVRecords(text: string): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (ch === '"') {
      if (inQuotes && text.charAt(i + 1) === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(current)
      current = ''
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // 行结束：吞掉 \r\n 组合
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++
      row.push(current)
      records.push(row)
      row = []
      current = ''
    } else {
      current += ch
    }
  }
  // 最后一行（无换行结尾的情况）
  if (current.length > 0 || row.length > 0) {
    row.push(current)
    records.push(row)
  }
  return records
}

// ═══════════════════════════════════════════════════════════════
// 术语库 CSV（v11.14：与翻译 CSV 同套原语——修 split('\n') 碎行雷）
// ═══════════════════════════════════════════════════════════════

export interface GlossaryCSVEntry {
  source: string
  translations: Record<string, string>
}

/**
 * 解析术语库 CSV（产品名/专属共用）。
 * v11.14 前：split('\n') + parseCSVRow——单元格内真实换行（Excel Alt+Enter）会把
 * 一条记录切成多个碎片条目；从翻译导出复制的 ↵ 占位符不还原（字面残留）。
 * 现与翻译 CSV 导入（csv-handler importCSV）同套 parseCSVRecords + csvDecodeCell。
 *
 * @param validLangCodes 有效语言代码集合（列名白名单）
 */
export function parseGlossaryCSVText(text: string, validLangCodes: Set<string>): GlossaryCSVEntry[] {
  const rows = parseCSVRecords(text.replace(/^﻿/, '').trim())
  if (rows.length === 0) return []
  const headerCells = rows[0]
  // 跳过旧版元数据列（兼容旧 CSV 格式）
  const skipCols = new Set([
    headerCells.findIndex(h => h.trim() === '处理方式'),
    headerCells.findIndex(h => h.trim() === '术语分类'),
    headerCells.findIndex(h => h.trim() === '产品线'),
    headerCells.findIndex(h => h.trim() === '术语类型'),
  ].filter(i => i >= 0))
  const langCols: string[] = []
  const dataCols: number[] = []
  for (let i = 1; i < headerCells.length; i++) {
    if (skipCols.has(i)) continue
    const colName = headerCells[i].trim()
    if (validLangCodes.has(colName)) {
      dataCols.push(i)
      langCols.push(colName)
    }
  }
  const entries: GlossaryCSVEntry[] = []
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]
    const source = (cells[0] || '').trim()
    if (!source) continue
    const translations: Record<string, string> = {}
    for (let j = 0; j < langCols.length; j++) {
      const val = csvDecodeCell((cells[dataCols[j]] || '').trim())
      if (val) translations[langCols[j]] = val
    }
    entries.push({ source, translations })
  }
  return entries
}

/**
 * 序列化专属术语库为 CSV 文本。
 * v11.14 前：escapeCSVCell 只加引号、单元格内保留字面 \n——Excel 打开即列错位；
 * 现用 csvEncodeCell（换行→↵ 占位符，一条记录恒一物理行，与翻译导出同规约）。
 */
export function serializeGlossaryCSV(entries: GlossaryCSVEntry[], langCodes: string[]): string {
  const header = ['source', ...langCodes].join(',')
  const rows = entries.map(g => {
    const cells = [csvEncodeCell(g.source)]
    for (const code of langCodes) {
      cells.push(csvEncodeCell(g.translations[code] || ''))
    }
    return cells.join(',')
  })
  return [header, ...rows].join('\n')
}
