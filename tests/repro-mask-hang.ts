/**
 * 回归脚本（v11.9.1）：点击翻译卡死 —— 修复后验证
 *
 * 事故根因（已实锤，修复前本脚本 3/4 用例 HANG）：
 *   lib/entity-masker.ts maskGlossaryTerms 的 v11.8「懒惰重匹配」分支（mi--; continue）
 *   无重试上界。cleanKey 归一化把 [-_]→空格，而柔性替换正则把空格→\s*、连字符保持
 *   字面：文本与术语分隔符形态不一致时（Osmo-360 vs 'Osmo 360'；'ZV E10' vs 'ZV-E10'；
 *   MX_Master_3S vs 'MX Master 3S'），cleanKey 命中但正则永远无候选，
 *   retryIdx 恒 !== -1 → 同一 match 无限重试 → UI 线程同步死循环 → 点击翻译卡死。
 *
 * v11.9.1 修复（lib/entity-masker.ts）：
 *   ① 正则连字符/下划线灵活化（转义 -_ → [\s\-_]*），与 cleanKey 归一化对齐 —— 根治；
 *   ② 删除 m.start 重锚（原双重计算 2·retryIdx−oldStart），漂移只吸收进 offset；
 *   ③ 每个 match 最多重试一次（retried 集合）—— 终止性结构性不变量。
 *
 * 本脚本 = 修复前 failing repro + 修复后 regression：
 *   每个用例在子进程里跑（esbuild JS API 打包，不依赖 tsx），15s 未退出即判 HANG。
 *   修复后要求：全部完成、形态不一致变体也被遮蔽成占位符、unmask 往返一致。
 */

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as esbuild from 'esbuild'

const NODE = process.execPath
const ROOT = path.join(__dirname, '..')

const CASES: Array<{ name: string; text: string; terms: string[]; expectMasked: boolean }> = [
  { name: '连字符文本 vs 空格术语 (Osmo-360)', text: 'Compatible with Osmo-360', terms: ['Osmo 360'], expectMasked: true },
  { name: '空格文本 vs 连字符术语 (ZV E10)', text: 'Works with ZV E10 camera', terms: ['ZV-E10'], expectMasked: true },
  { name: '下划线文本 (MX_Master_3S)', text: 'Pair with MX_Master_3S mouse', terms: ['MX Master 3S'], expectMasked: true },
  { name: '对照组：形态一致 (Steam Deck)', text: 'Compatible with Steam Deck', terms: ['Steam Deck'], expectMasked: true },
]

const CHILD_SNIPPET = `
const [text, termsJson] = [process.argv[2], process.argv[3]]
const { maskGlossaryTerms, unmaskGlossaryTerms } = require('@lib/entity-masker')
const map = new Map(JSON.parse(termsJson).map(t => [t, t]))
const r = maskGlossaryTerms([text], map)
const rt = unmaskGlossaryTerms(r.texts, r.termMap)
console.log(JSON.stringify({ masked: r.texts[0], roundtrip: rt.texts[0] === text }))
`

async function main() {
  let hangCount = 0
  let failCount = 0
  for (const c of CASES) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-mask-'))
    const childTs = path.join(tmpDir, 'child.ts')
    const entry = path.join(tmpDir, 'child.js')
    let verdict: string
    try {
      fs.writeFileSync(childTs, CHILD_SNIPPET, 'utf8')
      await esbuild.build({
        entryPoints: [childTs],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: entry,
        plugins: [{
          name: 'alias',
          setup(b) {
            b.onResolve({ filter: /^@lib\// }, a => ({ path: path.join(ROOT, 'lib', a.path.slice(5)) + '.ts' }))
            b.onResolve({ filter: /^@messages\// }, a => ({ path: path.join(ROOT, 'messages', a.path.slice(10)) + '.ts' }))
          },
        }],
        logLevel: 'silent',
      })
      const out = execFileSync(NODE, [entry, c.text, JSON.stringify(c.terms)],
        { timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      const parsed = JSON.parse(out.trim()) as { masked: string; roundtrip: boolean }
      const maskedOk = /__GLOSSARY(?:ALT)?_\d+__/.test(parsed.masked) === c.expectMasked
      const rtOk = parsed.roundtrip
      if (maskedOk && rtOk) {
        verdict = `完成 ✅ 遮蔽=${JSON.stringify(parsed.masked)} 往返=${rtOk}`
      } else {
        verdict = `FAIL ❌ 遮蔽=${JSON.stringify(parsed.masked)}（期望含占位符=${c.expectMasked}）往返=${rtOk}`
        failCount++
      }
    } catch (e: unknown) {
      const err = e as { killed?: boolean; signal?: string; stderr?: Buffer | string }
      const msg = String(e)
      const stderr = err.stderr ? String(err.stderr).slice(0, 400) : ''
      if (err.killed || err.signal === 'SIGTERM' || msg.includes('TIMEOUT') || msg.includes('timed out')) {
        verdict = 'HANG ❌ 死循环（15s 未退出）—— 修复未生效'
        hangCount++
        failCount++
      } else {
        verdict = `ERROR ⚠️ ${msg.slice(0, 300)}${stderr ? '\n  stderr: ' + stderr : ''}`
        failCount++
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 清理失败不阻断 */ }
    }
    console.log(`${c.name}\n  → ${verdict}\n`)
  }

  console.log(failCount === 0
    ? '结论：全部通过 —— 卡死根治，分隔符形态不一致变体正常遮蔽，往返一致'
    : `结论：${failCount} 个用例失败（含 ${hangCount} 个死循环）`)
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
