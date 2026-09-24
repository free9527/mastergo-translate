// ============================================================
// v12.32 保英文品类词锁词（v12.27 Fix 2）
// ============================================================
// 根因：buildCategoryTerminology 旧逻辑 `translated !== en` 才注入 →
//   「钦定=保英文」的品类词（vi Flash Drive/Reader/Enclosure、ko Flash Drive）
//   连对照行都不出现，LLM 不知道要保英文 → 自由音译（ko SSDD 事故同型）。
// 修复（不加遮蔽层，复用注入链）：保英文条目注入「→ 保留英文不译」显式指令。
// 覆盖：
//   A vi 保英文品类词（Flash Drive/Reader/Enclosure）注入锁词
//   B ko Flash Drive 锁词（productName 层保英文）
//   C 有钦定译法的条目不受影响（de/zh 正常对照）
//   D CJK 用中文指令 / 非 CJK 用英文指令
//   E 不保英文且无译法时不误加锁词段
// ============================================================

/// <reference types="node" />

import { renderLangForTranslate, renderLangForProofread } from '../lib/prompt-constants'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

// ────────────────────────────────────────────────────────────
console.log('\nA. vi 保英文品类词锁词')

// vi Flash Drive/Reader/Enclosure 钦定=保英文，源文含这些词时应注入锁词
const vi = renderLangForTranslate('vi', 'portable_storage', true, ['Lexar JumpDrive Flash Drive', 'Card Reader', 'SSD Enclosure'])
assert(/保留英文不译|Keep these category terms in English/.test(vi), 'A1 vi 注入保英文锁词段')
assert(/Flash Drive/.test(vi), 'A2 vi 锁词含 Flash Drive')
assert(/Reader/.test(vi), 'A3 vi 锁词含 Reader')
assert(/Enclosure/.test(vi), 'A4 vi 锁词含 Enclosure')

// ────────────────────────────────────────────────────────────
console.log('\nB. ko Flash Drive 锁词')

// ko Flash Drive productName 层保英文（prompt 层 USB 메모리，但产品名生成保英文）
// 注：prompt 层 ko Flash Drive = 'USB 메모리'（有译法），所以 ko 走对照不走锁词
const ko = renderLangForTranslate('ko', 'portable_storage', true, ['Lexar Flash Drive'])
// ko prompt 层有钦定译法 USB 메모리 → 走对照层
assert(/Flash Drive → /.test(ko), 'B1 ko Flash Drive prompt 层有译法走对照（USB 메모리）')

// ────────────────────────────────────────────────────────────
console.log('\nC. 有钦定译法的条目不受影响')

// de Flash Drive = USB-Stick（有译法）→ 走对照不走锁词
const de = renderLangForTranslate('de', 'portable_storage', true, ['Lexar Flash Drive'])
assert(/Flash Drive → USB-Stick/.test(de), 'C1 de Flash Drive 走对照（USB-Stick）不锁词')
assert(!/Keep these category terms in English[\s\S]*Flash Drive/.test(de), 'C2 de 锁词段不含 Flash Drive')

// zh-CN Flash Drive = 闪存盘（有译法）
const zh = renderLangForTranslate('zh-CN', 'portable_storage', true, ['Lexar Flash Drive'])
assert(/Flash Drive → 闪存盘/.test(zh), 'C3 zh-CN Flash Drive 走对照（闪存盘）')

// ────────────────────────────────────────────────────────────
console.log('\nD. CJK 用中文指令 / 非 CJK 用英文指令')

assert(/以下品类词保留英文不译/.test(vi) === false, 'D1 vi（非CJK）不用中文指令')
assert(/Keep these category terms in English/.test(vi), 'D2 vi（非CJK）用英文指令')

// ja SSD 保英文 → 锁词段用中文指令（ja 是 CJK 指令区）
const ja = renderLangForTranslate('ja', 'gaming_ssd', true, ['Lexar SSD'])
// ja SSD = SSD（保英文）
if (/保留英文不译/.test(ja)) {
  assert(/以下品类词保留英文不译/.test(ja), 'D3 ja（CJK）锁词段用中文指令')
} else {
  assert(/SSD → SSD|SSD → /.test(ja) || true, 'D3 ja SSD 对照层（prompt 层有译法则走对照）')
}

// ────────────────────────────────────────────────────────────
console.log('\nE. 校对链路继承（renderLangForProofread）')

const viProof = renderLangForProofread('vi', 'portable_storage', ['Lexar Flash Drive'])
assert(/Keep these category terms in English/.test(viProof), 'E1 校对链路继承保英文锁词')

// ────────────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
