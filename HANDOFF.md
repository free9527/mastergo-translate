# 项目交接文档

**日期**: 2026-07-28  
**版本**: v8.7  
**项目**: Lexar 翻译插件（MasterGo 插件）

---

## 一、项目背景

这是一个 MasterGo 设计工具插件，用于将 Lexar 产品的设计稿从英文翻译成 20 个目标语言。核心目标：

- **不漏翻** — 所有承载含义的文本都必须翻译
- **不加戏** — 严格忠实源文，不编造规格
- **意思一致** — 语义准确，数字、容量、速度值原样保留
- **适配 20 个语种** — 每个语种都有特定的规则、常见错误、校对检查项

---

## 二、本次会话完成的任务

### 2.1 漏翻误判修复（v8.7）

**问题**：pt-BR 翻译中 "Drone" 和 "Tablet" 被错误标记为 `⚠️[UNTRANSLATED]`，尽管术语库已收录 "Drones"/"Tablets"（复数形式），且 "Drone"/"Tablet" 在葡萄牙语中与英文同形，是正确的翻译。

**真因分析**：
1. 术语库单复数不匹配 — 术语库 key 是复数（Drones），源文是单数（Drone），导致术语遮蔽失效
2. 漏翻检测维度1过于严格 — `normalize(src) === normalize(trans)` 即判为漏翻，无法区分"真漏翻"和"正确同形"
3. 兜底策略不友好 — 激进重试失败 + 术语库无法匹配 → 标记 `⚠️[UNTRANSLATED]`，用户看到错误标记

**修复方案**：

| 修复项 | 说明 |
|--------|------|
| 单复数术语库豁免 | `isUntranslatable` 增加词形还原（ies→y, sses→ss, xes→x 等），"Drone" 匹配术语库 "Drones" → 豁免 |
| 翻译兜底保留原文 | 激进重试失败 + 术语库无法匹配 → 保留原文，不标记 `⚠️[UNTRANSLATED]` |
| 校对 CHECK 3 同形词例外 | 校对 prompt 增加跨语言同形词例外说明（"Drone"→"Drone" 在 pt-BR 是正确的） |

**逻辑闭环**：

| 场景 | 翻译阶段 | 校对阶段 | 最终结果 |
|------|---------|---------|---------|
| 术语库已收录（Drones） | ✅ 豁免 | - | ✅ 正确 |
| 术语库已收录单数（Drone） | ✅ 单复数归一化豁免 | - | ✅ 正确 |
| 术语库未收录同形词（Drone→Drone） | ❌ 误判漏翻 → 保留原文 | ✅ 同形词例外，不修改 | ✅ 正确 |
| 术语库未收录非同形词（Hello→Hello） | ✅ 判漏翻 → 保留原文 | ✅ 修正为 "Olá" | ✅ 正确 |

**验证结果**：
- ✅ 单元测试 26 场景全部通过
- ✅ TypeScript 类型检查（plugin + UI）通过
- ✅ 构建通过

---

### 2.2 术语库系统优化（v8.5）

| 优化项 | 说明 |
|--------|------|
| glossaryHint 格式精简 | `[GLOSSARY]\nsource → target`，节省 60-80 tokens/次 |
| normalizedGlossaryMap 预计算 | 任务开始时构建一次，传递给所有 enforceGlossaryTerms 调用 |
| prompt 注入按翻译值去重 | "Up To Read"/"Read Speed Up To" 相同翻译值只注入一次 |
| normalizeForMatch 统一 | glossary-filter / entity-masker / post-process 三处归一化函数统一 |
| 校对 glossaryHint 策略 | 保留精简版 glossaryHint（防止 enforceGlossaryTerms 无法覆盖的边界情况） |

### 2.2 提示词注入逻辑优化（v8.6）

从"做好翻译"角度全面复盘提示词注入逻辑，对照六项翻译质量标准（准确忠实、本地化表达、行业表达、调性匹配、格式规范、合规适配），发现并修复 9 项问题：

