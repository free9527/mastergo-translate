/**
 * 精确对比各版本 System Prompt 大小
 * 场景：商品详情页 + 标准版 + 电竞SSD + 简中→英
 * 不含术语库（动态注入，各版本相同）
 */
const { execSync } = require('child_process');

const SCENE = 'ecommerce';
const PRODUCT_LINE = 'gaming_ssd';

const versions = [
  { hash: '10e9105', label: 'v0.1.0 基线' },
  { hash: 'de3634b', label: 'v0.2.0 精细化' },
  { hash: 'd7588f1', label: 'v0.3.0 场景+短文本' },
  { hash: 'ebb1561', label: '校对禁扩写' },
  { hash: 'ab73167', label: '产品线×风格' },
  { hash: '6a486f1', label: '字体映射+守卫' },
  { hash: 'HEAD', label: 'current 本次' },
];

function getSource(hash) {
  try {
    return execSync(`git show ${hash}:lib/llm-api.ts`, {encoding:'utf-8', stdio:'pipe'});
  } catch(e) { return null; }
}

// 提取 `...` 模板字符串常量
function tpl(src, name) {
  // 尝试匹配 const NAME = `...`;
  const re = new RegExp('(?:const|export)\\s+(?:const\\s+)?' + name + '[^=]*=\\s*`([^`]*)`', 's');
  const m = src.match(re);
  return m ? m[1] : '';
}

// 提取 Record 中某个 key 的值
function recVal(src, recordName, key) {
  const idx = src.indexOf(recordName);
  if (idx < 0) return '';
  const section = src.substring(idx);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`'${escaped}'\\s*:\\s*\`([^\`]*)\``, 's');
  const m = section.match(re);
  return m ? m[1] : '';
}

// 提取 toneMap 中 standard.cn
function toneCN(src, style) {
  const idx = src.indexOf('toneMap');
  if (idx < 0) return '';
  const section = src.substring(idx, idx + 1500);
  const re = new RegExp(style + '[^}]*cn[^`]*`([^`]*)`', 's');
  const m = section.match(re);
  return m ? m[1] : '';
}

function estimateTokens(text) {
  let cjk = 0, latin = 0, other = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 0x4e00 && c <= 0x9fff || c >= 0x3400 && c <= 0x4dbf) cjk++;
    else if (c >= 0x41 && c <= 0x5a || c >= 0x61 && c <= 0x7a || c >= 0x30 && c <= 0x39) latin++;
    else if (c >= 0x3040 && c <= 0x30ff || c >= 0xac00 && c <= 0xd7af) cjk++;
    else other++;
  }
  return Math.round(cjk * 1.5 + latin * 0.3 + other * 0.5);
}

console.log('='.repeat(75));
console.log('  System Prompt 演进 — 固定场景');
console.log('  商品详情页 + 标准版 + 电竞SSD + 简→英');
console.log('  (不含术语库/品类词/few-shot — 这些各版本相同)');
console.log('='.repeat(75));
console.log('');

const results = [];

