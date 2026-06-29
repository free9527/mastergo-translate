---
name: auto-font-mapping
description: 自动字体映射 — 目标语言驱动，4品牌字体统一替换，字重继承
metadata:
  type: project
---

# 自动字体映射

**文件**: `lib/font-mapper.ts`

目标语言驱动，检测到四个品牌字体时统一替换：

| 目标语言 | 替换为 |
|---------|--------|
| zh-CN / ja / ko / th / vi / id | HarmonyOS Sans SC |
| zh-TW | HarmonyOS Sans TC |
| 拉丁/西里尔 | Avenir |
| ar | HarmonyOS Sans Naskh Arabic + RIGHT |

**关键行为**
- 仅 `targetFontFamily` 为空时自动填充，手动覆盖优先
- 字重继承原文
- 不在四个字体范围内的字体不动
- 调用点：翻译/校对/重试完成后 `autoMapFonts()`

**Why:** 不同语言需要不同字体，手动设置繁琐且易遗漏。
**How to apply:** 新增字体时加入 `SPECIAL_FONTS`，新增语言时加入对应分组。[[matergo-translate-plugin]]
