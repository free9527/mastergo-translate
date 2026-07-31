/**
 * ui-debug-log.ts — 轻量 UI 调试日志收集器（v10.1 创建，v10.3 扩展持久化）
 *
 * 背景：翻译管道诊断依赖 debugWarn（console），但 MasterGo 插件 UI 无开发者工具，
 * 用户拿不到 console 输出，实机 bug 只能靠猜。此模块把诊断信息同时推入
 * 内存环形缓冲，UI「高级 → 诊断日志」面板展示并支持一键复制。
 *
 * v10.3 扩展（日志持久化 + 主线程跨线程可见）：
 *   - 持久化：UI 侧内存缓冲仍是唯一事实源，通过 SAVE_UI_LOGS/LOAD_UI_LOGS 消息
 *     经主线程（clientStorage 唯一持有者）落盘；插件崩溃/刷新后重新加载恢复。
 *   - 跨线程：主线程（main.ts）通过 MAIN_LOG 消息把关键事件推入本缓冲，
 *     扫描/应用/撤销/字体替换等主线程行为不再不可见。
 *
 * 边界：只收集、不判定；主线程不可直接访问本缓冲（线程隔离）。
 */

export interface UiLogEntry {
  /** HH:MM:SS */
  time: string
  /** 来源模块，如 translate / proofread / retry / ui / main */
  tag: string
  message: string
}

const MAX_ENTRIES = 500
const buffer: UiLogEntry[] = []
/** 递增版本号：UI 轮询此值判断是否有新日志（避免深响应式开销） */
let version = 0

function now(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function uiLog(tag: string, message: string): void {
  buffer.push({ time: now(), tag, message })
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  version++
}

/** 读取快照（返回新数组，调用方安全持有） */
export function getUiLogs(): UiLogEntry[] {
  return buffer.slice()
}

export function getUiLogVersion(): number {
  return version
}

export function clearUiLogs(): void {
  buffer.length = 0
  version++
}

/** 导出为可复制文本 */
export function formatUiLogs(): string {
  return buffer.map(e => `[${e.time}] [${e.tag}] ${e.message}`).join('\n')
}

// ============================================================
// v10.3: 持久化与跨线程支持
// ============================================================

/** 主线程推入的日志（tag 已带 main 前缀，不重复打时间戳） */
export function receiveMainLog(entry: UiLogEntry): void {
  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  version++
}

/** 启动时从持久化恢复（合并到内存缓冲头部，当前会话日志在其后追加） */
export function restoreUiLogs(entries: UiLogEntry[]): void {
  if (!Array.isArray(entries) || entries.length === 0) return
  // 持久化的上次会话日志放前面，标记分隔
  buffer.length = 0
  buffer.push({ time: '--:--:--', tag: 'system', message: `── 恢复上次会话日志（${entries.length} 条）──` })
  for (const e of entries) {
    if (e && typeof e.time === 'string' && typeof e.tag === 'string' && typeof e.message === 'string') {
      buffer.push(e)
    }
  }
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  buffer.push({ time: now(), tag: 'system', message: '── 本次会话开始 ──' })
  version++
}

/** 序列化当前缓冲供持久化（排除分隔标记行，只保留真实日志） */
export function serializeUiLogs(): UiLogEntry[] {
  return buffer.filter(e => e.tag !== 'system' || !e.message.startsWith('──'))
}
