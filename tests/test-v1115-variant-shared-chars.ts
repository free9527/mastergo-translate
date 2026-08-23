/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />
// ============================================================
// v11.15 测试：简繁特征字表同形字「放」「言」清理回归锁
// ============================================================
// 背景（2026-08-18 实机事故）：SIMPLIFIED_ONLY_CHARS / TRADITIONAL_ONLY_CHARS
// 由词片段（'释放'/'釋放'）split('') 建表，漏网同形字「放」「言」混入两表——
// 繁体"釋放/語言/播放/發言"的 放/言 与简体同形，zh-CN→zh-TW 完美译文被判
// 简体残留（漏翻），统一重试→激进→逐句拆分→兜底→最终安全网层层拒收 →
// 误报"翻译失败"。v9.5 曾手工清理 17 个同形字，这两字是漏网残余。
//
// 本测试用行为断言锁回归（不比表内容快照——表会演进，行为不变量才是契约）：
//   A. 含放/言的繁体词在繁体语境中不判简体残留（事故直译）
//   B. 用户实机案例全文免疫
//   C. 真漏翻仍拦（释/釋/语/語 等真区分字仍在表）
//   D. 双向对称：简体句含放/言不判繁体残留
// ============================================================

import { hasSimplifiedOnlyChars, hasTraditionalOnlyChars } from '../lib/llm-api'

let pass = 0
let fail = 0
function out(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('A. 含放/言的繁体词在繁体语境不判简体残留（事故直译）')
// 这些词的简体写法与繁体写法逐字相同（放/言是同形字；釋/語已在句中其他位置提供繁体证据）
out('A1 釋放（繁体句）', !hasSimplifiedOnlyChars('釋放所有性能'))
out('A2 語言（繁体句）', !hasSimplifiedOnlyChars('支援多國語言'))
out('A3 播放（繁体句）', !hasSimplifiedOnlyChars('流暢播放 4K 影片'))
out('A4 發言（繁体句）', !hasSimplifiedOnlyChars('發言人表示'))
// 简体语境含放/言不判繁体残留（双向对称）
out('A5 释放（简体句）', !hasTraditionalOnlyChars('释放全部性能'))
out('A6 语言（简体句）', !hasTraditionalOnlyChars('支持多国语言'))

console.log('B. 用户实机案例：完美 zh-TW 译文免疫')
// 2026-08-18 实机日志原文——此译文被误判漏翻 → 全链重试 → 误报"翻译失败"
const liveCase = '高達 1650MB/s 的高速寫入效能，徹底釋放 Sony 相機的高速連拍潛能。不卡頓、不降速。'
out('B1 实机 TW 译文 hasSimplifiedOnlyChars === false', !hasSimplifiedOnlyChars(liveCase))
out('B2 实机 TW 译文 hasTraditionalOnlyChars === true（确实是繁体）', hasTraditionalOnlyChars(liveCase))

console.log('C. 真漏翻仍拦（真区分字仍在表，防止删过头）')
// 简体残留必须被识别：'释' 是简体专属字
out('C1 简体句"释放索尼相机潜能" → true（释）', hasSimplifiedOnlyChars('释放索尼相机潜能'))
// 繁体残留必须被识别：'釋' 是繁体专属字
out('C2 繁体句"釋放" → true（釋）', hasTraditionalOnlyChars('釋放'))
out('C3 简体"语言" → true（语）', hasSimplifiedOnlyChars('支持多语言切换'))
out('C4 繁体"語言" → true（語）', hasTraditionalOnlyChars('支援多語言切換'))
// 整句简体文案混入繁体目标语境的典型漏翻形态
out('C5 漏翻残留句"让性能全面释放" → true', hasSimplifiedOnlyChars('让性能全面释放'))

console.log('D. 同形字双向不干扰（放/言单独出现不构成任何方向的证据）')
out('D1 纯同形字句"放在桌上"（简体语境）不判简体残留', !hasSimplifiedOnlyChars('放在桌上'))
out('D2 纯同形字句"放在桌上"不判繁体残留', !hasTraditionalOnlyChars('放在桌上'))

console.log(`\nv11.15 测试：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
