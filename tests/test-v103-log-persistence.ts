/**
 * v10.3 日志持久化 + 主线程跨线程可见测试
 *
 * 覆盖：
 *   A. ui-debug-log 纯函数（receiveMainLog / restoreUiLogs / serializeUiLogs / 容量环形）
 *   B. 主线程消息流（MAIN_LOG 结构 / SAVE_UI_LOGS / LOAD_UI_LOGS）
 */

import { uiLog, getUiLogs, getUiLogVersion, clearUiLogs, formatUiLogs, receiveMainLog, restoreUiLogs, serializeUiLogs, UiLogEntry } from '../lib/ui-debug-log'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass++
    out.push(`✅ ${name}`)
  } else {
    fail++
    out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function main() {
  out.push('═'.repeat(60))
  out.push('A. ui-debug-log 纯函数')
  out.push('═'.repeat(60))

  // A1: receiveMainLog 入缓冲
  clearUiLogs()
  const before = getUiLogs().length
  receiveMainLog({ time: '12:00:00', tag: 'main:scan', message: '扫描完成' })
  const logs1 = getUiLogs()
  assert(logs1.length === before + 1, 'A1 receiveMainLog 入缓冲')
  assert(logs1[logs1.length - 1].tag === 'main:scan', 'A2 receiveMainLog 保留 tag')
  assert(logs1[logs1.length - 1].time === '12:00:00', 'A3 receiveMainLog 保留时间戳（不重打）')

  // A4-A6: restoreUiLogs 恢复 + 分隔标记
  clearUiLogs()
  const history: UiLogEntry[] = [
    { time: '10:00:00', tag: 'translate', message: '批次开始：5条 → ja' },
    { time: '10:00:05', tag: 'main:scan', message: '扫描完成：12 节点' },
  ]
  restoreUiLogs(history)
  const logs2 = getUiLogs()
  assert(logs2.length === 4, 'A4 restoreUiLogs 恢复 2 条 + 2 个分隔标记', `got ${logs2.length}`)
  assert(logs2[0].tag === 'system' && logs2[0].message.includes('恢复上次会话日志'), 'A5 首行是恢复分隔标记')
  assert(logs2[3].tag === 'system' && logs2[3].message.includes('本次会话开始'), 'A6 末行是本次会话开始标记')

  // A7: restoreUiLogs 后新日志追加在恢复日志之后
  uiLog('translate', '新日志')
  const logs3 = getUiLogs()
  assert(logs3.length === 5 && logs3[4].message === '新日志', 'A7 restore 后新日志追加在末尾')

  // A8-A10: serializeUiLogs 排除分隔标记行
  const serialized = serializeUiLogs()
  assert(serialized.length === 3, 'A8 serializeUiLogs 排除 2 个分隔标记', `got ${serialized.length}`)
  assert(serialized.every(e => !e.message.startsWith('──')), 'A9 序列化结果无分隔行')
  assert(serialized[0].message === '批次开始：5条 → ja', 'A10 序列化保留原始顺序')

  // A11-A12: restoreUiLogs 防御脏数据
  clearUiLogs()
  restoreUiLogs([
    { time: '10:00:00', tag: 'translate', message: '正常' },
    null as unknown as UiLogEntry,
    { time: 123, tag: 'bad', message: 'time 非字符串' } as unknown as UiLogEntry,
  ])
  const logs4 = getUiLogs()
  // 2 分隔标记 + 1 条正常（2 条脏数据被过滤）
  assert(logs4.length === 3, 'A11 restoreUiLogs 过滤脏数据（null / 非字符串字段）', `got ${logs4.length}`)
  assert(logs4[1].message === '正常', 'A12 脏数据被过滤，正常条目保留')

  // A13: 空数组恢复不产生分隔标记
  clearUiLogs()
  restoreUiLogs([])
  assert(getUiLogs().length === 0, 'A13 空数组恢复：无分隔标记')

  // A14-A15: formatUiLogs 格式不变
  clearUiLogs()
  uiLog('translate', '测试消息')
  const formatted = formatUiLogs()
  assert(/^\[\d{2}:\d{2}:\d{2}\] \[translate\] 测试消息$/.test(formatted), 'A14 formatUiLogs 格式 [time] [tag] message', formatted)

  // A16-A17: 容量环形（MAX_ENTRIES=500）
  clearUiLogs()
  for (let i = 0; i < 520; i++) uiLog('test', `msg${i}`)
  const logs5 = getUiLogs()
  assert(logs5.length === 500, 'A16 容量环形截断到 500', `got ${logs5.length}`)
  assert(logs5[0].message === 'msg20', 'A17 最老的 20 条被淘汰，从 msg20 开始')

  // A18: 版本号递增（UI 轮询机制）
  const v1 = getUiLogVersion()
  uiLog('test', 'x')
  assert(getUiLogVersion() > v1, 'A18 版本号随日志递增')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('B. 主线程消息结构（纯逻辑验证，不经 main.ts）')
  out.push('═'.repeat(60))

  // B1-B2: MAIN_LOG 消息 payload 结构（模拟 main.ts mainLog 的输出）
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const mainLogPayload = {
    time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    tag: 'main:scan',
    message: '扫描完成：12 节点 → 合并 8 条目',
  }
  assert(/^\d{2}:\d{2}:\d{2}$/.test(mainLogPayload.time), 'B1 MAIN_LOG 时间戳格式 HH:MM:SS')
  assert(mainLogPayload.tag.startsWith('main:'), 'B2 MAIN_LOG tag 带 main: 前缀')

  // B3: MAIN_LOG 可直接 receiveMainLog 消费（跨线程结构兼容）
  clearUiLogs()
  receiveMainLog(mainLogPayload)
  const logs6 = getUiLogs()
  assert(logs6.length === 1 && logs6[0].message === '扫描完成：12 节点 → 合并 8 条目', 'B3 MAIN_LOG 结构可直接入缓冲')

  // B4: 持久化截断逻辑（模拟 main.ts saveUiLogs 的 MAX_PERSISTED_LOGS=500）
  const MAX_PERSISTED_LOGS = 500
  const bigList = Array.from({ length: 600 }, (_, i) => ({ time: '10:00:00', tag: 't', message: `m${i}` }))
  const trimmed = bigList.length > MAX_PERSISTED_LOGS ? bigList.slice(-MAX_PERSISTED_LOGS) : bigList
  assert(trimmed.length === 500 && trimmed[0].message === 'm100', 'B4 持久化截断保留最新 500 条')

  // B5: 序列化结果 JSON 可克隆（postMessage 兼容，App.vue 用 JSON.parse(JSON.stringify())）
  clearUiLogs()
  uiLog('translate', '含中文和特殊字符 \n 换行')
  const roundTrip = JSON.parse(JSON.stringify(serializeUiLogs()))
  assert(roundTrip.length === 1 && roundTrip[0].message.includes('换行'), 'B5 序列化结果 JSON 克隆往返完整')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v103-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v10.3 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main()
