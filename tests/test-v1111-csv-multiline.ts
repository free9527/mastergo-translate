/**
 * v11.11 CSV 人工兜底多行文本修复测试
 *
 * 背景：扫描导出 CSV 人工翻译再导入批量替换时，原文含换行 \n 会被
 * csvEncodeCell 加引号但仍占多物理行，Excel 打开后「原文」列错位；
 * 导入时 split('\n') 把跨行引号字段切碎，译文对应不上节点。
 *
 * 修复：
 *   1. 导出：\n → ↵（U+21B5），一条记录一物理行，保留换行形象
 *   2. 导入：parseCSVRecords 支持 RFC 4180 跨行引号字段 + ↵ 自动还原 \n
 *   3. UTF-8 BOM 保留（Excel 双击中文不乱码；BOM 在 UI 层 triggerDownload 添加，
 *      导入侧 importCSV 负责剥离——本文件测导入侧剥离）
 */

import { csvEncodeCell, csvDecodeCell, parseCSVRecords } from '../lib/parse-csv'
import { PluginMessage } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ═══ 模拟 mg 环境（csv-handler 依赖） ═══
let lastMessage: { type: string; data: unknown } | null = null
;(globalThis as Record<string, unknown>).mg = {
  document: { currentPage: { name: 'Test Page' } },
  ui: {
    postMessage: (msg: { type: string; data: unknown }) => {
      lastMessage = msg
    },
  },
}

// 在 mg 就位后再加载 csv-handler
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { exportCSV, importCSV } = require('../lib/csv-handler') as typeof import('../lib/csv-handler')

const items = [
  { nodeIds: ['n1'], sourceText: 'Pocket 3 / Pocket 2', translatedText: '' },
  { nodeIds: ['n2'], sourceText: 'Line 1\nLine 2', translatedText: '' },
  { nodeIds: ['n3'], sourceText: 'Say "Hello", World', translatedText: '' },
  { nodeIds: ['n4'], sourceText: '中文多行\n第二行', translatedText: '' },
]

// ═══ A. 导出侧：一物理行一条记录 + ↵ 占位符 ═══
out.push('A. 导出侧')
exportCSV(items as never)
assert(lastMessage?.type === PluginMessage.CSV_EXPORT_READY, 'A1 导出消息类型正确')
const csv = lastMessage?.data as string
// BOM 由 ui/App.vue triggerDownload 在下载时添加；exportCSV payload 必须不带，
// 否则 UI 层再加一次会成双 BOM（导入只剥一层 → 首行首列混入 U+FEFF → 注释行识别失效）
assert(csv.charCodeAt(0) !== 0xFEFF, 'A2 导出 payload 不含 BOM（防 UI 层双写）')

// 每条记录必须是一物理行（无引号内换行）
const physicalLines = csv.split('\n')
const dataLines = physicalLines.filter(l => l.trim() && !l.startsWith('#'))
// 表头 + 4 条数据 = 5 行（统计行以 # 开头被过滤，空行被 trim 过滤）
assert(dataLines.length === 5, 'A3 每条记录占一物理行（无跨行字段）', `got ${dataLines.length} 行: ${JSON.stringify(dataLines)}`)

// 含换行的原文必须含 ↵
const line2 = dataLines.find(l => l.includes('Line 1'))
assert(line2?.includes('↵') === true, 'A4 换行转义为 ↵ 占位符', line2)
assert(line2?.includes('\n') === false, 'A5 导出内容无真实换行（除行尾）')

// ═══ B. 编码/解码单元函数 ═══
out.push('')
out.push('B. 编码/解码单元函数')
assert(csvEncodeCell('a\nb') === 'a↵b', 'B1 换行转义')
assert(csvEncodeCell('a\r\nb') === 'a↵b', 'B2 CRLF 转义')
assert(csvEncodeCell('a,b') === '"a,b"', 'B3 逗号加引号')
assert(csvEncodeCell('a"b') === '"a""b"', 'B4 引号转义')
assert(csvDecodeCell('a↵b') === 'a\nb', 'B5 ↵ 还原换行')
assert(csvDecodeCell('a\nb') === 'a\nb', 'B6 真实换行原样保留（兼容旧格式）')

