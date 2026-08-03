/**
 * v11.2 全品线形态扫描：模拟 11 大品线的真实/新品产品名，检测+生成+遮蔽全链路
 *
 * 用例覆盖 CSV 140 条的形态变体 + 假想新品，找出 v11.2 未考虑的特殊情况。
 * 输出：tests/tmp-v112-all-lines-scan.txt
 */
import { writeFileSync } from 'fs'
import { detectAdhocProductTerms, parseProductName } from '../lib/new-product-detect'
import { generateProductNameTranslations, detectCategory } from '../lib/product-name-generator'

const out: string[] = []
const p = (s: string) => out.push(s)

// 用例：{ src, note, 期望检出? }
const CASES: Array<{ src: string; note: string }> = [
  { src: 'Lexar® Professional SILVER GO microSDXC™ UHS-I Card', note: '真实新品-®+™符号+GO系列' },
  // ── Card 品线（42条，形态最多样）──
  { src: 'Lexar ARMOR GOLD SDXC UHS-II Card', note: 'Card-双臂师系列' },
  { src: 'Lexar BLUE PLUS microSDHC/microSDXC UHS-I Card', note: 'Card-斜杠双格式' },
  { src: 'Lexar High-Endurance microSDHC/microSDXC UHS-I Card', note: 'Card-连字符系列' },
  { src: 'Lexar High-Performance 633x microSDHC/microSDXC UHS-I Card BLUE Series', note: 'Card-速度等级+后置Series' },
  { src: 'Lexar NM Card', note: 'Card-双字母型号' },
  { src: 'Lexar PLAY PRO microSDXC Express Card', note: 'Card-Express规格' },
  { src: 'Lexar Professional 1066x SDXC UHS-I Card SILVER Series', note: 'Card-速度开头+后置Series' },
  { src: 'Lexar Professional CFexpress Type B Card DIAMOND Series', note: 'Card-后置DIAMOND Series' },
  { src: 'Lexar Professional DIAMOND CFexpress 4.0 Type B Card', note: 'Card-前置DIAMOND' },
  { src: 'Lexar SDHC/SDXC UHS-I Card E-series', note: 'Card-后置E-series小写' },
  { src: 'Lexar microSDXC UHS-I Card E-Series Plus', note: 'Card-后置E-Series Plus' },
  { src: 'Lexar nCARD NM card 2-in-1 USB 3.1 Reader', note: 'Reader-小写nCARD/card' },
  { src: 'Lexar Multi-Card 2-in-1 USB 3.1 Reader', note: 'Reader-连字符Multi-Card' },
  { src: 'Lexar microSD/SD USB-A/C Card Reader', note: 'Reader-斜杠+USB-A/C' },
  // ── Desktop/Laptop Memory ──
  { src: 'Lexar ARES DDR4 Desktop Memory', note: 'Mem-已知系列' },
  { src: 'Lexar DDR5 SODIMM Laptop Memory', note: 'Mem-规格开头无系列' },
  { src: 'Lexar THOR Z RGB DDR5 Desktop Memory', note: 'Mem-系列+Z+RGB' },
  { src: 'Lexar VELOCIS DDR5 6000MHz Desktop Memory', note: 'Mem-新系列+频率' },
  { src: 'Lexar ARES RGB 2nd Gen DDR5 Desktop Memory', note: 'Mem-2nd Gen' },
  // ── Dual Drive ──
  { src: 'Lexar JumpDrive Dual Drive D300 USB 3.2 Gen 1 Type-C', note: 'Dual-品类在中间' },
  { src: 'Lexar JumpDrive Solid State Dual Drive D500 USB 3.2 Gen 1 Type-C', note: 'Dual-固态双接口' },
  { src: 'Lexar Solid State Dual Drive D500 USB 3.2 Gen 1 Type-C Elite Legends Series', note: 'Dual-后置Elite Legends Series' },
  // ── Enclosure ──
  { src: 'Lexar 2.5 Inch Hard Drive Enclosure', note: 'Enc-尺寸开头' },
  { src: 'Lexar E300 M.2 SSD Enclosure', note: 'Enc-型号+SSD Enclosure' },
  { src: 'Lexar Professional USB 4 SSD Enclosure', note: 'Enc-USB 4' },
  // ── Flash Drive ──
  { src: 'Lexar JumpDrive Fingerprint F35 PRO USB 3.2 Gen 1 Flash Drive', note: 'FD-描述词Fingerprint' },
  { src: 'Lexar JumpDrive M900 USB 3.1 Flash Drive (EOL)', note: 'FD-(EOL)后缀' },
  { src: 'Lexar JumpDrive TwistTurn2 USB Flash Drive', note: 'FD-系列名含数字' },
  { src: 'Lexar JumpDrive V40 USB Flash Drive', note: 'FD-型号V40' },
  // ── Hub ──
  { src: 'Lexar H31 7-in-1 USB-C Hub', note: 'Hub-7-in-1' },
  // ── Portable SSD ──
  { src: 'Lexar ARMOR 700 Portable SSD', note: 'PSSD-系列+数字' },
  { src: 'Lexar Air Portable SSD', note: 'PSSD-已知特殊系列Air' },
  { src: 'Lexar Dual Drive Portable SSD D70E', note: 'PSSD-品类在中间+型号后置' },
  { src: 'Lexar ES5 Magnetic Portable SSD', note: 'PSSD-Magnetic中置' },
  { src: 'Lexar Professional Go Portable SSD with Hub', note: 'PSSD-with Hub配件' },
  { src: 'Lexar SL500 Portable SSD Elite Legends Series', note: 'PSSD-后置Elite Legends Series' },
  { src: 'Lexar SL660 BLAZE Gaming Portable SSD (EOL)', note: 'PSSD-Gaming描述+(EOL)' },
  { src: 'Lexar TouchLock Portable SSD', note: 'PSSD-已知系列TouchLock' },
  // ── Reader ──
  { src: 'Lexar CFexpress Type A USB-C Reader', note: 'Reader-Type A' },
  { src: 'Lexar Professional CFexpress Type B USB 3.2 Gen 2×2 Reader', note: 'Reader-×2特殊字符' },
  { src: 'Lexar Dual-Slot USB-A/C Reader', note: 'Reader-Dual-Slot连字符' },
  // ── SSD internal ──
  { src: 'Lexar NM100 M.2 2280 SATA III (6Gb/s) SSD', note: 'SSD-(6Gb/s)括号' },
  { src: 'Lexar NQ100 2.5” SATA III (6Gb/s) SSD', note: 'SSD-中文引号英寸' },
  { src: 'Lexar EQ790 with Heatsink M.2 2280 PCIe Gen4x4 NVMe SSD', note: 'SSD-with Heatsink中置' },
  { src: 'Lexar PLAY X M.2 PCIe 4.0 NVMe SSD', note: 'SSD-PLAY X' },
  { src: 'Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD', note: 'SSD-Professional+型号+PRO' },
  // ── 假想新品（新系列名）──
  { src: 'Lexar TITAN DDR5 6400MHz Desktop Memory', note: '新品-新系列TITAN' },
  { src: 'Lexar Professional TITAN CFexpress 4.0 Type B Card', note: '新品-Professional+新系列' },
  { src: 'Lexar TITAN 2TB M.2 2280 PCIe Gen5x4 NVMe SSD', note: '新品-系列+容量' },
  { src: 'Lexar® TITAN X Portable SSD', note: '新品-带®+系列+X' },
  // ── 非产品名对照 ──
  { src: 'Lexar 2.5 Inch Hard Drive Enclosure', note: '对照-已在CSV（应新颖性门拦）' },
]

