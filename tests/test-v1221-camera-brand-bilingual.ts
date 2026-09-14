/**
 * v12.21 相机品牌双语标签漏翻误报根治测试
 *
 * 背景（2026-09-14 实机实锤）：zh-TW 兼容性列表里相机品牌以「佳能 Canon」式
 * 「中文名 英文名」双写单节点出现。术语库把 Canon 当 identity 收，但「佳能 Canon」
 * 整条不是术语库 key → 漏翻检测看到残留拉丁 Canon 误判「漏翻」→ 统一重试加戏成
 * 「佳能 Canon品牌」。修法：isBilingualCameraBrand 识别「中文名+英文名」双语品牌标签
 * （判定归一），命中即 isUntranslatable 豁免、保留原文，不进漏翻检测、不重试。
 *
 * 覆盖：
 *   A. 双语命中：佳能 Canon / Canon 佳能（双向）/ 尼康 Nikon / 富士 FUJIFILM（大小写）
 *   B. 简繁同值：哈苏 Hasselblad（简）/ 哈蘇 Hasselblad（繁）→ 同一拉丁名
 *   C. 红线不误豁免：裸 Canon（非双语）/ 裸佳能（纯 CJK）/ 佳能 Sony（品牌错配）/
 *      佳能 Canon EOS R5（三段）/ 使用佳能 Canon 相机（正文句）
 *   D. isUntranslatable 集成：双语标签返回 true（漏翻检测会跳过）
 */

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { isUntranslatable } from '../lib/llm-api'
import { isBilingualCameraBrand } from '../lib/third-party-models'

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

// ── A. 双语命中 ──
assert(isBilingualCameraBrand('佳能 Canon') === true, 'A1 佳能 Canon 命中')
assert(isBilingualCameraBrand('Canon 佳能') === true, 'A2 Canon 佳能 反向命中')
assert(isBilingualCameraBrand('尼康 Nikon') === true, 'A3 尼康 Nikon 命中')
assert(isBilingualCameraBrand('松下 Panasonic') === true, 'A4 松下 Panasonic 命中')
assert(isBilingualCameraBrand('大疆 DJI') === true, 'A5 大疆 DJI 命中')

// ── B. 简繁同值 ──
assert(isBilingualCameraBrand('哈苏 Hasselblad') === true, 'B1 哈苏 Hasselblad（简）命中')
assert(isBilingualCameraBrand('哈蘇 Hasselblad') === true, 'B2 哈蘇 Hasselblad（繁）命中')
assert(isBilingualCameraBrand('富士 FUJIFILM') === true, 'B3 富士 FUJIFILM（大小写）命中')

// ── C. 红线不误豁免 ──
assert(isBilingualCameraBrand('Canon') === false, 'C1 裸 Canon 不豁免（非双语）')
assert(isBilingualCameraBrand('佳能') === false, 'C2 裸佳能 不豁免（纯 CJK）')
assert(isBilingualCameraBrand('佳能 Sony') === false, 'C3 佳能 Sony 不豁免（品牌错配）')
assert(isBilingualCameraBrand('佳能 Canon EOS R5') === false, 'C4 三段式不豁免（型号上下文）')
assert(isBilingualCameraBrand('使用佳能 Canon 相机') === false, 'C5 正文句不豁免（>2 段）')
assert(isBilingualCameraBrand('') === false, 'C6 空串不豁免')

// ── D. isUntranslatable 集成 ──
assert(isUntranslatable('佳能 Canon') === true, 'D1 佳能 Canon → isUntranslatable true')
assert(isUntranslatable('尼康 Nikon') === true, 'D2 尼康 Nikon → isUntranslatable true')
assert(isUntranslatable('佳能 Sony') === false, 'D3 佳能 Sony → isUntranslatable false（错配不豁免）')

console.log(out.join('\n'))
console.log(`\n${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
