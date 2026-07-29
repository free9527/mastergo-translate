# 项目交接文档

**日期**: 2026-07-29  
**版本**: v9.3  
**项目**: Lexar 翻译插件（MasterGo 插件）

---

## 一、项目背景

MasterGo 设计工具插件，将 Lexar 产品设计稿从英文翻译成 20 个目标语言。核心目标：

- **不漏翻** — 所有承载含义的文本都必须翻译
- **不加戏** — 严格忠实源文，不编造规格
- **意思一致** — 语义准确，数字、容量、速度值原样保留
- **适配 20 个语种** — 每个语种都有特定的规则、常见错误、校对检查项

---

## 二、当前版本（v9.3）

### 2.1 v9.3 同语系豁免死代码修复（2026-07-29）

**问题**：pt→pt-BR 翻译中，欧葡/巴葡写法完全相同的正确译文（`Resistente a baixas temperaturas` 等）被误判漏翻，触发无效重试 + 黄色"漏翻·保留原文"徽章阻塞批量应用。

**根因**：`detectUntranslatedText` 的同语系豁免 `['pt','pt-BR']` 依赖逐条 `detectSingleTextLanguage`，但后者是**字符集级检测，拉丁文本一律返回 `'en'`**——该豁免从 v8.5 写入起从未生效（死代码）。连带 de→de/pt→pt 同语言校对场景的"源==目标跳过"防线对拉丁语也全部失效。

**修复**（全部在 lib/llm-api.ts）：

| 机制 | 说明 |
|------|------|
| `detectSourceLanguage` 拉丁细分 | 新增独占区分词表（不用现有功能词表——es/pt 共享 17+ 词会混淆）+ 特征字符强信号（pt:ãõ / es:ñ¿¡ / de:ß，≥2 次直接判定）；保守裁决：最高票 ≥3 且 ≥2 倍第二名，否则回退 `'en'` |
| `detectUntranslatedText` 加 `batchSrcLang` | 同语系豁免用**并集**（批次级∪逐条级，豁免只增不减）；**纯度条件**（批次有英文信号 → 批次豁免静默失效）；同语系对跳过维度1+维度2（pt/pt-BR 特征/功能词表完全相同，维度2 天生无区分度） |
| 二元守卫 | 同语系对译文含 ≥2 个 en 区分词且无目标语言特征 → 仍判漏翻（防 LLM 摆烂返回纯英文） |
| 激进重试 | isSameScript 并集判定；英文 prompt 变体提示补"两变体写法相同的句子原样保留是正确行为"；同语系对豁免"与源文相同=失败" |

**核心原则**：批次级判定永远只做加法（多豁免），永不做减法（少检测）；拿不准回退现状行为。

**测试**：`tests/test-same-script-untranslated.ts` 12 用例 21 断言全过（pt 实锤/二元守卫/en→pt-BR 反回归/es↔pt 区分/en→ar 零变化/zh 不回归/混合批次回退/de→de 校对/纯度条件）。

**附带修复**：UI 页脚署名 `by Lexar Design Team` 恢复（v9.0 重构时误删）。

### 2.2 v9.2 术语遮蔽顺序修复（2026-07-29）

**问题**：`"Lexar Recovery Tool"` 日译为 `"Lexar リカバリーツール"`——术语库收录但未按术语库输出。

**根因**：遮蔽顺序错误。`maskEntities` 先执行，其实体正则将术语误判为产品名/型号，抢先替换为 `__PRD_N__`；术语遮蔽拿到的文本已无此字符串 → 术语库失效。

**修复**：`lib/llm-api.ts` 两行调换——`maskGlossaryTerms`（术语优先）→ `maskEntities`（不触碰已遮蔽区域）。

**配套清理**：删除 ja/ko "品牌首提注音"规则 4 处（批次架构下"首次出现"不可判定，属噪声指令，且与术语遮蔽冲突）。

**测试**：`tests/test-glossary-mask-all-langs.ts` 80/80 通过（4 场景 × 20 语种）。

---

## 三、仍然有效的机制（勿破坏）

### 3.1 v9.1 UX 操作逻辑（16 项修复，已实机验证）

