/**
 * 混合策略原型：保守 necessity + 字符集 fallback
 *
 * 核心洞察：
 * 1. 后端 necessity 分类用字符集 fallback（拉丁文本 → latin，CJK → zh-CN）
 * 2. UI badge 直接比较字符串（不做语言检测）
 * 3. 变体转换用字符特征校验（简繁）
 */
import {
  detectSingleTextLanguage,
  isUntranslatable,
} from '../lib/llm-api'

// ═══════════════════════════════════════════════════════════════
// 混合策略：字符集级语言分类（后端用）
// ═══════════════════════════════════════════════════════════════

/** 字符集级分类：比 detectSingleTextLanguage 更保守，不猜具体语言 */
type ScriptClass = 'latin' | 'cjk' | 'ja' | 'ko' | 'th' | 'ar' | 'ru' | 'en'

function getScriptClass(text: string): ScriptClass {
  if (!text) return 'en'
  let cjk = 0, latin = 0, hiragana = 0, katakana = 0, hangul = 0, thai = 0, arabic = 0, cyrillic = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 0x4E00 && code <= 0x9FFF) cjk++
    else if (code >= 0x3040 && code <= 0x309F) hiragana++
    else if (code >= 0x30A0 && code <= 0x30FF) katakana++
    else if (code >= 0xAC00 && code <= 0xD7AF) hangul++
    else if (code >= 0x0E00 && code <= 0x0E7F) thai++
    else if (code >= 0x0600 && code <= 0x06FF) arabic++
    else if (code >= 0x0400 && code <= 0x04FF) cyrillic++
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latin++
  }
  if (hiragana + katakana > 0 && (hiragana + katakana) >= cjk * 0.15) return 'ja'
  if (hangul > 0 && hangul >= (cjk + hangul) * 0.1) return 'ko'
  if (thai > latin * 0.5) return 'th'
  if (arabic > latin * 0.5) return 'ar'
  if (cyrillic > latin * 0.5) return 'ru'
  if (cjk > latin) return 'cjk'
  return 'latin'
}

/** 目标语言的字符集 */
function getTargetScript(targetLang: string): ScriptClass {
  if (targetLang === 'ja') return 'ja'
  if (targetLang === 'ko') return 'ko'
  if (targetLang === 'th') return 'th'
  if (targetLang === 'ar') return 'ar'
  if (targetLang === 'ru') return 'ru'
  if (targetLang.startsWith('zh')) return 'cjk'
  return 'latin'  // en/es/pt/de/fr/it/nl/pl/sv/tr/vi/id 等
}

/** 判断是否为同语系变体对（共享字符集） */
function isSameScriptPair(srcScript: ScriptClass, targetLang: string): boolean {
  const targetScript = getTargetScript(targetLang)
  if (srcScript !== targetScript) return false

  // CJK 变体：zh-CN/zh-TW/zh-HK 之间
  if (srcScript === 'cjk' && targetLang.startsWith('zh')) return true

  // 拉丁变体：pt/pt-BR 之间（其余拉丁语言对不视为变体）
  if (srcScript === 'latin' && (targetLang === 'pt' || targetLang === 'pt-BR')) {
    // 无法从字符集区分 pt 和 pt-BR，保守：视为变体
    return true
  }

  return false
}

// ═══════════════════════════════════════════════════════════════
// 简繁特征字（扩充高频区分字）
// ═══════════════════════════════════════════════════════════════
const SIMPLIFIED_ONLY_CHARS = new Set(
  '让这说会对开关时间问题现发现实义经验证号国际学习体台湾龙们为产众优亿仅从人什今们他她它们见页车马门问闻间开关买卖读书读写话语言讲谈议论认记忆讨让训议讲谢谢请诸课课课'.split('')
)
const TRADITIONAL_ONLY_CHARS = new Set(
  '讓這說會對開關時間問題現發現實義經驗證號國際學習體臺灣龍們為產眾優億僅從人什今們他她它們見頁車馬門問聞間開關買賣讀書讀寫話語言講談議論認記憶討讓訓議講謝謝請諸課課課'.split('')
)

function hasSimplifiedOnlyChars(text: string): boolean {
  for (const ch of text) if (SIMPLIFIED_ONLY_CHARS.has(ch)) return true
  return false
}

function hasTraditionalOnlyChars(text: string): boolean {
  for (const ch of text) if (TRADITIONAL_ONLY_CHARS.has(ch)) return true
  return false
}

