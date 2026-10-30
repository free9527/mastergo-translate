/// <reference types="node" />
import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import { parseCSVRecords, parseGlossaryCSVText } from '../lib/parse-csv'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '../lib/default-glossary'
import { generateProductNameTranslations, TARGET_LANGS } from '../lib/product-name-generator'

const langs = new Set<string>(TARGET_LANGS)
const products = parseGlossaryCSVText(readFileSync('术语素材/Lexar术语库_产品名.csv', 'utf8'), langs)
const exclusive = parseGlossaryCSVText(readFileSync('术语素材/Lexar术语库_专属.csv', 'utf8'), langs)
let passed = 0, failed = 0
function check(name: string, run: () => void) {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${(error as Error).message}`) }
}
function term(source: string, lang: string) {
  const entry = exclusive.find(r => r.source === source)
  assert(entry, source)
  return entry.translations[lang]
}
check('Korean terms contain Korean card names, not Japanese', () => {
  assert.equal(term('microSD Memory Card', 'ko'), 'microSD 카드')
  assert.equal(term('SD Memory Card', 'ko'), 'SD 카드')
  for (const entry of exclusive) assert(!/[ぁ-ヿ]/.test(entry.translations.ko || ''), entry.source)
})
check('Polish, Dutch, Swedish and Turkish grammar', () => {
  assert.equal(term('Backward Compatible', 'pl'), 'Wstecznie kompatybilny')
  assert.equal(term('Compact & Portable', 'nl'), 'Compact en draagbaar')
  assert.equal(term('Full Game Library Storage', 'sv'), 'Spara hela ditt spelbibliotek')
  assert.equal(term('Handheld Console Memory Card', 'tr'), 'Taşınabilir oyun konsolları için hafıza kartı')
  assert.equal(term('Frameo App', 'pl'), 'aplikacja Frameo')
})
check('ECC names correction rather than detection alone', () => {
  assert.equal(term('On-die ECC', 'zh-TW'), '晶粒內建錯誤更正碼（On-die ECC）')
})
check('Portuguese market distinction and German vocabulary', () => {
  assert.equal(term('USB Flash Drive', 'pt'), 'Pen USB')
  assert.equal(term('Solid State Flash Drive', 'pt'), 'Pen USB SSD')
  assert.equal(term('USB Flash Drive', 'pt-BR'), 'Pen Drive')
  assert.equal(term('Solid State Flash Drive', 'pt-BR'), 'Pen Drive SSD')
  assert.equal(term('Portable SSD', 'de'), 'tragbare SSD')
  assert.equal(term('CFexpress™ Type A', 'de'), 'CFexpress™ Typ A')
  assert.equal(term('Type-C', 'de'), 'Typ-C')
})
check('compatibility and read-speed wording is natural and consistent', () => {
  assert.equal(term('Seamless Compatibility', 'fr'), 'Compatibilité sans difficulté')
  const sentence = term('Seamlessly compatible with Intel XMP 3.0 & AMD EXPO for one-click overclocking.', 'ja')
  assert(sentence.includes('Intel XMP 3.0およびAMD EXPOに対応し'))
  assert(sentence.includes('ワンクリック'))
  assert.equal(term('Read Speed', 'ja'), '読み出し速度')
  assert(term('Read speed up to', 'ja').startsWith(term('Read Speed', 'ja')))
})
check('identical duplicate records are removed without losing any source', () => {
  assert.equal(exclusive.length, 126)
  assert.equal(new Set(exclusive.map(r => r.source)).size, exclusive.length)
  for (const key of ['PCIe Gen4x4', 'PCIe Gen5x4']) assert.equal(exclusive.filter(r => r.source === key).length, 1)
})
check('confirmed regional product names are retained', () => {
  for (const form of ['SODIMM', 'UDIMM']) {
    const entry = products.find(r => r.source === `Lexar DDR4 ${form} ${form === 'SODIMM' ? 'Laptop' : 'Desktop'} Memory`)!
    assert(entry.translations.ja.includes('DDR4-3200/2666'))
  }
  assert(products.find(r => r.source === 'Lexar PLAY 2230 PCIe 4.0 SSD')!.translations.de.includes('NVMe SSD'))
})
check('officially confirmed product facts are preserved', () => {
  const card = products.find(r => r.source === 'Lexar microSDXC UHS-I Card E-Series Plus')!
  assert.equal(card.translations.it, 'Scheda microSDXC UHS-I Lexar Serie E Plus')
  for (const model of ['S47', 'S80', 'V100']) {
    assert.equal(products.find(r => r.source === `Lexar JumpDrive ${model} USB 3.2 Flash Drive`)!.translations.es, `Unidad flash Lexar JumpDrive ${model} USB 3.2`)
  }
  assert.equal(products.find(r => r.source === 'Lexar Muse Ultra-Slim Portable SSD')!.translations.ko, 'Lexar Muse Ultra-Slim 휴대용 SSD')
})
check('2.5-inch enclosure does not exclude HDDs in Spanish or Italian', () => {
  const entry = products.find(r => r.source === 'Lexar 2.5 Inch Hard Drive Enclosure')!
  assert.equal(entry.translations.es, 'Carcasa Lexar para unidades de 2,5 pulgadas')
  assert.equal(entry.translations.it, 'Box esterno Lexar per unità da 2,5 pollici')
  const generated = generateProductNameTranslations(entry.source, '').translations
  assert.equal(generated.es, entry.translations.es)
  assert.equal(generated.it, entry.translations.it)
})
check('every source and every target-language value remains present', () => {
  assert.equal(products.length, 141)
  for (const entry of [...products, ...exclusive]) for (const lang of TARGET_LANGS.filter(l => l !== 'en')) assert(entry.translations[lang]?.trim(), `${entry.source}/${lang}`)
})
check('bundled glossary is exactly the maintained CSV data', () => {
  for (const [file, data] of [
    ['术语素材/Lexar术语库_产品名.csv', DEFAULT_GLOSSARY_PRODUCTS_CSV],
    ['术语素材/Lexar术语库_专属.csv', DEFAULT_GLOSSARY_EXCLUSIVE_CSV],
  ]) assert.deepEqual(parseCSVRecords(data.replace(/^﻿/, '')), parseCSVRecords(readFileSync(file, 'utf8').replace(/^﻿/, '')))
})
console.log(`Glossary localization: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