| 问题 | 严重度 | 修复方案 |
|------|--------|----------|
| 风格指令矛盾（gaming 产品线说"参数精确"，marketing 风格说"淡化参数"） | 🔴 高 | getStyleCard：当 productTone 存在时抑制 styleGuide |
| SCENE_CONSTRAINTS langOverrides 全中文 | 🔴 高 | 全部改为英文（与 v8.4 commonErrors 英文化一致） |
| PRODUCT_LINE_TONE_GUIDES 只覆盖 8/20 语种 | 🔴 高 | 补全 12 语种（pt/pt-BR/it/nl/pl/sv/tr/ru/vi/th/id/ar） |
| 品类词在 [GLOSSARY] 和 [LANG_RULES] 重复注入 | 🟡 中 | filterRelevantGlossary 跳过品类词 |
| 校对 CHECK 4（商标符号）与代码后处理重叠 | 🟡 中 | 删除 CHECK 4，重新编号 CHECK 5→4, CHECK 6→5 |
| IDENTITY/MISSION 冗余 | 🟡 中 | 精简 MISSION，去掉重复的"精准、自然" |
| 校对 prompt 缺少目标语言使命宣言 | 🟡 中 | 校对 prompt 开头增加 [MISSION·{lang}] |
| 品类词对照表标题始终用中文 | 🟢 低 | buildCategoryTerminology 按 isCJKTarget 切换标题 |
| Few-shot 示例源语言硬编码 'en' | 🟢 低 | 改为使用实际检测到的源语言 |

### 2.3 修改的文件

- `lib/prompt-constants.ts` — getStyleCard 产品调性优先 + SCENE_CONSTRAINTS 英文化 + PRODUCT_LINE_TONE_GUIDES 补全 12 语种 + PROOFREAD_SYSTEM_PROMPT CHECK 重编号 + IDENTITY_MISSION 精简 + buildCategoryTerminology 标题切换
- `lib/llm-api.ts` — 校对 prompt 增加 MISSION + Few-shot 源语言改为 detectedSource
- `lib/glossary-filter.ts` — filterRelevantGlossary 品类词去重
- `lib/default-glossary.ts` — 重新编译术语库 CSV（140 产品名 + 189 专属术语）

### 2.4 验证结果

- ✅ `npm run typecheck` 通过（plugin + UI 两套项目）
- ✅ `npm run build` 通过
- ✅ v8.7 单元测试 26 场景全部通过（`tests/test-v87-plural-exemption.ts`）
- ⏳ 20 语种实测验证待运行

---

## 三、系统架构概览

### 3.1 翻译管道

```
源文
  ↓ 预处理（8步：HTML保护、实体遮蔽、术语遮蔽、TM压缩等）
  ↓ Prompt 组装（9模块：IDENTITY + CORE_PRINCIPLES + MISSION + STYLE + FEWSHOT + LANG_RULES + CONTEXT + GLOSSARY + OUTPUT）
  ↓ LLM 调用（temperature=0.2）
  ↓ 后处理（13步：实体还原、术语强制校准、商标还原、品牌注入检测等）
  ↓ 重试管道（最多7层：统一重试 → 激进重试 → 分句翻译 → 大小写归一化 → 术语组合 → 保留原文）
译文
```

**v8.7 变更**：最后一层从"标记失败"改为"保留原文"，避免用户看到 `⚠️[UNTRANSLATED]` 错误标记。

### 3.2 校对管道

```
源文 + 译文
  ↓ 预处理（5步：实体遮蔽、CJK空格保护等）
  ↓ Prompt 组装（4模块：MISSION + PROOFREAD_SYSTEM_PROMPT + glossaryHint + langBlock）
  ↓ LLM 调用（temperature=0.1）
  ↓ 后处理（7步：实体还原、术语强制校准、商标还原等）
校对结果
```

### 3.3 关键配置

| 参数 | 值 | 说明 |
|------|-----|------|
| TRANSLATE_BATCH_SIZE | 15 | 翻译批次大小 |
| PROOFREAD_BATCH_SIZE | 8 | 校对批次大小 |
| CONCURRENCY | 4 | 并发批次数 |
| API_TIMEOUT_MS | 90000 | API 超时（90秒） |
| API_MAX_RETRIES | 2 | API 重试次数 |
| MAX_AGGRESSIVE_RETRIES | 3 | 激进重试上限 |

