/**
 * 第三方型号兼容列表（用户实机格式）× 4 目标语言 —— 现有逻辑诊断测试
 *
 * 输入：用户提供的真实兼容列表格式（型号被粘贴成多行碎片 + 斜杠分隔）
 * 目的：验证每条文本走过哪些防线、最终结果是否合理
 *   S1 整条短路（术语库命中）
 *   isUntranslatable 豁免（含 isModelListOrCode 型号列表）
 *   S2 遮蔽（术语库子串 → __GLOSSARY_N__，unmask 同形还原）
 *   走 LLM（mock 原样回显，隔离代码层行为）
 *
 * 判定原则（本项目红线）：
 *   整条都是型号 → 任何语言下原样保留 = 正确；被翻译 = 错
 *   混合「型号+功能词」的碎片（如 'Osmo Nano Hero 13 Black'）→ 遮蔽住已知型号、
 *   功能词交给 LLM = 当前架构下的正确行为（遮蔽颗粒度 vs 功能词翻译的权衡）
 *   ⛔ 任何语言下出现死循环/异常 = 卡死回归
 */

import { translateBatch, isUntranslatable } from '../lib/llm-api'
import { maskGlossaryTerms, unmaskGlossaryTerms } from '../lib/entity-masker'
import { DEFAULT_GLOSSARY_EXCLUSIVE_CSV } from '../lib/default-glossary'
import { BUILTIN_THIRD_PARTY_ENTRIES } from '../lib/third-party-models'
import { clearUiLogs } from '../lib/ui-debug-log'
import { GlossaryEntry, LLMConfig } from '../messages/types'

const out: string[] = []
let pass = 0
let fail = 0
let note = 0

