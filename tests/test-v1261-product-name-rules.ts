/// <reference types="node" />
import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import { generateProductNameTranslations as generate, TARGET_LANGS } from '../lib/product-name-generator'
import { detectAdhocProductTerms } from '../lib/new-product-detect'
import { restoreTrademarkSymbols, cleanKey } from '../lib/post-process'
import { CATEGORY_WORDS } from '../lib/prompt-constants'
let passed = 0, failed = 0
function check(name: string, run: () => void) {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${(error as Error).message}`) }
}
function names(source: string) { return generate(source, '').translations }
check('CFexpress: Italian media block and localized type, including trademarks', () => {
  const source = 'Lexar® Professional DIAMOND CFexpress™ 4.0 Type A Card'
  const term = detectAdhocProductTerms([source], new Map())[0].term
  const g = names(term)
  assert.equal(g.de, 'Lexar Professional DIAMOND CFexpress 4.0 Typ A Karte')
  assert.equal(g.es, 'Tarjeta Lexar Professional DIAMOND CFexpress 4.0 Tipo A')
  assert.equal(g.it, 'Scheda CFexpress 4.0 Tipo A Lexar Professional DIAMOND')
  assert.equal(restoreTrademarkSymbols([source], [g.it])[0], 'Scheda CFexpress™ 4.0 Tipo A Lexar® Professional DIAMOND')
})
for (const media of ['microSDXC UHS-I', 'SDXC UHS-II', 'microSDXC Express']) {
  check(`Italian media block: ${media}`, () => {
    assert.equal(names(`Lexar Professional NOVA ${media} Card`).it, `Scheda ${media} Lexar Professional NOVA`)
  })
}
check('Card Reader is not translated as a card plus reader', () => {
  const g = names('Lexar Professional Workflow CFexpress 4.0 Type A Card Reader')
  assert.equal(g.de, 'Lexar Professional Workflow CFexpress 4.0 Typ A Kartenleser')
  assert.equal(g.it, 'Lettore Lexar Professional Workflow CFexpress 4.0 Tipo A')
})
check('Dual Drive is not a generic Flash Drive', () => {
  const g = names('Lexar JumpDrive Dual Drive Z99 USB 3.2 Gen 1 Type-C')
  assert.equal(g.de, 'Lexar JumpDrive Dual Drive Z99 USB 3.2 Gen 1 Typ-C')
  assert.equal(g.es, 'Unidad dual Lexar JumpDrive Z99 USB 3.2 Gen 1 Tipo-C')
  assert.equal(g.it, 'Lexar JumpDrive Dual Drive Z99 USB 3.2 Gen 1 Tipo-C')
  assert.equal(g['zh-CN'], 'Lexar JumpDrive Dual Drive Z99 USB 3.2 Gen 1 Type-C 闪存盘')
})
check('Solid State Dual Drive category stays in its own slot', () => {
  const g = names('Lexar JumpDrive Solid State Dual Drive Z99 USB 3.2 Gen 1 Type-C')
  assert.equal(g.de, 'Lexar JumpDrive Dual-SSD Z99 USB 3.2 Gen 1 Typ-C')
  assert.equal(g.es, 'SSD doble Lexar JumpDrive Z99 USB 3.2 Gen 1 Tipo-C')
  assert.equal(g.it, 'Lexar JumpDrive a stato solido Dual Drive Z99 USB 3.2 Gen 1 Tipo-C')
  assert.equal(g['zh-CN'], 'Lexar JumpDrive Z99 USB 3.2 Gen 1 Type-C 双接口高速固态U盘')
})
check('portable SSD with magnetic set keeps accessory after category', () => {
  const g = names('Lexar Z99 Portable SSD with Magnetic Set')
  assert.equal(g.de, 'Lexar Z99 tragbare SSD mit Magnetset')
  assert.equal(g.es, 'SSD portátil Lexar Z99 con juego magnético')
  assert.equal(g.it, 'SSD portatile Lexar Z99 con set magnetico')
  assert.equal(g['zh-CN'], 'Lexar Z99 移动固态硬盘磁吸套装')
})
check('Hub accessory has distinct wording from standalone Hub', () => {
  const g = names('Lexar Z99 Portable SSD with Hub')
  assert.equal(g.it, 'SSD portatile Lexar Z99 con concentratore')
  assert.equal(g.es, 'SSD portátil Lexar Z99 con concentrador')
  assert.equal(g.ja, 'ハブ搭載 Lexar Z99 ポータブル SSD')
})
check('heatsink suffix and Italian Professional SSD name', () => {
  const g = names('Lexar Z99 with Heatsink M.2 PCIe 4.0 NVMe SSD')
  assert.equal(g.it, 'Unità a stato solido Lexar Z99 M.2 PCIe 4.0 NVMe con dissipatore di calore')
  assert.equal(g.es, 'Unidad de estado sólido (SSD) Lexar Z99 M.2 PCIe 4.0 NVMe con disipador de calor')
  assert.equal(g.de, 'Lexar Z99 M.2 PCIe 4.0 NVMe SSD mit Kühlkörper')
  assert.equal(names('Lexar Professional Z99 NVMe SSD').it, 'Unità a stato solido Lexar Professional Z99 NVMe')
  assert.equal(names('Lexar Z99 NVMe SSD').it, 'SSD Lexar Z99 NVMe')
})
check('second generation belongs to its own slot', () => {
  const g = names('Lexar ARES RGB 2nd Gen DDR5 Desktop Memory')
  assert.equal(g.de, 'Lexar ARES RGB DDR5 Desktop-Arbeitsspeicher der 2. Generation')
  assert.equal(g.es, 'Memoria de sobremesa Lexar ARES RGB DDR5 de 2.ª generación')
  assert.equal(g.it, 'Memoria per Desktop Lexar ARES RGB DDR5 di seconda generazione')
})
check('series is not a plural-card signal', () => {
  const g = names('Lexar Professional CFexpress Type A Card GOLD Series')
  assert.equal(g.de, 'Lexar Professional CFexpress Typ A Karte der GOLD-Serie')
  assert.equal(g.it, 'Scheda CFexpress Tipo A Lexar Professional Serie GOLD')
  assert.equal(g.es, 'Tarjeta Lexar Professional CFexpress Tipo A Serie GOLD')
  assert.equal(g['zh-CN'], 'Lexar Professional CFexpress Type A 存储卡 GOLD 系列')
})
check('E-series, EOL and enclosure compound', () => {
  assert.equal(names('Lexar microSDXC UHS-I Card E-Series Plus').de, 'Lexar microSDXC UHS-I Karte der E-Serie Plus')
  for (const lang of TARGET_LANGS) assert.equal(names('Lexar Z99 Portable SSD (EOL)')[lang], names('Lexar Z99 Portable SSD')[lang], lang)
  const g = names('Lexar Z99 M.2 SSD Enclosure')
  assert.equal(g.de, 'Lexar Z99 M.2 SSD-Gehäuse')
  assert.equal(g.it, 'Custodia per SSD Lexar Z99 M.2')
})
check('unknown accessory is preserved and explicitly reported', () => {
  const g = generate('Lexar Z99 Portable SSD with Quantum Kit', '')
  assert(g.translations.de.includes('with Quantum Kit'))
  assert(g.reviewReasons.length > 0)
})
check('normalization tolerates typography, never changes model or Type letter', () => {
  const g = names('Lexar Z99 PCIe Gen 4 × 4 M.2 NVMe SSD')
  assert(g.de.includes('Z99'))
  assert(g.de.includes('Gen4x4'))
  for (const type of ['A', 'B']) {
    const t = names(`Lexar Professional NOVA CFexpress 4.0 Type ${type} Card`)
    assert(t.de.includes(`Typ ${type}`))
    assert(t.it.includes(`Tipo ${type}`))
    assert(t.es.includes(`Tipo ${type}`))
  }
})
check('German subcategories, magnetic property and accessories', () => {
  assert.equal(names('Lexar Z99 Magnetic Portable SSD').de, 'Lexar Z99 magnetische tragbare SSD')
  assert.equal(names('Lexar Z99 M.2 SSD Enclosure').de, 'Lexar Z99 M.2 SSD-Gehäuse')
  assert.equal(names('Lexar 2.5 Inch Hard Drive Enclosure').de, 'Lexar 2,5-Zoll-Festplattengehäuse')
  assert.equal(names('Lexar Multi-Card 4-in-1 USB 3.1 Reader').de, 'Lexar 4-in-1 USB 3.1 Multi-Kartenleser')
  assert.equal(names('Lexar H99 7-in-1 USB-C Hub').de, 'Lexar H99 7-in-1 USB-C-Hub')
  assert.equal(names('Lexar Z99 USB Flash Drive').de, 'Lexar Z99 USB-Flash-Laufwerk')
})
check('USB Gen spacing is not PCIe Gen formatting', () => {
  assert(names('Lexar Z99 USB 3.2 Gen 2x2 Reader').de.includes('USB 3.2 Gen 2x2'))
  assert(names('Lexar Z99 PCIe Gen 4 × 4 SSD').de.includes('PCIe Gen4x4'))
})
check('series tokens cannot swallow appended accessory words', () => {
  const g = generate('Lexar Z99 Portable SSD with Hub Adapter', '')
  assert(g.reviewReasons.length > 0)
  assert(g.translations.de.includes('with Hub Adapter'))
})
check('new product recognition preserves Type A/B and explicit unsupported structures', () => {
  for (const type of ['A', 'B']) {
    const source = `Lexar Professional NOVA CFexpress 4.0 Type ${type} Card`
    const d = detectAdhocProductTerms([source], new Map())[0]
    assert(d)
    assert(names(d.term).de.includes(`Typ ${type}`))
  }
  assert.equal(detectAdhocProductTerms(['Lexar delivers a fast Card'], new Map()).length, 0)
})
check('full category has priority over embedded media, independent of casing', () => {
  assert.equal(generate('Lexar NOVA SD Card Reader', '').category, 'Reader')
  assert.equal(generate('Lexar NOVA sd card reader', '').category, 'Reader')
  assert.equal(generate('Lexar NOVA portable ssd with Hub', '').category, 'Portable SSD')
  assert.equal(generate('Lexar NOVA m.2 ssd enclosure', '').category, 'Enclosure')
})
check('CFexpress format variants do not change compatibility', () => {
  const a = names('Lexar Professional NOVA CFexpress 4.0 Type A Card')
  const b = names('Lexar Professional NOVA CFexpress 4.0 Type B Card')
  assert.notEqual(a.de, b.de)
  assert.equal(names('Lexar Professional NOVA CFexpress 4.0 type a Card').it, a.it)
})
check('unknown generation is not mistaken for a supported generation', () => {
  const g = generate('Lexar NOVA 3rd Gen DDR5 Desktop Memory', '')
  assert(g.translations.de.includes('3rd Gen'))
  assert(g.reviewReasons.length > 0)
})
check('unknown series and unsupported card format require review', () => {
  assert(generate('Lexar NOVA microSDXC UHS-I Card PLATINUM Series', '').reviewReasons.length > 0)
  assert(generate('Lexar NOVA CFast 2.0 Card', '').reviewReasons.length > 0)
})
check('matching normalizes typography, not product identity or word order', () => {
  assert.equal(cleanKey('Lexar® NOVA PCIe Gen 4 × 4 SSD'), cleanKey('Lexar NOVA PCIe Gen4x4 SSD'))
  assert.notEqual(cleanKey('Lexar NOVA CFexpress Type A Card'), cleanKey('Lexar NOVA CFexpress Type B Card'))
  assert.notEqual(cleanKey('Lexar NOVA CFexpress 4.0 Type A Card'), cleanKey('Lexar NOVA CFexpress 2.0 Type A Card'))
  assert.notEqual(cleanKey('Lexar Z99 Portable SSD'), cleanKey('Lexar Z99 Portable SSD with Hub'))
  assert.notEqual(cleanKey('Lexar Z99 1TB SSD'), cleanKey('Lexar Z99 2TB SSD'))
  assert.notEqual(cleanKey('Lexar NOVA M.2 PCIe 4.0 SSD'), cleanKey('Lexar NOVA PCIe 4.0 M.2 SSD'))
})
check('German product category vocabulary has one shared source', () => {
  assert.equal(CATEGORY_WORDS.Reader.productName!.de, 'Kartenleser')
  assert.equal(CATEGORY_WORDS['Desktop Memory'].productName!.de, 'Desktop-Arbeitsspeicher')
  assert.equal(CATEGORY_WORDS['Laptop Memory'].productName!.de, 'Laptop-Arbeitsspeicher')
  assert.equal(CATEGORY_WORDS['Portable SSD'].productName!.de, 'tragbare SSD')
})
check('unknown review information reaches the UI entry points', () => {
  const ui = readFileSync('ui/App.vue', 'utf8')
  assert(ui.includes('gen.reviewReasons'))
  assert(!ui.includes('新品名待确认（LLM 辅助识别）：'))
})
check('20-language new combinations keep models, specifications and trademark counts', () => {
  for (const grade of ['DIAMOND', 'GOLD', 'NOVA']) for (const type of ['A', 'B']) {
    const source = `Lexar® Professional ${grade} CFexpress™ 4.0 Type ${type} Card`
    const term = detectAdhocProductTerms([source], new Map())[0].term
    const g = names(term)
    for (const lang of TARGET_LANGS) {
      const text = restoreTrademarkSymbols([source], [g[lang]])[0]
      assert(text.includes('Lexar®'), lang)
      assert(text.includes(grade), lang)
      assert(text.includes('CFexpress™ 4.0'), lang)
      assert.equal((text.match(/™/g) || []).length, 1, lang)
      assert.equal((text.match(/®/g) || []).length, 1, lang)
      assert.equal((text.match(/CFexpress/g) || []).length, 1, lang)
      assert(text.includes(type), lang)
    }
  }
})
check('magnetic property follows local category grammar', () => {
  const g = names('Lexar Z99 Magnetic Portable SSD')
  assert.equal(g['zh-CN'], 'Lexar Z99 磁吸移动固态硬盘')
  assert.equal(g.fr, 'SSD portable magnétique Lexar Z99')
  assert.equal(g.it, 'SSD portatile magnetica Lexar Z99')
  assert.equal(g.es, 'SSD portátil magnética Lexar Z99')
  assert.equal(g.de, 'Lexar Z99 magnetische tragbare SSD')
})
check('all direct generator callers receive explicit review reasons', () => {
  assert.equal(generate('', '').reviewReasons.length, 1)
  assert.equal(generate('Lexar NOVA', '').translations.de, 'Lexar NOVA')
  assert(generate('Lexar NOVA CFexpress Type C Card', '').reviewReasons.length > 0)
})
console.log(`Product naming rules: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
