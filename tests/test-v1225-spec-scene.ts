// ============================================================
// v12.25 规格书场景三件套：best-of-2 跳过双跑 + 假全一致日志 + 数字归一豁免
// ============================================================
// 背景（2026-09-24 规格书实机日志复盘）：
//   一条 D500 双头U盘 6 段产品描述 → ja，烧了 70 秒 / 3 次 API，根因三件套：
//   ① best-of-2 双跑烧了 2 倍 token，但规格书全是数字 → 资格判定 /\d/ 豁免
//      → 择优永远空转。日志却打「两路全一致，免判定」= 假阳性（两路明明不同）。
//   ② detectBrandInjection 的 measurePatterns 用正则比 src/trans 是否都含
//      「数字+单位」——源文 "up to 400MB/s" 被 LLM 正确翻成 ja「最大400MB/s」，
//      「最大」是 up to 的钦定译法，但正则只认「数字+单位」本身，限定词差异
//      导致 srcMatch=false → 误判「LLM 编造规格」→ 整条日文译文回退英文。
//   ③ 回退后译文=源文 → 最终安全网检出漏翻 → 校对把英文重新翻成日文
//      （翻译层白跑 39s，校对层 14s 重翻，总共 3 次 API 的钱 1 次就够）。
//
// 三件套的边界（与既有纪律对齐）：
//   B1 跳过双跑：只动「含数字批次」——营销句（无锁高自由度）不受影响仍双跑。
//   B2 日志：区分「真一致」vs「资格豁免跳过」，纯观测零风险。
//   B3 数字归一豁免：只在「源文译文数字+单位集合相同、仅限定词不同」时豁免，
//      源文真的没该数字/单位时照回退（编造规格红线不破）。
//
// 覆盖：
//   A 限定词数字归一化（normalizeMeasureText）单元行为
//   B detectBrandInjection 数字归一豁免（up to→最大 不误杀）
//   C detectBrandInjection 红线（真编造规格仍回退——豁免不破红线）
//   D best-of-2 批次含数字判定（shouldSkipBestOf2）单元行为
//   E 20 语种限定词表形态（豁免表语种无关安全——未收录语种回退现有行为）
// ============================================================

/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

import { detectBrandInjection, normalizeMeasureText } from '../lib/post-process'
import { shouldSkipBestOf2 } from '../lib/llm-api'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

// ────────────────────────────────────────────────────────────
console.log('\nA. 限定词数字归一化（normalizeMeasureText）单元行为')

// A1: 剥英文限定词 up to
assert(
  normalizeMeasureText('up to 400MB/s') === '400MB/s',
  'A1 剥 "up to" → 400MB/s'
)
// A2: 剥 maximum
assert(
  normalizeMeasureText('maximum read speed 205MB/s') === 'read speed 205MB/s',
  'A2 剥 "maximum" → read speed 205MB/s'
)
// A3: 剥 ja 限定词 最大
assert(
  normalizeMeasureText('最大400MB/s') === '400MB/s',
  'A3 剥 ja「最大」→ 400MB/s'
)
// A4: 剥 ja まで
assert(
  normalizeMeasureText('400MB/sまで') === '400MB/s',
  'A4 剥 ja「まで」→ 400MB/s'
)
// A5: 剥 zh-TW 最高
assert(
  normalizeMeasureText('最高205MB/s') === '205MB/s',
  'A5 剥 zh-TW「最高」→ 205MB/s'
)
// A6: 单位前空格归一
assert(
  normalizeMeasureText('最大1TB 容量') === '1TB 容量',
  'A6 剥「最大」保单位连写 1TB'
)
// A7: 无限定词文本原样（不误伤）
assert(
  normalizeMeasureText('400MB/s transfer') === '400MB/s transfer',
  'A7 无限定词原样保留'
)
// A8: de 限定词 bis zu
assert(
  normalizeMeasureText('bis zu 400MB/s') === '400MB/s',
  'A8 剥 de「bis zu」→ 400MB/s'
)

// ────────────────────────────────────────────────────────────
console.log('\nB. detectBrandInjection 数字归一豁免（up to→最大 不误杀）')

