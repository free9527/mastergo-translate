import { renderLangForTranslate, renderLangForProofread, LANG_SPECIFIC } from '../lib/prompt-constants'
let pass = 0, fail = 0
const assert = (c: boolean, n: string) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}`) } }

// ko rules/commonErrors/proofreadChecks 注入
const ko = LANG_SPECIFIC['ko']
assert(ko.rules.includes('시험'), 'ko.rules 含 시험 术语规范')
assert(ko.rules.includes('스마트폰'), 'ko.rules 含 스마트폰 术语规范')
assert(ko.commonErrors!.includes('테스트'), 'ko.commonErrors 含 테스트→시험 反例')
assert(ko.commonErrors!.includes('휴지폰'), 'ko.commonErrors 含 휴지폰→스마트폰 反例')
assert(ko.proofreadChecks!.includes('시험'), 'ko.proofreadChecks 含 시험 检查项')

// 翻译链路注入（renderLangForTranslate 含 commonErrors）
const trans = renderLangForTranslate('ko', null, true, ['some text'])
assert(trans.includes('시험'), 'renderLangForTranslate 注入 시험 规范')
assert(trans.includes('스마트폰'), 'renderLangForTranslate 注入 스마트폰 规范')

// 校对链路注入
const proof = renderLangForProofread('ko', null, ['some text'])
assert(proof.includes('시험'), 'renderLangForProofread 注入 시험 检查项')

// 边界：性能·benchmark 测试保留 테스트（不一刀切，v12.29 收窄实证标注）
assert(ko.rules.includes('테스트 허용') || ko.commonErrors!.includes('不一刀切'), '边界：性能·benchmark 测试保留 테스트（不一刀切）标注存在')

// 其他语种不受影响
const ja = renderLangForTranslate('ja', null, true, ['text'])
assert(!ja.includes('시험'), 'ja 不受影响（无 ko 规则）')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
