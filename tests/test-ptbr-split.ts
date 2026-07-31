/**
 * 逐个拆分验证：哪些短语把批次拖回 'en'？
 */
import { detectSourceLanguage } from '../lib/llm-api'

const tricky = [
  'Leituras rápidas, transferências velozes',
  'Design compacto e portátil',
  'Ideal para câmeras e drones',
  'Compatível com USB 3.2 Gen 2',
  'Desempenho extremo para criadores',
  'Alta velocidade para gamers',
]

for (const t of tricky) {
  console.log(`${detectSourceLanguage([t]).padEnd(5)} | ${t}`)
}
console.log('--- 组合 ---')
console.log(`${detectSourceLanguage(tricky)} | 全部6条`)
