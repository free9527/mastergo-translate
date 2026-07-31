/**
 * v9.5 三层漏翻检测架构全量回归测试
 * 覆盖：30 主场景 + 10 边界情况
 */
import {
  detectUntranslatedText,
  detectSingleTextLanguage,
  isUntranslatable,
  classifyNecessity,
  getTargetScript,
  hasFunctionWords,
  hasSimplifiedOnlyChars,
  hasTraditionalOnlyChars,
} from '../lib/llm-api'

// ═══════════════════════════════════════════════════════════════
// 复制 App.vue 的 UI 层逻辑（用于验证 UI badge 行为）
// ═══════════════════════════════════════════════════════════════
function uiBadge(item: { sourceText: string; translatedText: string }, targetLang: string): boolean {
  if (item.sourceText !== item.translatedText) return false
  if (isUntranslatable(item.sourceText, undefined)) return false

  const necessity = classifyNecessity(item.sourceText, targetLang)

  switch (necessity.kind) {
    case 'translate':
      if (getTargetScript(targetLang) === 'latin' && hasFunctionWords(item.translatedText, targetLang)) {
        return false
      }
      return true
    case 'variant':
      if (necessity.conversion === 's2t') return hasSimplifiedOnlyChars(item.translatedText)
      if (necessity.conversion === 't2s') return hasTraditionalOnlyChars(item.translatedText)
      if (necessity.conversion === 'pt') {
        return hasFunctionWords(item.translatedText, 'en') && !hasFunctionWords(item.translatedText, 'pt')
      }
      return false
    case 'verify':
      return false
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试场景
// ═══════════════════════════════════════════════════════════════
interface Scenario {
  id: string
  name: string
  targetLang: string
  texts: string[]
  translations: string[]
  expected: { backend: number[]; ui: number[] }
  note?: string
}

const scenarios: Scenario[] = [
  // ── A. 同语言扫描 ──
  { id: 'A1', name: 'en→en', targetLang: 'en', texts: ['High speed performance', 'Ideal for gaming'], translations: ['High speed performance', 'Ideal for gaming'], expected: { backend: [], ui: [] } },
  { id: 'A2', name: 'zh-CN→zh-CN', targetLang: 'zh-CN', texts: ['高速性能', '理想用于游戏'], translations: ['高速性能', '理想用于游戏'], expected: { backend: [], ui: [] } },
  { id: 'A3', name: 'ja→ja', targetLang: 'ja', texts: ['高速パフォーマンス', 'ゲームに最適'], translations: ['高速パフォーマンス', 'ゲームに最適'], expected: { backend: [], ui: [] } },
  { id: 'A4', name: 'pt-BR→pt-BR', targetLang: 'pt-BR', texts: ['Alto desempenho', 'Ideal para jogos e criação'], translations: ['Alto desempenho', 'Ideal para jogos e criação'], expected: { backend: [], ui: [] } },
  { id: 'A5', name: 'es→es', targetLang: 'es', texts: ['Alto rendimiento', 'Ideal para juegos y creación'], translations: ['Alto rendimiento', 'Ideal para juegos y creación'], expected: { backend: [], ui: [] } },
  { id: 'A6', name: 'de→de', targetLang: 'de', texts: ['Hohe Geschwindigkeit', 'Ideal für Gaming und Erstellung'], translations: ['Hohe Geschwindigkeit', 'Ideal für Gaming und Erstellung'], expected: { backend: [], ui: [] } },
  { id: 'A7', name: 'fr→fr', targetLang: 'fr', texts: ['Haute performance', 'Idéal pour le jeu et la création'], translations: ['Haute performance', 'Idéal pour le jeu et la création'], expected: { backend: [], ui: [] } },
  { id: 'A8', name: 'it→it', targetLang: 'it', texts: ['Alte prestazioni', 'Ideale per il gioco e la creazione'], translations: ['Alte prestazioni', 'Ideale per il gioco e la creazione'], expected: { backend: [], ui: [] } },
  { id: 'A9', name: 'ko→ko', targetLang: 'ko', texts: ['고속 성능', '게임 및 콘텐츠 제작에 이상적'], translations: ['고속 성능', '게임 및 콘텐츠 제작에 이상적'], expected: { backend: [], ui: [] } },

  // ── B. 变体转换 ──
  { id: 'B1', name: 'zh-CN→zh-TW（正确）', targetLang: 'zh-TW', texts: ['高速性能表现', '让游戏更流畅'], translations: ['高速性能表現', '讓遊戲更流暢'], expected: { backend: [], ui: [] } },
  { id: 'B2', name: 'zh-CN→zh-TW（摆烂）', targetLang: 'zh-TW', texts: ['高速性能表现', '让游戏更流畅'], translations: ['高速性能表现', '让游戏更流畅'], expected: { backend: [0, 1], ui: [0, 1] } },
  { id: 'B3', name: 'zh-TW→zh-CN（正确）', targetLang: 'zh-CN', texts: ['高速性能表現', '讓遊戲更流暢'], translations: ['高速性能表现', '让游戏更流畅'], expected: { backend: [], ui: [] } },
  { id: 'B4', name: 'zh-TW→zh-CN（摆烂）', targetLang: 'zh-CN', texts: ['高速性能表現', '讓遊戲更流暢'], translations: ['高速性能表現', '讓遊戲更流暢'], expected: { backend: [0, 1], ui: [0, 1] } },
  { id: 'B5', name: 'pt→pt-BR（写法相同）', targetLang: 'pt-BR', texts: ['Resistente a baixas temperaturas', 'Proteção contra água'], translations: ['Resistente a baixas temperaturas', 'Proteção contra água'], expected: { backend: [], ui: [] } },

  // ── C. 跨语言 ──
  { id: 'C1', name: 'en→ja（正确）', targetLang: 'ja', texts: ['High speed performance'], translations: ['高速パフォーマンス'], expected: { backend: [], ui: [] } },
  { id: 'C2', name: 'en→ja（摆烂）', targetLang: 'ja', texts: ['High speed performance'], translations: ['High speed performance'], expected: { backend: [0], ui: [0] } },
  { id: 'C3', name: 'en→pt-BR（正确）', targetLang: 'pt-BR', texts: ['High speed performance'], translations: ['Desempenho de alta velocidade'], expected: { backend: [], ui: [] } },
  { id: 'C4', name: 'en→de（正确）', targetLang: 'de', texts: ['High speed performance'], translations: ['Hohe Geschwindigkeit'], expected: { backend: [], ui: [] } },
  { id: 'C5', name: 'en→de（摆烂）', targetLang: 'de', texts: ['High speed performance'], translations: ['High speed performance'], expected: { backend: [0], ui: [0] } },
  { id: 'C6', name: 'de→en（正确）', targetLang: 'en', texts: ['Hohe Geschwindigkeit'], translations: ['High speed'], expected: { backend: [], ui: [] } },
  { id: 'C7', name: 'de→en（摆烂）', targetLang: 'en', texts: ['Hohe Geschwindigkeit'], translations: ['Hohe Geschwindigkeit'], expected: { backend: [0], ui: [0] } },

  // ── D. 混杂批次 ──
  { id: 'D1', name: 'pt-BR 混 en → pt-BR', targetLang: 'pt-BR', texts: ['Alto desempenho para jogos', 'High speed performance', 'Ideal para jogos e criação'], translations: ['Alto desempenho para jogos', 'High speed performance', 'Ideal para jogos e criação'], expected: { backend: [1], ui: [1] } },
  { id: 'D2', name: 'zh-TW 混 zh-CN → zh-TW', targetLang: 'zh-TW', texts: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'], translations: ['高速性能表現', '高速性能表现', '讓遊戲更流暢'], expected: { backend: [1], ui: [1] } },
  { id: 'D3', name: 'zh-CN 混 zh-TW → zh-CN', targetLang: 'zh-CN', texts: ['高速性能表现', '高速性能表現', '让游戏更流畅'], translations: ['高速性能表现', '高速性能表現', '让游戏更流畅'], expected: { backend: [1], ui: [1] } },
  { id: 'D4', name: 'de 混 en → de', targetLang: 'de', texts: ['Hohe Geschwindigkeit für Gaming', 'High speed performance', 'Ideal für Gaming und Erstellung'], translations: ['Hohe Geschwindigkeit für Gaming', 'High speed performance', 'Ideal für Gaming und Erstellung'], expected: { backend: [1], ui: [1] } },

  // ── E. 边界情况 ──
  { id: 'E1', name: '品牌名', targetLang: 'ja', texts: ['Lexar ARES', 'High speed'], translations: ['Lexar ARES', '高速'], expected: { backend: [], ui: [] } },
  { id: 'E2', name: '数字+单位', targetLang: 'pt-BR', texts: ['2050MB/s', '1000GB'], translations: ['2050MB/s', '1000GB'], expected: { backend: [], ui: [] } },
  { id: 'E3', name: '空字符串', targetLang: 'ja', texts: ['', 'Hello'], translations: ['', 'こんにちは'], expected: { backend: [], ui: [] } },
  { id: 'E4', name: '术语库同形', targetLang: 'pt-BR', texts: ['SSD', 'NVMe'], translations: ['SSD', 'NVMe'], expected: { backend: [], ui: [] } },
  { id: 'E5', name: '单条短文本', targetLang: 'pt-BR', texts: ['Alto'], translations: ['Alto'], expected: { backend: [], ui: [] } },

  // ── F. 反向校验与混杂边界 ──
  { id: 'F1', name: 'en→de 反向校验', targetLang: 'de', texts: ['Design'], translations: ['Design'], expected: { backend: [], ui: [] }, note: '"Design" 在德语中也是正确词汇，isUntranslatable 豁免' },
  { id: 'F2', name: 'en→de 含德语功能词', targetLang: 'de', texts: ['Ideal für Gaming'], translations: ['Ideal für Gaming'], expected: { backend: [], ui: [] }, note: '含 für（德语功能词）→ 不算漏翻' },
  { id: 'F3', name: 'en→de 纯英文', targetLang: 'de', texts: ['High speed performance'], translations: ['High speed performance'], expected: { backend: [0], ui: [0] } },
  { id: 'F4', name: 'de→de 短文本', targetLang: 'de', texts: ['Hohe Geschwindigkeit'], translations: ['Hohe Geschwindigkeit'], expected: { backend: [], ui: [] } },
  { id: 'F5', name: 'de→de 极短文本', targetLang: 'de', texts: ['Schnell'], translations: ['Schnell'], expected: { backend: [], ui: [] }, note: '1 个功能词不足 2 票 → translate，但 isUntranslatable 豁免' },
  { id: 'F6', name: 'pt 混 en → pt（英文含 pt 功能词）', targetLang: 'pt-BR', texts: ['Alto desempenho', 'Fast para jogos'], translations: ['Alto desempenho', 'Fast para jogos'], expected: { backend: [], ui: [] }, note: '英文条目含 para（pt 功能词）→ 不判漏翻' },
  { id: 'F7', name: '简繁混合单条 → zh-TW', targetLang: 'zh-TW', texts: ['高速性能表现表現'], translations: ['高速性能表现表現'], expected: { backend: [0], ui: [0] }, note: '含简体字 → 漏翻' },
  { id: 'F8', name: '简繁混合单条 → zh-CN', targetLang: 'zh-CN', texts: ['高速性能表现表現'], translations: ['高速性能表现表現'], expected: { backend: [0], ui: [0] }, note: '含繁体字 → 漏翻' },
  { id: 'F9', name: '全球统一术语', targetLang: 'de', texts: ['USB 3.2 Gen 2', 'NVMe SSD'], translations: ['USB 3.2 Gen 2', 'NVMe SSD'], expected: { backend: [], ui: [] } },
  { id: 'F10', name: '单字符', targetLang: 'ja', texts: ['A'], translations: ['A'], expected: { backend: [], ui: [] }, note: '单字符 isUntranslatable？' },
]

// ═══════════════════════════════════════════════════════════════
// 执行测试
// ═══════════════════════════════════════════════════════════════
console.log('═══════════════════════════════════════════════════════════════')
console.log('v9.5 三层漏翻检测架构全量回归测试')
console.log('═══════════════════════════════════════════════════════════════\n')

let backendPass = 0, backendFail = 0
let uiPass = 0, uiFail = 0
const failures: string[] = []

for (const s of scenarios) {
  const backendResult = detectUntranslatedText(s.texts, s.translations, s.targetLang, undefined)
  const backendIndices = [...backendResult].sort((a, b) => a - b)

  const uiIndices: number[] = []
  for (let i = 0; i < s.texts.length; i++) {
    if (uiBadge({ sourceText: s.texts[i], translatedText: s.translations[i] }, s.targetLang)) {
      uiIndices.push(i)
    }
  }

  const backendMatch = JSON.stringify(backendIndices) === JSON.stringify(s.expected.backend)
  const uiMatch = JSON.stringify(uiIndices) === JSON.stringify(s.expected.ui)

  if (backendMatch) backendPass++; else { backendFail++; failures.push(`${s.id} backend`) }
  if (uiMatch) uiPass++; else { uiFail++; failures.push(`${s.id} ui`) }

  const status = backendMatch && uiMatch ? '✅' : '❌'
  console.log(`${status} ${s.id}: ${s.name}`)
  console.log(`   后端: [${backendIndices}] 期望: [${s.expected.backend}] ${backendMatch ? '✓' : '✗'}`)
  console.log(`   UI:   [${uiIndices}] 期望: [${s.expected.ui}] ${uiMatch ? '✓' : '✗'}`)
  if (s.note) console.log(`   说明: ${s.note}`)
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`后端: ${backendPass} 通过 / ${backendFail} 失败`)
console.log(`UI:   ${uiPass} 通过 / ${uiFail} 失败`)
if (failures.length > 0) {
  console.log(`失败项: ${failures.join(', ')}`)
}
console.log('═══════════════════════════════════════════════════════════════')

// 导出用于其他测试文件复用
export { uiBadge, scenarios }
