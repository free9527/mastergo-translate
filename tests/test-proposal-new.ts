/**
 * 新方案原型验证：classifyTranslationTask + validateTranslationResult
 * 与现有系统跑同样 20 个场景，对比结果
 */
import {
  detectSingleTextLanguage,
  isUntranslatable,
} from '../lib/llm-api'

// ═══════════════════════════════════════════════════════════════
// 新方案核心：翻译必要性判断
// ═══════════════════════════════════════════════════════════════

type VariantConversion = 'zh-CN→zh-TW' | 'zh-TW→zh-CN' | 'zh-CN→zh-HK' | 'pt→pt-BR' | 'pt-BR→pt'

type Necessity =
  | { kind: 'skip'; reason: 'same-language' | 'untranslatable' | 'glossary-same' }
  | { kind: 'translate'; variantConversion?: VariantConversion }
  | { kind: 'verify'; reason: 'ambiguous' }

const VARIANT_PAIRS: Record<string, VariantConversion> = {
  'zh-CN:zh-TW': 'zh-CN→zh-TW',
  'zh-TW:zh-CN': 'zh-TW→zh-CN',
  'zh-CN:zh-HK': 'zh-CN→zh-HK',
  'zh-HK:zh-CN': 'zh-TW→zh-CN', // HK 是繁体，反向也映射到 TW→CN
  'pt:pt-BR': 'pt→pt-BR',
  'pt-BR:pt': 'pt-BR→pt',
}

// 简繁特征字表（高频区分字）
const SIMPLIFIED_ONLY_CHARS = new Set('让这说会对开关时间问题现发现实义经验证号国际学习体台灣湾龙们为产众优亿仅从人什今们他她它们'.split(''))
const TRADITIONAL_ONLY_CHARS = new Set('讓這說會對開關時間問題現發現實義經驗證號國際學習體臺灣龍們為產眾優億僅從人什今們他她它們'.split(''))

function hasSimplifiedOnlyChars(text: string): boolean {
  for (const ch of text) if (SIMPLIFIED_ONLY_CHARS.has(ch)) return true
  return false
}

function hasTraditionalOnlyChars(text: string): boolean {
  for (const ch of text) if (TRADITIONAL_ONLY_CHARS.has(ch)) return true
  return false
}

function classifyTranslationTask(
  src: string,
  srcLang: string,
  targetLang: string,
  glossaryMap?: Map<string, string>,
): Necessity {
  // 1. 同语言：源语言 == 目标语言
  //    包括：en→en, zh-CN→zh-CN, ja→ja, pt-BR→pt-BR, de→de...
  if (srcLang === targetLang) {
    return { kind: 'skip', reason: 'same-language' }
  }

  // 2. 变体转换：共享字符集但不同变体
  const variantKey = `${srcLang}:${targetLang}`
  const variant = VARIANT_PAIRS[variantKey]
  if (variant) {
    return { kind: 'translate', variantConversion: variant }
  }

  // 3. 不可翻译：品牌名/数字/术语
  if (isUntranslatable(src, glossaryMap)) {
    return { kind: 'skip', reason: 'untranslatable' }
  }

  // 4. 标准翻译
  return { kind: 'translate' }
}

function isVariantConverted(trans: string, conversion: VariantConversion): boolean {
  switch (conversion) {
    case 'zh-CN→zh-TW':
    case 'zh-CN→zh-HK':
      // 简体→繁体：译文不应含简体特征字
      return !hasSimplifiedOnlyChars(trans)
    case 'zh-TW→zh-CN':
      // 繁体→简体：译文不应含繁体特征字
      return !hasTraditionalOnlyChars(trans)
    case 'pt→pt-BR':
    case 'pt-BR→pt':
      // 葡语变体：写法可能完全相同，无法从字符判断
      // 保守策略：不校验，交给校对环节
      return true
    default:
      return true
  }
}

