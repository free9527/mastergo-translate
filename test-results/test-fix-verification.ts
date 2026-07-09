/**
 * 修复验证脚本：正反验证 detectTranslationExpansion 修复效果
 *
 * 正向验证：合法译文不被误截断
 * 反向验证：真正的异常扩展仍然能被检测到
 * 边界验证：安全检查不会放过真正的注入
 *
 * 使用方法：
 *   npx tsx test-results/test-fix-verification.ts
 */

import { detectTranslationExpansion, detectBrandInjection } from '../lib/post-process'

// ============================================================
// 正向验证：修复后，合法译文不被误截断
// 这些案例来自测试日志中的真实误截断
// ============================================================

const positiveCases = [
  {
    name: '葡萄牙语：口号翻译（1.68x）',
    source: 'Game faster, load quicker, perform better',
    translation: 'Jogue mais rápido, carregue mais depressa, alcance um melhor desempenho',
    lang: 'pt',
    shouldTruncate: false,
    reason: '合法翻译，膨胀率 1.68x < 阈值 2.52x',
  },
  {
    name: '西班牙语：技术参数（1.57x）',
    source: 'Read speeds up to 7400MB/s',
    translation: 'Velocidades de lectura de hasta 7400MB/s',
    lang: 'es',
    shouldTruncate: false,
    reason: '合法翻译，包含源文数字 7400，安全检查跳过',
  },
  {
    name: '葡萄牙语：短文本（1.83x）',
    source: 'Lexar Quality Labs',
    translation: 'Laboratórios de Qualidade Lexar',
    lang: 'pt',
    shouldTruncate: false,
    reason: '短文本阈值 3.6x，包含品牌名 Lexar',
  },
  {
    name: '法语：描述翻译（1.68x）',
    source: 'Boost your PC performance with faster boot times',
    translation: 'Optimisez les performances de votre PC grâce à des temps de démarrage plus rapides',
    lang: 'fr',
    shouldTruncate: false,
    reason: '合法翻译，膨胀率 1.68x < 阈值 2.52x',
  },
  {
    name: '德语：描述翻译（1.59x）',
    source: 'Fast transfer speeds for quick access',
    translation: 'Schnelle Übertragungsgeschwindigkeiten für schnellen Zugriff',
    lang: 'de',
    shouldTruncate: false,
    reason: '合法翻译，膨胀率 1.59x < 阈值 2.66x',
  },
  {
    name: '葡萄牙语：产品名翻译（1.78x）',
    source: 'Lexar Professional CFexpress Type B Card',
    translation: 'Cartão Lexar Professional CFexpress Tipo B',
    lang: 'pt',
    shouldTruncate: false,
    reason: '包含品牌名 Lexar，安全检查跳过',
  },
  {
    name: '西班牙语：性能描述（1.60x）',
    source: 'Boost your PC performance with faster boot times',
    translation: 'Potencie el rendimiento de su ordenador con tiempos de arranque más rápidos',
    lang: 'es',
    shouldTruncate: false,
    reason: '合法翻译，膨胀率 1.60x < 阈值 2.38x',
  },
]

// ============================================================
// 反向验证：修复后，真正的异常扩展仍然能被检测到
// 这些是模拟的 LLM 异常扩展案例
// ============================================================

const negativeCases = [
  {
    name: '英语：LLM 添加营销文案（6.5x）',
    source: 'Fast SSD',
    translation: 'This amazing Lexar SSD will change your life with blazing speeds',
    lang: 'en',
    shouldTruncate: true,
    reason: '异常扩展 6.5x > 阈值 2.1x，应截断',
  },
  {
    name: '葡萄牙语：LLM 扩展产品描述（5.3x）',
    source: 'Lexar PLAY PRO',
    translation: 'Lexar PLAY PRO is the best gaming card in the world with amazing performance',
    lang: 'pt',
    shouldTruncate: true,
    reason: '异常扩展 5.3x > 阈值 2.52x，应截断',
  },
  {
    name: '西班牙语：LLM 添加购买引导（5.7x）',
    source: 'Good for Today',
    translation: 'This product is good for today and great for tomorrow, buy now and save money',
    lang: 'es',
    shouldTruncate: true,
    reason: '异常扩展 5.7x > 阈值 2.38x，应截断',
  },
  {
    name: '法语：LLM 编造功能描述（4.0x）',
    source: 'Quality Labs',
    translation: 'Les laboratoires de qualité Lexar testent chaque produit pour garantir la meilleure performance possible',
    lang: 'fr',
    shouldTruncate: true,
    reason: '异常扩展 4.0x > 阈值 2.52x，应截断',
  },
  {
    name: '德语：LLM 添加技术参数（3.5x）',
    source: 'Storage Solution',
    translation: 'Die Speicherkarte mit 7400MB/s Geschwindigkeit und 1TB Kapazität',
    lang: 'de',
    shouldTruncate: true,
    reason: '异常扩展 3.5x > 阈值 2.66x，应截断',
  },
]