// ═══════════════════════════════════════════════════════════════
// 混合策略后端检测
// ═══════════════════════════════════════════════════════════════
function detectUntranslatedTextHybrid(
  sourceTexts: string[],
  translatedTexts: string[],
  targetLang: string,
  glossaryMap?: Map<string, string>,
): Set<number> {
  const untranslated = new Set<number>()
  const normalize = (s: string) => s.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

  for (let i = 0; i < sourceTexts.length; i++) {
    const src = sourceTexts[i] || ''
    const trans = translatedTexts[i] || ''
    if (!src || !trans) continue

    // 1. 不可翻译 → 跳过
    if (isUntranslatable(src, glossaryMap)) continue

    const srcScript = getScriptClass(src)
    const targetScript = getTargetScript(targetLang)

    // 2. 同字符集（同语言或变体）→ 特殊处理
    if (srcScript === targetScript) {
      // 2a. CJK 变体转换校验
      if (srcScript === 'cjk' && targetLang === 'zh-TW') {
        // 简体→繁体：译文含简体特征字 → 漏翻
        if (hasSimplifiedOnlyChars(trans)) untranslated.add(i)
        continue
      }
      if (srcScript === 'cjk' && targetLang === 'zh-CN') {
        // 繁体→简体：译文含繁体特征字 → 漏翻
        if (hasTraditionalOnlyChars(trans)) untranslated.add(i)
        continue
      }

      // 2b. 拉丁变体（pt/pt-BR）：源文==译文是正确结果，跳过
      if (srcScript === 'latin' && (targetLang === 'pt' || targetLang === 'pt-BR')) {
        continue
      }

      // 2c. 同语言（en→en, ja→ja, de→de...）：源文==译文是正确结果，跳过
      //     用 detectSingleTextLanguage 精确判断
      const srcLang = detectSingleTextLanguage(src)
      if (srcLang === targetLang) continue

      // 2d. 跨语言但同字符集（en→de, en→fr...）：源文==译文 → 漏翻
      if (normalize(src) === normalize(trans)) untranslated.add(i)
      continue
    }

    // 3. 跨字符集（en→ja, zh→en...）：源文==译文 → 漏翻
    if (normalize(src) === normalize(trans)) untranslated.add(i)
  }

  return untranslated
}

// ═══════════════════════════════════════════════════════════════
// 混合策略 UI badge（直接比较字符串，不做语言检测）
// ═══════════════════════════════════════════════════════════════
function uiBadgeHybrid(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (sourceText !== translatedText) return false

  // 不可翻译 → 不显示 badge
  if (isUntranslatable(sourceText, undefined)) return false

  const srcScript = getScriptClass(sourceText)
  const targetScript = getTargetScript(targetLang)

  // 同字符集
  if (srcScript === targetScript) {
    // CJK 变体：简繁转换校验
    if (srcScript === 'cjk' && targetLang === 'zh-TW') {
      return hasSimplifiedOnlyChars(translatedText)
    }
    if (srcScript === 'cjk' && targetLang === 'zh-CN') {
      return hasTraditionalOnlyChars(translatedText)
    }
    // 拉丁变体（pt/pt-BR）：不显示 badge
    if (srcScript === 'latin' && (targetLang === 'pt' || targetLang === 'pt-BR')) {
      return false
    }
    // 同语言：不显示 badge
    const srcLang = detectSingleTextLanguage(sourceText)
    if (srcLang === targetLang) return false
    // 跨语言同字符集（en→de）：显示 badge
    return true
  }

  // 跨字符集：显示 badge
  return true
}

// ═══════════════════════════════════════════════════════════════
// 测试场景
// ═══════════════════════════════════════════════════════════════
interface Scenario {
  id: string; name: string; targetLang: string
  texts: string[]; translations: string[]
  expected: { backend: number[]; ui: number[] }
}

