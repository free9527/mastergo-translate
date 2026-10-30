/// <reference types="node" />
import { strict as assert } from 'assert'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import * as path from 'path'
import * as ts from 'typescript'

// Run with ts-node/register/transpile-only and tsconfig-paths/register. All network access is blocked.
const Module = require('module')
const root = process.cwd()
const source = 'Lexar® Professional DIAMOND CFexpress™ 4.0 Type A Card'
const plain = source.replace(/[®™©]/g, '')
const originalLoader = Module._extensions['.ts']
const sourceCache = new Map<string, string>()
let revision = ''
let passed = 0
let failed = 0

require('vue')
Module._extensions['.vue'] = (module: NodeModule) => { module.exports = {} }
;(globalThis as any).document = { querySelectorAll: () => [], querySelector: () => null }
;(globalThis as any).window = {}
;(globalThis as any).parent = { postMessage: () => {} }
;(globalThis as any).XMLHttpRequest = class {
  constructor() { throw Error('Network access forbidden in product routing tests') }
}
const realSetTimeout = globalThis.setTimeout
;(globalThis as any).setTimeout = (fn: (...args: any[]) => void, ms: number, ...args: any[]) => {
  const timer = realSetTimeout(fn, ms, ...args)
  timer.unref()
  return timer
}

