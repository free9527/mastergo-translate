/// <reference types="node" />
import { strict as assert } from 'assert'
import { loadGlossaryWithMerge, saveGlossaryWithVersion, GlossaryStorage } from '../lib/glossary-store'
import { GLOSSARY_VERSION, STORAGE_KEY_GLOSSARY_VERSION, STORAGE_KEY_GLOSSARY_PRODUCTS, STORAGE_KEY_GLOSSARY_EXCLUSIVE, STORAGE_KEY_TRANSLATION_CACHE } from '../lib/constants'
import { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '../lib/default-glossary'
import { parseGlossaryCSVText } from '../lib/parse-csv'
import { TARGET_LANGS } from '../lib/product-name-generator'

async function main() {
  assert.equal(GLOSSARY_VERSION, 13)
  const langs = new Set<string>(TARGET_LANGS)
  const defaults = new Map([
    [STORAGE_KEY_GLOSSARY_PRODUCTS, parseGlossaryCSVText(DEFAULT_GLOSSARY_PRODUCTS_CSV, langs)],
    [STORAGE_KEY_GLOSSARY_EXCLUSIVE, parseGlossaryCSVText(DEFAULT_GLOSSARY_EXCLUSIVE_CSV, langs)],
  ])
  for (const order of [[STORAGE_KEY_GLOSSARY_PRODUCTS, STORAGE_KEY_GLOSSARY_EXCLUSIVE], [STORAGE_KEY_GLOSSARY_EXCLUSIVE, STORAGE_KEY_GLOSSARY_PRODUCTS]]) {
    const data: Record<string, unknown> = {
      [STORAGE_KEY_GLOSSARY_VERSION]: 12,
      [STORAGE_KEY_TRANSLATION_CACHE]: { obsolete: 'old translation' },
      [STORAGE_KEY_GLOSSARY_PRODUCTS]: [{ source: 'old custom product', translations: { de: 'alt' } }],
      [STORAGE_KEY_GLOSSARY_EXCLUSIVE]: [{ source: 'old custom term', translations: { ko: 'old' } }],
    }
    const storage: GlossaryStorage = {
      async getAsync(key) { return data[key] ?? null },
      async setAsync(key, value) { data[key] = value },
    }
    const upgraded: string[] = []
    for (const key of order) {
      const actual = await loadGlossaryWithMerge(storage, key, () => defaults.get(key)!, GLOSSARY_VERSION, () => { upgraded.push(key) })
      assert.deepEqual(actual, defaults.get(key), key)
      assert.deepEqual(data[key], defaults.get(key), key)
    }
    assert.equal(upgraded.length, 2)
    assert.deepEqual(data[STORAGE_KEY_TRANSLATION_CACHE], {})
    for (const key of order) {
      const saved = [...defaults.get(key)!, { source: 'current version manual import', translations: { de: 'neu' } }]
      await saveGlossaryWithVersion(storage, key, saved, GLOSSARY_VERSION)
      const actual = await loadGlossaryWithMerge(storage, key, () => { throw Error('Unexpected repeat upgrade') }, GLOSSARY_VERSION)
      assert.deepEqual(actual, saved)
    }
    console.log(`PASS upgrade both libraries, clear cache, persist once: ${order.join(' -> ')}`)
  }
  // A failed cache write must not mark the library upgrade as finished.
  const productKey = STORAGE_KEY_GLOSSARY_PRODUCTS
  const stamp = `${STORAGE_KEY_GLOSSARY_VERSION}:${productKey}`
  const data: Record<string, unknown> = { [stamp]: 12 }
  let rejectCache = true
  const storage: GlossaryStorage = {
    async getAsync(key) { return data[key] ?? null },
    async setAsync(key, value) {
      if (key === STORAGE_KEY_TRANSLATION_CACHE && rejectCache) throw Error('Cache storage unavailable')
      data[key] = value
    },
  }
  await assert.rejects(loadGlossaryWithMerge(storage, productKey, () => defaults.get(productKey)!, 13), /Cache storage unavailable/)
  assert.equal(data[stamp], 12)
  rejectCache = false
  assert.deepEqual(await loadGlossaryWithMerge(storage, productKey, () => defaults.get(productKey)!, 13), defaults.get(productKey))
  assert.equal(data[stamp], 13)
  console.log('PASS interrupted upgrade retries before marking version current')

}
main().catch(error => { console.error(error); process.exit(1) })
