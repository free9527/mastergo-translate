/**
 * v12.5 LLM 自发星号清理（stripSpuriousAsterisks）测试套件
 *
 * 背景：zh-TW 实机反馈「AI 生成文字中有出现 * 等符号，需要修改删除」。
 * LLM 把营销文案当 markdown 输出 *强调* / **粗体** / 孤立脚注符，设计稿
 * 不渲染 markdown，星号原样上稿。源文无 * 时清理；源文有 *（900MB/s* 速率
 * 脚注、行首列表符）一个都不碰。
 *
 * 用法：
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true,"types":["node"],"rootDir":".","importHelpers":false}' TS_NODE_TRANSPILE_ONLY=true npx ts-node -r tsconfig-paths/register tests/test-v125-spurious-asterisks.ts
 */

import { stripSpuriousAsterisks } from '../lib/post-process'

let passed = 0
let failed = 0
function assert(label: string, actual: string, expected: string) {
  if (actual === expected) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.error(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`)
  }
}

console.log('[A] markdown 成对标记——剥标记留内容')
assert('A1 **粗体** 剥壳',
  stripSpuriousAsterisks('Unleash the Power', '**釋放效能**'),
  '釋放效能')
assert('A2 *强调* 剥壳',
  stripSpuriousAsterisks('Unleash the Power', '*釋放效能*'),
  '釋放效能')
assert('A3 句中成对',
  stripSpuriousAsterisks('Capture every moment', '捕捉*每一個*瞬間'),
  '捕捉每一個瞬間')
assert('A4 嵌套 ** 内 *（先剥外层）',
  stripSpuriousAsterisks('Power and speed', '**效能*與*速度**'),
  '效能與速度')
assert('A5 多处成对',
  stripSpuriousAsterisks('Fast. Reliable. Safe.', '*快速*。**可靠**。*安全*。'),
  '快速。可靠。安全。')

console.log('\n[B] 孤立星号——剥掉并吸前导空格')
assert('B1 行首列表符（源文无 *）',
  stripSpuriousAsterisks('Limited Lifetime Warranty', '* 有限終身保固'),
  '有限終身保固')
assert('B2 句尾脚注符',
  stripSpuriousAsterisks('Limited Lifetime Warranty', '有限終身保固 *'),
  '有限終身保固')
assert('B3 词间孤立',
  stripSpuriousAsterisks('Up to 900MB per second', '高達 * 900MB/s'),
  '高達 900MB/s')
assert('B4 多行断行不被吃掉（\\n 前后星号只剥星号不吞换行）',
  stripSpuriousAsterisks('Line one\nLine two', '第一行 *\n* 第二行'),
  '第一行\n第二行')

console.log('\n[C] 源文有 * —— 一个都不碰')
assert('C1 速率脚注 900MB/s*',
  stripSpuriousAsterisks('Read speed up to 900MB/s*', '讀取速度高達 900MB/s*'),
  '讀取速度高達 900MB/s*')
assert('C2 行首列表符（源文本就是列表）',
  stripSpuriousAsterisks('* Limited Lifetime Warranty', '* 有限終身保固'),
  '* 有限終身保固')
assert('C3 源文 ※ 转义形态（管道中间态）',
  stripSpuriousAsterisks('※ Limited Lifetime Warranty', '※ 有限終身保固'),
  '※ 有限終身保固')

console.log('\n[D] 数字/单位紧邻的 * 保守保留（防误剥速率语义）')
assert('D1 译文自发 900MB/s*（源文无 *）——保留',
  stripSpuriousAsterisks('Read speed up to 900MB/s', '讀取速度高達 900MB/s*'),
  '讀取速度高達 900MB/s*')
assert('D2 词尾紧贴字母的 * 属孤立剥除（體驗* → 體驗）',
  stripSpuriousAsterisks('Fast 5G speed', '* 5G 高速體驗*'),
  '5G 高速體驗')

console.log('\n[E] 无 * 直通 / 空串')
assert('E1 无星号直通',
  stripSpuriousAsterisks('Hello world', '你好世界'),
  '你好世界')
assert('E2 空译文',
  stripSpuriousAsterisks('Hello', ''),
  '')

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
