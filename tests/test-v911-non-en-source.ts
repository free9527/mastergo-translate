/**
 * v9.11 非英源文漏翻闭环测试
 *
 * 根因（2026-07-31 实测）：pt 源文 "Resistente a altas temperaturas" → ja 漏翻。
 *   1. 逐条标注 detectSingleTextLanguage 对拉丁文本恒返回 'en'（v9.3 死代码），
 *      user message 标注 "(en→ja)" 让模型困惑"这不是英文"而回显原文。
 *   2. Layer 3 静默保留原文（v8.7 设计），用户完全无感知。
 *
 * 修复：
 *   F1 标注改用批次级 detectedSource（翻译 + 校对两条管道）
 *   F2 激进层指令补充"源文可能是任何语言"
 *   F3 translateBatch 新增 untranslatedIndices 输出 — 最终仍漏翻条目暴露给 UI 标记翻译失败
 *   F3b detectUntranslatedText 同源语言批次豁免（de→de 等校对工作流不误判）
 */

import { translateBatch, proofreadBatch, detectSourceLanguage, isUntranslatable, detectUntranslatedText } from '../lib/llm-api'

const out: string[] = []
let pass = 0
let fail = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass++
    out.push(`✅ ${name}`)
  } else {
    fail++
    out.push(`❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock XHR：队列式脚本化响应
// ═══════════════════════════════════════════════════════════════
interface MockCall { body: string }
const mockCalls: MockCall[] = []
const responseQueue: string[] = []
function enqueueResponse(content: string) { responseQueue.push(content) }

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

const config = { apiUrl: 'https://mock.local/v1/chat/completions', apiKey: 'test', model: 'test-model', translationStyle: '' }
const emptyGlossary = new Map<string, string>()

// 用户实测批次（4 条 pt 文本，detectSourceLanguage 拉丁细分可判 pt）
const PT_BATCH = [
  'Resistente a altas temperaturas',
  'Resistente a baixas temperaturas',
  'Alta velocidade de leitura',
  'Proteção contra água e poeira',
]

function firstCallUserMessage(): string {
  const body = JSON.parse(mockCalls[0].body)
  return body.messages?.[1]?.content || ''
}

async function main() {
  // ═══════════════════════════════════════════════════════════
  // A. F1：批次级源语言标注（翻译管道）
  // ═══════════════════════════════════════════════════════════
  out.push('═'.repeat(60))
  out.push('A. F1 批次级源语言标注（修 v9.3 逐条死代码）')
  out.push('═'.repeat(60))

  assert(detectSourceLanguage(PT_BATCH) === 'pt', 'A0 批次级检测：4 条 pt 文本判为 pt', `got ${detectSourceLanguage(PT_BATCH)}`)

  enqueueResponse('[1] 高温に強い\n[2] 低温に強い\n[3] 高速読み取り\n[4] 防水防塵')
  mockCalls.length = 0
  await translateBatch(PT_BATCH, 'ja', emptyGlossary, config)
  const userMsg = firstCallUserMessage()
  assert(userMsg.includes('(pt→ja)'), 'A1 pt 批次首调标注 (pt→ja)', userMsg.slice(0, 80))
  assert(!userMsg.includes('(en→ja)'), 'A2 pt 批次不再标注 (en→ja)')

  // 英源批次不受影响
  enqueueResponse('[1] 高速性能\n[2] ゲームに最適')
  mockCalls.length = 0
  await translateBatch(['High speed performance', 'Ideal for gaming'], 'ja', emptyGlossary, config)
  assert(firstCallUserMessage().includes('(en→ja)'), 'A3 en 批次仍标注 (en→ja)')

  // 手动指定源语言优先
  enqueueResponse('[1] Alta velocidad')
  mockCalls.length = 0
  await translateBatch(['High speed'], 'es', emptyGlossary, config, 'fr')
  assert(firstCallUserMessage().includes('(fr→es)'), 'A4 手动 sourceLang 优先于自动检测')

  // 校对管道同样修（F1 覆盖 proofreadBatch）
  enqueueResponse('[]')  // 校对 LLM 返回空数组 = 全部 OK
  mockCalls.length = 0
  await proofreadBatch(
    PT_BATCH.map(t => ({ sourceText: t, translatedText: 'ダミー訳文' })),
    'ja', emptyGlossary, config,
  )
  const proofUserMsg = firstCallUserMessage()
  assert(proofUserMsg.includes('(pt→ja)'), 'A5 校对管道标注同步批次级 (pt→ja)', proofUserMsg.slice(0, 80))

  // ═══════════════════════════════════════════════════════════
  // B. F2：激进层指令含"任意语言"声明
  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('B. F2 激进层指令补充非英源文声明')
  out.push('═'.repeat(60))

  // ja 目标 → 中文激进指令
  enqueueResponse('[1] Resistente a altas temperaturas')  // 首调回显 → 漏翻
  enqueueResponse('[1] Resistente a altas temperaturas')  // 统一重试回显 → 仍漏翻
  enqueueResponse('高温に強い')                            // 激进单条成功
  mockCalls.length = 0
  await translateBatch(['Resistente a altas temperaturas'], 'ja', emptyGlossary, config)
  assert(mockCalls.length === 3, 'B0 触发完整兜底链（首调+重试+激进）', `got ${mockCalls.length}`)
  const agSysZh = JSON.parse(mockCalls[2].body).messages[0].content as string
  assert(agSysZh.includes('源文可能是任何语言'), 'B1 ja 目标激进指令（中文）含"源文可能是任何语言"')

  // de 目标 → 英文激进指令
  enqueueResponse('[1] Resistente a altas temperaturas')
  enqueueResponse('[1] Resistente a altas temperaturas')
  enqueueResponse('Beständig gegen hohe Temperaturen')
  mockCalls.length = 0
  await translateBatch(['Resistente a altas temperaturas'], 'de', emptyGlossary, config)
  const agSysEn = JSON.parse(mockCalls[2].body).messages[0].content as string
  assert(agSysEn.includes('may be in ANY language'), 'B2 de 目标激进指令（英文）含 "may be in ANY language"')

  // ═══════════════════════════════════════════════════════════
  // C. F3：漏翻条目通过 untranslatedIndices 暴露
  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('C. F3 Layer 3 静默保留原文 → 索引暴露给 UI')
  out.push('═'.repeat(60))

  // C1/C2: 批次级判 pt 的顽固模型（首调/重试/激进全部回显）→ 最终安全网检出全部漏翻
  // ⚠️ 队列说明：统一重试的异常集是 index 序（如 [0截断,1漏翻]），队列响应需按 index 序排布
  enqueueResponse('[1] Resistente a altas temperaturas\n[2] Resistente a altas temperaturas') // 首调：两条都回显
  enqueueResponse('[1] Resistente a altas temperaturas\n[2] Resistente a altas temperaturas') // 统一重试（index 序）
  enqueueResponse('Resistente a altas temperaturas')  // 激进条1回显
  enqueueResponse('Resistente a altas temperaturas')  // 激进条2回显
  mockCalls.length = 0
  const untranslated1 = new Set<number>()
  const r1 = await translateBatch(
    ['Resistente a altas temperaturas', 'Proteção contra água e poeira não é problema'],
    'ja', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated1)
  assert(untranslated1.size === 2 && untranslated1.has(0) && untranslated1.has(1),
    'C1 顽固模型：全部漏翻索引上报（最终安全网）', `got ${[...untranslated1]}`)
  assert(r1[0] === 'Resistente a altas temperaturas',
    'C2 顽固模型：漏翻条保留原文（供 UI 展示）', JSON.stringify(r1))

  // C3/C4: 激进层成功 → 安全网不再上报
  // v10.2 队列说明：新截断判定（目标脚本存在性）下，首调条1回显源文 →
  // 同时命中"截断+漏翻"，去重后异常集={0}，重试只发 1 条。
  // 队列：首调2条 → 重试1条（只给条1译文）。条2首调译文直接合格。
  enqueueResponse('[1] Resistente a altas temperaturas\n[2] 防水防塵も問題ない')
  enqueueResponse('[1] 高温耐性に優れています')  // 重试：只回条1
  mockCalls.length = 0
  const untranslated2 = new Set<number>()
  const r2 = await translateBatch(
    ['Resistente a altas temperaturas', 'Proteção contra água e poeira não é problema'],
    'ja', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated2)
  assert(untranslated2.size === 0, 'C3 激进层成功：不上报漏翻索引', `got ${[...untranslated2]}`)
  assert(r2[0] === '高温耐性に優れています' && r2[1] === '防水防塵も問題ない',
    'C4 重试成功：两条结果均正确', JSON.stringify(r2))

  // C5: 可选参数向后兼容（不传不报错，正常翻译不受影响）
  // 注：单条 pt 批次级检测回退 en → (en→ja) 标注；v10.2 起 ja 目标截断检测改为
  // 目标脚本存在性判定（不再依赖译文长度），无需"给足长度防截断"的旧 trick。
  enqueueResponse('[1] 高温耐性に優れています')
  mockCalls.length = 0
  const r4 = await translateBatch(['Resistente a altas temperaturas'], 'ja', emptyGlossary, config)
  assert(r4[0] === '高温耐性に優れています', 'C5 不传 untranslatedIndices：向后兼容', `got ${JSON.stringify(r4)}`)

  // C6/C7: 不可翻译条目（全球统一缩写组合/容量）豁免漏翻 → 绝不误报
  // 注：'Lexar NM790 PRO' 含 ≥3 词且属型号描述，v8.0 起不豁免（必须翻译）——改用真正豁免样例
  enqueueResponse('[1] USB NVMe\n[2] 4TB')
  mockCalls.length = 0
  const untranslated4 = new Set<number>()
  await translateBatch(['USB NVMe', '4TB'], 'ja', emptyGlossary, config,
    undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, untranslated4)
  assert(untranslated4.size === 0, 'C6 isUntranslatable 豁免条目（缩写组合/容量）不误报', `got ${[...untranslated4]}`)
  assert(isUntranslatable('USB NVMe') && isUntranslatable('4TB'), 'C7 豁免判断本身成立')

  // ═══════════════════════════════════════════════════════════
  // D. F3b：同语言批次豁免（仅限拉丁语言对，防 de→de 误判）
  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push('D. F3b 同源语言批次豁免（拉丁限定，非拉丁走逐条分类）')
  out.push('═'.repeat(60))

  const DE_BATCH = ['Hohe Geschwindigkeit und Leistung', 'Ideal für Gaming und mehr', 'Robustes Gehäuse für unterwegs']
  assert(detectSourceLanguage(DE_BATCH) === 'de', 'D0 批次级检测：3 条 de 文本判为 de', `got ${detectSourceLanguage(DE_BATCH)}`)
  const d1 = detectUntranslatedText(DE_BATCH, DE_BATCH, 'de', emptyGlossary)
  assert(d1.size === 0, 'D1 de→de 源文==译文：不误判漏翻', `got ${[...d1]}`)

  // 跨字符集真漏翻不受豁免影响
  const d2 = detectUntranslatedText(['Resistente a altas temperaturas'], ['Resistente a altas temperaturas'], 'ja', emptyGlossary)
  assert(d2.size === 1, 'D2 pt→ja 源文==译文：仍检出漏翻', `got ${[...d2]}`)

  // 豁免不减少既有检测：en→ja 纯英文仍检出
  const d3 = detectUntranslatedText(['High speed performance'], ['High speed performance'], 'ja', emptyGlossary)
  assert(d3.size === 1, 'D3 en→ja 源文==译文：仍检出漏翻', `got ${[...d3]}`)

  // 非拉丁语言不豁免：zh-TW→zh-CN 未转换（detectSourceLanguage 对 zh-TW 报 zh-CN 粗类）
  const d4 = detectUntranslatedText(['高速性能表現', '讓遊戲更流暢'], ['高速性能表現', '讓遊戲更流暢'], 'zh-CN', emptyGlossary)
  assert(d4.size === 2, 'D4 zh-TW→zh-CN 未转换：不豁免、仍检出（v9.5 B4 回归防线）', `got ${[...d4]}`)

  // ═══════════════════════════════════════════════════════════
  // 输出
  // ═══════════════════════════════════════════════════════════
  out.push('')
  out.push('═'.repeat(60))
  out.push(`结果：${pass} 通过，${fail} 失败`)
  out.push('═'.repeat(60))

  require('fs').writeFileSync(__dirname + '/tmp-v911-test-out.txt', out.join('\n'), 'utf8')
  console.log(`v9.11 测试：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error(e)
  out.push('ERROR: ' + e)
  require('fs').writeFileSync(__dirname + '/tmp-v911-test-out.txt', out.join('\n'), 'utf8')
  process.exit(1)
})
