# 项目交接文档

**版本**: v9.4 · **日期**: 2026-07-29 · **项目**: Lexar 翻译插件（MasterGo 插件）

---

## 一、项目是什么

MasterGo 设计工具插件，将 Lexar 产品设计稿从英文翻译成 20 个目标语言。四条铁律：**不漏翻**（承载含义必翻）、**不加戏**（不编造规格）、**意思一致**（数字/容量/速度原样保留）、**适配 20 语种**。

### 1.1 质量标准（v9.4 业务定义，已注入翻译/校对 prompt）

"做好翻译"须同时满足六维，作为 LLM 的质量目标放在具体规则之前：

| # | 维度 | 要点 |
|---|------|------|
| 一 | 准确忠实（底线） | 不漏不错不添加；关键参数（速度/容量/代次）逐字对应；修辞可本地化重组但事实 1:1 |
| 二 | 本地化表达 | 像母语原创非翻译腔，去机翻味；区分语言变体（简/繁、欧葡/巴葡），用词符合当地习惯 |
| 三 | 行业表达 | 存储/消费电子标准术语与惯用说法（如「读取速度」「散热片」），不字面直译；术语/产品名/型号全篇统一，术语标准优先 |
| 四 | 调性匹配 | 产品线语感+目标客群：专业线克制、游戏线年轻有张力、大众线直白；匹配物料类型：海报短促/详情页详尽/声明严谨 |
| 五 | 格式规范统一 | 标点/大小写/空格/数字单位全篇统一，遵循目标语言书写规范（中文全角、德语名词大写） |
| 六 | 合规与文化适配 | 符合目标市场法规（广告法/认证标识），尊重宗教文化禁忌；法律声明逐字对应不增不减 |

实现：`QUALITY_STANDARD`（英）/ `QUALITY_STANDARD_ZH`（中）常量，翻译 prompt 注入位置 IDENTITY 之后、CORE_PRINCIPLES 之前；校对 prompt 开头加 [QUALITY BAR] 六维摘要。

---

## 二、系统架构（最新逻辑）

### 2.1 翻译管道

```
源文
  ↓ 预处理：HTML保护 → Unicode标准化 → 术语预替换 → maskGlossaryTerms → maskEntities → CJK空格保护 → ™剥离
  ↓ Prompt 组装：IDENTITY + QUALITY_STANDARD(v9.4) + CORE_PRINCIPLES + MISSION + STYLE + FEWSHOT + LANG_RULES + CONTEXT + GLOSSARY + OUTPUT
  ↓ LLM 调用（temperature=0.2）
  ↓ 后处理：stripEchoQuotes → 实体/术语还原 → postProcessTranslation → detectBrandInjection
            → detectTranslationExpansion → enforceGlossaryTerms → restoreTrademarkSymbols → detectUntranslatedText
  ↓ 重试管道：统一重试 → 激进重试×3 → 分句翻译 → 大小写归一化 → 术语组合 → 保留原文（v8.7，不标记⚠️）
译文
```

**遮蔽顺序（v9.2 定）**：`maskGlossaryTerms` 先于 `maskEntities`——术语是最高事实源，实体正则不触碰已遮蔽区域。反了会导致术语被实体正则误吞、术语库失效。

### 2.2 校对管道

```
源文 + 译文 → maskEntitiesForProofread → CJK空格保护 → ™保护
  → Prompt（MISSION + PROOFREAD_SYSTEM_PROMPT + glossaryHint + langBlock）
  → LLM（temperature=0.1）→ 实体/术语还原 → 校对后漏翻检测（v9.3 接 batchSrcLang）
```

### 2.3 漏翻检测（v9.3 现状，五道防线按序）