// ============================================================
// 边界验证：安全检查不会放过真正的注入
// ============================================================

const boundaryCases = [
  {
    name: '品牌注入检测（不是扩展检测的职责）',
    source: 'Fast storage solution',
    translation: 'Lexar® SSD 7400MB/s',
    shouldDetectInjection: true,
    reason: '源文无品牌，译文注入 Lexar，应被 detectBrandInjection 检测',
  },
  {
    name: '数值注入检测（已有设计局限）',
    source: 'Read speeds up to 800MB/s',
    translation: 'Read speeds up to 800MB/s and write speeds up to 6000MB/s',
    shouldDetectInjection: false,  // 已知局限：源文已有数值时，新增数值不会被检测
    reason: '已知局限：源文已有 800MB/s，detectBrandInjection 只检测"源文无数值但译文有"的情况',
  },
]

// ============================================================
// 执行验证
// ============================================================

console.log('=== 正向验证：合法译文不被误截断 ===\n')
let positivePass = 0
for (const c of positiveCases) {
  const result = detectTranslationExpansion([c.source], [c.translation], c.lang)
  const wasTruncated = result.expandedIndices.has(0)
  const pass = wasTruncated === c.shouldTruncate
  if (pass) positivePass++
  console.log(`${pass ? '✅' : '❌'} ${c.name}`)
  console.log(`   源文: "${c.source}" (${c.source.length}字符)`)
  console.log(`   译文: "${c.translation}" (${c.translation.length}字符)`)
  console.log(`   膨胀率: ${(c.translation.length / c.source.length).toFixed(2)}x`)
  console.log(`   结果: ${wasTruncated ? '被截断 ❌' : '保留 ✅'}`)
  console.log(`   预期: ${c.reason}`)
  console.log()
}
console.log(`正向验证: ${positivePass}/${positiveCases.length} 通过\n`)

console.log('=== 反向验证：异常扩展仍然能被检测 ===\n')
let negativePass = 0
for (const c of negativeCases) {
  const result = detectTranslationExpansion([c.source], [c.translation], c.lang)
  const wasTruncated = result.expandedIndices.has(0)
  const pass = wasTruncated === c.shouldTruncate
  if (pass) negativePass++
  console.log(`${pass ? '✅' : '❌'} ${c.name}`)
  console.log(`   源文: "${c.source}" (${c.source.length}字符)`)
  console.log(`   译文: "${c.translation}" (${c.translation.length}字符)`)
  console.log(`   膨胀率: ${(c.translation.length / c.source.length).toFixed(2)}x`)
  console.log(`   结果: ${wasTruncated ? '被截断 ✅' : '保留 ❌'}`)
  console.log(`   预期: ${c.reason}`)
  console.log()
}
console.log(`反向验证: ${negativePass}/${negativeCases.length} 通过\n`)

console.log('=== 边界验证：品牌/数值注入检测 ===\n')
let boundaryPass = 0
for (const c of boundaryCases) {
  const result = detectBrandInjection([c.source], [c.translation])
  const wasDetected = result.injectedIndices.has(0)
  const pass = wasDetected === c.shouldDetectInjection
  if (pass) boundaryPass++
  console.log(`${pass ? '✅' : '❌'} ${c.name}`)
  console.log(`   源文: "${c.source}"`)
  console.log(`   译文: "${c.translation}"`)
  console.log(`   结果: ${wasDetected ? '检测到注入 ✅' : '未检测 ❌'}`)
  console.log(`   预期: ${c.reason}`)
  console.log()
}
console.log(`边界验证: ${boundaryPass}/${boundaryCases.length} 通过\n`)

console.log('=== 总结 ===')
const totalPass = positivePass + negativePass + boundaryPass
const totalCases = positiveCases.length + negativeCases.length + boundaryCases.length
console.log(`总计: ${totalPass}/${totalCases} 通过`)
if (totalPass === totalCases) {
  console.log('✅ 所有验证通过！修复有效。')
  process.exit(0)
} else {
  console.log('❌ 部分验证失败，需要检查修复逻辑。')
  process.exit(1)
}