- **撤销语义**：`appliedTexts` 快照（APPLY 时逐节点记录译文，持久化）；undoAll 三方对比——画布文本仍等于译文的才恢复，**用户手改的跳过**；扫描保存原文快照时已有不覆盖
- **扫描完整重置** `resetWorkState()`：清 items + 错误 + 待确认 + 已应用 + CSV 高亮 + 徽章缓存
- 待确认警告条移入 sticky 区，出现即自动展开
- 批量进行中防竞争：translating/proofreading/applying 期间禁用输入/单条操作
- 画布选区实时感知（`selectionchange`）；无选区时"选中对象扫描"禁用
- toast 队列（同时 1 条，重复合并 ×N）
- 扫描进度"扫描中(N)..." + 1500 节点上限（`MAX_SCAN_NODES`）
- 窗口 480×840（`UI_WIDTH`/`UI_HEIGHT`）

### 3.2 v9.0 UI 重构（已实机验证）

- 操作集中顶部 sticky：扫描方式/语言/统计+翻译（或统一进度条+取消）/应用翻译+替换字体+恢复原文
- 统一进度条（`busyPhase` computed，优先级 apply>proofread>translate）
- 配置/高级默认折叠 + 摘要行显示当前值
- 结果卡片操作行 [定位][重翻][应用] 全部 icon+文字（消灭 icon-only）
- 样式全部在 `ui/styles.css`（Apple 设计令牌：11/12/13/14/15/17px 字号阶梯，语义颜色层，btn-primary/tinted/gray/plain 体系，深色覆盖）

### 3.3 v8.9 待确认机制（业务契约）

**3 类阻塞**（强制用户处理后才能批量应用）：

| 类别 | 检测条件 |
|------|---------|
| 翻译失败 | `translateErrors.has(nodeId)` |
| 占位符残留 | `__[A-Z]+_\d+__` 正则 |
| 漏翻-保留原文 | `sourceText === translatedText` 且非同语系且非术语库豁免 |

**交互**：红底=错误/占位符，黄底=漏翻，绿底=校对（不阻塞）；顶部警告条 + 一键操作；批量应用按钮待处理数>0 时禁用，文案 `应用翻译 (N条待处理)`。

### 3.4 v8.7 漏翻兜底策略

- `isUntranslatable` 单复数术语库豁免（词形还原：ies→y, sses→ss 等；"Drone" 匹配术语库 "Drones"）
- 激进重试失败 + 术语库无法匹配 → **保留原文，不标记 `⚠️[UNTRANSLATED]`**，由校对 LLM 最终判断
- 校对 CHECK 3 同形词例外（"Drone"→"Drone" 在 pt-BR 是正确的）

### 3.5 提示词系统（v8.6 定稿，20 语种全覆盖）

- `getStyleCard`：productTone 存在时抑制 styleGuide（产品调性优先于通用风格）
- 全组件 20/20 语种覆盖：STYLE_GUIDES / commonErrors / proofreadChecks / PRODUCT_LINE_TONE_GUIDES / SCENE_CONSTRAINTS / LANGUAGE_MARKET_NOTES
- CJK 语种中文指令，非 CJK 英文指令；校对 prompt 开头 [MISSION·{lang}]

---

## 四、系统架构

### 4.1 翻译管道

```
源文
  ↓ 预处理（HTML保护 → 源文本标准化 → 术语预替换 → maskGlossaryTerms → maskEntities → CJK空格保护 → ™剥离）
  ↓ Prompt 组装（9模块：IDENTITY + CORE_PRINCIPLES + MISSION + STYLE + FEWSHOT + LANG_RULES + CONTEXT + GLOSSARY + OUTPUT）
  ↓ LLM 调用（temperature=0.2）
  ↓ 后处理（stripEchoQuotes → 实体/术语还原 → postProcessTranslation → detectBrandInjection → detectTranslationExpansion → enforceGlossaryTerms → restoreTrademarkSymbols → detectUntranslatedText）
  ↓ 重试管道（统一重试 → 激进重试×3 → 分句翻译 → 大小写归一化 → 术语组合 → 保留原文 v8.7）
译文
```

**v9.2 遮蔽顺序**：`maskGlossaryTerms`（术语优先）→ `maskEntities`（实体不触碰已遮蔽区域）。

### 4.2 校对管道

```
源文 + 译文
  ↓ 预处理（maskEntitiesForProofread → CJK空格保护 → ™保护）
  ↓ Prompt 组装（MISSION + PROOFREAD_SYSTEM_PROMPT + glossaryHint + langBlock）
  ↓ LLM 调用（temperature=0.1）
  ↓ 后处理（实体还原 → 术语强制校准 → 商标还原 → 校对后漏翻检测 v9.3 接 batchSrcLang）
校对结果
```

