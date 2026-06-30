const fs = require('fs');
const s = fs.readFileSync('lib/llm-api.ts', 'utf-8');

function clen(name) {
  const idx = s.indexOf('const ' + name);
  if (idx < 0) return 0;
  const start = s.indexOf('`', idx) + 1;
  let depth = 1, pos = start;
  while (pos < s.length && depth > 0) {
    if (s[pos] === '\\') { pos += 2; continue; }
    if (s[pos] === '`') depth--;
    pos++;
  }
  return pos - start - 1;
}

console.log('=== 当前 prompt 各组件大小 ===\n');
console.log('GLOBAL_RULES_CN:   ', clen('GLOBAL_RULES ='), 'chars');
console.log('GLOBAL_RULES_EN:   ', clen('GLOBAL_RULES_EN'), 'chars');
console.log('OUTPUT_ANCHOR_CN:  ', clen('OUTPUT_ANCHOR ='), 'chars');
console.log('OUTPUT_ANCHOR_EN:  ', clen('OUTPUT_ANCHOR_EN'), 'chars');
console.log('CONTEXT_HINT_CN:   ', clen('CONTEXT_HINT ='), 'chars');
console.log('CONTEXT_HINT_EN:   ', clen('CONTEXT_HINT_EN'), 'chars');

// ROLE
const roleIdxCN = s.indexOf('你是 Lexar（雷克沙）首席');
const roleCN = s.substring(roleIdxCN, s.indexOf('。', roleIdxCN) + 1);
console.log('ROLE_CN:           ', roleCN.length, 'chars');

const roleIdxEN = s.indexOf('You are Lexar');
const roleEN = s.substring(roleIdxEN, s.indexOf('.', s.indexOf('Core mission:', roleIdxEN)) + 1);
console.log('ROLE_EN:           ~', roleEN.length, 'chars');

