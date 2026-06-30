/**
 * System Prompt Token 演进 — 精确对比
 * 固定场景: 商品详情页 + 标准版 + 电竞SSD + 简中→英
 * 不含术语库/品类词/few-shot
 */
const { execSync } = require('child_process');
const fs = require('fs');

function getSrc(hash) {
  if (hash === 'HEAD') return fs.readFileSync('lib/llm-api.ts', 'utf-8');
  try { return execSync('git show ' + hash + ':lib/llm-api.ts', {encoding:'utf-8', stdio:'pipe'}); }
  catch(e) { return null; }
}

// 提取 const NAME = `...`; 的内容
function extractConst(src, name) {
  const idx = src.indexOf('const ' + name);
  if (idx < 0) return '';
  const eq = src.indexOf('=', idx);
  const start = src.indexOf('`', eq) + 1;
  // 找闭合反引号 (处理转义)
  let depth = 1, pos = start;
  while (pos < src.length && depth > 0) {
    if (src[pos] === '\\') { pos += 2; continue; }
    if (src[pos] === '`') depth--;
    pos++;
  }
  return src.substring(start, pos - 1);
}

// Token 估算 (中文 ~1.5, 英文 ~0.3, 其他 ~0.5)
function estTokens(text) {
  let cjk = 0, latin = 0, other = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    const isCJK = (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) ||
                  (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF);
    const isLatin = (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) ||
                    (c >= 0x30 && c <= 0x39) || c === 0x20;
    if (isCJK) cjk++;
    else if (isLatin) latin++;
    else other++;
  }
  return Math.round(cjk * 1.5 + latin * 0.3 + other * 0.5);
}

const versions = [
  { h: '10e9105', label: 'v0.1.0 基线' },
  { h: 'de3634b', label: 'v0.2.0 精细化' },
  { h: 'd7588f1', label: 'v0.3.0 场景+短文本' },
  { h: 'ebb1561', label: '校对禁扩写' },
  { h: 'ab73167', label: '产品线x风格' },
  { h: '6a486f1', label: '字体映射+守卫' },
  { h: 'HEAD', label: 'current 本次' },
];

// 手工验证几个关键值
for (const v of versions) {
  const src = getSrc(v.h);
  if (!src) { console.log(v.label + ': SKIP'); continue; }

  // GLOBAL_RULES
  const gr1 = extractConst(src, 'GLOBAL_RULES =');
  const gr2 = extractConst(src, 'GLOBAL_RULES_EN');
  const rules = gr1 || gr2 || '';

  // BRAND_VOICE (v0.1.0)
  const bv = extractConst(src, 'BRAND_VOICE =');

  // ROLE
  const roleMatch = src.match(/(你是[^。\n]{30,250}。)/);
  const role = roleMatch ? roleMatch[1] : '';

  // LANG_SPECIFIC count
  const lsCount = (src.match(/'[a-z]{2}(-[A-Z]{2})?':\s*`/g) || []).length;

  // OUTUT_ANCHOR
  const oa = extractConst(src, 'OUTPUT_ANCHOR =');
  const oaEn = extractConst(src, 'OUTPUT_ANCHOR_EN');

  // Features present
  const hasPL = src.includes('PRODUCT_LINE_STRATEGIES');
  const hasScene = src.includes('SCENE_PRESETS');
  const hasAnchor = !!oa || !!oaEn;
  const hasLangSpecific = lsCount > 0;

  console.log(v.label + ':');
  console.log('  ROLE=' + (role.length) + ' RULES=' + (rules.length || bv.length) +
    ' LANG_SPECIFIC=' + lsCount + '语 PL=' + hasPL + ' SCENE=' + hasScene +
    ' ANCHOR=' + (oa.length || oaEn.length));
}