| 防线 | 机制 | 备注 |
|------|------|------|
| 源==目标跳过 | `srcLang===targetLang` 或 `batchExemptLang===targetLang` | v9.3 批次级补拉丁语（de→de/pt→pt 校对） |
| isUntranslatable | 品牌名/技术缩写/容量/术语库一致项（v8.7 单复数 lemma 豁免） | |
| 同语系豁免 | 并集：批次级∪逐条级；纯度条件防混杂批次 | v9.3 修复死代码 |
| 维度1 全等 | `normalize(src)===normalize(trans)` | 同语系对跳过 |
| 维度2 特征 | 特征字符/功能词/英文占比 | 同语系对跳过（pt/pt-BR 特征表相同无区分度），其余保留 |
| 二元守卫 | 同语系对译文 ≥2 en 区分词且无目标语言特征 → 仍判漏翻 | v9.3 新增，防 LLM 摆烂 |

**拉丁语判定**：`detectSourceLanguage` 批次级——独占区分词表 `LATIN_DISTINCTIVE_WORDS`（勿用 `LANG_FUNCTION_WORDS`，es/pt 共享 17+ 词会混淆）+ 特征字符强信号（pt:ãõ / es:ñ¿¡ / de:ß，≥2 次直接判定）；保守裁决：最高票 ≥3 且 ≥2 倍第二名，否则回退 `'en'`。**批次级只做加法豁免，拿不准回退现状。**

### 2.4 关键配置

TRANSLATE_BATCH_SIZE=15 · PROOFREAD_BATCH_SIZE=8 · CONCURRENCY=4 · API_TIMEOUT_MS=90000 · API_MAX_RETRIES=2 · MAX_AGGRESSIVE_RETRIES=3 · MAX_SCAN_NODES=1500 · UI 480×840

---

## 三、仍然有效的机制（勿破坏）

**v9.1 UX**：撤销三方对比（appliedTexts 快照，用户手改跳过）· 扫描完整重置 resetWorkState · 待确认条入 sticky 自动展开 · 批量进行中防竞争 · 选区感知 · toast 队列 · 扫描进度+1500上限 · 窗口 480×840

**v9.0 UI**：操作集中顶部 sticky · 统一进度条 busyPhase（apply>proofread>translate）· 配置/高级默认折叠+摘要行 · 结果卡片 [定位][重翻][应用] icon+文字 · 样式全在 ui/styles.css（Apple 设计令牌+深色覆盖）

**v8.9 待确认契约**（3 类阻塞，强制处理后才能批量应用）：翻译失败 `translateErrors.has` · 占位符残留 `__[A-Z]+_\d+__` · 漏翻保留原文（`sourceText===translatedText` 且非同语系且非术语库豁免）。交互：红=错误/占位符，黄=漏翻，绿=校对（不阻塞）；批量按钮待处理数>0 禁用，文案 `应用翻译 (N条待处理)`。

**v8.7 漏翻兜底**：isUntranslatable 单复数豁免 · 激进重试失败→保留原文不标记（交校对判断）· 校对 CHECK 3 同形词例外

**提示词系统（v8.6 定稿，20 语种全覆盖）**：getStyleCard productTone 抑制 styleGuide（具体覆盖通用）· STYLE_GUIDES/commonErrors/proofreadChecks/PRODUCT_LINE_TONE_GUIDES/SCENE_CONSTRAINTS/LANGUAGE_MARKET_NOTES 全 20/20 · CJK 中文指令、非 CJK 英文指令 · 校对 prompt 开头 [MISSION·{lang}]

---

## 四、踩过的坑（绝对不要再踩）

1. **tsconfig.ui.json 通配符**：`./typings/**/*.d.ts` 会把 plugin-runtime.d.ts 拉进 UI 项目与 DOM lib 冲突 → 用精确路径。**build 过 ≠ tsc 过，两者都查。**
2. **字符集检测不能用于拉丁语细分**（v9.3）：`detectSingleTextLanguage` 拉丁文本恒返回 `'en'`，依赖它做拉丁语对判断的逻辑全是死代码 → 用批次级 `detectSourceLanguage`。
3. **es/pt 功能词表混淆**（v9.3）：`LANG_FUNCTION_WORDS` es/pt 共享 17+ 词 → 拉丁细分必须用独占区分词表。
4. **术语遮蔽顺序**（v9.2）：maskEntities 先于 maskGlossaryTerms 会把术语误吞 → 术语遮蔽永远先于实体遮蔽。
5. **风格指令冲突**：productTone 抑制 styleGuide（具体覆盖通用）。
6. **指令语言错位**：非 CJK 语种指令是英文，prompt 字段用中文会干扰输出。