for (const v of versions) {
  const src = getSource(v.hash);
  if (!src) { console.log(`  ${v.label}: 文件不存在`); continue; }

  // 组装 prompt 各部分
  const parts = {};

  // ROLE — 各版本都有
  if (v.hash === '10e9105') {
    parts.role = '你是Lexar存储品牌专业翻译，专精3C/存储跨境电商。';
  } else if (v.hash === 'HEAD') {
    parts.role = '你是 Lexar（雷克沙）首席本地化翻譯專家，精通存儲、電競、影像及消費電子領域。核心使命：將源文本精準、地道地翻譯為目標語言。嚴格忠實於原文信息邊界——透過調整詞彙色彩、句式結構來適配產品線與受眾，但絕對禁止自由創作、腦補參數或誇大宣傳。';
  } else {
    const found = src.match(/你是[^`\n]{30,300}/);
    parts.role = found ? found[0].replace(/\$\{[^}]+\}/g, '').trim() : '(未找到)';
  }

  // GLOBAL_RULES (v0.1.0用BRAND_VOICE+简单规则)
  if (v.hash === '10e9105') {
    const bv = tpl(src, 'BRAND_VOICE');
    parts.rules = bv + '\n术语库最高优先级，必须严格使用。型号/容量/接口/协议原样保留。';
  } else {
    parts.rules = tpl(src, 'GLOBAL_RULES');
    if (!parts.rules) parts.rules = tpl(src, 'GLOBAL_RULES\\s'); // try alternate
  }

  // 翻译指令
  parts.translate = '将以下文本从简体中文翻译成English。\n⚠️ 原文中的 ↵ 符号代表换行，译文中请保留同样的换行位置。';

  // Context = 产品线策略 + 场景 + 风格
  let ctx = '';
  const pl = recVal(src, 'PRODUCT_LINE_STRATEGIES', PRODUCT_LINE);
  if (pl) {
    ctx += pl + '\n';
  } else if (v.hash === '10e9105') {
    // v0.1.0 没有产品线策略，用 content type guide
    const ctg = src.match(/description[^`]*`([^`]*)`/);
    if (ctg) ctx += ctg[1] + '\n';
  } else {
    // 通用兜底
    ctx += '【产品语境】通用3C存储产品。使用行业标准术语，准确翻译。\n';
  }

  const sceneVal = recVal(src, 'SCENE_PRESETS', SCENE);
  if (sceneVal) ctx += sceneVal + '\n';

  const styleVal = toneCN(src, 'standard');
  if (styleVal) ctx += styleVal + '\n';

  parts.context = ctx.trim();

  // LANG_SPECIFIC for English
  parts.lang = recVal(src, 'LANG_SPECIFIC', 'en');
  if (!parts.lang && v.hash !== '10e9105') {
    // Try alternate extraction
    const lsSec = src.match(/LANG_SPECIFIC[^=]*=\s*\{/);
    if (lsSec) {
      const enVal = src.substring(lsSec.index).match(/'en'\s*:\s*`([^`]*)`/);
      if (enVal) parts.lang = enVal[1];
    }
  }

  // OUTPUT_ANCHOR
  parts.anchor = tpl(src, 'OUTPUT_ANCHOR');

  // 输出格式
  parts.format = '__XXX_N__ 格式标记必须原样保留在译文对应位置。\n【输出】严格按 "[N] 译文" 格式，一行一条。';

  // 计算总字符
  let total = 0;
  const detail = [];
  for (const [name, content] of Object.entries(parts)) {
    total += content.length;
    detail.push({ name, len: content.length });
  }

  const tokens = estimateTokens(Object.values(parts).join(''));

  results.push({ label: v.label, total, tokens, detail, parts });

  // 打印
  console.log(`─── ${v.label} ───`);
  for (const d of detail) {
    console.log(`  ${d.name.padEnd(14)} ${String(d.len).padStart(4)} chars`);
  }
  console.log(`  ${'─'.repeat(18)}`);
  console.log(`  TOTAL          ${String(total).padStart(4)} chars → ~${tokens} tokens`);
  console.log('');
}

// 汇总
console.log('='.repeat(75));
console.log('  汇总');
console.log('='.repeat(75));
console.log('');
console.log('版本                   chars    tokens    增量     增率');
console.log('─'.repeat(60));

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const label = r.label.padEnd(24);
  const chars = String(r.total).padStart(5);
  const tok = String(r.tokens).padStart(5);
  let delta = '', pct = '';
  if (i > 0) {
    const prevT = results[i-1].total;
    const d = r.total - prevT;
    const sign = d >= 0 ? '+' : '';
    delta = (sign + d).padStart(8);
    pct = (sign + Math.round(d/prevT*100) + '%').padStart(6);
  } else {
    delta = '—'.padStart(8);
    pct = '—';
  }
  console.log(`${label}${chars}    ${tok}  ${delta}  ${pct}`);
}

const first = results[0];
const last = results[results.length - 1];
const growth = Math.round((last.total - first.total) / first.total * 100);
console.log('─'.repeat(60));
console.log(`总增长: ${first.tokens} → ${last.tokens} tokens (+${growth}%)`);
