/**
 * 源文本预标准化
 *
 * 在将文本送入 LLM 之前做 Unicode 正规化处理，消除设计稿中常见的
 * 全角字符、零宽空格、兼容字符等问题，提升 LLM 语种检测准确率和术语匹配精度。
 *
 * 注意：此模块不处理 ®™© 符号（由 constants.ts 的 normalizeText 负责），
 * 也不处理 HTML 标签（由 protectHtmlTags/restoreHtmlTags 负责）。
 */

// ============================================================
// 全角→半角映射（仅 ASCII 范围的拉丁字母和数字）
// ============================================================
// Unicode 全角字符块 U+FF00–U+FFEF
// 全角字母：Ａ(FF21)–Ｚ(FF3A) → A(0041)–Z(005A)
// 全角字母：ａ(FF41)–ｚ(FF5A) → a(0061)–z(007A)
// 全角数字：０(FF10)–９(FF19) → 0(0030)–9(0039)
// 偏移量: 0xFEE0 = 65248

function fullwidthToHalfwidth(text: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const code = ch.charCodeAt(0)
    // 全角字母 A-Z (FF21-FF3A) 和 a-z (FF41-FF5A)
    if ((code >= 0xff21 && code <= 0xff3a) || (code >= 0xff41 && code <= 0xff5a)) {
      result += String.fromCharCode(code - 0xfee0)
    }
    // 全角数字 0-9 (FF10-FF19)
    else if (code >= 0xff10 && code <= 0xff19) {
      result += String.fromCharCode(code - 0xfee0)
    }
    // 其他字符保持不变（包括全角标点、CJK 字符等）
    else {
      result += ch
    }
  }
  return result
}

// ============================================================
// 零宽字符移除
// ============================================================
// U+200B 零宽空格 (Zero Width Space)
// U+200C 零宽非连接符 (Zero Width Non-Joiner)
// U+200D 零宽连接符 (Zero Width Joiner)
// U+FEFF 字节顺序标记 / 零宽不换行空格 (BOM / Zero Width No-Break Space)

function removeZeroWidthChars(text: string): string {
  return text.replace(/[​‌‍﻿]/g, '')
}

// ============================================================
// Unicode 兼容字符正规化
// ============================================================
// NFKC (Compatibility Composition) 会将兼容字符分解为规范形式：
// ㎇ (U+3387) → GB, ㎒ (U+3392) → MHz, ㎝ (U+339D) → cm
// ① (U+2460) → 1, ™ (U+2122) → TM 等
//
// 但 NFKC 也会影响某些 CJK 字符，因此只对非 CJK 文本区域使用。
// 由于我们的源文本主要是拉丁字母 + 数字 + 单位符号，NFKC 是安全的。
//
// ⚠️ 重要：™ (U+2122) 会被 NFKC 展开为 "TM" 两个ASCII字符，
// 这会破坏商标符号的还原。因此在 NFKC 前保护 ™ 符号。

// PUA 字符 U+E000，不会被 NFKC 影响
const TM_PROTECTION_CHAR = ''

function normalizeCompatibilityChars(text: string): string {
  // 保护 ™ 符号：NFKC 会将 ™ (U+2122) 展开为 "TM" 两个ASCII字符
  // 先用 PUA 占位符替换，NFKC 后还原
  let result = text.replace(/™/g, TM_PROTECTION_CHAR)
  result = result.normalize('NFKC')
  result = result.replace(new RegExp(TM_PROTECTION_CHAR, 'g'), '™')
  return result
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 对源文本数组做预标准化，准备送入 LLM
 * @param texts 原始源文本数组（HTML 标签应已在此之前被 protectHtmlTags 保护）
 * @returns 标准化后的文本数组，与输入一一对应
 */
export function normalizeTextForLLM(texts: string[]): string[] {
  return texts.map((text) => {
    if (!text) return text

    let result = text

    // 1. Unicode NFC 正规化（组合字符统一为规范形式）
    result = result.normalize('NFC')

    // 1.5. 换行符保护：将硬件换行替换为 ↵（U+21B5），防止 LLM（Qwen）将换行视为条目分隔符。
    // 翻译完成后由 postProcessTranslation 还原为实际换行。
    result = result.replace(/[\n\r]+/g, ' ↵ ')

    // 2. 全角字母/数字 → 半角
    result = fullwidthToHalfwidth(result)

    // 3. 移除零宽字符
    result = removeZeroWidthChars(result)

    // 4. Unicode 兼容字符正规化（NFKC）
    result = normalizeCompatibilityChars(result)

    return result
  })
}

// ============================================================
// CJK 空格保护 — 防止 LLM 将 CJK 文本中的空格误判为条目分隔符
//
// 根因：Qwen 等模型在遇到 "超会玩 A2性能 体验3A游戏大作" 时，
// 会将空格视为分隔符，只翻译前半段 "超會玩" 而丢弃后续内容。
//
// 方案（v2）：直接删除 CJK 主导文本（CJK 字符占比 > 30%）中的 ASCII 空格。
// CJK 文本本身不需要空格即可被 LLM 正确理解，翻译后的拉丁语言输出
// 会自动包含正确间距，因此无需还原。
//
// 历史：曾使用 SP{N} 占位符（PUA 字符 U+E000），但该字符同样
// 不在 Qwen BPE tokenizer 词汇表中，被当作 token 边界处理，导致
// 占位符处文本被拆分，保护失效。详见 2026-06-29 根因分析。
// ============================================================

function isCJK(charCode: number): boolean {
  return (charCode >= 0x4e00 && charCode <= 0x9fff) ||   // CJK统一汉字
    (charCode >= 0x3400 && charCode <= 0x4dbf) ||          // CJK扩展A
    (charCode >= 0x3040 && charCode <= 0x309f) ||          // 平假名
    (charCode >= 0x30a0 && charCode <= 0x30ff) ||          // 片假名
    (charCode >= 0xac00 && charCode <= 0xd7af)             // 韩文
}

function isCJKDominant(text: string): boolean {
  if (!text || text.length === 0) return false
  let cjkCount = 0
  for (let i = 0; i < text.length; i++) {
    if (isCJK(text.charCodeAt(i))) cjkCount++
  }
  return cjkCount / text.length > 0.3
}

/**
 * CJK 空格保护 — 合并多余连续空格，保留有效空格和 ↵ 断行标记周围的空格。
 *
 * 历史：曾直接删除所有空格（text.replace(/ /g, '')），因为 Qwen 可能将 CJK 文本
 * 中的空格误判为条目分隔符。但该逻辑导致两个问题：
 * 1. CJK 短语间的有效空格被删除（"生而强大 耐力十足" → "生而强大耐力十足"）
 * 2. ↵ 断行标记被 CJK 字符夹住（"强大↵耐力"），LLM 难以识别
 * 现在文本已用 [N] "..." 格式包裹，空格不再被误解为分隔符 → 只合并多余空格。
 */
export function protectCjkSpaces(texts: string[]): string[] {
  return texts.map((text) => {
    if (!text || !isCJKDominant(text)) return text
    // 合并连续空格为单空格，保留有效空格和 ↵ 周围的间距
    return text.replace(/ {2,}/g, ' ')
  })
}