function validateTranslationResult(
  src: string,
  trans: string,
  necessity: Necessity,
  targetLang: string,
): boolean {
  // 不需要翻译的条目，永远不算漏翻
  if (necessity.kind === 'skip') return false

  // 空文本不处理
  if (!src || !trans) return false

  // 变体转换：校验是否完成转换
  if (necessity.variantConversion) {
    return !isVariantConverted(trans, necessity.variantConversion)
  }

  // 标准翻译：源文==译文 → 漏翻
  // （不再用维度2特征检测，避免拉丁语误判）
  const normalize = (s: string) => s.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (normalize(src) === normalize(trans)) return true

  return false
}

// ═══════════════════════════════════════════════════════════════
// 新方案 detectUntranslatedText V2
// ═══════════════════════════════════════════════════════════════
function detectUntranslatedTextV2(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang: string,
  glossaryMap?: Map<string, string>,
): Set<number> {
  const untranslated = new Set<number>()

  for (let i = 0; i < sourceTexts.length; i++) {
    const src = sourceTexts[i] || ''
    const trans = translatedTexts[i] || ''
    if (!src || !trans) continue

    const srcLang = detectSingleTextLanguage(src)
    const necessity = classifyTranslationTask(src, srcLang, targetLang, glossaryMap)

    if (validateTranslationResult(src, trans, necessity, targetLang)) {
      untranslated.add(i)
    }
  }

  return untranslated
}

// ═══════════════════════════════════════════════════════════════
// 新方案 UI badge
// ═══════════════════════════════════════════════════════════════
function uiComputeBadgeV2(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (sourceText !== translatedText) return false
  const srcLang = detectSingleTextLanguage(sourceText)
  const necessity = classifyTranslationTask(sourceText, srcLang, targetLang, undefined)
  // skip 类型不显示 badge；translate 类型显示（源文==译文=漏翻）
  return necessity.kind === 'translate'
}

// ═══════════════════════════════════════════════════════════════
// 测试场景（与基线测试相同）
// ═══════════════════════════════════════════════════════════════
interface Scenario {
  id: string
  name: string
  targetLang: string
  texts: string[]
  translations: string[]
  expected: { backend: number[]; ui: number[] }
  note: string
}

