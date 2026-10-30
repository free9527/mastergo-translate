/// <reference types="node" />
import { strict as assert } from 'assert'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { parseCSVRecords } from '../lib/parse-csv'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '../lib/default-glossary'

const products = parseCSVRecords(readFileSync('术语素材/Lexar术语库_产品名.csv', 'utf8'))
const exclusive = parseCSVRecords(readFileSync('术语素材/Lexar术语库_专属.csv', 'utf8'))
let passed = 0, failed = 0
function check(name: string, run: () => void) {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${(error as Error).message}`) }
}
function german(rows: string[][], source: string) {
  return rows.find(row => row[0] === source)![rows[0].indexOf('de')]
}
check('localized specification names', () => {
  assert.equal(german(exclusive, 'CFexpress™ Type A'), 'CFexpress™ Typ A')
  assert.equal(german(exclusive, 'CFexpress™ Type B'), 'CFexpress™ Typ B')
  assert.equal(german(exclusive, 'Type-C'), 'Typ-C')
})
check('compound nouns and adjective case', () => {
  assert.equal(german(products, 'Lexar ARES DDR4 Desktop Memory'), 'Lexar ARES DDR4 Desktop-Arbeitsspeicher')
  assert.equal(german(products, 'Lexar DDR5 SODIMM Laptop Memory'), 'Lexar DDR5 SODIMM Laptop-Arbeitsspeicher')
  assert.equal(german(products, 'Lexar E300 M.2 SSD Enclosure'), 'Lexar E300 M.2 SSD-Gehäuse')
  assert.equal(german(products, 'Lexar ES5 Magnetic Portable SSD'), 'Lexar ES5 magnetische tragbare SSD')
  assert.equal(german(products, 'Lexar 2.5 Inch Hard Drive Enclosure'), 'Lexar 2,5-Zoll-Festplattengehäuse')
})
check('consistent reader name', () => {
  for (const row of products.slice(1)) if (/Reader$/.test(row[0])) {
    assert(/Kartenleser/.test(row[6]), row[0])
    assert(!/Lesegerät/.test(row[6]), row[0])
  }
})
check('card number and series spelling', () => {
  assert.equal(german(products, 'Lexar PLAY microSDXC UHS-I Card'), 'Lexar PLAY microSDXC UHS-I Karte')
  assert.equal(german(products, 'Lexar Professional CFexpress Type A Card GOLD Series'), 'Lexar Professional CFexpress Typ A Karte der GOLD-Serie')
  assert.equal(german(products, 'Lexar microSDHC/microSDXC UHS-I Card E-Series'), 'Lexar microSDHC/microSDXC UHS-I Karte der E-Serie')
})
check('end-of-life marker is absent from every product field, without removing products', () => {
  assert.equal(products.length - 1, 141)
  assert.equal(new Set(products.slice(1).map(r => r[0])).size, 141)
  for (const row of products) for (const value of row) assert(!value.includes('(EOL)'), row[0])
  for (const name of ['Lexar JumpDrive M900 USB 3.1 Flash Drive', 'Lexar JumpDrive S57 USB 3.0 Flash Drive', 'Lexar SL210 Portable SSD', 'Lexar SL660 BLAZE Gaming Portable SSD']) {
    assert(products.some(row => row[0] === name), name)
  }
})
check('unreviewed cells remain unchanged from the pre-task data', () => {
  const reviewed: Record<string, string[]> = {
    'Lexar microSDXC UHS-I Card E-Series Plus': ['it'],
    'Lexar JumpDrive S47 USB 3.2 Flash Drive': ['es'],
    'Lexar JumpDrive S80 USB 3.2 Flash Drive': ['es'],
    'Lexar JumpDrive V100 USB 3.2 Flash Drive': ['es'],
    'Lexar Muse Ultra-Slim Portable SSD': ['ko'],
    'Lexar 2.5 Inch Hard Drive Enclosure': ['es', 'it'],
    'microSD Memory Card': ['ko'], 'SD Memory Card': ['ko'],
    'Backward Compatible': ['pl'], 'Compact & Portable': ['nl'],
    'Full Game Library Storage': ['sv'], 'Handheld Console Memory Card': ['tr'],
    'Frameo App': ['pl'], 'On-die ECC': ['zh-TW'],
    'USB Flash Drive': ['pt'], 'Solid State Flash Drive': ['pt'],
    'Seamless Compatibility': ['fr'], 'Read Speed': ['ja'],
    'Seamlessly compatible with Intel XMP 3.0 & AMD EXPO for one-click overclocking.': ['ja', 'fr'],
  }
  for (const [rows, hash] of [
    [products, 'c53af895256dcb3205d940cac81167a43c018e2465cee712e22cb291c19364fc'],
    [exclusive, '6183b37d28e06362c0c026961ca2fe35aa9079810a50c0415a5568d052d64811'],
  ] as [string[][], string][]) {
    const header = rows[0]
    const cells = rows.map(r => r.filter((_, i) => header[i] !== 'de' && !(reviewed[r[0]] || []).includes(header[i])).map(v => v.replace(/\s*\(EOL\)/gi, '')))
    assert.equal(createHash('sha256').update(JSON.stringify(cells)).digest('hex'), hash)
  }
})
check('bundled data equals source CSV data', () => {
  assert.deepEqual(parseCSVRecords(DEFAULT_GLOSSARY_PRODUCTS_CSV.replace(/^﻿/, '')), parseCSVRecords(readFileSync('术语素材/Lexar术语库_产品名.csv', 'utf8').replace(/^﻿/, '')))
  assert.deepEqual(parseCSVRecords(DEFAULT_GLOSSARY_EXCLUSIVE_CSV.replace(/^﻿/, '')), parseCSVRecords(readFileSync('术语素材/Lexar术语库_专属.csv', 'utf8').replace(/^﻿/, '')))
})
console.log(`German localization: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
