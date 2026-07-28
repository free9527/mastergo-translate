/**
 * 验证不承载语言语义的文本不会进入漏翻重试。
 * 运行：npx tsx tests/test-untranslatable-symbols.ts
 */
import { detectUntranslatedText, isUntranslatable } from '../lib/llm-api'

const shouldSkip = ['+', '—', '•', '™', '  +  ', '4', '4.0', '4TB', '200%', '30°C']
const mustTranslate = ['High Speed', 'Up to 4TB', '5 Years Service']

for (const source of shouldSkip) {
  if (!isUntranslatable(source)) {
    throw new Error(`应跳过但未跳过：${JSON.stringify(source)}`)
  }
  const detected = detectUntranslatedText([source], [source], 'nl', new Map())
  if (detected.size !== 0) {
    throw new Error(`跳过文本被错误标记为漏翻：${JSON.stringify(source)}`)
  }
}

for (const source of mustTranslate) {
  if (isUntranslatable(source)) {
    throw new Error(`应翻译但被错误跳过：${JSON.stringify(source)}`)
  }
  const detected = detectUntranslatedText([source], [source], 'nl', new Map())
  if (detected.size !== 1) {
    throw new Error(`未翻译文本没有被检出：${JSON.stringify(source)}`)
  }
}

console.log(`通过：${shouldSkip.length} 条非语言文本跳过；${mustTranslate.length} 条英文内容仍会检出漏翻。`)
