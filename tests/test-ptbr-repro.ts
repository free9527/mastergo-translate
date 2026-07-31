/**
 * 根因验证：批次检测失败回退 'en' 时，pt-BR 源文的误报路径
 * 模拟三种典型失败场景
 */
import { detectSourceLanguage, detectUntranslatedText } from '../lib/llm-api'

// 场景 A：元音丰富的常规巴葡（批次检测能中）
const batchGood = [
  'Resistente a baixas temperaturas',
  'Proteção contra água e poeira',
  'Leve seus jogos para qualquer lugar',
  'Desempenho extremo para criadores de conteúdo',
  'Guarde todos os seus momentos',
  'Velocidade de leitura até 2050MB/s',
]

// 场景 B：营销短语 / 技术短语（含大量拉丁同源词与英语借词，批次检测易回退 'en'）
const batchTricky = [
  'Leituras rápidas, transferências velozes',
  'Design compacto e portátil',
  'Ideal para câmeras e drones',
  'Compatível com USB 3.2 Gen 2',
  'Desempenho extremo para criadores',
  'Alta velocidade para gamers',
]

// 场景 C：批次被切碎（TRANSLATE_BATCH_SIZE=15 后去重，可能只剩 3-5 条）
const batchTiny = [
  'Leituras rápidas, transferências velozes',
  'Design compacto e portátil',
  'Compatível com USB 3.2 Gen 2',
]

// 场景 D：混杂英文产品名（纯度条件失效）
const batchMixed = [
  'Resistente a baixas temperaturas',
  'Proteção contra água e poeira',
  'Lexar PLAY microSDXC UHS-I Card',   // 英文产品名 → en 信号 ≥2 → 纯度失效
  'The ultimate gaming gear',
  'Leve seus jogos para qualquer lugar',
]

for (const [name, texts] of [
  ['A: 常规巴葡', batchGood],
  ['B: 营销/技术短语', batchTricky],
  ['C: 小批次', batchTiny],
  ['D: 混杂英文', batchMixed],
] as const) {
  const batchLang = detectSourceLanguage([...texts])
  const result = detectUntranslatedText([...texts], [...texts], 'pt-BR', undefined, batchLang)
  console.log(`\n=== ${name} ===`)
  console.log(`  批次判定: ${batchLang}  | 误报漏翻: ${result.size}/${texts.length}`)
  for (const i of result) console.log(`    [${i}] ${texts[i]}`)
}