function ok(name: string, detail?: string) { pass++; out.push(`✅ ${name}${detail ? ' — ' + detail : ''}`) }
function bad(name: string, detail?: string) { fail++; out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`) }
function info(name: string, detail?: string) { note++; out.push(`ℹ️  ${name}${detail ? ' — ' + detail : ''}`) }

// ═══ Mock XHR：原样回显（隔离代码层：LLM 不改一个字时代码该做什么）═══
interface MockCall { body: string }
const mockCalls: MockCall[] = []
let echoResponder: ((texts: string[]) => string) | null = null

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
    let content = ''
    if (echoResponder) {
      try {
        const parsed = JSON.parse(body || '{}')
        const userMsg: string = parsed.messages?.[parsed.messages.length - 1]?.content || ''
        // 与 translateBatch 组装格式对齐：[N] (src→tgt) "文本"（含空白加引号）或裸文本；跨行吃到下一个 [N]
        const texts = [...userMsg.matchAll(/^\[(\d+)\]\s*\([a-zA-Z-]+→[a-zA-Z-]+\)\s?"?((?:.(?!\n\[\d+\] ))*.)/gs)]
          .map(m => {
            let t = m[2]
            if (t.endsWith('"')) t = t.slice(0, -1)
            return t
          })
        content = echoResponder(texts)
      } catch (e) { content = 'PARSE_ERROR: ' + e }
    }
    this.responseText = JSON.stringify({ choices: [{ message: { content } }] })
    setTimeout(() => this.onload && this.onload(), 0)
  }
}

const config: LLMConfig = {
  apiUrl: 'https://mock.local/v1/chat/completions',
  apiKey: 'test', model: 'test-model',
  translationStyle: '', translationStyleCustom: '', scenePreset: '',
  enableProofread: false, proofreadApiKey: '', proofreadApiUrl: '', proofreadModel: '',
}

/** 复刻 ui/App.vue buildGlossaryMaps 三方合并（内置优先，first-wins） */
function buildMergedMap(userEntries: GlossaryEntry[], targetLang: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const b of BUILTIN_THIRD_PARTY_ENTRIES) {
    map.set(b.source, b.translations['*'] || b.source)
  }
  for (const g of userEntries) {
    const tgtVal = g.translations[targetLang]
    if (!tgtVal) continue
    if (!map.has(g.source)) map.set(g.source, tgtVal)
    for (const [lang, srcVal] of Object.entries(g.translations)) {
      if (lang === targetLang) continue
      if (srcVal && !map.has(srcVal)) map.set(srcVal, tgtVal)
    }
  }
  return map
}

function parseExclusiveEntries(): GlossaryEntry[] {
  const lines = DEFAULT_GLOSSARY_EXCLUSIVE_CSV.split('\n').filter(l => l.trim())
  const header = lines[0].split(',')
  return lines.slice(1).map(line => {
    const cols = line.split(',')
    const translations: Record<string, string> = {}
    for (let i = 1; i < header.length; i++) {
      if (cols[i]?.trim()) translations[header[i].trim()] = cols[i].trim()
    }
    return { source: cols[0].trim(), translations }
  })
}

const userExclusive = parseExclusiveEntries()

// ═══ 用户实机输入（原样，含碎行/多空格）═══
const LINES = [
  'Pocket 3 /',
  'Pocket 2\n /',
  'Pocket 1 / Action 5 Pro / Action 4 / Action 3 /',
  'Action 2 / Action / Osmo Nano Hero 13 Black\n  / Hero 12 Black\n\n  / Hero 11 Black',
  'Hero 10 Black\n\n  / Hero 9 Black\n  / Hero 8 Black',
  'Hero 7 black / Max',
  'X5\n / X4',
  'ONE X3\n\n\n / ONE X2',
  '\n\n / ONE RS\n\n / ONE R',
  ' Mavic 4 Pro\n / Mavic 3 Pro\n\n / Mavic 3\n / Mavic 2 Pro',
  'Mini 4 Pro / Mini 2\n / Air 3s / Air 3\n\n\n / Avata 2',
  'Switch NS\n / Switch Lite Ace Pro 2  / \nAce Pro\n  / GO Ultra\n',
]

const builtinSources = new Set(BUILTIN_THIRD_PARTY_ENTRIES.map(b => b.source))

async function main() {
  out.push('═'.repeat(70))
  out.push('第一部分：逐条防线判定（语言无关，代码层）')
  out.push('═'.repeat(70))

  const mapDe = buildMergedMap(userExclusive, 'de')

  for (const line of LINES) {
    const flat = line.replace(/\s+/g, ' ').trim()
    const untrans = isUntranslatable(line, mapDe)
    const masked = maskGlossaryTerms([line], mapDe)
    const placeholders = [...masked.texts[0].matchAll(/__GLOSSARY(?:ALT)?_(\d+)__/g)].map(m => m[1])
    const rt = unmaskGlossaryTerms(masked.texts, masked.termMap)
    const rtOk = rt.texts[0] === line

    // 遮蔽命中的术语 = termMap 里的值（identity 词条 = 文本侧写法）
    const maskedTerms = [...masked.termMap.values()]

    let verdict: string
    if (untrans) {
      verdict = `豁免整条（不送 LLM）`
      ok(`「${flat.slice(0, 44)}」→ isUntranslatable 豁免`, '')
    } else if (placeholders.length > 0) {
      const leftover = masked.texts[0].replace(/__GLOSSARY(?:ALT)?_\d+__/g, '▢').replace(/\s+/g, ' ').trim()
      verdict = `遮蔽 ${placeholders.length} 处 [${maskedTerms.join(' | ')}]，残余送 LLM: ${leftover}`
      info(`「${flat.slice(0, 44)}」→ ${verdict}`)
    } else {
      verdict = `零命中，整条送 LLM`
      bad(`「${flat.slice(0, 44)}」→ 零防线命中，完全裸露给 LLM`)
    }
    if (!rtOk) bad(`  ↳ unmask 往返不一致`, `got ${JSON.stringify(rt.texts[0])}`)
    void verdict
  }

  out.push('')
  out.push('═'.repeat(70))
  out.push('第二部分：4 语言 translateBatch 端到端（LLM mock 原样回显）')
  out.push('  目标语言：zh-TW 繁中 / de 德 / ko 韩 / sv 瑞典（代挪威——插件无挪威语）')
  out.push('  判定：整条型号 → 原样保留为对；任何变化/异常 = 失败')
  out.push('═'.repeat(70))

  for (const lang of ['zh-TW', 'de', 'ko', 'sv']) {
    const map = buildMergedMap(userExclusive, lang)
    clearUiLogs()
    mockCalls.length = 0
    echoResponder = (texts) => texts.map((t, i) => `[${i + 1}] ${t}`).join('\n')

    const untranslated = new Set<number>()
    let threw: unknown = null
    let results: string[] = []
    const t0 = Date.now()
    try {
      results = await translateBatch(
        LINES, lang, map, config,
        undefined, undefined, undefined, undefined, undefined, undefined,
        false, false, undefined, untranslated)
    } catch (e) { threw = e }
    const ms = Date.now() - t0

    out.push('')
    out.push(`── ${lang} ──（耗时 ${ms}ms，API 调用 ${mockCalls.length} 次，漏翻上报 ${untranslated.size} 条）`)
    if (threw) { bad(`${lang} 抛异常`, String(threw).slice(0, 200)); continue }
    if (ms > 10000) { bad(`${lang} 耗时异常`, `${ms}ms 疑似死循环`); continue }

    for (let i = 0; i < LINES.length; i++) {
      const src = LINES[i]
      const dst = results[i] ?? '(missing)'
      const flatSrc = src.replace(/\s+/g, ' ').trim()
      const flatDst = (dst || '').replace(/\s+/g, ' ').trim()
      // 空白归一化后相等 = 代码层没改字（含型号大小写）→ 对
      if (flatDst === flatSrc) {
        ok(`  「${flatSrc.slice(0, 40)}」→ 原样保留`)
      } else if (flatDst.toLowerCase() === flatSrc.toLowerCase()) {
        // 仅空白/大小写差异（如 Air 3s→Air 3S 是术语库内置词条 'Air 3S' 还原官方字形）→ 可接受，观察
        info(`  「${flatSrc.slice(0, 40)}」→ 仅大小写/空白差异`, `got ${flatDst.slice(0, 80)}`)
      } else {
        bad(`  「${flatSrc.slice(0, 40)}」→ 内容被改动`, `got ${flatDst.slice(0, 80)}`)
      }
    }
  }

  out.push('')
  out.push('═'.repeat(70))
  out.push(`结果：${pass} 通过，${fail} 失败，${note} 条观察`)
  out.push('═'.repeat(70))

  require('fs').writeFileSync(__dirname + '/tmp-compat-list-out.txt', out.join('\n'), 'utf8')
  console.log(out.join('\n'))
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-compat-list-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