---

## 五、关键文件

| 文件 | 职责 |
|------|------|
| `lib/llm-api.ts` | LLM 调用 + 翻译/校对管道 + 重试 + detectSourceLanguage 拉丁细分(v9.3) + detectUntranslatedText batchSrcLang(v9.3) + isUntranslatable 单复数豁免(v8.7) |
| `lib/prompt-constants.ts` | 提示词常量（STYLE_GUIDES/LANG_SPECIFIC/PRODUCT_LINE_TONE_GUIDES/SCENE_CONSTRAINTS/CORE_PRINCIPLES/PROOFREAD_SYSTEM_PROMPT） |
| `lib/post-process.ts` | 译后处理（enforceGlossaryTerms/detectBrandInjection/restoreTrademarkSymbols/detectTranslationExpansion） |
| `lib/entity-masker.ts` | 实体/术语遮蔽（maskGlossaryTerms→maskEntities 顺序 v9.2） |
| `lib/glossary-filter.ts` | 术语过滤（filterRelevantGlossary/normalizeForMatch） |
| `lib/few-shot-examples.ts` | Few-shot 示例（20语种×3类型） |
| `lib/text-normalizer.ts` | 文本预处理（NFC/全角→半角/零宽字符/↵保护） |
| `lib/default-glossary.ts` | 默认术语库（140 产品名 + 189 专属术语） |
| `lib/main.ts` | 插件主线程（扫描/appliedTexts 快照/undoAll/selectionchange） |
| `lib/metrics.ts` | 翻译指标收集器 |
| `ui/App.vue` | UI 主组件（流程编排/sticky 操作区/待确认/busyPhase） |
| `ui/styles.css` | 全部样式（Apple 令牌/深色/.footer） |
| `tests/test-same-script-untranslated.ts` | v9.3 同语系豁免 12 用例 |
| `tests/test-glossary-mask-all-langs.ts` | v9.2 术语遮蔽 80 断言 |
| `tests/test-v87-plural-exemption.ts` | v8.7 单复数豁免 26 场景 |
| `tests/test-all-languages.ts` | 20 语种并行全量测试 |

---

## 六、构建与测试

```bash
npm run typecheck    # tsc 双项目（plugin+UI），必须过
npm run build        # 生产构建，必须过

npx tsx tests/test-same-script-untranslated.ts   # v9.3 同语系豁免
npx tsx tests/test-glossary-mask-all-langs.ts    # v9.2 术语遮蔽
npx tsx tests/test-v87-plural-exemption.ts       # v8.7 单复数豁免
```

**铁律**：改代码后必跑 typecheck + build。build 过 ≠ tsc 过。

---

## 七、Prompt 模板速查

**翻译**（buildSystemPrompt）：IDENTITY → QUALITY_STANDARD(六维v9.4) → CORE_PRINCIPLES(3条) → MISSION → STYLE(getStyleCard) → EXAMPLES(few-shot) → Guidelines(品类词+语言规则+commonErrors) → CONTEXT → GLOSSARY → OUTPUT。User: `[N] ({src}→{tgt}) "text"`

**校对**（proofreadBatch）：ROLE → QUALITY_BAR(六维摘要v9.4) → CORE_DIRECTIVE(只修客观错误) → CHECK1完整性 → CHECK2语义自然 → CHECK3漏翻(同形词例外v8.7) → CHECK4语法拼写标点 → CHECK5术语一致性 → GLOSSARY_REFERENCE → OUTPUT(JSON only, reason中文枚举) → VALIDATION。User: `[N] ({src}→{tgt}) source\nTrans：translation`

---

## 八、后续建议

**短期**：实机验证 v9.3（pt→pt-BR 不再误报漏翻）
**中期**：指标收集器 UI 面板 · 校准 LANG_EXPANSION_RATIO
**长期**：术语库版本管理 · 术语注入分级策略

---

**最后更新**: 2026-07-29