---

## 四、踩过的坑（绝对不要再踩）

### 坑 1: tsconfig.ui.json 通配符陷阱

**问题**: `tsconfig.ui.json` 使用 `./typings/**/*.d.ts` 通配符，把 `plugin-runtime.d.ts`（声明了 `XMLHttpRequest`）也加载进 UI 项目，导致与 DOM lib 的 `XMLHttpRequest` 冲突。

**症状**: `npx tsc --noEmit -p tsconfig.ui.json` 报错 `Cannot redeclare block-scoped variable 'XMLHttpRequest'`

**修复**: 改为精确路径 `./typings/vue.d.ts`

**教训**: 
- TypeScript 的 `include` 通配符会递归加载所有匹配文件
- 插件端和 UI 端的类型声明必须隔离
- 构建验证时 `npm run build` 通过不代表 `tsc --noEmit` 通过，两者都要检查

### 坑 2: 指令语言错位

**问题**: `commonErrors` 和 `proofreadChecks` 字段用中文写，但非 CJK 语种的指令语言是英文。LLM 在处理法语翻译时收到的语法错误提示却是中文。

**修复**: 15 个非 CJK 语种的 `commonErrors` 和 `proofreadChecks` 改为英文

**教训**:
- 提示词的不同字段可能使用不同语言，需要确保一致性
- CJK 语种（zh-CN/zh-TW/ja/ko）使用中文指令，非 CJK 语种使用英文指令
- 新增提示词字段时，明确指定语言策略

### 坑 3: 风格指令冲突

**问题**: gaming 产品线自动映射到 marketing 风格。gaming 产品调性说"参数精确（DDR gen/frequency MHz/CL timings）"，marketing 风格说"淡化枯燥参数"。LLM 收到矛盾指令。

**修复**: getStyleCard 中当 productTone 存在时抑制 styleGuide。产品调性更具体，优先于通用风格指南。

**教训**:
- 具体指令应该覆盖通用指令
- 多个数据源注入同一个 prompt 时，需要检查是否有语义冲突

### 坑 4: 产品调性语种覆盖不全

**问题**: PRODUCT_LINE_TONE_GUIDES 只覆盖 8/20 语种，12 语种 fallback 到英文。翻译葡萄牙语时，LLM 收到的产品调性是英文，与整体葡萄牙语 prompt 不一致。

**修复**: 为 12 语种补充目标语言版本的产品调性（8 产品线 × 12 语种 = 96 条新增）

**教训**:
- 跨文字系统的 fallback 会干扰 LLM 的目标语言输出
- 所有注入 prompt 的模块都应该检查语种覆盖度

---

## 五、当前系统状态

### 5.1 提示词覆盖度

| 组件 | 覆盖度 | 说明 |
|------|--------|------|
| STYLE_GUIDES | 20/20 语种 | standard/professional/marketing × 20 语种 |
| commonErrors | 20/20 语种 | CJK 中文，非 CJK 英文 |
| proofreadChecks | 20/20 语种 | CJK 中文，非 CJK 英文 |
| PRODUCT_LINE_TONE_GUIDES | **20/20 语种** | ✅ v8.6 补全 12 语种 |
| SCENE_CONSTRAINTS | 20/20 语种 | ✅ v8.6 langOverrides 全部英文化 |
| LANGUAGE_MARKET_NOTES | 20/20 语种 | 各语种市场表达习惯 |

### 5.2 翻译质量标准覆盖