// B1: 核心实机案例——源文 up to 400MB/s，译文 ja 最大400MB/s，不应误判注入
{
  const src = ['Transfer speeds up to 400MB/s. Capacity up to 1TB.']
  const trans = ['転送速度最大400MB/s。容量最大1TB。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 0, 'B1 up to→最大 豁免（不误判注入回退）')
  assert(r.texts[0] === trans[0], 'B1b 译文保留（不回退英文）')
}

// B2: 不同限定词形态——源文 maximum，译文 ja 最大
{
  const src = ['Maximum capacity 2TB.']
  const trans = ['最大容量2TB。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 0, 'B2 maximum→最大 豁免')
}

// B3: de 限定词 bis zu
{
  const src = ['Read speed up to 205MB/s.']
  const trans = ['Lesegeschwindigkeit bis zu 205MB/s.']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 0, 'B3 up to→bis zu 豁免')
}

// B4: 源文本就含「数字+单位」、译文同值——本来就 srcMatch=true，归一化不改变结果
{
  const src = ['Speed 400MB/s.']
  const trans = ['速度400MB/s。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 0, 'B4 本就 srcMatch 的条目不受影响')
}

// ────────────────────────────────────────────────────────────
console.log('\nC. detectBrandInjection 红线（真编造规格仍回退——豁免不破红线）')

// C1: 源文无该速度值，译文编造 5200MB/s → 必须回退（红线）
{
  const src = ['Fast portable SSD.']
  const trans = ['速度5200MB/sのポータブルSSD。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 1, 'C1 编造速度值 5200MB/s 仍回退（红线）')
  assert(r.texts[0] === src[0], 'C1b 回退到英文源文')
}

// C2: 源文是 400MB/s，译文篡改成 800MB/s → 数字不同，必须回退
{
  const src = ['Speed up to 400MB/s.']
  const trans = ['速度最大800MB/s。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 1, 'C2 数字篡改 400→800 仍回退（限定词豁免不覆盖改值）')
}

// C3: 源文无容量，译文编造 8TB → 必须回退
{
  const src = ['Compact design.']
  const trans = ['容量8TBのコンパクト設計。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 1, 'C3 编造容量 8TB 仍回退（红线）')
}

// C4: 限定词豁免只豁免「限定词差异」，不豁免「单位类型不同」——源文速度单位，译文容量单位
{
  const src = ['Speed up to 400MB/s.']
  const trans = ['容量最大400GB。']
  const r = detectBrandInjection(src, trans)
  // 400GB 是容量单位，源文无容量 → 仍回退（速度值豁免不延伸到容量）
  assert(r.injectedIndices.size === 1, 'C4 速度限定词豁免不延伸到容量单位（红线）')
}

// ────────────────────────────────────────────────────────────
console.log('\nD. best-of-2 批次含数字判定（shouldSkipBestOf2）单元行为')

// D1: 含数字批次（规格书特征）→ 跳过双跑
assert(
  shouldSkipBestOf2(['Transfer up to 400MB/s. Capacity 1TB.']) === true,
  'D1 含数字批次 → 跳过双跑'
)
// D2: 纯营销句（无数字）→ 不跳过（仍双跑择优）
assert(
  shouldSkipBestOf2(['Unleash your creativity with blazing speed.']) === false,
  'D2 纯营销句无数字 → 不跳过（双跑保留）'
)
// D3: 混合批次含数字 → 跳过（保守：有数字就跳过，营销句不受影响因为整批跳过双跑）
assert(
  shouldSkipBestOf2(['Unleash creativity.', 'Speed 400MB/s.']) === true,
  'D3 混合批次含数字 → 跳过（整批保守）'
)
// D4: 空批次 → 不跳过
assert(
  shouldSkipBestOf2([]) === false,
  'D4 空批次 → 不跳过'
)

// ────────────────────────────────────────────────────────────
console.log('\nE. 20 语种限定词表形态（豁免语种无关安全）')

// E1: 未收录限定词表的语种（如 fr），源文译文同数字同单位 → 不误杀（归一化对无限定词文本原样）
{
  const src = ['Vitesse 400MB/s.']
  const trans = ['Vitesse 400MB/s.']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 0, 'E1 fr 无限定词差异条目不受影响')
}

// E2: 全角数字+单位（CJK 译文形态）不误伤
{
  const src = ['Capacity up to 1TB.']
  const trans = ['容量最大1TB。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 0, 'E2 CJK 容量限定词豁免')
}

// E3: 限定词表只剥限定词，不动数字本身——数字不同仍回退（跨语种红线）
{
  const src = ['Speed up to 205MB/s.']
  const trans = ['速度最大500MB/s。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 1, 'E3 跨语种数字篡改仍回退')
}

// E4: 单位族归一——速度单位 MB/s 与基础单位 MB 同数值视为对应（v12.25.2 根因实锤锁）
// 源文「400MB/s1」脚标 1 使 MB/s 后 (?!\w) 不成立、回退匹配 MB → 源文记 400|mb；
// 译文 400|mb/s → 旧逻辑数值对不等误判。单位族归一后 mb/s→mb 同源对应。
{
  const src = ['Transfer speeds up to 400MB/s1 are 4X faster.']
  const trans = ['最大400MB/s※1の転送速度は4倍高速。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 0, 'E4 单位族归一（源文脚标致 MB/s 退化为 MB 不误判）')
}

// E5: 单位族归一不豁免数值篡改——400MB/s → 800MB 仍回退（红线）
{
  const src = ['Speed up to 400MB/s1.']
  const trans = ['速度最大800MB。']
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 1, 'E5 单位族归一不豁免数值篡改 400→800（红线）')
}

// E6: 真实源文整段回归（用户提供的 D500 六段文案 + 日志第一路译文）——整段不回退
{
  const src = [`Compact and Cable-Free. With USB A and USB-C connectors, this pocket-friendly storage includes everything you need to quickly free up phone space and transfer your photos, videos, and other files to a computer.
4X Faster than USB 3.02.  Transfer speeds up to 400MB/s1 are 4X faster than USB 3.0 drives2, so you can transfer 2GB in just a few seconds.
Auto-Backup with the Lexar App.  Available for iOS and Android devices3, the Lexar App Photo Backup function is a simple, safe, and secure way to automatically back up and manage your media. The Lexar App works offline to keep your data safe and, best of all, it’s free.
Metal Construction with a Swivel Design.  Designed with a sleek metal housing and a lanyard loop, the Lexar® JumpDrive D500 is built for extreme durability to keep your data safe, wherever you go.
Extra Space When It’s Needed.  Available in capacities up to 1TB to store 300,000+ photos, or 18,000 minutes of HD video4 – and keep your favorite devices ready to capture more.
Dual-Connectors. Wide Compatibility.  Dual USB-A and USB-C connectors offer wide compatibility with multiple generations of USB devices, making it easy to transfer content between a mobile phone, tablet, MacBook, and a desktop computer.
Rigorously Tested. All Lexar products undergo extensive testing in the Lexar Quality Labs, facilities with thousands of different cameras and digital devices to ensure performance, quality, compatibility, and reliability.`]
  const trans = [`コンパクトでケーブル不要。USB-AとUSB-Cコネクタを備えたポケットサイズのストレージで、スマートフォンの空き容量をすばやく確保し、写真、動画、その他のファイルをコンピューターへ簡単に転送できます。
USB 3.0※2の4倍高速。最大400MB/s※1の転送速度はUSB 3.0ドライブ※2の4倍高速で、2GBのデータをわずか数秒で転送できます。
Lexar Appアプリで自動バックアップ。iOSおよびAndroidデバイス※3に対応したLexarアプリの写真バックアップ機能により、メディアをかんたんかつ安全に自動バックアップして管理できます。Lexarアプリはオフラインで動作するためデータを安全に保ち、しかも無料で利用できます。
スイベルデザインのメタル構造。洗練されたメタルハウジングとストラップホールを備えたLexar JumpDrive D500は、どこへ持ち運んでもデータを安全に保てるよう、高い耐久性を備えています。
必要なときに追加の容量を。最大1TBの容量を用意し、30万枚以上の写真、または18,000分のHD動画※4を保存可能。お気に入りのデバイスでさらに撮影できる容量を確保できます。
デュアルコネクタ。幅広い互換性。USB-AとUSB-Cのデュアルコネクタにより、複数世代のUSBデバイスと幅広く互換し、スマートフォン、タブレット、MacBook、デスクトップコンピューター間で簡単にコンテンツを転送できます。
厳格なテスト済み。すべてのLexar製品は、パフォーマンス、品質、互換性、信頼性を確保するため、何千種類ものカメラやデジタルデバイスを備えたLexar品質ラボで広範なテストを受けています。`]
  const r = detectBrandInjection(src, trans)
  assert(r.injectedIndices.size === 0, 'E6 真实源文整段（D500 六段）不回退——v12.25 事故回归锁')
}

// ────────────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
