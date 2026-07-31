/**
 * ui-debug-log.ts — 轻量 UI 调试日志收集器（v10.1）
 *
 * 背景：翻译管道诊断依赖 debugWarn（console），但 MasterGo 插件 UI 无开发者工具，
 * 用户拿不到 console 输出，实机 bug 只能靠猜。此模块把诊断信息同时推入
 * 内存环形缓冲，UI「高级 → 诊断日志」面板展示并支持一键复制。
 *
 * 边界：只收集、不判定；主线程（main.ts）不可见本缓冲（线程隔离）——
 * 需要跨线程的诊断由 UI 侧对应事件点补记。
 */

export interface UiLogEntry {
  /** HH:MM:SS */
  time: string
  /** 来源模块，如 translate / proofread / retry / ui */
  tag: string
  message: string
}

const MAX_ENTRIES = 300
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