const scenarios: Scenario[] = [
  { id: 'A1', name: 'en→en', targetLang: 'en', texts: ['High speed performance', 'Ideal for gaming'], translations: ['High speed performance', 'Ideal for gaming'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'A2', name: 'zh-CN→zh-CN', targetLang: 'zh-CN', texts: ['高速性能', '理想用于游戏'], translations: ['高速性能', '理想用于游戏'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'A3', name: 'ja→ja', targetLang: 'ja', texts: ['高速パフォーマンス', 'ゲームに最適'], translations: ['高速パフォーマンス', 'ゲームに最適'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'A4', name: 'pt-BR→pt-BR', targetLang: 'pt-BR', texts: ['Alto desempenho', 'Ideal para jogos'], translations: ['Alto desempenho', 'Ideal para jogos'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'A5', name: 'es→es', targetLang: 'es', texts: ['Alto rendimiento', 'Ideal para juegos'], translations: ['Alto rendimiento', 'Ideal para juegos'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'A6', name: 'de→de', targetLang: 'de', texts: ['Hohe Geschwindigkeit', 'Ideal für Gaming'], translations: ['Hohe Geschwindigkeit', 'Ideal für Gaming'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'B1', name: 'zh-CN→zh-TW（正确转换）', targetLang: 'zh-TW', texts: ['高速性能表现', '让游戏更流畅'], translations: ['高速性能表現', '讓遊戲更流暢'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'B2', name: 'zh-CN→zh-TW（LLM摆烂）', targetLang: 'zh-TW', texts: ['高速性能表现', '让游戏更流畅'], translations: ['高速性能表现', '让游戏更流畅'], expected: { backend: [0, 1], ui: [0, 1] }, note: '' },
  { id: 'B3', name: 'zh-TW→zh-CN（正确转换）', targetLang: 'zh-CN', texts: ['高速性能表現', '讓遊戲更流暢'], translations: ['高速性能表现', '让游戏更流畅'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'B4', name: 'zh-TW→zh-CN（LLM摆烂）', targetLang: 'zh-CN', texts: ['高速性能表現', '讓遊戲更流暢'], translations: ['高速性能表現', '讓遊戲更流暢'], expected: { backend: [0, 1], ui: [0, 1] }, note: '' },
  { id: 'B5', name: 'pt→pt-BR（写法相同，正确）', targetLang: 'pt-BR', texts: ['Resistente a baixas temperaturas', 'Proteção contra água'], translations: ['Resistente a baixas temperaturas', 'Proteção contra água'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'C1', name: 'en→ja（正确翻译）', targetLang: 'ja', texts: ['High speed performance'], translations: ['高速パフォーマンス'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'C2', name: 'en→ja（LLM摆烂）', targetLang: 'ja', texts: ['High speed performance'], translations: ['High speed performance'], expected: { backend: [0], ui: [0] }, note: '' },
  { id: 'C3', name: 'en→pt-BR（正确翻译）', targetLang: 'pt-BR', texts: ['High speed performance'], translations: ['Desempenho de alta velocidade'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'D1', name: 'pt-BR 混 en → pt-BR', targetLang: 'pt-BR', texts: ['Alto desempenho', 'High speed performance', 'Ideal para jogos'], translations: ['Alto desempenho', 'High speed performance', 'Ideal para jogos'], expected: { backend: [1], ui: [1] }, note: '' },
  { id: 'D2', name: 'zh-TW 混 zh-CN → zh-TW', targetLang: 'zh-TW', texts: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'], translations: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'], expected: { backend: [1], ui: [1] }, note: '' },
  { id: 'D3', name: 'zh-CN 混 zh-TW → zh-CN', targetLang: 'zh-CN', texts: ['高速性能表现', '高速性能表現', '让游戏更流畅'], translations: ['高速性能表现', '高速性能表現', '让游戏更流畅'], expected: { backend: [1], ui: [1] }, note: '' },
  { id: 'E1', name: '品牌名（不可翻译）', targetLang: 'ja', texts: ['Lexar ARES', 'High speed'], translations: ['Lexar ARES', '高速'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'E2', name: '数字+单位（不可翻译）', targetLang: 'pt-BR', texts: ['2050MB/s', '1000GB'], translations: ['2050MB/s', '1000GB'], expected: { backend: [], ui: [] }, note: '' },
  { id: 'E3', name: '空字符串', targetLang: 'ja', texts: ['', 'Hello'], translations: ['', 'こんにちは'], expected: { backend: [], ui: [] }, note: '' },
]

// ═══════════════════════════════════════════════════════════════
// 执行测试
// ═══════════════════════════════════════════════════════════════
console.log('═══════════════════════════════════════════════════════════════')
console.log('新方案原型验证')
console.log('═══════════════════════════════════════════════════════════════\n')

let backendPass = 0, backendFail = 0
let uiPass = 0, uiFail = 0

for (const s of scenarios) {
  const backendResult = detectUntranslatedTextV2(s.texts, s.translations, s.targetLang, undefined)
  const backendIndices = [...backendResult].sort((a, b) => a - b)

  const uiIndices: number[] = []
  for (let i = 0; i < s.texts.length; i++) {
    if (uiComputeBadgeV2(s.texts[i], s.translations[i], s.targetLang)) {
      uiIndices.push(i)
    }
  }

  const backendMatch = JSON.stringify(backendIndices) === JSON.stringify(s.expected.backend)
  const uiMatch = JSON.stringify(uiIndices) === JSON.stringify(s.expected.ui)

  if (backendMatch) backendPass++; else backendFail++
  if (uiMatch) uiPass++; else uiFail++

  const status = backendMatch && uiMatch ? '✅' : '❌'
  console.log(`${status} ${s.id}: ${s.name}`)
  console.log(`   后端: [${backendIndices}] 期望: [${s.expected.backend}] ${backendMatch ? '✓' : '✗'}`)
  console.log(`   UI:   [${uiIndices}] 期望: [${s.expected.ui}] ${uiMatch ? '✓' : '✗'}`)
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`后端: ${backendPass} 通过 / ${backendFail} 失败`)
console.log(`UI:   ${uiPass} 通过 / ${uiFail} 失败`)
console.log('═══════════════════════════════════════════════════════════════')
