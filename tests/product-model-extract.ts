// ============================================================
// v12.30: 型号提取回归——lib/product-model-extract.ts vs xlsx 钦定表
// ============================================================
// 回归锁：lib 提取器逐条对照 tests/golden/product-model-extract.json
//   （xlsx《系列名以及产品命名规则》140 行钦定 Model 列）。
// 规则形态说明见 lib/product-model-extract.ts 头注释。
// ============================================================

/// <reference types="node" />

import { readFileSync } from 'fs'
import { join } from 'path'
import { extractProductModel } from '../lib/product-model-extract'

// 直接用相对本文件的路径（__dirname 在 commonjs ts-node 下原生可用）

// ============================================================
// 回归测试：xlsx 140 行钦定 Model 列逐条对照 + Muse 新条目规则符合性
// ============================================================
if (process.argv[1] && process.argv[1].includes('product-model-extract')) {
  const goldenPath = join(__dirname, 'golden', 'product-model-extract.json')
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as { cases: Array<{ source: string; model: string }> }

  let pass = 0
  let fail = 0
  const fails: Array<{ source: string; expected: string; got: string; line: string }> = []
  for (const c of golden.cases) {
    const r = extractProductModel(c.source)
    const got = r ? r.model : '(null)'
    // 归一化比较（大小写/多空格不敏感——xlsx 提取可能有格式微差）
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    if (r && norm(got) === norm(c.model)) {
      pass++
    } else {
      fail++
      fails.push({ source: c.source, expected: c.model, got, line: r?.line || '?' })
    }
  }

  console.log(`\n═══ 型号提取回归（xlsx ${golden.cases.length} 行钦定对照）═══`)
  console.log(`通过 ${pass} / ${golden.cases.length}（${(pass / golden.cases.length * 100).toFixed(1)}%）`)
  if (fails.length > 0) {
    console.log(`\n未命中 ${fails.length} 条（规则盲区，需校准）:`)
    for (const f of fails.slice(0, 40)) {
      console.log(`  [${f.line}] ${f.source}`)
      console.log(`      期望: "${f.expected}"  实得: "${f.got}"`)
    }
  }

  // Muse 规则符合性检查（v12.23 术语库新增条目，不在 xlsx 内）
  // 「Lexar Muse Ultra-Slim Portable SSD」无字母数字代号 → 系列即型号 = Muse（同 Air/Go 类）
  console.log(`\n═══ Muse 新条目规则符合性（用户指令核查）═══`)
  const muse = extractProductModel('Lexar Muse Ultra-Slim Portable SSD')
  const museOk = muse !== null && muse.model === 'Muse'
  console.log(`  Lexar Muse Ultra-Slim Portable SSD → model="${muse?.model}" (line=${muse?.line})`)
  console.log(museOk
    ? '  ✅ 符合规则：无代号 → 系列即型号 = Muse（与 Air/Go/TouchLock 同型），命名合规无需改正'
    : '  ❌ 不符合规则：期望 model="Muse"，需检查')

  if (fail > 0 || !museOk) process.exit(1)
}

// ============================================================
// 产品线闭环推导回归：deriveProductLineFromModel
//   钦定来源：extractProductModel 型号 + 品线 → 8 条产品线
//   （与 PRODUCT_LINE_TONE_GUIDES key 严格对齐）
// ============================================================
if (process.argv[1] && process.argv[1].includes('product-model-extract')) {
  const { deriveProductLineFromModel } = require('../lib/product-model-extract')
  const cases: Array<{ src: string; expected: string | null }> = [
    // 内存
    { src: 'Lexar ARES DDR5 OC Desktop Memory', expected: 'gaming_dimm' },
    { src: 'Lexar THOR RGB DDR5 Desktop Memory', expected: 'gaming_dimm' },
    { src: 'Lexar DDR4 SODIMM Laptop Memory', expected: 'pc_productivity' },
    // 卡
    { src: 'Lexar ARMOR GOLD SDXC UHS-II Card', expected: 'gaming_card' },
    { src: 'Lexar PLAY microSDXC UHS-I Card', expected: 'gaming_card' },
    { src: 'Lexar Professional CFexpress Type B Card GOLD Series', expected: 'professional_imaging' },
    { src: 'Lexar Professional SILVER SDXC UHS-I Card', expected: 'professional_imaging' },
    { src: 'Lexar BLUE microSDXC UHS-I Card', expected: 'consumer_cards' },
    { src: 'Lexar High-Endurance microSDHC/microSDXC UHS-I Card', expected: 'consumer_cards' },
    // SSD
    { src: 'Lexar THOR PRO PCIe Gen4X4 NVMe SSD', expected: 'gaming_ssd' },
    { src: 'Lexar ARES PRO M.2 2280 PCIe 5.0 NVMe SSD', expected: 'gaming_ssd' },
    { src: 'Lexar NM790 M.2 2280 PCIe Gen 4x4 NVMe SSD', expected: 'pc_productivity' },
    { src: 'Lexar EQ790 M.2 2280 PCIe Gen4x4 NVMe SSD', expected: 'pc_productivity' },
    { src: 'Lexar SL500 Portable SSD', expected: 'portable_storage' },
    { src: 'Lexar Air Portable SSD', expected: 'portable_storage' },
    { src: 'Lexar ARMOR 700 Portable SSD', expected: 'gaming_ssd' },
    // U盘
    { src: 'Lexar JumpDrive C40E USB 3.2 Gen 1 Flash Drive', expected: 'portable_storage' },
    { src: 'Lexar JumpDrive Solid State Dual Drive D500 USB 3.2 Gen 1 Type-C', expected: 'portable_storage' },
    // 外设
    { src: 'Lexar H31 7-in-1 USB-C Hub', expected: 'portable_storage' },
    { src: 'Lexar E300 M.2 SSD Enclosure', expected: 'portable_storage' },
    { src: 'Lexar Professional Workflow CFexpress 4.0 Type A Card Reader', expected: 'professional_imaging' },
    { src: 'Lexar Professional USB-C Dual-Slot Reader', expected: 'portable_storage' },
    // 子品牌 / 非产品名
    { src: 'Lexar Professional Workflow', expected: 'portable_storage' },
    { src: 'The best storage solution for your daily life', expected: null },
  ]

  console.log(`\n═══ 产品线闭环推导回归（deriveProductLineFromModel）═══`)
  let lp = 0
  let lf = 0
  for (const c of cases) {
    const ext = extractProductModel(c.src)
    const got = ext ? deriveProductLineFromModel(ext, c.src) : null
    const ok = got === c.expected
    if (ok) { lp++; console.log(`  ✅ [${got}] ${c.src}`) }
    else { lf++; console.log(`  ❌ ${c.src}\n      期望: ${c.expected}  实得: ${got}`) }
  }
  console.log(`产品线推导: ${lp} 通过, ${lf} 失败`)
  if (lf > 0) process.exit(1)
}