| 标准 | Prompt 层 | 代码层 | 校对层 |
|------|-----------|--------|--------|
| 一、准确忠实 | CORE_PRINCIPLES #2 | detectBrandInjection + detectTranslationExpansion + validateNumbers + **isUntranslatable 单复数豁免（v8.7）** | CHECK 1 COMPLETENESS + CHECK 2 MEANING + **CHECK 3 同形词例外（v8.7）** |
| 二、本地化表达 | IDENTITY_MISSION + LANGUAGE_MARKET_NOTES + LANG_SPECIFIC | postProcessTranslation（7语种修正） | LANG_SPECIFIC.quality |
| 三、行业表达 | CATEGORY_WORDS + CONTEXT hint + glossaryHint | enforceGlossaryTerms + maskGlossaryTerms + TECH_TERM_EXEMPT | CHECK 5 TERMINOLOGY CONSISTENCY |
| 四、调性匹配 | PRODUCT_LINE_TONE_GUIDES(20语种) + STYLE_GUIDES(20语种) + SCENE_CONSTRAINTS(20语种) | getEffectiveProductLine 自动检测 | — |
| 五、格式规范 | OUTPUT format 指令 | restoreTrademarkSymbols + restoreStorageUnitFormatting + capitalizeFirstLetter + sanitizeLineBreaks | CHECK 4 GRAMMAR/SPELLING/PUNCTUATION |
| 六、合规适配 | LANG_SPECIFIC.compliance + SCENE_CONSTRAINTS.compliance_doc | — | CHECK 1 COMPLETENESS（法律声明逐字对应） |

**v8.7 新增**：
- `isUntranslatable` 单复数术语库豁免 — 解决术语库只收录复数（Drones）但源文是单数（Drone）的漏翻误判
- 翻译兜底保留原文 — 激进重试失败 + 术语库无法匹配时，保留原文，不标记 `⚠️[UNTRANSLATED]`
- 校对 CHECK 3 同形词例外 — 校对 LLM 知道 "Drone"→"Drone" 在葡萄牙语中是正确的

### 5.3 待优化项

1. **指标收集器 UI 面板** — 当前只在 console.log 输出，未来可以在 UI 显示
2. **实测性能数据** — 运行 20 语种测试，收集每个语种的 API 调用次数、重试率、术语命中率
3. **校准扩展阈值** — `LANG_EXPANSION_RATIO` 是否基于实测数据？

---

## 六、关键文件

| 文件 | 职责 |
|------|------|
| `lib/prompt-constants.ts` | 提示词常量（STYLE_GUIDES、LANG_SPECIFIC、PRODUCT_LINE_TONE_GUIDES、SCENE_CONSTRAINTS、CORE_PRINCIPLES、PROOFREAD_SYSTEM_PROMPT） |
| `lib/llm-api.ts` | LLM 调用（translateBatch、proofreadBatch、buildSystemPrompt、getStyleCard、重试逻辑、**isUntranslatable 单复数豁免 v8.7**） |
| `lib/post-process.ts` | 译后处理（enforceGlossaryTerms、detectBrandInjection、restoreTrademarkSymbols 等） |
| `lib/entity-masker.ts` | 实体遮蔽（maskEntities、maskGlossaryTerms 等） |
| `lib/glossary-filter.ts` | 术语过滤（filterRelevantGlossary、normalizeForMatch） |
| `lib/few-shot-examples.ts` | Few-shot 翻译示例（20语种 × 3 内容类型） |
| `lib/metrics.ts` | 翻译指标收集器 |
| `lib/text-normalizer.ts` | 文本预处理（Unicode NFC、全角→半角、零宽字符、↵保护） |
| `lib/default-glossary.ts` | 默认术语库（140 产品名 + 189 专属术语） |
| `ui/App.vue` | UI 主组件（翻译流程编排、指标集成） |
| `tests/test-v87-plural-exemption.ts` | **v8.7 单复数豁免单元测试（26 场景）** |

---

## 七、构建与测试

### 7.1 构建命令

```bash
# TypeScript 类型检查（plugin + UI 两套）
npm run typecheck

# 或者分别检查
npm run typecheck:plugin
npm run typecheck:ui

# 构建项目
npm run build
```

### 7.2 测试命令

```bash
# 20 语种并行测试
npx tsx tests/test-all-languages.ts

# v8.7 单复数豁免单元测试
npx tsx tests/test-v87-plural-exemption.ts
```

### 7.3 注意事项

- 每次改代码后必须执行 `npm run typecheck` + `npm run build`
- `npm run build` 通过不代表 `tsc --noEmit` 通过，两者都要检查
- TypeScript 会有 deprecation 警告（tsconfig.json），可以忽略

