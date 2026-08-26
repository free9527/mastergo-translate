/**
 * v12.1 泰文断行结构硬锁（enforceThaiLineBreaks）单元测试
 *
 * 背景：judge 基线（迭代 1）发现 th naturalness 2.69 崩塌，根因=LLM 对泰文
 * 多行文本换行保留率仅 41%（其他语种 65%），prompt 指令无效。
 * 修复：S5 还原后对 th 目标按源文断行位置强制补足换行（代码管形式）。
 *
 * 用法：
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true,"types":["node"],"rootDir":".","importHelpers":false}' TS_NODE_TRANSPILE_ONLY=true npx ts-node -r tsconfig-paths/register tests/test-v121-thai-linebreaks.ts
 */

import { enforceThaiLineBreaks } from '../lib/post-process'

let passed = 0
let failed = 0

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('═══ A 断行补足（核心场景）═══')

// A1: 源文 2 行（标题+正文），译文 0 换行 → 应拆成 2 行
{
  const src = 'Power Up Your Play\nLexar® PLAY PRO microSDXC™ Express Card'
  const trans = 'อัปพลังให้การเล่นของคุณเมมโมรี่การ์ด Lexar® PLAY PRO microSDXC™ Express'
  const out = enforceThaiLineBreaks(src, trans)
  const outBreaks = (out.match(/\n/g) || []).length
  assert(outBreaks >= 1, 'A1 源文1换行译文0换行 → 补足≥1', `实际 ${outBreaks} 换行: ${JSON.stringify(out)}`)
}

// A2: 源文 9 标题 14 换行，译文 3 换行 → 应补足
{
  const src = 'Good for Today, Great for Tomorrow\n\nRevolutionary Performance\n\nPeace of Mind Extras\n\nLevel-up Your Handheld Gaming Experience\nRead speed up to 900MB/s\n\nCut Your Download Times\nWrite speed up to 600MB/s\n\nMassive Capacity up to 1TB\n\nProtection Built in'
  const trans = 'ตอบโจทย์วันนี้พร้อมลุยวันหน้าประสิทธิภาพพลิกโฉมเสริมความอุ่นใจยกระดับประสบการณ์เกมพกพาของคุณความเร็วในการอ่านสูงสุด 900MB/s\nลดเวลาการดาวน์โหลดของคุณความเร็วในการเขียนสูงสุด 600MB/s\nความจุขนาดใหญ่สูงสุด 1TB\nการปกป้องในตัว'
  const out = enforceThaiLineBreaks(src, trans)
  const outBreaks = (out.match(/\n/g) || []).length
  assert(outBreaks > 3, 'A2 源文14换行译文3换行 → 补足>3', `实际 ${outBreaks} 换行`)
}

console.log('\n═══ B 不干预场景（安全性）═══')

// B1: 源文无换行 → 不干预
{
  const src = 'Read speed up to 900MB/s'
  const trans = 'ความเร็วในการอ่านสูงสุด 900MB/s'
  const out = enforceThaiLineBreaks(src, trans)
  assert(out === trans, 'B1 源文无换行 → 原样返回')
}

// B2: 译文换行 ≥ 源文 → 不干预
{
  const src = 'Title\nBody'
  const trans = 'หัวข้อ\nเนื้อหา\nเพิ่มเติม'
  const out = enforceThaiLineBreaks(src, trans)
  assert(out === trans, 'B2 译文换行(2)>源文(1) → 原样返回')
}

// B3: 源文只有空段（连续换行）→ 不干预
{
  const src = 'Single line\n\n\n'
  const trans = 'บรรทัดเดียว'
  const out = enforceThaiLineBreaks(src, trans)
  assert(out === trans, 'B3 源文空段 → 原样返回')
}

console.log('\n═══ C 断点安全性（不切词）═══')

// C1: 拆分点应在泰文元音前或数字/英文前（不在泰文辅音后硬切）
{
  const src = 'Revolutionary Performance\n\nThanks to its next-gen tech'
  const trans = 'ประสิทธิภาพพลิกโฉมด้วยเทคโนโลยีเจเนอเรชันใหม่'
  const out = enforceThaiLineBreaks(src, trans)
  const lines = out.split('\n')
  assert(lines.length >= 2, 'C1 应拆成≥2行', `实际 ${lines.length} 行`)
  // 断行后每行应以完整字符开头（泰文元音 สระ 或英文字母）
  if (lines.length >= 2) {
    const secondLineStart = lines[1].trim()[0] || ''
    const code = secondLineStart.charCodeAt(0)
    const isVowelOrLatin = (code >= 0x0e30 && code <= 0x0e44) || /[A-Za-z0-9]/.test(secondLineStart)
    assert(isVowelOrLatin, 'C2 第二行以泰文元音/英文开头（不切词）', `第二行开头: ${secondLineStart} (U+${code.toString(16).toUpperCase()})`)
  }
}

console.log('\n═══ D 内容保留（不丢字）═══')

// D1: 拆分前后非空白字符完全一致
{
  const src = 'Title One\nTitle Two\nTitle Three'
  const trans = 'หัวข้อที่หนึ่งหัวข้อที่สองหัวข้อที่สาม'
  const out = enforceThaiLineBreaks(src, trans)
  const stripWs = (s: string) => s.replace(/\s/g, '')
  assert(stripWs(out) === stripWs(trans), 'D1 拆分后非空白字符完全一致', `差异: ${stripWs(out)} vs ${stripWs(trans)}`)
}

console.log(`\n═══ 结果: ${passed} 通过, ${failed} 失败 ═══`)
process.exit(failed > 0 ? 1 : 0)