// LANG_SPECIFIC
const lsRe = /'([a-z]{2}(-[A-Z]{2})?)':\s*`([^`]*)`/g;
let lsMatch;
console.log('\nLANG_SPECIFIC per language:');
while ((lsMatch = lsRe.exec(s)) !== null) {
  console.log('  ' + lsMatch[1].padEnd(6) + ' ' + String(lsMatch[3].length).padStart(3) + ' chars');
}

// Product line strategies (CN) — extract from PRODUCT_LINE_STRATEGIES record
const plIdx = s.indexOf('const PRODUCT_LINE_STRATEGIES');
const plIdxEN = s.indexOf('const PRODUCT_LINE_STRATEGIES_EN');
const plSection = s.substring(plIdx, plIdxEN);
const plRe = /'([a-z_]+)':\s*`([^`]*)`/g;
let plMatch;
console.log('\nProduct line strategies (CN):');
while ((plMatch = plRe.exec(plSection)) !== null) {
  console.log('  ' + plMatch[1].padEnd(22) + ' ' + String(plMatch[2].length).padStart(3) + ' chars');
}

// Product line strategies (EN)
const plSectionEN = s.substring(plIdxEN, s.indexOf('// 产品线 → 相关品类词映射'));
const plMatchEN = [...plSectionEN.matchAll(/'([a-z_]+)':\s*`([^`]*)`/g)];
console.log('\nProduct line strategies (EN):');
for (const m of plMatchEN) {
  console.log('  ' + m[1].padEnd(22) + ' ' + String(m[2].length).padStart(3) + ' chars');
}

// Proofread product line contexts
console.log('\nProofread PL contexts (CN):');
const prPlCN = s.substring(s.indexOf('PROOFREAD_PL_CN'), s.indexOf('PROOFREAD_PL_EN'));
const prPlCNMatches = [...prPlCN.matchAll(/'([a-z_]+)':\s*`([^`]*)`/g)];
for (const m of prPlCNMatches) {
  console.log('  ' + m[1].padEnd(22) + ' ' + String(m[2].length).padStart(3) + ' chars');
}

console.log('\nProofread PL contexts (EN):');
const prPlEN = s.substring(s.indexOf('PROOFREAD_PL_EN'), s.indexOf('function getProofreadContext'));
const prPlENMatches = [...prPlEN.matchAll(/'([a-z_]+)':\s*`([^`]*)`/g)];
for (const m of prPlENMatches) {
  console.log('  ' + m[1].padEnd(22) + ' ' + String(m[2].length).padStart(3) + ' chars');
}

// Scene presets
console.log('\nSCENE_PRESETS (CN):');
const scRe = /'(technical_params|ecommerce|packaging|ui|after_sales|manual|spec_sheet)':\s*`([^`]*)`/g;
let scMatch;
while ((scMatch = scRe.exec(s)) !== null) {
  console.log('  ' + scMatch[1].padEnd(18) + ' ' + String(scMatch[2].length).padStart(3) + ' chars');
}

// Few-shot estimate (1 example per non-CJK batch)
console.log('\nFew-shot: now 1 example per batch (was 2), ~120-180 chars each.');

// ============================================================
// Simulate one API call
// ============================================================
console.log('\n=== 典型 API 调用估算 ==================');

// CN → EN (ecommerce, standard, gaming_ssd)
const totalCN = clen('GLOBAL_RULES =') + roleCN.length + 300 + 120 + 30 + 180 + clen('OUTPUT_ANCHOR =') + clen('CONTEXT_HINT =') + 200;
console.log('CN→EN 翻译:');
console.log('  GLOBAL_RULES:    ', clen('GLOBAL_RULES ='), 'chars');
console.log('  ROLE:            ', roleCN.length, 'chars');
console.log('  Product line:    ~300 chars');
console.log('  Scene:           ~120 chars');
console.log('  Style:           ~30 chars');
console.log('  LANG_SPECIFIC:   ~180 chars');
console.log('  CONTEXT_HINT:    ', clen('CONTEXT_HINT ='), 'chars');
console.log('  OUTPUT_ANCHOR:   ', clen('OUTPUT_ANCHOR ='), 'chars');
console.log('  Few-shot:        N/A (zh/zh-TW跳过)');
console.log('  Format/Markers:  ~200 chars');
console.log('  ─────────────────────────');
console.log('  TOTAL (不含术语): ~' + totalCN + ' chars');

// EN → DE (ecommerce, standard, pc_productivity) — has few-shot
console.log('\nEN→DE 翻译:');
const totalEN = clen('GLOBAL_RULES_EN') + roleEN.length + 300 + 120 + 30 + clen('CONTEXT_HINT_EN') + clen('OUTPUT_ANCHOR_EN') + 150 + 200 + 200;
console.log('  GLOBAL_RULES:    ', clen('GLOBAL_RULES_EN'), 'chars');
console.log('  ROLE:            ~330 chars');
console.log('  Product line:    ~230 chars (EN)');
console.log('  Scene:           ~120 chars');
console.log('  Style:           ~35 chars');
console.log('  LANG_SPECIFIC:   ~270 chars (de)');
console.log('  CONTEXT_HINT:    ', clen('CONTEXT_HINT_EN'), 'chars');
console.log('  OUTPUT_ANCHOR:   ', clen('OUTPUT_ANCHOR_EN'), 'chars');
console.log('  Few-shot:        ~150 chars (1 example)');
console.log('  Format/Markers:  ~200 chars');
console.log('  ─────────────────────────');
console.log('  TOTAL (不含术语): ~' + totalEN + ' chars');

// EN → DE 校对 (proofread, same product line)
console.log('\nEN→DE 校对:');
const proofPL = [...prPlENMatches].find(m => m[1] === 'pc_productivity');
const proofContextLen = proofPL ? proofPL[2].length : 0;
const totalProof = 330 + clen('GLOBAL_RULES_EN') + proofContextLen + 100 + 100 + clen('OUTPUT_ANCHOR_EN') + 200;
console.log('  ROLE (proofread): ~330 chars');
console.log('  Rules (proofread): abbrev version');
console.log('  Proofread context:', proofContextLen, 'chars (vs ~350 chars before)');
console.log('  Category words:   ~100 chars');
console.log('  Context hint:     ~100 chars');
console.log('  OUTPUT_ANCHOR:    ', clen('OUTPUT_ANCHOR_EN'), 'chars');
console.log('  Format:           ~200 chars');
console.log('  ─────────────────────────');
console.log('  校对语境节省: ~' + (350 - proofContextLen) + ' chars (vs 翻译版产品线策略)');