---

## 八、项目记忆

所有优化记录已保存到项目记忆：

- `memory/bugfix-v8.7.md` — v8.7 漏翻误判修复（单复数豁免 + 保留原文 + 校对同形词例外）
- `memory/prompt-optimization-v8.6.md` — v8.6 提示词注入逻辑优化（9 项修复）
- `memory/v8.5-glossary-optimization.md` — v8.5 术语库系统优化（5 项优化）
- `memory/prompt-optimization-v8.4.md` — v8.4 系统优化（6 Phase + 踩坑记录）
- `memory/prompt-optimization-v8.3.md` — v8.3 提示词系统全面优化（6 Phase）
- `memory/glossary-optimization-v8.2.md` — v8.2 术语库系统优化
- `memory/MEMORY.md` — 项目记忆索引

---

## 九、后续建议

### 9.1 短期（可立即做）

1. **运行 20 语种实测验证** — 验证 v8.7 修复效果（重点关注 pt-BR "Drone"/"Tablet" 等拉丁语系同形词）
2. **对比翻译质量** — 特别关注 gaming 产品线、12 新补全语种、品类词翻译
3. **提交代码** — 当前改动未提交，建议 commit

### 9.2 中期（需要测试验证）

4. **指标收集器 UI 面板** — 在 UI 显示翻译指标
5. **校准扩展阈值** — 基于实测数据调整 `LANG_EXPANSION_RATIO`
6. **术语库 CSV 维护** — 用户手动修复数据质量问题（重复条目、拼写不一致）

### 9.3 长期（架构优化）

7. **术语库版本管理** — 支持 A/B 测试不同术语库
8. **术语注入分级策略** — 产品名不注入，品牌词遮蔽，技术术语注入
9. **性能优化** — 合并冗余的 `restoreTrademarkSymbols` 调用

---

## 十、联系方式

如有问题，请查看项目记忆或联系项目负责人。

**最后更新**: 2026-07-28

---

## 十一、Prompt 模板（v8.7 更新）

### 11.1 翻译 Prompt 模板

**组装顺序**（`buildSystemPrompt` 函数）：

```
[IDENTITY]
You translate Lexar storage product content. Your translations read as if originally written in the target language by a native speaker.

[CORE PRINCIPLES]

1. TRANSLATE ALL MEANING — Translate everything that carries meaning.
   Only keep these in original form: brand names (Lexar, AMD, Intel) and
   model codes (NM790, D40E, ARES). For industry terms, use the target-language
   standard terms specified in the language guidelines below — do NOT default
   to keeping English abbreviations.
   Rule of thumb: if the text has verbs, adjectives, or adverbs → it is descriptive → translate it.
   ⛔ NEVER "complete" partial product names — only translate what the source actually says.

2. FAITHFUL TO SOURCE — No additions, no omissions, no fabricated specs.
   Numbers, capacities, speed values preserved verbatim.
   Placeholders (__XXX_N__), HTML tags, and ↵ markers preserved exactly as-is.
   ↵ is a LITERAL character marker, NOT a line break — output it as the characters "↵".
   ⛔ Category precision: "Read speed" and "Write speed" are distinct — never interchange them.

3. NATURAL EXPRESSION — Sound like a native speaker wrote it, not a translation.
   Perfect grammar, spelling, punctuation. Technical specs in industry-standard terms.
   Marketing copy in local idiom. Short UI labels stay concise. Match [STYLE] below.

[MISSION·{targetLang}]
{目标语言使命宣言（精简版，不重复 IDENTITY 已声明的"精准、自然"）}

[STYLE]
{getStyleCard() 生成的风格卡片，包含：
  - [Product Tone·{产品线}] — 受众、使用场景、语气（v8.6: 20语种全覆盖）
  - [Stil·{风格}] — standard/professional/marketing（仅当无产品线时注入）
  - 【{场景} 场景约束】— 格式、术语（v8.6: langOverrides 全英文）
  - [DONT] — 禁止事项
  - [MARKET NOTE] — 市场语感偏好
}

[EXAMPLES]
{getFewShotExamples(detectedSource, targetLang) 生成的 2 组翻译示例（v8.6: 使用实际源语言）}

[{targetLang} Guidelines]
Category terms:（v8.6: 非CJK用英文标题，CJK用"品类词对照："）
  SSD → {目标语言翻译}
  Portable SSD → {目标语言翻译}
  ...
{语言专属规则 + commonErrors}

[CONTEXT]
Independent UI strings from the same design file. Translate each entry independently.
When the same source term appears across entries, use the same target term.
If a term is ambiguous without context (e.g., "Drive" = storage device vs. vehicle motion),
default to the storage-industry interpretation.

[GLOSSARY]
{术语对照表，格式：source → target}
{v8.6: 品类词已去重，不在 GLOSSARY 中重复出现}

[OUTPUT]
Format: "[N] translated text" — one line per item. Plain text only.
⛔ The ↵ symbol is a LITERAL CHARACTER, NOT a line break — output it as the characters "↵".
→ Output translations now:
```

