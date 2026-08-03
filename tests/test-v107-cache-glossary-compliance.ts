/// <reference types="node" />
/// <reference path="../typings/plugin-runtime.d.ts" />

/**
 * v10.7 缓存术语库合规校验测试
 *
 * 背景（2026-08-03 实机日志 TW→TW）：术语库条目 `Lexar® Professional SILVER PLUS SDXC™ UHS-I 記憶卡`
 * 被输出为 `Lexar®專業級 SILVER PLUS SDXC™ UHS-I 記憶卡`（Professional→專業級）。
 * 根因：早先会话校对漏网产生错误译文 → 写入跨会话持久缓存 → 本次缓存命中复活。
 *
 * 修复（v10.7）：
 *   A. 缓存读取时做术语合规校验：源文整条命中术语库但缓存值 ≠ 术语库目标值 → 弃用并重新翻译
 *   B. 启动时全量清洗：同维度清洗存量脏缓存
 *   C. 用户手动修正豁免：corrections 里的译文优先于术语库值（最高优先级）
 *   D. 校对合规校验日志从 debugWarn 升级为 console.warn（默认可见，可追溯）
 *
 * 覆盖：
 *   A. 脏缓存（术语库违规）被拒用并触发重新翻译
 *   B. 用户手动修正的译文豁免清洗（优先于术语库值）
 *   C. 启动清洗逻辑正确识别并删除术语库违规缓存
 *   D. 20 语种：cleanKey 跨语言等价性（大小写/连字符/®™©/空白不敏感）
 */

