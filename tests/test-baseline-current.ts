/**
 * 现有系统全场景基线测试
 * 覆盖：同语言、变体转换、跨语言、混杂批次、UI badge
 */
import {
  detectSourceLanguage,
  detectUntranslatedText,
  detectSingleTextLanguage,
  isUntranslatable,
} from '../lib/llm-api'

// ═══════════════════════════════════════════════════════════════
// 复制 App.vue 的 UI 层逻辑（用于验证 UI badge 行为）
// ═══════════════════════════════════════════════════════════════
function uiDetectSingleTextLanguage(text: string): string {
  if (!text) return 'en'
  let cjkChars = 0, latinChars = 0, hiragana = 0, katakana = 0, hangul = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 0x4E00 && code <= 0x9FFF) cjkChars++
    else if (code >= 0x3040 && code <= 0x309F) hiragana++
    else if (code >= 0x30A0 && code <= 0x30FF) katakana++
    else if (code >= 0xAC00 && code <= 0xD7AF) hangul++
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latinChars++
  }
  if (hiragana + katakana > 0 && (hiragana + katakana) >= cjkChars * 0.15) return 'ja'
  if (hangul > 0 && hangul >= (cjkChars + hangul) * 0.1) return 'ko'
  return cjkChars > latinChars ? 'zh-CN' : 'en'
}

function uiIsSameScriptLanguagePair(src: string, tgt: string): boolean {
  const SAME_SCRIPT_PAIRS = [
    ['zh-CN', 'zh-TW'], ['zh-CN', 'zh-HK'],
    ['pt', 'pt-BR'],
  ]
  return SAME_SCRIPT_PAIRS.some(([s, t]) =>
    (s === src && t === tgt) || (t === src && s === tgt)
  )
}

function uiComputeUntranslatedBadge(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (sourceText !== translatedText) return false
  const srcLang = uiDetectSingleTextLanguage(sourceText)
  if (uiIsSameScriptLanguagePair(srcLang, targetLang)) return false
  return !isUntranslatable(sourceText, undefined)
}

// ═══════════════════════════════════════════════════════════════
// 测试场景定义
// ═══════════════════════════════════════════════════════════════
interface Scenario {
  id: string
  name: string
  targetLang: string
  texts: string[]
  translations: string[]  // 模拟 LLM 输出
  expected: {
    backend: number[]      // 期望后端检测出的漏翻索引
    ui: number[]           // 期望 UI 标记的漏翻索引
  }
  note: string
}