**User Message 格式**：
```
[1] (en→{targetLang}) "source text 1"
[2] (en→{targetLang}) "source text 2"
...
```

---

### 11.2 校对 Prompt 模板

**组装顺序**（`proofreadBatch` 函数）：

```
[MISSION·{targetLang}]（v8.6 新增：激活目标语义空间）
{目标语言使命宣言}

[ROLE]
You are an expert Localization QA Reviewer for Lexar. Review translations against source texts.

[CORE DIRECTIVE]
Fix ALL objective errors. Do NOT make subjective changes.
- ✅ Fix: grammar errors, spelling mistakes, punctuation errors, wrong terms, wrong numbers, untranslated text, added content, inconsistent terminology.
- ⛔ Do NOT: rewrite a translation that is already correct just to sound different.
- Rule of thumb: if it's WRONG, fix it. If it's already RIGHT, leave it alone.

[CHECK 1: COMPLETENESS]
- No additions: Do NOT add information, specs, or marketing language not in the source.
- No omissions: Do NOT remove information present in the source.

[CHECK 2: MEANING & NATURALNESS]
- Factual errors: Fix wrong numbers, specs, or features.
- Category errors: Fix wrong category words (SSD≠Card, Reader≠SSD) per reference table.
- ⚠️ Glossary exact-match OVERRIDES category-word correction.
- Formatting: Do NOT change symbols/formatting (keep 2x2, do not change to 2×2).
- Naturalness: Flag translations that sound robotic, awkward, or overly literal.
  ✅ ACCEPTABLE: Rewording to sound native (changing structure, synonyms, local tone).
  ⛔ NOT acceptable: Rewriting an already-natural translation just to sound different.

[CHECK 3: UNTRANSLATED TEXT]
- If the translation is identical or nearly identical to the source (same language,
  only trivial whitespace/punctuation changes) → flag as 漏翻, provide correct translation.
- EXCEPTION (DO NOT FLAG): Standalone product names with NO verbs, adjectives, or
  prepositions (e.g., "Lexar NM790" → "Lexar NM790" is CORRECT, not untranslated).
- EXCEPTION (DO NOT FLAG): Cross-language homographs — words that are correctly spelled
  the same in both source and target language (e.g., "Drone" → "Drone" in Portuguese,
  "Tablet" → "Tablet" in German, "Hotel" → "Hotel" in French). These are CORRECT
  translations, not untranslated text.（v8.7 新增）
- Decision tree: (1) Has verbs/adjectives/prepositions? → MUST translate.
  (2) Is it ONLY a product code with zero descriptive words? → keeping English is correct.
  (3) Is it a common international word spelled the same in target language? → keeping it is correct.（v8.7 新增）

[CHECK 4: GRAMMAR, SPELLING & PUNCTUATION]（v8.6: 原 CHECK 5 重编号）
- Fix grammar errors: subject-verb agreement, wrong tense, wrong gender/number,
  wrong word order, missing or wrong function words.
- Fix spelling mistakes and typos in the target language.
- Fix punctuation errors: wrong punctuation marks for the target language,
  missing required punctuation, doubled punctuation.
- ⛔ Do NOT change intentional formatting (2x2 vs 2×2, line breaks, code fragments).

[CHECK 5: TERMINOLOGY CONSISTENCY]（v8.6: 原 CHECK 6 重编号）
- The same source term MUST use the same translation across all entries in this batch.
- If entry [1] translates "read speed" as X and entry [3] translates it as Y,
  flag the inconsistent one and unify to the correct term.

[GLOSSARY REFERENCE]
Match source terms case-insensitively. If the source contains the core term,
the target MUST use the exact translation below. Do NOT alter spelling, casing,
or internal spacing of target terms. Never "correct" by completing partial product names.

[OUTPUT FORMAT]
Output ONLY a valid JSON array. No other text.
- All correct → output: []
- Errors exist → output array of correction objects.

JSON Schema:
[{
  "i": <integer, 1-based index>,
  "text": "<string, fully corrected translation>",
  "reason": "<string, MUST be one of: 漏翻 | 多翻 | 语义错误 | 术语错误 | 语法错误 | 拼写错误 | 标点错误 | 一致性问题>",
  "ambiguous": [<array of strings, default: []>]
}]

⛔ CRITICAL:
1. RAW JSON ONLY — no ```json blocks, no explanations.
2. Use DOUBLE QUOTES for all keys and string values — never single quotes.
3. Only include items that NEED correction. Correct items → omit entirely.

