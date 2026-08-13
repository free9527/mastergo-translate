// ============================================================
// 术语库加载合并（v11.9 收口）
// ============================================================
//
// 职责（唯一事实源）：
//   1. 版本升级时「合并升级」——内置默认词条优先，用户自定义词条保留追加
//      （diff 键 = source.trim().toLowerCase()；不再整体覆盖冲掉用户词条）
//   2. 版本戳写回 STORAGE_KEY_GLOSSARY_VERSION（修复 v11.8 及以前的既有 bug：
//      升级分支从不写回版本号 → 每次启动重复走升级分支）
//
// 被 lib/main.ts（插件线程）与 UI 层 save 封装（ui/App.vue）共同委托——
// 保存用户术语库时统一顺手写回版本戳，保证戳与内容永不失配。

import { GlossaryEntry } from '@messages/types'
import { STORAGE_KEY_GLOSSARY_VERSION } from '@lib/constants'

/** clientStorage 最小抽象（插件线程传 mg.clientStorage，测试传内存 mock） */
export interface GlossaryStorage {
  getAsync(key: string): Promise<unknown>
  setAsync(key: string, value: unknown): Promise<void>
}

/** source 归一化键（大小写/首尾空白不敏感） */
function normKey(source: string): string {
  return source.trim().toLowerCase()
}

/**
 * 合并升级：内置默认在前（同 key 覆盖用户旧值），用户自定义词条（默认里没有的）
 * 原样追加在后。返回合并结果与用户自定义条数（供日志）。
 */
export function mergeGlossaryOnUpgrade(
  defaults: GlossaryEntry[],
  stored: GlossaryEntry[],
): { merged: GlossaryEntry[]; customCount: number } {
  const merged = [...defaults]
  const defaultKeys = new Set(defaults.map(d => normKey(d.source)))
  let customCount = 0
  for (const s of stored) {
    if (!defaultKeys.has(normKey(s.source))) {
      merged.push(s)
      customCount++
    }
  }
  return { merged, customCount }
}

/**
 * 术语库加载：版本升级 → 合并升级 + 写回版本戳；否则读存量；
 * 存量为空（首次/被清空）→ 落内置默认 + 写回版本戳。
 *
 * @param storageKey 该库的 clientStorage key
 * @param parseDefaults 内置默认词条解析函数
 * @param version 当前 GLOSSARY_VERSION
 * @param onUpgraded 升级发生时的回调（清翻译缓存/记日志，可选）
 */
export async function loadGlossaryWithMerge(
  storage: GlossaryStorage,
  storageKey: string,
  parseDefaults: () => GlossaryEntry[],
  version: number,
  onUpgraded?: (customCount: number) => void,
): Promise<GlossaryEntry[]> {
  const storedVersion = (await storage.getAsync(STORAGE_KEY_GLOSSARY_VERSION)) as number | null | undefined

  if (storedVersion == null || storedVersion < version) {
    const defaults = parseDefaults()
    const stored = ((await storage.getAsync(storageKey)) as GlossaryEntry[] | null | undefined) || []
    const { merged, customCount } = mergeGlossaryOnUpgrade(defaults, stored)
    await storage.setAsync(storageKey, merged)
    await storage.setAsync(STORAGE_KEY_GLOSSARY_VERSION, version)
    onUpgraded?.(customCount)
    return merged
  }

  const fromLocal = (await storage.getAsync(storageKey)) as GlossaryEntry[] | null | undefined
  if (fromLocal && fromLocal.length > 0) return fromLocal

  const defaults = parseDefaults()
  await storage.setAsync(storageKey, defaults)
  await storage.setAsync(STORAGE_KEY_GLOSSARY_VERSION, version)
  return defaults
}

/**
 * 保存用户术语库并写回版本戳（内容已由用户产生 = 当前版本语义）。
 * 插件线程封装的职责：setAsync + 版本戳；副作用（清缓存/SharedPluginData/消息）留在调用方。
 */
export async function saveGlossaryWithVersion(
  storage: GlossaryStorage,
  storageKey: string,
  entries: GlossaryEntry[],
  version: number,
): Promise<void> {
  await storage.setAsync(storageKey, entries)
  await storage.setAsync(STORAGE_KEY_GLOSSARY_VERSION, version)
}