### 4.3 漏翻检测三道防线（v9.3 现状）

| 防线 | 机制 | 状态 |
|------|------|------|
| 源==目标跳过 | `srcLang === targetLang` 或 `batchExemptLang === targetLang` | v9.3 批次级补拉丁语 |
| 同语系豁免 | 并集：批次级∪逐条级；纯度条件防混杂批次 | v9.3 修复死代码 |
| 维度1全等 | `normalize(src) === normalize(trans)` | 同语系对跳过 |
| 维度2特征 | 特征字符/功能词/英文占比 | 同语系对跳过（v9.3），其余保留 |
| 二元守卫 | 同语系对译文疑为纯英文 → 仍判漏翻 | v9.3 新增 |

### 4.4 关键配置

| 参数 | 值 |
|------|-----|
| TRANSLATE_BATCH_SIZE | 15 |
| PROOFREAD_BATCH_SIZE | 8 |
| CONCURRENCY | 4 |
| API_TIMEOUT_MS | 90000 |
| API_MAX_RETRIES | 2 |
| MAX_AGGRESSIVE_RETRIES | 3 |
| MAX_SCAN_NODES | 1500 |
| UI_WIDTH / UI_HEIGHT | 480 / 840 |

---

## 五、踩过的坑（绝对不要再踩）

### 坑 1: tsconfig.ui.json 通配符陷阱

`./typings/**/*.d.ts` 把 `plugin-runtime.d.ts`（声明 `XMLHttpRequest`）加载进 UI 项目，与 DOM lib 冲突。修复：改精确路径 `./typings/vue.d.ts`。**`npm run build` 通过不代表 `tsc --noEmit` 通过，两者都要检查。**

### 坑 2: 字符集级语言检测不能用于拉丁语细分（v9.3 新坑）

`detectSingleTextLanguage` 按 Unicode 范围判断，拉丁文本一律返回 `'en'`。任何依赖它做拉丁语对判断的逻辑（同语系豁免、源==目标跳过）都是死代码。**拉丁语判定必须用批次级 `detectSourceLanguage`（区分词投票+特征字符），且只做加法豁免。**

### 坑 3: es/pt 功能词表混淆

`LANG_FUNCTION_WORDS` 的 es/pt 表共享 17+ 词（que/para/por/de/a/se…），直接投票会把 es 误判成 pt。**拉丁语细分必须用独占区分词表 `LATIN_DISTINCTIVE_WORDS`。**

### 坑 4: 术语遮蔽顺序（v9.2）

`maskEntities` 先于 `maskGlossaryTerms` 会把术语误判为产品名/型号实体抢先遮蔽 → 术语库失效。**术语遮蔽永远先于实体遮蔽。**

### 坑 5: 风格指令冲突

gaming 产品线"参数精确" vs marketing 风格"淡化参数"。**具体指令覆盖通用指令**（productTone 抑制 styleGuide）。

### 坑 6: 指令语言错位

非 CJK 语种的指令语言是英文，prompt 字段用中文会干扰输出。新增提示词字段时明确语言策略。

---

## 六、关键文件

| 文件 | 职责 |
|------|------|
| `lib/prompt-constants.ts` | 提示词常量（STYLE_GUIDES、LANG_SPECIFIC、PRODUCT_LINE_TONE_GUIDES、SCENE_CONSTRAINTS、CORE_PRINCIPLES、PROOFREAD_SYSTEM_PROMPT） |
| `lib/llm-api.ts` | LLM 调用 + 翻译/校对管道 + 重试逻辑 + **detectSourceLanguage 拉丁细分（v9.3）** + **detectUntranslatedText batchSrcLang（v9.3）** + isUntranslatable 单复数豁免（v8.7） |
| `lib/post-process.ts` | 译后处理（enforceGlossaryTerms、detectBrandInjection、restoreTrademarkSymbols、detectTranslationExpansion） |
| `lib/entity-masker.ts` | 实体/术语遮蔽（maskGlossaryTerms → maskEntities 顺序 v9.2） |
| `lib/glossary-filter.ts` | 术语过滤（filterRelevantGlossary、normalizeForMatch） |
| `lib/few-shot-examples.ts` | Few-shot 翻译示例（20语种 × 3 内容类型） |
| `lib/metrics.ts` | 翻译指标收集器 |
| `lib/text-normalizer.ts` | 文本预处理（Unicode NFC、全角→半角、零宽字符、↵保护） |
| `lib/default-glossary.ts` | 默认术语库（140 产品名 + 189 专属术语） |
| `lib/main.ts` | 插件主线程（扫描/appliedTexts 快照/undoAll 三方对比/selectionchange） |
| `ui/App.vue` | UI 主组件（流程编排、sticky 操作区、待确认机制、busyPhase） |
| `ui/styles.css` | 全部样式（Apple 设计令牌、深色覆盖、.footer v9.3 恢复） |
| `ui/ui.ts` | UI 挂载入口 |
| `tests/test-same-script-untranslated.ts` | **v9.3 同语系豁免测试矩阵（12 用例）** |
| `tests/test-glossary-mask-all-langs.ts` | v9.2 术语遮蔽 20 语种回归（80 断言） |
| `tests/test-v87-plural-exemption.ts` | v8.7 单复数豁免单元测试（26 场景） |

