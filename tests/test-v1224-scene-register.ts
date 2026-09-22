/**
 * v12.24 说明书场景卡语体指令——prompt 常量断言（零 API）
 *
 * 背景：es/ja 实机对照实锤——插件敬体（usted/～してください），官方亲体/陈述体（tú/～します）。
 * 且现有场景卡 es「Manuals use Usted address」/ja「～してください polite form」本身就是错误指引。
 * 本套件锁定改动后的语体指令，并回归其余语种 override 不变。
 *
 * 用法：npx tsx tests/test-v1224-scene-register.ts
 */
import { SCENE_CONSTRAINTS, getSceneConstraints } from '../lib/prompt-constants'

let passed = 0, failed = 0
function assert(cond: boolean, name: string, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.error(`  ❌ ${name}`, extra ?? '') }
}

console.log('=== v12.24 场景卡语体指令测试 ===\n')

const og = SCENE_CONSTRAINTS['operation_guide']
assert(!!og, 'A0 operation_guide 场景存在')

// ── A 段：es 语体指令（tú 亲体，删除错误 Usted 指引）──
console.log('A 段 es 语体指令')
const esOv = og.langOverrides?.['es'] || []
const esJoined = esOv.join('\n')
assert(/tú informal address/.test(esJoined), 'A1 es override 含 tú 亲体指令', esOv)
assert(/not Usted/.test(esJoined), 'A2 es override 明示「非 Usted」对照', esOv)
assert(!/Manuals use Usted address/.test(esJoined), 'A3 es override 已删除错误「Usted address」指引', esOv)
assert(/ADVERTENCIA\/PRECAUCIÓN\/NOTA/.test(esJoined), 'A4 es 警告格式保留')

// ── B 段：ja 语体指令（陈述体为主，删除一刀切 ～してください）──
console.log('\nB 段 ja 语体指令')
const jaOv = og.langOverrides?.['ja'] || []
const jaJoined = jaOv.join('\n')
assert(/declarative ～します\/～する/.test(jaJoined), 'B1 ja override 含陈述体指令', jaOv)
assert(/reserve 「～してください」 only for direct commands/.test(jaJoined), 'B2 ja override 明示 ～してください 仅限命令句', jaOv)
assert(!/Manuals use 「～してください」 polite form/.test(jaJoined), 'B3 ja override 已删除一刀切「～してください polite form」', jaOv)
assert(/【警告】【注意】【注釈】/.test(jaJoined), 'B4 ja 警告格式保留')

// ── C 段：getSceneConstraints 渲染后含新指令（es/ja）──
console.log('\nC 段 渲染输出')
const esRender = getSceneConstraints('manual', 'es')
const jaRender = getSceneConstraints('manual', 'ja')
assert(/tú informal address/.test(esRender), 'C1 manual 场景 es 渲染含 tú 指令')
assert(/declarative ～します/.test(jaRender), 'C2 manual 场景 ja 渲染含陈述体指令')

// ── D 段：其余语种 override 不变（回归）──
console.log('\nD 段 其余语种回归')
const koOv = (og.langOverrides?.['ko'] || []).join('\n')
const deOv = (og.langOverrides?.['de'] || []).join('\n')
const frOv = (og.langOverrides?.['fr'] || []).join('\n')
const zhCnOv = (og.langOverrides?.['zh-CN'] || []).join('\n')
assert(/하십시오체 polite form/.test(koOv), 'D1 ko override 不变', koOv)
assert(/Sie address/.test(deOv), 'D2 de override 不变', deOv)
assert(/vous address/.test(frOv), 'D3 fr override 不变', frOv)
assert(/请" imperative|请按下X键/.test(zhCnOv) || /请/.test(zhCnOv), 'D4 zh-CN override 不变', zhCnOv)

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`)
if (failed > 0) process.exit(1)