const scenarios: Scenario[] = [
  // ── A. 同语言扫描（源语言 == 目标语言）──
  {
    id: 'A1', name: 'en→en', targetLang: 'en',
    texts: ['High speed performance', 'Ideal for gaming'],
    translations: ['High speed performance', 'Ideal for gaming'],
    expected: { backend: [], ui: [] },
    note: '同语言，源文==译文是正确结果',
  },
  {
    id: 'A2', name: 'zh-CN→zh-CN', targetLang: 'zh-CN',
    texts: ['高速性能', '理想用于游戏'],
    translations: ['高速性能', '理想用于游戏'],
    expected: { backend: [], ui: [] },
    note: '同语言，防线1应命中',
  },
  {
    id: 'A3', name: 'ja→ja', targetLang: 'ja',
    texts: ['高速パフォーマンス', 'ゲームに最適'],
    translations: ['高速パフォーマンス', 'ゲームに最適'],
    expected: { backend: [], ui: [] },
    note: '同语言，防线1应命中',
  },
  {
    id: 'A4', name: 'pt-BR→pt-BR', targetLang: 'pt-BR',
    texts: ['Alto desempenho', 'Ideal para jogos'],
    translations: ['Alto desempenho', 'Ideal para jogos'],
    expected: { backend: [], ui: [] },
    note: '同语言，但批次检测可能回退 en',
  },
  {
    id: 'A5', name: 'es→es', targetLang: 'es',
    texts: ['Alto rendimiento', 'Ideal para juegos'],
    translations: ['Alto rendimiento', 'Ideal para juegos'],
    expected: { backend: [], ui: [] },
    note: '同语言，批次检测可能回退 en',
  },
  {
    id: 'A6', name: 'de→de', targetLang: 'de',
    texts: ['Hohe Geschwindigkeit', 'Ideal für Gaming'],
    translations: ['Hohe Geschwindigkeit', 'Ideal für Gaming'],
    expected: { backend: [], ui: [] },
    note: '同语言，批次检测能中 de',
  },

  // ── B. 变体转换 ──
  {
    id: 'B1', name: 'zh-CN→zh-TW（正确转换）', targetLang: 'zh-TW',
    texts: ['高速性能表现', '让游戏更流畅'],
    translations: ['高速性能表現', '讓遊戲更流暢'],
    expected: { backend: [], ui: [] },
    note: 'LLM 正确转换，不应误报',
  },
  {
    id: 'B2', name: 'zh-CN→zh-TW（LLM摆烂）', targetLang: 'zh-TW',
    texts: ['高速性能表现', '让游戏更流畅'],
    translations: ['高速性能表现', '让游戏更流畅'],
    expected: { backend: [0, 1], ui: [0, 1] },
    note: 'LLM 未转换，应检出漏翻',
  },
  {
    id: 'B3', name: 'zh-TW→zh-CN（正确转换）', targetLang: 'zh-CN',
    texts: ['高速性能表現', '讓遊戲更流暢'],
    translations: ['高速性能表现', '让游戏更流畅'],
    expected: { backend: [], ui: [] },
    note: 'LLM 正确转换，不应误报',
  },
  {
    id: 'B4', name: 'zh-TW→zh-CN（LLM摆烂）', targetLang: 'zh-CN',
    texts: ['高速性能表現', '讓遊戲更流暢'],
    translations: ['高速性能表現', '讓遊戲更流暢'],
    expected: { backend: [0, 1], ui: [0, 1] },
    note: 'LLM 未转换，应检出漏翻',
  },
  {
    id: 'B5', name: 'pt→pt-BR（写法相同，正确）', targetLang: 'pt-BR',
    texts: ['Resistente a baixas temperaturas', 'Proteção contra água'],
    translations: ['Resistente a baixas temperaturas', 'Proteção contra água'],
    expected: { backend: [], ui: [] },
    note: '欧葡巴葡写法相同，源文==译文是正确结果',
  },

  // ── C. 跨语言翻译 ──
  {
    id: 'C1', name: 'en→ja（正确翻译）', targetLang: 'ja',
    texts: ['High speed performance'],
    translations: ['高速パフォーマンス'],
    expected: { backend: [], ui: [] },
    note: '正常翻译，不应误报',
  },
  {
    id: 'C2', name: 'en→ja（LLM摆烂）', targetLang: 'ja',
    texts: ['High speed performance'],
    translations: ['High speed performance'],
    expected: { backend: [0], ui: [0] },
    note: 'LLM 未翻译，应检出漏翻',
  },
  {
    id: 'C3', name: 'en→pt-BR（正确翻译）', targetLang: 'pt-BR',
    texts: ['High speed performance'],
    translations: ['Desempenho de alta velocidade'],
    expected: { backend: [], ui: [] },
    note: '正常翻译，不应误报',
  },

  // ── D. 混杂批次 ──
  {
    id: 'D1', name: 'pt-BR 混 en → pt-BR', targetLang: 'pt-BR',
    texts: ['Alto desempenho', 'High speed performance', 'Ideal para jogos'],
    translations: ['Alto desempenho', 'High speed performance', 'Ideal para jogos'],
    expected: { backend: [1], ui: [1] },
    note: '葡语条目正确，英文条目漏翻',
  },
  {
    id: 'D2', name: 'zh-TW 混 zh-CN → zh-TW', targetLang: 'zh-TW',
    texts: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'],
    translations: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'],
    expected: { backend: [1], ui: [1] },
    note: '繁体条目正确，简体条目漏翻（未转换）',
  },
  {
    id: 'D3', name: 'zh-CN 混 zh-TW → zh-CN', targetLang: 'zh-CN',
    texts: ['高速性能表现', '高速性能表現', '让游戏更流畅'],
    translations: ['高速性能表现', '高速性能表現', '让游戏更流畅'],
    expected: { backend: [1], ui: [1] },
    note: '简体条目正确，繁体条目漏翻（未转换）',
  },

  // ── E. 边界情况 ──
  {
    id: 'E1', name: '品牌名（不可翻译）', targetLang: 'ja',
    texts: ['Lexar ARES', 'High speed'],
    translations: ['Lexar ARES', '高速'],
    expected: { backend: [], ui: [] },
    note: '品牌名不应误报',
  },
  {
    id: 'E2', name: '数字+单位（不可翻译）', targetLang: 'pt-BR',
    texts: ['2050MB/s', '1000GB'],
    translations: ['2050MB/s', '1000GB'],
    expected: { backend: [], ui: [] },
    note: '数字单位不应误报',
  },
  {
    id: 'E3', name: '空字符串', targetLang: 'ja',
    texts: ['', 'Hello'],
    translations: ['', 'こんにちは'],
    expected: { backend: [], ui: [] },
    note: '空字符串不应误报',
  },
]

// ═══════════════════════════════════════════════════════════════
// 执行测试
// ═══════════════════════════════════════════════════════════════
console.log('═══════════════════════════════════════════════════════════════')
console.log('现有系统全场景基线测试')
console.log('═══════════════════════════════════════════════════════════════\n')

let backendPass = 0, backendFail = 0
let uiPass = 0, uiFail = 0

for (const s of scenarios) {
  const batchLang = detectSourceLanguage(s.texts)
  const backendResult = detectUntranslatedText(s.texts, s.translations, s.targetLang, undefined, batchLang)
  const backendIndices = [...backendResult].sort((a, b) => a - b)

  const uiIndices: number[] = []
  for (let i = 0; i < s.texts.length; i++) {
    if (uiComputeUntranslatedBadge(s.texts[i], s.translations[i], s.targetLang)) {
      uiIndices.push(i)
    }
  }

  const backendMatch = JSON.stringify(backendIndices) === JSON.stringify(s.expected.backend)
  const uiMatch = JSON.stringify(uiIndices) === JSON.stringify(s.expected.ui)

  if (backendMatch) backendPass++; else backendFail++
  if (uiMatch) uiPass++; else uiFail++

  const status = backendMatch && uiMatch ? '✅' : '❌'
  console.log(`${status} ${s.id}: ${s.name}`)
  console.log(`   批次检测: ${batchLang} | 目标: ${s.targetLang}`)
  console.log(`   后端: [${backendIndices}] 期望: [${s.expected.backend}] ${backendMatch ? '✓' : '✗'}`)
  console.log(`   UI:   [${uiIndices}] 期望: [${s.expected.ui}] ${uiMatch ? '✓' : '✗'}`)
  if (!backendMatch || !uiMatch) {
    console.log(`   ⚠️  ${s.note}`)
  }
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`后端: ${backendPass} 通过 / ${backendFail} 失败`)
console.log(`UI:   ${uiPass} 通过 / ${uiFail} 失败`)
console.log('═══════════════════════════════════════════════════════════════')