// ═══ C. parseCSVRecords：RFC 4180 跨行引号字段 ═══
out.push('')
out.push('C. parseCSVRecords 跨行字段')
const multilineCsv = `序号,节点ID,原文,译文,重复
1,n1,"Line 1
Line 2","第一行
第二行",1
2,n2,normal,普通,1`
const records = parseCSVRecords(multilineCsv)
assert(records.length === 3, 'C1 跨行字段被拼回一条记录', `got ${records.length}`)
assert(records[1][2] === 'Line 1\nLine 2', 'C2 原文换行保留', JSON.stringify(records[1][2]))
assert(records[1][3] === '第一行\n第二行', 'C3 译文换行保留', JSON.stringify(records[1][3]))

// ═══ D. 导入侧：完整往返 ═══
out.push('')
out.push('D. 导入侧完整往返')
// 模拟用户填好译文：第 2 条用 ↵ 占位符形态；第 4 条用 Excel Alt+Enter
// 真实换行形态（Excel 保存时跨行字段自动加引号）
const userCsv = `﻿# MasterGo 翻译扫描结果
# 导出时间,2026/8/13 16:00:00
# 页面名称,Test Page

序号,节点ID,原文,译文,重复

1,n1,Pocket 3 / Pocket 2,口袋 3 / 口袋 2,1
2,n2,Line 1↵Line 2,第一行↵第二行,1
3,n3,"Say ""Hello"", World","说「你好」，世界",1
4,n4,中文多行↵第二行,"中文多行
第二行",1

# 原文条目,4
# 总节点数,4`

importCSV(userCsv)
assert(lastMessage?.type === PluginMessage.CSV_IMPORT_DONE, 'D1 导入消息类型正确')
const imported = lastMessage?.data as { nodeIds: string[]; translatedText: string }[]
assert(imported.length === 4, 'D2 4 条全部导入（BOM 已剥离）', `got ${imported.length}`)
assert(imported[1].translatedText === '第一行\n第二行', 'D3 ↵ 还原为真实换行', JSON.stringify(imported[1].translatedText))
assert(imported[3].translatedText === '中文多行\n第二行', 'D4 真实换行（Excel Alt+Enter 带引号）兼容', JSON.stringify(imported[3].translatedText))
assert(imported[2].translatedText === '说「你好」，世界', 'D5 引号转义字段正确还原', JSON.stringify(imported[2].translatedText))

// ═══ E. 边界：空译文 / 缺列 / 无表头 / BOM ═══
out.push('')
out.push('E. 边界')
importCSV('序号,节点ID,原文,译文,重复\n1,n1,src,,1')
assert((lastMessage?.data as unknown[]).length === 0, 'E1 空译文跳过')
importCSV('a,b,c')
assert(lastMessage?.type === PluginMessage.ERROR, 'E2 无表头报错')
importCSV('﻿序号,节点ID,原文,译文,重复\n1,nX,src,tgt,1')
const bomImport = lastMessage?.data as { nodeIds: string[]; translatedText: string }[]
assert(lastMessage?.type === PluginMessage.CSV_IMPORT_DONE && bomImport.length === 1 && bomImport[0].translatedText === 'tgt',
  'E3 BOM 前缀输入正常剥离导入')

out.push('')
out.push('═'.repeat(50))
out.push(`结果：${pass} 通过，${fail} 失败`)
out.push('═'.repeat(50))
require('fs').writeFileSync(__dirname + '/tmp-v1111-test-out.txt', out.join('\n'), 'utf8')
console.log(out.join('\n'))
if (fail > 0) process.exit(1)