function readSource(file: string): string {
  if (revision === 'working-tree') return readFileSync(file, 'utf8')
  const relative = path.relative(root, file).split(path.sep).join('/')
  const key = `${revision}:${relative}`
  if (!sourceCache.has(key)) {
    sourceCache.set(key, execFileSync('git', ['show', key], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
  }
  return sourceCache.get(key)!
}

function compile(text: string): string {
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
}

Module._extensions['.ts'] = (module: any, file: string) => {
  if (file.startsWith(root + path.sep) && !file.includes(path.sep + 'node_modules' + path.sep)) {
    module._compile(compile(readSource(file)), file)
  } else originalLoader(module, file)
}

interface Scenario {
  name: string
  entry?: 'batch' | 'single' | 'retry' | 'proofread'
  text?: string
  extra?: 'exact' | 'longer-key' | 'longer-value' | 'zero-width-key'
  ordinary?: boolean
  action?: 'confirm' | 'skip'
  duplicate?: boolean
  stale?: boolean
  identity?: boolean
  cancel?: boolean
}

const scenarios: Scenario[] = [
  { name: 'exact source uses rule generation' },
  { name: 'exact glossary wins over generation', extra: 'exact' },
  { name: 'longer glossary key must not disable product translation', extra: 'longer-key' },
  { name: 'longer glossary value must not disable product translation', extra: 'longer-value' },
  { name: 'non-breaking spaces keep the product route', text: source.replace(/ /g, ' ') },
  { name: 'zero-width brand character keeps the product route', text: source.replace('Lexar', 'Le​xar') },
  { name: 'single retranslation keeps the product route', entry: 'single' },
  { name: 'failed-item retry keeps the product route', entry: 'retry' },
  { name: 'single retranslation respects curated names', entry: 'single', extra: 'exact' },
  { name: 'retry respects curated names', entry: 'retry', extra: 'exact' },
  { name: 'single retranslation ignores longer-name interference', entry: 'single', extra: 'longer-key' },
  { name: 'retry ignores longer-name interference', entry: 'retry', extra: 'longer-key' },
  { name: 'zero-width spelling still respects a curated name', text: source.replace('Lexar', 'Le​xar'), extra: 'exact' },
  { name: 'standalone proofread exempts deterministic product name', entry: 'proofread' },
  { name: 'normal canvas matches zero-width curated key', extra: 'zero-width-key' },
  { name: 'confirm normalized pending source', text: source.replace('Lexar', 'Le​xar'), action: 'confirm' },
  { name: 'skip normalized pending source', text: source.replace(/ /g, ' '), action: 'skip' },
  { name: 'retry name outranks stale same-source translation', entry: 'retry', duplicate: true },
  { name: 'retry clears stale item state', entry: 'retry', stale: true },
  { name: 'auxiliary identity protects raw alias', text: source.replace('DIAMOND', 'SUPER').replace('Lexar', 'Le​xar'), identity: true },
  { name: 'auxiliary identity works in single retranslation', text: source.replace('DIAMOND', 'SUPER'), entry: 'single', identity: true },
  { name: 'auxiliary identity works in failed-item retry', text: source.replace('DIAMOND', 'SUPER'), entry: 'retry', identity: true },
  { name: 'cancelled mixed retry preserves unprocessed errors', entry: 'retry', cancel: true },
  { name: 'ordinary marketing still reaches translation', text: 'Capture every moment with exceptional clarity.', ordinary: true },
]

// Expose state only in the in-memory copy; production files remain unchanged.
const probe = `
exports.runProbe = async function(text, lang, rows, entry, scenario) {
  settingsReady = true;
  glossaryReady = true;
  items.value = [{ sourceText: text, translatedText: '', proofreadText: '',
    nodeIds: ['routing-probe'], nodeNames: ['routing-probe'] }];
  targetLang.value = lang;
  glossaryProducts.value = rows;
  glossaryExclusive.value = [];
  pendingReviewTerms.value = [];
  llmConfig.value.apiKey = 'offline-placeholder';
  llmConfig.value.apiUrl = 'https://offline.invalid';
  if (scenario.duplicate) items.value.unshift({sourceText:text,translatedText:'OLD® WRONG™ TRANSLATION',proofreadText:'',nodeIds:['old-item'],nodeNames:['old-item']});
  if (scenario.stale) {
    items.value[0].proofreadText='STALE'; items.value[0].proofreadReason='STALE'; items.value[0].corrected=true;
    appliedNodeIds.value.add('routing-probe'); prohibitedTransIds.value.set('routing-probe',['STALE']);
  }
  if (scenario.cancel) for (let i=0;i<16;i++) items.value.push({sourceText:'Capture every moment with exceptional clarity '+i,translatedText:'',proofreadText:'',nodeIds:['ordinary-'+i],nodeNames:['ordinary-'+i]});
  clearUiLogs();
  if (entry === 'proofread') {
    const term = text.replace(/[®™©]/g, '');
    items.value[0].translatedText = restoreTrademarkSymbols([text], [generateProductNameTranslations(term, 'DIAMOND').translations[lang]])[0];
    await startProofread();
  } else if (entry === 'single') await retranslateSingle(items.value[0]);
  else if (entry === 'retry') {
    for (const item of items.value) if (item.nodeIds[0]!=='old-item') translateErrors.value.add(item.nodeIds[0]);
    await retryFailedTranslations();
  } else await startTranslate();
  const target=items.value.find(item=>item.nodeIds[0]==='routing-probe');
  const blockersBefore=pendingItems.value.filter(row=>row.item===target).map(row=>row.type);
  if (scenario.action==='confirm') confirmLlmFallbackTerm(target);
  if (scenario.action==='skip') applyWithoutGlossary(target);
  return { translation: target.translatedText, source: target.sourceText, blockersBefore,
    blockersAfter:pendingItems.value.filter(row=>row.item===target).map(row=>row.type),
    confirmed:pendingReviewTerms.value.some(row=>row.confirmed),
    proofreadText:target.proofreadText,corrected:target.corrected,applied:appliedNodeIds.value.has('routing-probe'),
    prohibited:prohibitedTransIds.value.has('routing-probe'),errors:[...translateErrors.value],progress:translateProgress.value,
    logs: getUiLogs().map(row => row.message), pending: pendingReviewTerms.value.map(row => row.source) };
};
exports.cancelProbe = () => { cancelFlag.value = true; };`

async function check(scenario: Scenario, lang: string) {
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(root + path.sep) && !file.includes(path.sep + 'node_modules' + path.sep)) {
      delete require.cache[file]
    }
  }
  const api = require('../lib/llm-api')
  const pipelineEntries: string[] = []
  for (const name of ['translateBatch', 'proofreadBatch', 'parseProductNameWithLLM',
    'personaJudgeBatch', 'polishBatch', 'polishVerifyBatch']) {
    api[name] = async () => {
      pipelineEntries.push(name)
      throw Error(`Offline routing trap: ${name}`)
    }
  }
  const { DEFAULT_GLOSSARY_PRODUCTS_CSV, DEFAULT_GLOSSARY_EXCLUSIVE_CSV } = require('../lib/default-glossary')
  const { parseGlossaryCSVText } = require('../lib/parse-csv')
  const { generateProductNameTranslations, TARGET_LANGS } = require('../lib/product-name-generator')
  const { cleanKey, restoreTrademarkSymbols } = require('../lib/post-process')
  const { parseProductName, detectAdhocProductTerms, detectFallbackCandidates } = require('../lib/new-product-detect')
  const languages = new Set(TARGET_LANGS)
  const rows = [
    ...parseGlossaryCSVText(DEFAULT_GLOSSARY_PRODUCTS_CSV, languages),
    ...parseGlossaryCSVText(DEFAULT_GLOSSARY_EXCLUSIVE_CSV, languages),
  ]
  const productSource = scenario.identity ? source.replace('DIAMOND', 'SUPER') : source
  const canonical = restoreTrademarkSymbols([productSource], [generateProductNameTranslations(productSource.replace(/[®™©]/g, ''), scenario.identity ? 'SUPER' : 'DIAMOND').translations[lang]])[0]
  if (scenario.extra === 'zero-width-key') rows.unshift({ source: plain.replace('Lexar', 'Le​xar'), translations: { [lang]: 'Lexar Professional DIAMOND CFexpress 4.0 CURATED Type A' } })
  if (scenario.extra === 'exact') rows.unshift({ source: plain, translations: { [lang]: 'Lexar Professional DIAMOND CFexpress 4.0 CURATED Type A' } })
  if (scenario.extra === 'longer-key') rows.push({ source: `${plain} 512GB`, translations: { [lang]: `${canonical} 512GB` } })
  if (scenario.extra === 'longer-value') rows.push({ source: 'Synthetic review fixture', translations: { en: `${plain} 512GB`, [lang]: `${canonical} 512GB` } })

  const map = new Map<string, string>()
  for (const row of rows) {
    const value = row.translations[lang]
    if (value && !map.has(row.source)) map.set(row.source, value)
  }
  for (const row of rows) {
    for (const [language, key] of Object.entries(row.translations)) {
      if (language !== lang && key && row.translations[lang] && !map.has(key as string)) {
        map.set(key as string, row.translations[lang])
      }
    }
  }
  const text = scenario.text || source
  const normalized = cleanKey(text)
  const trace = {
    parsed: parseProductName(text),
    ruleCandidates: detectAdhocProductTerms([text], map).length,
    identityCandidates: detectFallbackCandidates([text], map).length,
    exactGlossary: [...map].some(([key]) => cleanKey(key) === normalized),
    containingGlossary: [...map.keys()].filter(key => cleanKey(key) !== normalized && cleanKey(key).includes(normalized)),
  }
  const app = readSource(path.resolve('ui/App.vue')).split('<script lang="ts" setup>')[1]?.split('</script>')[0]
  assert(app, 'App.vue script block must exist')
  const module = new Module(path.resolve('ui/product-routing-probe.cjs'))
  module.filename = path.resolve('ui/product-routing-probe.cjs')
  module.paths = Module._nodeModulePaths(path.resolve('ui'))
  module._compile(compile(app + probe), module.filename)
  if (scenario.identity) api.parseProductNameWithLLM = async () => { pipelineEntries.push('identity-only'); return { isProductName: true, series: 'SUPER' } }
  if (scenario.cancel) api.translateBatch = async (texts: string[]) => { pipelineEntries.push('cancelled-model-batch'); module.exports.cancelProbe(); return texts.map(() => 'Translated ordinary text') }
  const actual = await module.exports.runProbe(text, lang, rows, scenario.entry || 'batch', scenario)
  const label = `${revision} / ${lang} / ${scenario.name}`
  try {
    assert.equal(actual.source, text, 'Routing must not rewrite the canvas source')
    if (scenario.ordinary) {
      assert.deepEqual(pipelineEntries, ['translateBatch'], 'Ordinary prose must keep its model translation route')
      passed++
      console.log(`PASS ${label}: ordinary translation route preserved`)
      return
    }
    if (scenario.cancel) {
      assert.deepEqual(pipelineEntries, ['cancelled-model-batch'])
      assert(actual.errors.includes('ordinary-15'), 'Cancelled unprocessed text must remain retryable')
      assert(!actual.errors.includes('routing-probe'), 'Local product must succeed')
      assert.equal(actual.progress.current, 16, 'Progress includes local product and processed ordinary rows')
      passed++; console.log(`PASS ${label}`); return
    }
    assert.deepEqual(pipelineEntries, scenario.identity ? ['identity-only'] : [], 'Product names must not reach ordinary translation, polish or proofread pipelines')
    const expected = (scenario.extra === 'exact' || scenario.extra === 'zero-width-key') ? 'Lexar Professional DIAMOND CFexpress 4.0 CURATED Type A' : canonical
    assert.equal(actual.translation.replace(/[®™©]/g, ''), expected.replace(/[®™©]/g, ''), 'Use the curated name or deterministic generated name')
    if (scenario.extra !== 'exact' && scenario.extra !== 'zero-width-key' && scenario.entry !== 'proofread') {
      assert(actual.blockersBefore.includes('llmFallback'), 'Unconfirmed generated product must block application')
    }
    if (scenario.action) assert(!actual.blockersAfter.includes('llmFallback'), 'Review action must release the blocker')
    if (scenario.action === 'confirm') assert(actual.confirmed, 'Confirm must persist the matching pool entry')
    if (scenario.action === 'skip') assert.equal(actual.pending.length, 0, 'Skip must remove the matching pool entry')
    if (scenario.stale) {
      assert.equal(actual.proofreadText, ''); assert.equal(actual.corrected, false)
      assert.equal(actual.applied, false); assert.equal(actual.prohibited, false)
    }
    if (scenario.entry === 'retry') assert.equal(actual.progress.current, actual.progress.total, 'Local retry progress completes')
    if ((scenario.entry === 'single' || scenario.entry === 'retry') && scenario.extra !== 'exact') {
      assert(actual.pending.includes(productSource.replace(/[®™©]/g, '')), 'Rule-generated retry names must remain in the review pool')
    }
    passed++
    console.log(`PASS ${label}: ${JSON.stringify(actual.translation)}`)
  } catch (error) {
    failed++
    console.log(`FAIL ${label}: ${(error as Error).message.split('\n')[0]}`)
    console.log(JSON.stringify({ trace, pipelineEntries, translation: actual.translation,
      logs: actual.logs.filter((line: string) => /新产品名|S1短路|异常|失败/.test(line)) }))
  }
}

async function main() {
  const warn = console.warn, error = console.error
  console.warn = () => {}
  console.error = (...args: unknown[]) => {
    if (!args.some(arg => String(arg).includes('Offline routing trap:'))) error(...args)
  }
  try {
    for (revision of process.argv.slice(2).length ? process.argv.slice(2) : ['working-tree']) {
      for (const lang of ['pt', 'es']) {
        for (const scenario of scenarios) await check(scenario, lang)
      }
    }
  } finally {
    console.warn = warn
    console.error = error
    Module._extensions['.ts'] = originalLoader
    globalThis.setTimeout = realSetTimeout
  }
  console.log(`Product routing: ${passed} passed, ${failed} failed; API requests disabled; synthetic cases do not establish incident state.`)
  if (failed) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