const scenarios: Scenario[] = [
  { id: 'A1', name: 'en→en', targetLang: 'en', texts: ['High speed performance', 'Ideal for gaming'], translations: ['High speed performance', 'Ideal for gaming'], expected: { backend: [], ui: [] } },
  { id: 'A2', name: 'zh-CN→zh-CN', targetLang: 'zh-CN', texts: ['高速性能', '理想用于游戏'], translations: ['高速性能', '理想用于游戏'], expected: { backend: [], ui: [] } },
  { id: 'A3', name: 'ja→ja', targetLang: 'ja', texts: ['高速パフォーマンス', 'ゲームに最適'], translations: ['高速パフォーマンス', 'ゲームに最適'], expected: { backend: [], ui: [] } },
  { id: 'A4', name: 'pt-BR→pt-BR', targetLang: 'pt-BR', texts: ['Alto desempenho', 'Ideal para jogos'], translations: ['Alto desempenho', 'Ideal para jogos'], expected: { backend: [], ui: [] } },
  { id: 'A5', name: 'es→es', targetLang: 'es', texts: ['Alto rendimiento', 'Ideal para juegos'], translations: ['Alto rendimiento', 'Ideal para juegos'], expected: { backend: [], ui: [] } },
  { id: 'A6', name: 'de→de', targetLang: 'de', texts: ['Hohe Geschwindigkeit', 'Ideal für Gaming'], translations: ['Hohe Geschwindigkeit', 'Ideal für Gaming'], expected: { backend: [], ui: [] } },
  { id: 'B1', name: 'zh-CN→zh-TW（正确转换）', targetLang: 'zh-TW', texts: ['高速性能表现', '让游戏更流畅'], translations: ['高速性能表現', '讓遊戲更流暢'], expected: { backend: [], ui: [] } },
  { id: 'B2', name: 'zh-CN→zh-TW（LLM摆烂）', targetLang: 'zh-TW', texts: ['高速性能表现', '让游戏更流畅'], translations: ['高速性能表现', '让游戏更流畅'], expected: { backend: [0, 1], ui: [0, 1] } },
  { id: 'B3', name: 'zh-TW→zh-CN（正确转换）', targetLang: 'zh-CN', texts: ['高速性能表現', '讓遊戲更流暢'], translations: ['高速性能表现', '让游戏更流畅'], expected: { backend: [], ui: [] } },
  { id: 'B4', name: 'zh-TW→zh-CN（LLM摆烂）', targetLang: 'zh-CN', texts: ['高速性能表現', '讓遊戲更流暢'], translations: ['高速性能表現', '讓遊戲更流暢'], expected: { backend: [0, 1], ui: [0, 1] } },
  { id: 'B5', name: 'pt→pt-BR（写法相同，正确）', targetLang: 'pt-BR', texts: ['Resistente a baixas temperaturas', 'Proteção contra água'], translations: ['Resistente a baixas temperaturas', 'Proteção contra água'], expected: { backend: [], ui: [] } },
  { id: 'C1', name: 'en→ja（正确翻译）', targetLang: 'ja', texts: ['High speed performance'], translations: ['高速パフォーマンス'], expected: { backend: [], ui: [] } },
  { id: 'C2', name: 'en→ja（LLM摆烂）', targetLang: 'ja', texts: ['High speed performance'], translations: ['High speed performance'], expected: { backend: [0], ui: [0] } },
  { id: 'C3', name: 'en→pt-BR（正确翻译）', targetLang: 'pt-BR', texts: ['High speed performance'], translations: ['Desempenho de alta velocidade'], expected: { backend: [], ui: [] } },
  { id: 'D1', name: 'pt-BR 混 en → pt-BR', targetLang: 'pt-BR', texts: ['Alto desempenho', 'High speed performance', 'Ideal para jogos'], translations: ['Alto desempenho', 'High speed performance', 'Ideal para jogos'], expected: { backend: [1], ui: [1] } },
  { id: 'D2', name: 'zh-TW 混 zh-CN → zh-TW', targetLang: 'zh-TW', texts: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'], translations: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'], expected: { backend: [1], ui: [1] } },
  { id: 'D3', name: 'zh-CN 混 zh-TW → zh-CN', targetLang: 'zh-CN', texts: ['高速性能表现', '高速性能表現', '让游戏更流畅'], translations: ['高速性能表现', '高速性能表現', '让游戏更流畅'], expected: { backend: [1], ui: [1] } },
  { id: 'E1', name: '品牌名（不可翻译）', targetLang: 'ja', texts: ['Lexar ARES', 'High speed'], translations: ['Lexar ARES', '高速'], expected: { backend: [], ui: [] } },
  { id: 'E2', name: '数字+单位（不可翻译）', targetLang: 'pt-BR', texts: ['2050MB/s', '1000GB'], translations: ['2050MB/s', '1000GB'], expected: { backend: [], ui: [] } },
  { id: 'E3', name: '空字符串', targetLang: 'ja', texts: ['', 'Hello'], translations: ['', 'こんにちは'], expected: { backend: [], ui: [] } },
]

console.log('═══════════════════════════════════════════════════════════════')
console.log('混合策略原型验证')
console.log('═══════════════════════════════════════════════════════════════\n')

let backendPass = 0, backendFail = 0
let uiPass = 0, uiFail = 0

for (const s of scenarios) {
  const backendResult = detectUntranslatedTextHybrid(s.texts, s.translations, s.targetLang, undefined)
  const backendIndices = [...backendResult].sort((a, b) => a - b)

  const uiIndices: number[] = []
  for (let i = 0; i < s.texts.length; i++) {
    if (uiBadgeHybrid(s.texts[i], s.translations[i], s.targetLang)) uiIndices.push(i)
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
