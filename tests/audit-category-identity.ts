// ============================================================
// 品类词「保英文钦定」真空扫描（只读，不改代码）
// ============================================================
// 根因（2026-09-24 ko 实机 Solid State Dual Drive 音译事故）：
//   「该语种钦定 = 保英文（值与英文源同形）」的品类词，在该语种的
//   翻译管道里没有任何一道代码防线兜底——
//     · S1 短路：整条非产品名不触发
//     · S2 术语遮蔽：遮蔽源=术语库 CSV 行，品类词刻意不遮蔽（entity-masker 注释）
//     · LANG_SPECIFIC.rules：未写这条
//     · BRAND_NAME_RULE：v11.5 起移出首调
//   → 只能靠 LLM 自觉，规格书场景「全翻」压力最大时破防（ko 音译实锤）。
//
// 本扫描：对 11 个品类词 × 20 语种，找出「该语种值 === 英文源」的
// 「同形钦定」条目——这些就是翻译管道里的「保英文真空」，
// 一旦该词以非整条形态出现在正文里，LLM 就可能自由音译/变形。
//
// 产出：claude-tmp/category-identity-audit.txt
// ============================================================

/// <reference types="node" />

import { CATEGORY_WORDS } from '../lib/prompt-constants'
import { LANGUAGES } from '../messages/types'
import * as fs from 'fs'
import * as path from 'path'

const TARGET_LANGS = LANGUAGES.map(l => l.code).filter(c => c !== 'en')

// 归一化比较（与 cleanKey 同思路：大小写/连字符/空白不敏感）
function norm(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
}

interface IdentityHit {
  word: string
  lang: string
  promptValue: string      // prompt 对照层值（=英文源）
  productNameValue?: string // productName override 层值（若也是英文源，双保险真空）
  layer: 'prompt' | 'productName' | 'both'
}

const hits: IdentityHit[] = []
const lines: string[] = []

lines.push('品类词「保英文钦定」真空扫描')
lines.push(`生成时间: ${new Date().toISOString()}`)
lines.push(`品类词数: ${Object.keys(CATEGORY_WORDS).length}, 目标语种数: ${TARGET_LANGS.length}`)
lines.push('')
lines.push('判定口径：该语种的译法与英文源同形（归一化后相等）→ 该语种下此词')
lines.push('在翻译管道中无遮蔽/短路兜底，正文嵌入时存在被 LLM 音译/变形风险。')
lines.push('')

// 汇总表头
const header = ['品类词'.padEnd(26), ...TARGET_LANGS.map(l => l.padEnd(7))]
lines.push('='.repeat(120))
lines.push('【总表】●=该语种保英文(真空)  ○=有钦定译法(有防线)  ·=productName层也保英文')
lines.push('='.repeat(120))
lines.push(header.join(' '))
lines.push('-'.repeat(120))

for (const [word, entry] of Object.entries(CATEGORY_WORDS)) {
  const enPrompt = (entry['en'] as string) || word
  const row: string[] = [word.padEnd(26)]
  for (const lang of TARGET_LANGS) {
    const promptVal = entry[lang] as string | undefined
    const pnMap = entry['productName'] as Record<string, string> | undefined
    const pnVal = pnMap?.[lang]

    const promptIsIdentity = promptVal !== undefined && norm(promptVal) === norm(enPrompt)
    const pnIsIdentity = pnVal !== undefined && norm(pnVal) === norm(enPrompt)

    let mark = '○'      // 有钦定译法
    if (promptIsIdentity && pnIsIdentity) mark = '●·'   // 两层都保英文
    else if (promptIsIdentity) mark = '●'               // prompt 层保英文
    else if (pnIsIdentity) mark = '·'                   // 仅 productName 层保英文

    row.push(mark.padEnd(7))

    if (promptIsIdentity || pnIsIdentity) {
      hits.push({
        word, lang,
        promptValue: promptVal ?? '(无)',
        productNameValue: pnVal,
        layer: promptIsIdentity && pnIsIdentity ? 'both' : promptIsIdentity ? 'prompt' : 'productName',
      })
    }
  }
  lines.push(row.join(' '))
}

lines.push('')
lines.push('='.repeat(120))
lines.push(`【命中明细】共 ${hits.length} 个「词×语种」保英文真空`)
lines.push('='.repeat(120))

// 按语种分组统计
const byLang = new Map<string, IdentityHit[]>()
for (const h of hits) {
  if (!byLang.has(h.lang)) byLang.set(h.lang, [])
  byLang.get(h.lang)!.push(h)
}

lines.push('')
lines.push('── 按语种统计 ──')
for (const lang of TARGET_LANGS) {
  const list = byLang.get(lang) || []
  const words = list.map(h => h.word).join(', ')
  lines.push(`${lang.padEnd(7)} ${String(list.length).padStart(2)} 个真空: ${words || '(无)'}`)
}

lines.push('')
lines.push('── 按词统计（哪些词在哪些语种保英文）──')
const byWord = new Map<string, string[]>()
for (const h of hits) {
  if (!byWord.has(h.word)) byWord.set(h.word, [])
  byWord.get(h.word)!.push(h.lang)
}
for (const [word, langs] of byWord.entries()) {
  lines.push(`${word.padEnd(28)} → ${langs.length} 语种保英文: ${langs.join(', ')}`)
}

lines.push('')
lines.push('── 重点关注：多词品类词的保英文真空（嵌入正文时最易被音译）──')
lines.push('（单词如 SSD/Hub 即使保英文也不易被音译；多词组合如 Solid State Dual Drive')
lines.push('  / Flash Drive / Dual Drive 是 ko 音译事故的同型高危区）')
const multiWordHits = hits.filter(h => h.word.includes(' '))
for (const h of multiWordHits) {
  lines.push(`  ${h.lang.padEnd(7)} ${h.word.padEnd(28)} [${h.layer}] prompt="${h.promptValue}"`)
}

lines.push('')
lines.push('── 明细全量 ──')
for (const h of hits) {
  lines.push(`  ${h.lang.padEnd(7)} ${h.word.padEnd(28)} [${h.layer}] prompt="${h.promptValue}"${h.productNameValue ? ` productName="${h.productNameValue}"` : ''}`)
}

const out = lines.join('\n')
console.log(out)

const outPath = path.join(__dirname, '..', 'claude-tmp', 'category-identity-audit.txt')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, out, 'utf8')
console.log(`\n已写出: ${outPath}`)
