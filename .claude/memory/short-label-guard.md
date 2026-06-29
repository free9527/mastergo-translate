---
name: short-label-guard
description: 短标签扩写硬守卫，防止UI短文本被LLM过度翻译
metadata:
  type: project
---

# 短标签扩写硬守卫

**文件**: `lib/post-process.ts` — `enforceShortLabelLength()`

源文 < 15 字符且译文 > 1.5x 时触发三道防线：
1. 精确匹配术语库
2. 降低阈值（3 字符起）重新子串匹配
3. 硬截断到源文 1.3x（CJK 按字符、拉丁按词边界）

已集成到 `llm-api.ts` 和 `App.vue` 两个翻译管道，紧接 `enforceGlossaryTerms` 之后。

**Why:** LLM 容易把短标签翻译成长句导致 UI 溢出。prompt 软约束不够可靠。
**How to apply:** 放在 `enforceGlossaryTerms` 之后、其他后处理之前。[[matergo-translate-plugin]]