const glossary = new Map<string, string>([
  // 模拟真实术语库（含已知系列与部分整条）
  ['Lexar ARES DDR4 Desktop Memory', 'x'],
  ['Lexar PLAY microSDXC UHS-I Card', 'x'],
  ['Lexar THOR DDR4 UDIMM Desktop Memory', 'x'],
  ['Lexar 2.5 Inch Hard Drive Enclosure', 'x'],
  ['Lexar Air Portable SSD', 'x'],
  ['Lexar TouchLock Portable SSD', 'x'],
])

p('源文'.padEnd(62) + '检出  品类识别        parse.series / valid')
p('─'.repeat(110))
for (const c of CASES) {
  const parsed = parseProductName(c.src)
  const det = detectAdhocProductTerms([c.src], glossary)
  const cat = detectCategory(c.src)
  const detected = det.length > 0 ? '✅' : '—'
  const ps = parsed ? (parsed.series || '(空)') + ' / ' + parsed.valid : 'null'
  p(c.src.slice(0, 60).padEnd(62) + detected + '   ' + String(cat).padEnd(16) + ps + '   [' + c.note + ']')
}

writeFileSync('tests/tmp-v112-all-lines-scan.txt', out.join('\n'), 'utf-8')
console.log(out.join('\n').split('').map(ch => {
  const code = ch.codePointAt(0)!
  return code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : ch
}).join(''))