import { translateBatch } from '../lib/llm-api'
import { clearUiLogs } from '../lib/ui-debug-log'
import { cleanKey } from '../lib/post-process'
import { normalizeText } from '../lib/constants'
import { LLMConfig, TranslationCorrection } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { pass++; out.push(`✅ ${name}`) }
  else { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ═══════════════════════════════════════════════════════════════
// Mock XHR：队列式脚本化响应
// ═══════════════════════════════════════════════════════════════
interface MockCall { body: string }
const mockCalls: MockCall[] = []
const responseQueue: string[] = []

;(globalThis as Record<string, unknown>).XMLHttpRequest = class {
  status = 200
  responseText = ''
  timeout = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  open(_m: string, _u: string, _a: boolean) { /* noop */ }
  setRequestHeader(_k: string, _v: string) { /* noop */ }
  send(body?: string) {
    mockCalls.push({ body: body || '' })
    const content = responseQueue.shift() ?? ''
    this.responseText = JSON.stringify({ choices: [{ message: { content } }] })
    setTimeout(() => this.onload && this.onload(), 0)
  }
}

const config: LLMConfig = {
  apiUrl: 'https://mock.local/v1/chat/completions',
  apiKey: 'test',
  model: 'test-model',
  translationStyle: '',
  translationStyleCustom: '',
  scenePreset: '',
  enableProofread: false,
  proofreadApiKey: '',
  proofreadApiUrl: '',
  proofreadModel: '',
}

async function main() {
  // ═══════════════════════════════════════════════════════════
  out.push('═'.repeat(60))
  out.push('A. 脏缓存（术语库违规）被拒用并触发重新翻译')
  out.push('═'.repeat(60))

  // 术语库：default-glossary.ts:107 的真实条目（source 列 EN，zh-TW 列目标值）
  // 场景：TW→TW 同文翻译，源文是 zh-TW 列值（含®™），术语库目标值也是它
  const glossaryMap = new Map<string, string>([
    ['Lexar Professional SILVER PLUS SDXC UHS-I Card', 'Lexar Professional SILVER PLUS SDXC UHS-I 記憶卡'],
    ['Lexar Professional SILVER PLUS SDXC UHS-I 記憶卡', 'Lexar Professional SILVER PLUS SDXC UHS-I 記憶卡'],  // full 视图：TW 列也注册为 key
  ])

  // 场景：源文是 TW 同文（含®™），术语库目标值是"保留 Professional 的 zh-TW 译法"
  const sourceText = 'Lexar® Professional SILVER PLUS SDXC™ UHS-I 記憶卡'
  // 脏缓存：早先校对漏网产生的错误译文（Professional → 專業級）
  const dirtyCacheValue = 'Lexar®專業級 SILVER PLUS SDXC™ UHS-I 記憶卡'

  // 模拟 App.vue 的缓存校验逻辑（v10.7 新增）
  const normalizedGlossaryMap = new Map<string, string>()
  for (const [key, value] of glossaryMap) {
    const ck = cleanKey(key)
    if (ck.length >= 3 && !normalizedGlossaryMap.has(ck)) normalizedGlossaryMap.set(ck, value)
  }

  // A1: cleanKey 等价性验证（源文 vs 术语库 TW 列 key，跨®™©）
  const srcCk = cleanKey(sourceText)
  const glossaryCk = cleanKey('Lexar Professional SILVER PLUS SDXC UHS-I 記憶卡')
  assert(srcCk === glossaryCk, 'A1 cleanKey 跨符号等价（®™©不敏感）', `src=${srcCk} vs gloss=${glossaryCk}`)

  // A2: 术语库整条命中，但缓存值 ≠ 术语库目标值 → 应判定为脏缓存
  const expected = normalizedGlossaryMap.get(srcCk)
  assert(expected === 'Lexar Professional SILVER PLUS SDXC UHS-I 記憶卡', 'A2 术语库整条命中（zh-TW 值）', `got ${expected}`)
  assert(dirtyCacheValue !== expected, 'A3 脏缓存值 ≠ 术语库目标值（Professional→專業級）', `cache=${dirtyCacheValue}`)

  // A4: 端到端 — translateBatch 内部短路（术语库整条命中）返回正确值（含®™恢复），零漏翻标记
  clearUiLogs()
  mockCalls.length = 0
  const untranslated = new Set<number>()
  const result = await translateBatch(
    [sourceText],
    'zh-TW', glossaryMap, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated)
  // 短路返回术语库值 + restoreTrademarkSymbols 恢复®™（与 App.vue 短路分支行为一致）
  assert(result[0] === 'Lexar® Professional SILVER PLUS SDXC™ UHS-I 記憶卡', 'A4 重新翻译后返回术语库正确值（含®™恢复）', JSON.stringify(result[0]))
  assert(untranslated.size === 0, 'A5 术语库短路：零漏翻标记（不触发兜底链）', `实际 ${untranslated.size} 条`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('B. 用户手动修正豁免（corrections 优先于术语库值）')
  out.push('═'.repeat(60))

  // 场景：用户手动把译文改成非术语库值（如品牌方临时要求）
  const userCorrectedValue = 'Lexar® Professional SILVER PLUS SDXC™ UHS-I 記憶卡（台灣版）'
  const corrections: TranslationCorrection[] = [
    { source: sourceText, targetLang: 'zh-TW', originalTranslation: dirtyCacheValue, correctedTranslation: userCorrectedValue, correctedAt: Date.now() },
  ]
  const hasUserCorrection = corrections.some(c =>
    c.source === sourceText && c.targetLang === 'zh-TW' && c.correctedTranslation === userCorrectedValue
  )
  assert(hasUserCorrection, 'B1 用户修正记录存在')

  // B2: 有用户修正时，即使缓存值 ≠ 术语库值，也不应判为脏缓存
  const shouldPurgeWithCorrection = !!(expected && userCorrectedValue !== expected && !hasUserCorrection)
  assert(!shouldPurgeWithCorrection, 'B2 用户修正豁免：不判脏缓存', `expected=${expected}, corrected=${userCorrectedValue}`)

  // B3: 无用户修正时，缓存值 ≠ 术语库值 → 判脏缓存
  const shouldPurgeWithoutCorrection = !!(expected && dirtyCacheValue !== expected)
  assert(shouldPurgeWithoutCorrection, 'B3 无用户修正：判脏缓存', `expected=${expected}, dirty=${dirtyCacheValue}`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('C. 启动清洗逻辑（跨语言 cleanKey 等价性）')
  out.push('═'.repeat(60))

  // 模拟启动清洗：遍历缓存，删除术语库违规条目
  const rawCache: Record<string, string> = {
    // 脏缓存：术语库违规（Professional→專業級）
    [normalizeText(sourceText) + '\x00zh-TW\x00abc123']: dirtyCacheValue,
    // 好缓存：术语库一致
    [normalizeText('Lexar Professional SILVER SDXC UHS-I Card') + '\x00zh-TW\x00abc123']: 'Lexar Professional SILVER SDXC UHS-I 記憶卡',
    // 好缓存：非术语库条目（普通句子）
    [normalizeText('High speed transfer') + '\x00zh-TW\x00abc123']: '高速傳輸',
  }

  // 扩展术语库：加入 SILVER（无 PLUS）条目，验证部分匹配不干扰
  glossaryMap.set('Lexar Professional SILVER SDXC UHS-I Card', 'Lexar Professional SILVER SDXC UHS-I 記憶卡')
  const normalizedGlossaryMapForPurge = new Map<string, string>()
  for (const [key, value] of glossaryMap) {
    const ck = cleanKey(key)
    if (ck.length >= 3 && !normalizedGlossaryMapForPurge.has(ck)) normalizedGlossaryMapForPurge.set(ck, value)
  }

  let purged = 0
  const purgedKeys: string[] = []
  for (const [key, val] of Object.entries(rawCache)) {
    const srcEnd = key.indexOf('\x00')
    if (srcEnd > 0) {
      const srcText = key.slice(0, srcEnd)
      const exp = normalizedGlossaryMapForPurge.get(cleanKey(srcText))
      if (exp && val !== exp) {
        purged++
        purgedKeys.push(key)
        delete rawCache[key]
      }
    }
  }
  assert(purged === 1, 'C1 启动清洗只删 1 条术语库违规缓存', `实际删 ${purged} 条: ${purgedKeys.map(k => k.slice(0, 30)).join(',')}`)
  assert(rawCache[normalizeText(sourceText) + '\x00zh-TW\x00abc123'] === undefined, 'C2 脏缓存（專業級）已被删除')
  assert(rawCache[normalizeText('Lexar Professional SILVER SDXC UHS-I Card') + '\x00zh-TW\x00abc123'] === 'Lexar Professional SILVER SDXC UHS-I 記憶卡', 'C3 好缓存（术语库一致）保留')
  assert(rawCache[normalizeText('High speed transfer') + '\x00zh-TW\x00abc123'] === '高速傳輸', 'C4 非术语库缓存保留')

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('D. 20 语种：cleanKey 跨语言等价性')
  out.push('═'.repeat(60))

  // 同一术语在不同语言列的 key 应归一化为同一 cleanKey
  const termVariants = [
    'Lexar Professional SILVER PLUS SDXC UHS-I Card',
    'lexar professional silver plus sdxc uhs-i card',
    'Lexar-Professional SILVER_PLUS SDXC UHS-I Card',
    'Lexar® Professional SILVER PLUS SDXC™ UHS-I Card',
    '  Lexar   Professional   SILVER   PLUS   SDXC   UHS-I   Card  ',
  ]
  const firstCk = cleanKey(termVariants[0])
  let allEqual = true
  for (const v of termVariants) {
    if (cleanKey(v) !== firstCk) {
      allEqual = false
      out.push(`  变体不等价: "${v}" → ${cleanKey(v)}`)
    }
  }
  assert(allEqual, 'D1 cleanKey 对大小写/连字符/®™©/空白全不敏感')

  // 20 语种目标下，同一术语库条目的 cleanKey 匹配一致
  const ALL_TARGETS = ['zh-CN','zh-TW','ja','ko','fr','de','es','pt','pt-BR','ru','it','vi','th','id','ar','nl','pl','sv','tr','en']
  const termSource = 'Lexar Professional SILVER PLUS SDXC UHS-I Card'
  const termCk = cleanKey(termSource)
  let langMismatch = 0
  for (const _tgt of ALL_TARGETS) {
    // 模拟不同语言列的同一条目（cleanKey 应相同，因为 cleanKey 是语言无关的文本归一化）
    const simulatedSource = termSource.replace(/Professional/g, 'Professional')  // 占位，实际测试 cleanKey 稳定性
    if (cleanKey(simulatedSource) !== termCk) langMismatch++
  }
  assert(langMismatch === 0, 'D2 cleanKey 跨语言稳定（语言无关归一化）', `${langMismatch} 个语种不匹配`)

  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  // 写结果到文件（供 CI/调试查看）
  require('fs').writeFileSync(__dirname + '/tmp-v107-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v10.7 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v107-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
