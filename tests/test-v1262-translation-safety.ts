/// <reference types="node" />
import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import * as ts from 'typescript'
import { normalizeTextForLLM } from '../lib/text-normalizer'
import { maskGlossaryTerms } from '../lib/entity-masker'
import { retrieveTM, retrieveTMShortCircuit } from '../lib/translation-memory'
import { validateNumbers } from '../lib/post-process'
import { validatePolishOutput } from '../lib/polish-guard'
import { buildSystemPrompt, proofreadBatch, translateBatch, polishBatch } from '../lib/llm-api'
import { buildProofreadSystemPrompt, getStyleCard, getStyleCardSplit, getTechnicalRegister } from '../lib/prompt-constants'
import { LLMConfig, TranslationCorrection } from '../messages/types'

let passed = 0, failed = 0
async function check(name: string, run: () => void | Promise<void>) {
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${(error as Error).message}`) }
}
const config: LLMConfig = {
  apiKey: 'offline-placeholder', apiUrl: 'https://offline.invalid', model: 'offline',
  translationStyle: 'standard', translationStyleCustom: '', scenePreset: 'ecommerce',
  enableProofread: true, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '',
}
let replies: string[] = [], requests: Array<{ messages: Array<{ role: string; content: string }> }> = []
;(globalThis as any).XMLHttpRequest = class {
  status = 200
  responseText = ''
  onload = () => {}
  open() {}
  setRequestHeader() {}
  send(body: string) {
    requests.push(JSON.parse(body))
    const reply = replies.shift()
    if (reply === undefined) throw Error('Unexpected request: no offline response queued')
    this.responseText = JSON.stringify({ choices: [{ message: { content: reply } }] })
    queueMicrotask(() => this.onload())
  }
}
function correction(source: string): TranslationCorrection {
  return { source, targetLang: 'es', correctedTranslation: 'Approved translation', originalTranslation: '', correctedAt: 1, origin: 'user' }
}
async function proofread(source: string, before: string, after: string) {
  replies = [JSON.stringify({ results: [{ i: 1, text: after, reason: '语义错误', ambiguous: [] }] })]
  const result = await proofreadBatch([{ sourceText: source, translatedText: before }], 'es', new Map(), config)
  assert.equal(replies.length, 0)
  return result[0].text
}
async function main() {
  await check('normalization never invents trademarks, including existing PUA', () => {
    for (const source of ['Read speed 100MB/s', 'CFexpress™ Type A', 'Lexar®', 'AB™', 'ＡＢＣ™ １２３']) {
      const actual = normalizeTextForLLM([source])[0]
      assert.equal((actual.match(/™/g) || []).length, (source.match(/™/g) || []).length)
      assert.equal(normalizeTextForLLM([actual])[0], actual)
    }
    assert.equal(normalizeTextForLLM(['AB™'])[0], 'AB™')
    assert.equal(normalizeTextForLLM(['ＡＢＣ™ １２３'])[0], 'ABC™ 123')
  })
  await check('normalization preserves multiword glossary masking', () => {
    const masked = maskGlossaryTerms(normalizeTextForLLM(['Read speed up to 100MB/s']), new Map([['read speed', 'Velocidad de lectura']]))
    assert.equal(masked.termMap.size, 1)
  })
  await check('TM exact reuse rejects reversed direction, multiplicity, case and line boundaries', () => {
    for (const [a, b] of [
      ['Read speed exceeds write speed', 'Write speed exceeds read speed'],
      ['Transfer photos from camera to SSD', 'Transfer photos from SSD to camera'],
      ['Very very fast storage for creators', 'Very fast storage for creators'],
      ['Device supports ABC and abc storage', 'Device supports abc and ABC storage'],
      ['Others No Anti-glare\nPexar Anti-glare', 'Others No Anti-glare Pexar Anti-glare'],
    ]) assert.equal(retrieveTMShortCircuit([b], [correction(a)], 'es').size, 0, `${a} / ${b}`)
    assert.equal(retrieveTMShortCircuit(['  Transfer  photos to storage  '], [correction('Transfer photos to storage')], 'es').get(0), 'Approved translation')
    assert(retrieveTM(['Write speed exceeds read speed'], [correction('Read speed exceeds write speed')], 'es').length > 0, 'Similar sentences remain generation references')
  })
  await check('numeric quantities preserve decimals and complete units', () => {
    for (const [a, b] of [
      ['Capacity 1.5GB', 'Capacidad 15GB'], ['Read speed 900MB/s', 'Velocidad 900MB'],
      ['Read speed 900MB/s', 'Velocidad 900GB/s'], ['Capacity 128GB', 'Capacidad 128TB'],
      ['Clock 0.005GHz', 'Reloj 0.006GHz'], ['Exposure 10mGy', 'Exposure 10GHz'],
    ]) assert(validateNumbers([a], [b]).tamperedIndices.has(0), `${a} / ${b}`)
    for (const [a, b] of [
      ['Capacity 1.5GB', 'Capacité 1,5 Go'], ['Speed 3,500MB/s', 'Vitesse 3 500 Mo/s'],
      ['Speed 3,500.5MB/s', 'Vitesse 3.500,5 Mo/s'], ['Capacity 1TB', '容量１TB'],
      ['Speed 900MB/s capacity 4TB', 'Capacité 4 To et vitesse 900 Mo/s'],
      ['Speed 2000MB/s', 'Скорость 2000МБ/с'],
    ]) assert.equal(validateNumbers([a], [b]).mismatchedIndices.size, 0, `${a} / ${b}`)
    const missing = validateNumbers(['Read 100MB/s write 90MB/s'], ['Read 100MB/s'])
    assert(missing.mismatchedIndices.has(0)); assert.equal(missing.tamperedIndices.size, 0, 'Existing count-only warning policy stays intact')
  })
  await check('polish rejects decimal changes and rate-to-capacity changes', () => {
    assert.equal(validatePolishOutput('Read speed up to 900MB/s', 'Velocidad de lectura de hasta 900MB.', 'es').ok, false)
    assert.equal(validatePolishOutput('Capacity up to 1.5GB', 'Capacidad de hasta 15GB', 'es').ok, false)
    assert.equal(validatePolishOutput('Read speed up to 900MB/s', 'Vitesse de lecture de 900 Mo/s', 'fr').ok, true)
  })
  await check('proofread cannot change a correct numeric fact', async () => {
    const before = 'Velocidad de lectura de hasta 100 MB/s.'
    assert.equal(await proofread('Read speed up to 100 MB/s.', before, 'Velocidad de lectura de hasta 200 MB/s.'), before)
  })
  await check('proofread cannot drop a complete unit or a previously present quantity', async () => {
    const before = 'Velocidad de lectura de hasta 100 MB/s.'
    assert.equal(await proofread('Read speed up to 100 MB/s.', before, 'Velocidad de lectura de hasta 100 MB.'), before)
    const both = 'Lectura 100MB/s y escritura 90MB/s.'
    assert.equal(await proofread('Read 100MB/s and write 90MB/s.', both, 'Lectura 100MB/s.'), both)
  })
  await check('proofread may repair an already incorrect numeric fact', async () => {
    assert.equal(await proofread('Read speed up to 100 MB/s.', 'Velocidad de lectura de hasta 200 MB/s.', 'Velocidad de lectura de hasta 100 MB/s.'), 'Velocidad de lectura de hasta 100 MB/s.')
  })
  await check('technical prompt does not upgrade protocols, delete information or fight unit formatting', () => {
    const card = getTechnicalRegister('en')
    assert(!card.includes('not "USB 3.0"'))
    assert(!card.includes('Units standard half-width with a space'))
    assert(card.includes('Preserve source protocol names and versions'))
    assert(card.includes('preserve all source meaning'))
  })
  await check('scene examples do not insert warranty, hardware or absolute performance claims', () => {
    assert(!getStyleCard('ja', 'gaming_ssd', 'standard', 'ecommerce').includes('5年保証'))
    assert(!getStyleCard('ja', 'gaming_ssd', 'standard', 'ecommerce').includes('完全カット'))
    assert(!getStyleCard('de', 'gaming_ssd', 'standard', 'ecommerce').includes('Samsung B-Die'))
  })
  await check('style selections are distinct, and retries keep the same bounded style', () => {
    assert.notEqual(getStyleCard('es', 'gaming_ssd', 'professional', 'ecommerce'), getStyleCard('es', 'gaming_ssd', 'marketing', 'ecommerce'))
    for (const scene of ['ecommerce', 'manual']) for (const style of ['standard', 'professional', 'marketing']) {
      assert.equal(getStyleCard('es', 'gaming_ssd', style, scene), getStyleCardSplit('es', 'gaming_ssd', style, scene))
    }
    const prompt = buildSystemPrompt({ targetLang: 'es', langBlock: '', styleCard: '', fewShotBlock: '' })
    assert(!prompt.includes('Independent UI strings'))
  })
  await check('custom style reaches the real translation request as subordinate style data', async () => {
    requests = []; replies = [JSON.stringify({ translations: [{ i: 1, text: 'Captura cada momento con claridad.' }] })]
    await translateBatch(['Capture every moment with clarity.'], 'es', new Map(), { ...config, translationStyle: 'custom', translationStyleCustom: 'CUSTOM_STYLE_PROBE: use formal usted' })
    const prompt = requests[0].messages[0].content
    assert(prompt.includes('CUSTOM_STYLE_PROBE'))
    assert(prompt.includes('must not override fidelity'))
  })
  await check('technical proofreading does not reintroduce marketing calibration', () => {
    const build = buildProofreadSystemPrompt as any
    assert(!build({ targetLang: 'es', productLine: 'gaming_ssd', useEnInstruction: true, scenePreset: 'manual' }).includes('[MARKET CALIBRATION'))
    assert(build({ targetLang: 'es', productLine: 'gaming_ssd', useEnInstruction: true, scenePreset: 'ecommerce' }).includes('[MARKET CALIBRATION'))
  })
  await check('polish addresses only the translated segment that contains the issue', async () => {
    requests = []; replies = [JSON.stringify({ polished: [{ i: 1, text: 'Una segunda frase original suena natural.', changes: [{ issueIndex: 0, before: 'suena robótica', after: 'suena natural' }] }] })]
    await polishBatch(['The first source sentence is unchanged.\nThe second source sentence needs polishing.'], ['La primera frase original no cambia.\nUna segunda frase original suena robótica.'], [0], new Map([[0, [{ type: 'calque', span: 'suena robótica', suggestion: 'suena natural' }]]]), 'es', config)
    assert.equal(requests.length, 1)
    assert(!requests[0].messages[1].content.includes('The first source sentence'))
    assert(requests[0].messages[1].content.includes('The second source sentence'))
  })
  await check('shared-unit capacity lists are not concatenated into one quantity', () => {
    for (const [source, target] of [
      ['Capacities: 128, 256, 512GB', 'Capacidades: 128, 256 y 512GB'],
      ['Capacities: 128, 256, 512 GB', 'Capacidades: 128 / 256 / 512 GB'],
      ['Speed 3,500 MB/s', 'Vitesse 3 500 Mo/s'],
    ]) {
      const result = validateNumbers([source], [target])
      assert.equal(result.mismatchedIndices.size, 0, `${source} / ${target}`)
      assert.equal(result.tamperedIndices.size, 0)
    }
  })
  await check('endurance TBW remains a complete protected unit', () => {
    assert.equal(validatePolishOutput('Endurance rated up to 600TBW', 'Ausdauer von bis zu 600', 'de').ok, false)
    assert.equal(validatePolishOutput('Endurance rated up to 600TBW', 'Ausdauer von bis zu 600TB', 'de').ok, false)
    assert.equal(validatePolishOutput('Endurance rated up to 600TBW', 'Ausdauer von bis zu 600 TBW', 'de').ok, true)
  })
  await check('proofread numeric guard preserves curated whole-entry values without a precomputed index', async () => {
    for (const indexed of [false, true]) {
      const source = 'Rated speed 100MB/s'
      const curated = 'Velocidad nominal 200MB/s'
      const glossary = new Map([[source, curated]])
      replies = [JSON.stringify({ results: [] })]
      const result = await proofreadBatch([{ sourceText: source, translatedText: 'Velocidad nominal 100MB/s' }], 'es', glossary, config,
        undefined, undefined, undefined, indexed ? new Map([['rated speed 100mb/s', curated]]) : undefined)
      assert.equal(result[0].text, curated)
      assert.equal(replies.length, 0)
    }
  })
  await check('polish matches judge spans in the same trademark-stripped view', async () => {
    requests = []; replies = [JSON.stringify({ polished: [{ i: 1, text: 'Mit Lexar Speicher wird dein Spiel schneller.', changes: [{ issueIndex: 0, before: 'Lexar Speicher', after: 'Lexar Speicher' }] }] })]
    const result = await polishBatch(['With Lexar® storage your game gains speed.'], ['Mit Lexar® Speicher gewinnt dein Spiel an Tempo.'], [0],
      new Map([[0, [{ type: 'calque', span: 'Lexar Speicher', suggestion: 'Use a natural German formulation' }]]]), 'de', config)
    assert.equal(requests.length, 1)
    assert.equal(replies.length, 0)
    assert(result[0].polished)
    assert(result[0].text.includes('Lexar®'))
  })
  await check('an unmatched polish issue never edits another segment', async () => {
    requests = []; replies = []
    const before = 'La traducción original ya es correcta.'
    const result = await polishBatch(['The original source already reads correctly.'], [before], [0], new Map([[0, [{ type: 'calque', span: 'not present in translation', suggestion: 'Do not apply' }]]]), 'es', config)
    assert.equal(requests.length, 0)
    assert.equal(result[0].text, before)
    assert.equal(result[0].polished, false)
  })
  await check('cache identity covers full glossary and effective translation settings', () => {
    const app = readFileSync('ui/App.vue', 'utf8')
    const section = app.slice(app.indexOf('  const glossaryHash ='), app.indexOf('  let cacheHits ='))
    const evaluate = new Function('glossary', 'targetLang', 'adhocTerms', 'normalizeText', 'PROHIBITED_WORDS_VERSION', 'CORPUS_VERSION', 'GLOSSARY_VERSION', 'llmConfig', 'sourceLang', 'pageName', 'fileName', `${ts.transpileModule(section, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText}; return cacheKey('Some source');`)
    const rows = [{ source: 'Prefix '.repeat(50), translations: { es: 'first' } }, { source: 'Later term', translations: { es: 'old' } }]
    const run = (settings: LLMConfig = config) => evaluate({ value: rows }, { value: 'es' }, [], (s: string) => s, 1, 2, 13, { value: settings }, { value: 'auto' }, { value: '' }, { value: '' })
    const before = run()
    rows[1].translations.es = 'new'
    assert.notEqual(run(), before)
    const current = run()
    assert.notEqual(run({ ...config, scenePreset: 'manual' }), current)
    assert.notEqual(run({ ...config, model: 'another-model' }), current)
    assert.notEqual(run({ ...config, translationStyle: 'custom', translationStyleCustom: 'Formal' }), current)
  })
  await check('quality judge failures stay unscored and cannot enter baselines', async () => {
    const text = readFileSync('tests/test-v1228-quality-gate.ts', 'utf8')
    const section = text.slice(text.indexOf('async function judgeTranslation('), text.indexOf('// 报告输出'))
    const js = ts.transpileModule(section, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    for (const response of [null, { fidelity: 4, naturalness: 4 }, { fidelity: 0, naturalness: 4, tone: 4 }]) {
      const judge = new Function('fetch', 'LIVE_MODE', 'API_URL', 'API_KEY', 'process', `${js}; return judgeTranslation;`)(
        async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }),
        true, 'https://offline.invalid', 'offline-placeholder', { env: {} },
      )
      assert.equal(await judge('Source', 'Translation', 'es'), null)
    }
    assert(!text.includes('g.translations[\'en\'] && !en.has'))
  })
  await check('actual UI translation plus proofread preserves the correct quantity', async () => {
    require('vue')
    const Module = require('module')
    const path = require('path')
    ;(globalThis as any).document = { querySelectorAll: () => [], querySelector: () => null }
    ;(globalThis as any).window = {}
    ;(globalThis as any).parent = { postMessage: () => {} }
    const filename = path.resolve('ui/translation-safety-probe.cjs')
    const module = new Module(filename)
    module.filename = filename
    module.paths = Module._nodeModulePaths(path.dirname(filename))
    const app = readFileSync('ui/App.vue', 'utf8').split('<script lang="ts" setup>')[1].split('</script>')[0]
    const probe = `
      exports.run = async () => {
        settingsReady = true; glossaryReady = true;
        targetLang.value = 'es'; glossaryProducts.value = []; glossaryExclusive.value = []; pendingReviewTerms.value = [];
        llmConfig.value = ${JSON.stringify({ ...config, scenePreset: 'technical_params' })};
        items.value = [{ sourceText:'Read speed up to 100MB/s.',translatedText:'',proofreadText:'',nodeIds:['probe'],nodeNames:['probe'] }];
        await startTranslate(); return items.value[0].translatedText;
      };`
    const warn = console.warn
    console.warn = () => {}
    try {
      module._compile(ts.transpileModule(app + probe, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename)
      requests = []
      replies = [JSON.stringify({ translations: [{ i: 1, text: 'Velocidad de lectura de hasta 100MB/s.' }] }), JSON.stringify({ results: [{ i: 1, text: 'Velocidad de lectura de hasta 200MB/s.', reason: '语义错误', ambiguous: [] }] })]
      assert.equal(await module.exports.run(), 'Velocidad de lectura de hasta 100MB/s.')
      assert.equal(requests.length, 2, 'Real UI flow calls translation and proofreading, never polish for specifications')
      assert.equal(replies.length, 0)
    } finally { console.warn = warn }
  })
  console.log(`Translation safety: ${passed} passed, ${failed} failed; all requests mocked`)
  if (failed) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
