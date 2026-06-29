---
name: matergo-translate-plugin
description: MasterGo translation plugin for Lexar e-commerce designs — AI-powered multilingual translation with glossary management, font replacement, and QA proofreading
metadata:
  type: project
---

# MasterGo Lexar 翻译插件

## 项目概述
MasterGo 设计工具的翻译插件，面向 Lexar 跨境电商设计团队。利用 LLM API 将设计稿中的中文文本批量翻译为 20 种目标语言，支持术语库管理、字体替换、AI 校对等完整翻译工作流。

## 技术栈
- **平台**: MasterGo 插件（`mg.*` API）
- **前端**: Vue 3 + TypeScript（Composition API + `<script setup>`）
- **构建**: Vite 2.9，双目标构建（`main.js` + `index.html`）
- **API 调用**: XHR（非 fetch），指数退避重试
- **UI 风格**: Apple 简约风（SF Pro 字体，#007AFF 蓝，10px 圆角，CSS 变量系统）

## 文件结构（核心源文件）

```
lib/
├── main.ts               # 插件主线程入口：扫描→翻译→应用→撤销，含 Avenir ® 字体修复
├── llm-api.ts             # LLM API 调用：翻译批次、校对、源语言检测、内容类型分流、20语种提示词
├── text-collector.ts      # 文本节点递归采集 + 去重合并
├── text-normalizer.ts     # 源文本预标准化：NFC→全角半角→零宽移除→NFKC
├── entity-masker.ts       # 实体遮蔽：产品型号/URL/Email/测量值→占位符→还原
├── font-mapper.ts         # 自动字体映射：目标语言驱动，4品牌字体统一替换
├── translation-memory.ts  # 翻译记忆：同型号不同容量模板匹配，减少API调用
├── default-glossary.ts    # 内置术语库（232 条，20 语种）
├── glossary-filter.ts     # 智能术语过滤：仅提取当前文本中出现的术语
├── few-shot-examples.ts   # Few-shot 翻译示例库（按语言对+内容类型索引）
├── parse-csv.ts           # CSV 解析/编码
├── csv-handler.ts         # CSV 导入导出
├── format-text.ts         # 中日韩文字间距处理
├── post-process.ts        # 译文后处理：语种格式化+术语校准+商标还原+单位还原+短标签守卫
├── unit-convert.ts        # 存储单位转换
├── constants.ts           # 全局常量
ui/
├── ui.ts                  # Vue 入口
└── App.vue                # 单文件组件（~1900 行）：完整 UI 逻辑 + 样式
messages/
├── types.ts               # 共享类型：TextItem, LLMConfig, GlossaryEntry, 消息枚举, 20 种语言
├── sender.ts              # 通用消息发送
├── main-sender.ts         # 主线程 → UI 消息发送
└── ui-sender.ts           # UI → 主线程消息发送
术语/
└── Lexar术语库.csv        # 原始术语库（234 行，含 category/中文品类 等元数据列）
```

## 消息通信架构
- **UI → 主线程**: `UIMessage` 枚举（SCAN_ALL, APPLY_TRANSLATIONS, SAVE_GLOSSARY 等 15 个消息）
- **主线程 → UI**: `PluginMessage` 枚举（SCAN_RESULT, APPLY_DONE, GLOSSARY_LOADED 等 17 个消息）
- 通过 `mg.showUI()` 渲染 UI，`window.postMessage` 双向通信

## 核心功能流程

### 1. 扫描
- **全页扫描**: `collectTextNodes(page)` 递归遍历所有节点 → `mergeDuplicates` 去重合并
- **选中扫描**: 遍历 `selection` 中每个节点的子树 → 去重合并
- 合并逻辑：相同文本且字体相同的节点合并为一个 `TextItem`（含多个 `nodeIds`）

### 2. 翻译
- 自动跳过纯数字和单字符文本
- **翻译记忆**：同型号不同容量（NM790 1TB/2TB/4TB）模板匹配，减少 30-50% API 调用
- 按 `TRANSLATE_BATCH_SIZE=10` 分批，3 路并发调用 LLM API
- 缓存命中：`sourceText + '\x00' + targetLang` 为 key，跨会话持久化
- 源语言自动检测（CJK 字符占比），也支持手动指定
- 内容类型检测：title/specification/marketing/description，分流不同 prompt 和 temperature
- **产品线 × 风格二维策略**：8 产品线 × 3 风格 = 24 块精准翻译指南
- 智能术语过滤：产品线 → 场景 → 相关性三层过滤
- **短标签硬守卫**：源文 < 15 字符且译文 > 1.5x 时自动压缩
- **20 语种专属提示词** + 弱语言尾加固（TAIL 模式）

### 3. AI 校对
- 翻译完成后可选执行，使用独立模型配置
- 按 `PROOFREAD_BATCH_SIZE=10` 分批，校对结果以橙色高亮标记
- 校对修正可一键恢复

### 4. 应用译文
- 遍历 `nodeIds` 逐节点写入 `node.characters`
- 处理缺字体场景（HarmonyOS Sans SC 兜底）
- 支持字体替换（family/style/size/lineHeight/letterSpacing/textAlign）
- **自动字体映射**：根据目标语言自动替换 4 种品牌字体（SC/TC/Avenir/Naskh Arabic），字重继承
- **Avenir ® 修复**：Avenir 字体下 ® 单独用 HarmonyOS Sans SC 渲染
- 进度条实时反馈

### 5. 撤销
- 保存原始文本到 `originalTexts` Map，撤销时恢复

### 6. 术语库
- 上传 CSV → 合并（已有条目更新，新条目追加）
- 下载模板 = `DEFAULT_GLOSSARY_CSV`
- 兼容新旧 CSV 格式（自动跳过 category/category_name/中文品类 等非语言列）
- 术语库变更后自动清除翻译缓存

### 7. CSV 导入导出
- 导出翻译结果为 CSV
- 导入 CSV 更新译文（变更条目紫色高亮）

## 20 种支持语言
zh-CN, zh-TW, en, ja, ko, fr, de, es, pt, pt-BR, ru, it, vi, th, id, ar, nl, pl, sv, tr

## 存储 Key（跨客户端同步）
- `translate_glossary` — 术语库
- `translate_settings` — LLM 配置
- `translate_originals` — 原始文本（撤销用）
- `translate_cache` — 翻译缓存
- `translate_corrections` — 用户修正记录

**Why:** 这是 Lexar 跨境电商设计团队的核心生产力工具，需要完整记录其架构以便后续维护和迭代。[[ui-apple-style]]