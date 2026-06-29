---
name: translation-memory
description: 模板匹配翻译记忆，同型号不同容量只翻译一次
metadata:
  type: project
---

# 翻译记忆 — 模板匹配

**文件**: `lib/translation-memory.ts`

同型号不同容量的文本压缩为模板，只翻译一次代表文本，其余回填数值。

- 匹配模式：速度（7400MB/s）、容量（1TB、512GB）
- 仅合并 ≥2 个成员的模板组
- 不跨批次合并
- 已集成到 `App.vue` 翻译和重试两个流程

**Why:** 典型产品详情页可减少 30-50% LLM 调用，天然保证同型号不同容量译文一致。
**How to apply:** API 调用前 `compressBatch`，结果后 `expandBatch`。[[matergo-translate-plugin]]
