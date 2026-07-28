/**
 * 调试 FR→ES 漏翻误报
 */

import { detectUntranslatedText } from '../lib/llm-api'

const src = ['Le disque SSD est très rapide', 'Vitesse de lecture élevée']
const trans = ['La unidad SSD es muy rápida', 'Alta velocidad de lectura']

console.log('源文:', src)
console.log('译文:', trans)
console.log('目标语言: es')

const detected = detectUntranslatedText(src, trans, 'es', new Map())

console.log('\n漏翻检测结果:', detected)
console.log('漏翻索引:', Array.from(detected))

if (detected.size > 0) {
  for (const idx of detected) {
    console.log(`\n漏翻项 [${idx}]:`)
    console.log(`  源文: "${src[idx]}"`)
    console.log(`  译文: "${trans[idx]}"`)
  }
}