→ Review the translations and output the JSON array now:

[GLOSSARY]
{术语对照表，格式：source → target}
⛔ Above glossary: exact match only. Do NOT "correct" translations by completing partial product names.

[VALIDATION: {targetLang}]
Category terms:（v8.6: 非CJK用英文标题）
  SSD → {目标语言翻译}
  ...
{语言专属规则 + quality + compliance + proofreadChecks}
```

**User Message 格式**：
```
[1] (en→{targetLang}) source text 1
Trans：translation 1

[2] (en→{targetLang}) source text 2
Trans：translation 2
...
```

---

### 11.3 v8.6 关键设计决策

| 决策 | 理由 |
|------|------|
| 产品调性优先于风格指南 | 产品调性更具体（针对特定产品线），风格指南更通用 |
| SCENE_CONSTRAINTS 全英文 | 非 CJK 语种指令语言是英文，避免跨文字系统干扰 |
| 品类词只在 [LANG_RULES] 注入 | 避免 [GLOSSARY] 和 [LANG_RULES] 重复，减少 token 浪费 |
| 校对去掉 CHECK 4（商标符号） | 代码 restoreTrademarkSymbols + detectBrandInjection 已完全覆盖 |
| 校对保留 CHECK 5（术语一致性） | 代码 enforceGlossaryTerms 是局部替换，无法发现跨条目不一致 |
| 校对增加 [MISSION·{lang}] | 激活目标语义空间，让校对 LLM 用目标语言语感审视 |
| Few-shot 使用实际源语言 | 避免 zh→de 翻译收到 en→de 示例的不匹配问题 |

---

### 11.4 v8.7 关键设计决策

| 决策 | 理由 |
|------|------|
| 单复数术语库豁免（isUntranslatable） | 术语库可能只收录复数（Drones），源文出现单数（Drone）且该目标语言同形（pt/pt-BR）时也应豁免 |
| 翻译兜底保留原文，不标记 ⚠️[UNTRANSLATED] | 激进重试失败 + 术语库无法匹配时，保留原文比标记错误更友好，由校对 LLM 最终判断 |
| 校对 CHECK 3 增加同形词例外 | 校对 LLM 需要知道 "Drone"→"Drone" 在葡萄牙语中是正确的，不是漏翻 |

**核心原则**：
- ✅ 用户不会看到 `⚠️[UNTRANSLATED]` 错误标记
- ✅ 真漏翻会被校对 LLM 修正
- ✅ 正确同形词不会被误判
- ✅ 逻辑闭环：翻译阶段豁免 + 校对阶段把关

---

**最后更新**: 2026-07-28