---

## 七、构建与测试

```bash
npm run typecheck    # tsc 双项目（plugin + UI），必须过
npm run build        # 生产构建，必须过

# 测试
npx tsx tests/test-same-script-untranslated.ts   # v9.3 同语系豁免 12 用例
npx tsx tests/test-glossary-mask-all-langs.ts    # v9.2 术语遮蔽 80 断言
npx tsx tests/test-v87-plural-exemption.ts       # v8.7 单复数豁免 26 场景
```

**铁律**：每次改代码后必须执行 `npm run typecheck` + `npm run build`。build 过 ≠ tsc 过。

---

## 八、后续建议

**短期**：
1. 实机验证 v9.3：pt→pt-BR 4 条实锤不再误报漏翻；en→xx 常规回归
2. 提交代码（v9.2+v9.3 改动未提交）

**中期**：
3. 指标收集器 UI 面板（当前只 console.log）
4. 校准 `LANG_EXPANSION_RATIO` 扩展阈值（基于实测数据）

**长期**：
5. 术语库版本管理（A/B 测试）
6. 术语注入分级策略（产品名不注入/品牌词遮蔽/技术术语注入）

---

## 九、Prompt 模板

### 9.1 翻译 Prompt（buildSystemPrompt 组装顺序）

```
[IDENTITY] You translate Lexar storage product content...
[CORE PRINCIPLES] 1.TRANSLATE ALL MEANING 2.FAITHFUL TO SOURCE 3.NATURAL EXPRESSION
[MISSION·{targetLang}] 目标语言使命宣言
[STYLE] {getStyleCard()：Product Tone（产品线优先）/ Stil（无产品线时）/ 场景约束 / DONT / MARKET NOTE}
[EXAMPLES] {getFewShotExamples(detectedSource, targetLang)}
[{targetLang} Guidelines] 品类词对照 + 语言专属规则 + commonErrors
[CONTEXT] Independent UI strings... 术语一致性 + 存储行业解释
[GLOSSARY] source → target（品类词已去重）
[OUTPUT] Format: "[N] translated text"，↵ 是字面字符
```

User Message：`[N] ({srcLang}→{targetLang}) "source text"`

### 9.2 校对 Prompt（proofreadBatch 组装顺序）

```
[MISSION·{targetLang}]
[ROLE] Localization QA Reviewer
[CORE DIRECTIVE] Fix ALL objective errors. Do NOT make subjective changes.
[CHECK 1: COMPLETENESS] 不加不漏
[CHECK 2: MEANING & NATURALNESS] 事实/品类/自然度；术语库精确匹配覆盖品类词纠正
[CHECK 3: UNTRANSLATED TEXT] 相同→漏翻；例外：无动词产品名 + 跨语言同形词（v8.7）
[CHECK 4: GRAMMAR/SPELLING/PUNCTUATION]
[CHECK 5: TERMINOLOGY CONSISTENCY] 跨条目术语一致
[GLOSSARY REFERENCE] 精确匹配，不补全部分产品名
[OUTPUT FORMAT] JSON array only，reason 枚举中文
[VALIDATION: {targetLang}] 品类词对照 + quality + compliance + proofreadChecks
```

User Message：`[N] ({srcLang}→{targetLang}) source\nTrans：translation`

---

**最后更新**: 2026-07-29
