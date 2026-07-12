---
name: matergo-translate-plugin
description: MasterGo translation plugin for Lexar e-commerce designs — AI-powered multilingual translation with glossary management, font replacement, and QA proofreading
metadata:
  type: project
---

# MasterGo Lexar 翻译插件 v7.5.8

## 项目概述
MasterGo 设计工具的翻译插件，面向 Lexar 跨境电商设计团队。利用 LLM API（qwen3.7-max）将设计稿中的英文/中文文本批量翻译为 20 种目标语言，支持术语库管理、字体替换、AI 校对等完整翻译工作流。

## 技术栈
- **平台**: MasterGo 插件（`mg.*` API）
- **前端**: Vue 3 + TypeScript（Composition API + `<script setup>`）
- **构建**: Vite 2.9，双目标构建（TARGET=ui → dist/index.html，TARGET=main → dist/main.js）
- **打包**: vite-plugin-singlefile（UI 内联为单文件）
- **API**: qwen3.7-max @ aigo.lexar.com/v1/chat/completions，XHR（非 fetch），指数退避重试
- **UI 风格**: Apple 简约风（SF Pro 字体，#007AFF 蓝，10px 圆角，CSS 变量系统）

## 文件结构（核心源文件）

```
lib/
├── main.ts               # 插件主线程入口：扫描→翻译→应用→撤销，含 Avenir ® 字体修复
├── llm-api.ts             # LLM API 调用：翻译批次、重试/兜底、detectUntranslatedText、isUntranslatable
├── text-collector.ts      # 文本节点递归采集 + 去重合并
├── text-normalizer.ts     # 源文本预标准化：NFC→全角半角→零宽移除→NFKC
├── entity-masker.ts       # 实体遮蔽：产品型号/URL/Email/测量值→占位符→还原
├── font-mapper.ts         # 自动字体映射：目标语言驱动，4品牌字体统一替换
├── translation-memory.ts  # 翻译记忆（TM）：同型号不同容量模板匹配 compressBatch/expandBatch
├── default-glossary.ts    # 内置术语库（232 条，20 语种）
├── glossary-filter.ts     # 智能术语过滤：仅提取当前文本中出现的术语
├── parse-csv.ts           # CSV 解析/编码
├── csv-handler.ts         # CSV 导入导出
├── format-text.ts         # 中日韩文字间距处理（formatCJKSpace）
├── post-process.ts        # 译文后处理：语言格式化+品牌注入检测+术语校准+商标还原+$N清理
├── unit-convert.ts        # 存储单位转换
├── constants.ts           # 全局常量（DEBUG_MODE、批次大小、normalizeText）
├── prompt-constants.ts    # 全部 prompt 常量：IRON_RULES、BRAND_ASSET_RULES、LangBlock、风格指南
ui/
├── ui.ts                  # Vue 入口
└── App.vue                # 单文件组件：完整 UI 逻辑 + 样式 + 译前短路 + 跨批次一致性
messages/
├── types.ts               # 共享类型：TextItem, LLMConfig, GlossaryEntry, 消息枚举, 20 种语言
├── sender.ts              # 通用消息发送
├── main-sender.ts         # 主线程 → UI 消息发送
└── ui-sender.ts           # UI → 主线程消息发送
scripts/
├── merge-glossary.py      # 术语库合并工具
└── convert-glossary-tags.js # 术语库标签转换
tests/
├── test-all-languages.ts  # 20语言并行翻译测试
└── test-pipeline-trace.ts # 管道端到端追踪测试（v7.5.8 漏翻/®丢失复现用）
```

## 翻译管道（v7.5.8 最终版）

### 完整管道
```
预处理: protectHtmlTags → normalizeTextForLLM → maskEntities → compressBatch → 构建prompt
后处理: unmaskEntities → restoreHtmlTags → postProcessTranslation → detectBrandInjection
        → enforceGlossaryTerms → restoreTrademarkSymbols → validateNumbers
        → restoreStorageUnitFormatting → capitalizeFirstLetter → detectTranslationExpansion
        → expandBatch
```

### 译前短路路径（ui/App.vue）⚠️ 不经过翻译管道
- 数字/单字符、术语库不翻词（src==tgt）、术语库精确匹配、存储单位转换
- **v7.5.8**: 术语库精确匹配路径补上了 `restoreTrademarkSymbols` 调用

### 重试/兜底（v7.1 优化，v7.3/v7.5.8 修复）
- 截断+漏翻合并为 1 次统一重试（forceTranslate=true 注入 system prompt）
- 三层兜底：激进逐条翻译 → 术语库组合 → ⚠️[UNTRANSLATED] 标记
- **v7.5.8**: detectBrandInjection 词边界宽松匹配，解决 SSDs vs SSD 误判

### 校对后处理
```
proofreadDone → detectTranslationExpansion → enforceGlossaryTerms
→ postProcessTranslation → formatCJKSpace → restoreStorageUnitFormatting
→ restoreTrademarkSymbols → sanitizeLineBreaks → detectTruncatedTexts
→ enforceSameSourceConsistency → autoMapFonts
```

## 关键风险点（v7.5.8 新增）

| 风险 | 文件 | 说明 |
|------|------|------|
| detectBrandInjection 误判 | post-process.ts | `\b` 词边界对英文词尾变化不友好（SSDs vs SSD），导致正确译文被回退为英文 |
| 术语库匹配短路 | App.vue | 绕过翻译管道，必须补上 restoreTrademarkSymbols 等后处理 |
| detectTranslationExpansion 回退 | post-process.ts | 与 detectBrandInjection 是唯二会用"源文覆盖译文"的步骤 |

## 消息通信架构
- **UI → 主线程**: `UIMessage` 枚举（SCAN_ALL, APPLY_TRANSLATIONS, SAVE_GLOSSARY 等 15 个消息）
- **主线程 → UI**: `PluginMessage` 枚举（SCAN_RESULT, APPLY_DONE, GLOSSARY_LOADED 等 17 个消息）
- 通过 `mg.showUI()` 渲染 UI，`window.postMessage` 双向通信

## 20 种支持语言
zh-CN, zh-TW, en, ja, ko, fr, de, es, pt, pt-BR, ru, it, vi, th, id, ar, nl, pl, sv, tr

## 存储 Key（跨客户端同步）
- `translate_glossary` — 术语库
- `translate_settings` — LLM 配置
- `translate_originals` — 原始文本（撤销用）
- `translate_cache` — 翻译缓存
- `translate_corrections` — 用户修正记录

## 版本历史

| 版本 | 日期 | 关键变更 |
|------|------|---------|
| v7.1 | 07-10 | 速度优化：合并重试、品牌名修复、批次调整 |
| v7.2 | 07-10 | 提示词审计：compliance填充、校对闭环、场景英文化 |
| v7.3 | 07-12 | debugWarn修复、$N清理、20语言全量测试通过 |
| v7.4 | 07-12 | 三层兜底、产品型号豁免 |
| v7.5.8 | 07-12 | **®术语库匹配路径丢失修复 + detectBrandInjection词边界误判修复** |

**Why:** Lexar 跨境电商设计团队核心生产力工具。v7.5.8 修复了两个历时数日的系统性管道缺陷，详见 [[bugfix-v7.5.8]]。

[[ui-apple-style]] [[mastergo-developer-docs]]
