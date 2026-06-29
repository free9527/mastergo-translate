---
name: avenir-register-fix
description: Avenir字体®符号渲染异常的修复方案
metadata:
  type: project
---

# Avenir ® 符号修复

**文件**: `lib/main.ts` — `fixAvenirRegisterSymbol()`

Avenir 字体的 ® 过大且非上标。方案：译文应用后，逐字符查找 ®，单独用 `HarmonyOS Sans SC` 覆盖渲染，字重继承。预加载阶段载入常用字重确保可用。

**Why:** Avenir 设计缺陷，® 视觉不符合 Lexar 品牌规范。单字符替换比全局换字体精准。
**How to apply:** `fixAvenirRegisterSymbol` 在 `applyTextStyle` 后立即调用。[[matergo-translate-plugin]]
