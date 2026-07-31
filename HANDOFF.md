# 项目交接文档

**日期**: 2026-07-31  
**版本**: v10.2  
**项目**: Lexar 翻译插件（MasterGo 插件）

---

## 一、项目背景

MasterGo 设计工具插件，将 Lexar 产品设计稿从英文翻译成 20 个目标语言。核心目标：

- **不漏翻** — 所有承载含义的文本都必须翻译
- **不加戏** — 严格忠实源文，不编造规格
- **意思一致** — 语义准确，数字、容量、速度值原样保留
- **适配 20 个语种** — 每个语种都有特定的规则、常见错误、校对检查项

### 1.1 质量评审标准（判断依据，非 prompt）

"做好翻译"须同时满足六维——这是**评审代码与修改是否达标的判断依据**，不注入翻译/校对 LLM prompt（注入会与现有 CORE_PRINCIPLES / LANG_SPECIFIC / STYLE 模块语义重叠污染）：

| # | 维度 | 要点 |
|---|------|------|
| 一 | 准确忠实（底线） | 不漏不错不添加；关键参数（速度/容量/代次）逐字对应；修辞可本地化重组但事实 1:1 |
| 二 | 本地化表达 | 像母语原创非翻译腔，去机翻味；区分语言变体（简/繁、欧葡/巴葡） |
| 三 | 行业表达 | 存储/消费电子标准术语与惯用说法；术语/产品名/型号全篇统一，术语标准优先 |
| 四 | 调性匹配 | 产品线语感（专业克制/游戏张力/大众直白）+ 物料类型（海报短促/详情页详尽/声明严谨） |
| 五 | 格式规范统一 | 标点/大小写/数字单位全篇统一，遵循目标语言书写规范 |
| 六 | 合规与文化适配 | 目标市场法规/宗教文化禁忌；法律声明逐字对应 |

**现有 prompt 各模块与六维的对应关系**（评审时对照）：一→CORE_PRINCIPLES #2 + detectBrandInjection/validateNumbers；二→IDENTITY_MISSION + LANGUAGE_MARKET_NOTES + LANG_SPECIFIC；三→CATEGORY_WORDS + glossaryHint + enforceGlossaryTerms；四→PRODUCT_LINE_TONE_GUIDES + STYLE_GUIDES + SCENE_CONSTRAINTS；五→OUTPUT format + restoreTrademarkSymbols/capitalizeFirstLetter；六→LANG_SPECIFIC.compliance + SCENE_CONSTRAINTS.compliance_doc。

---

## 二、当前版本（v10.4）

### 2.0 v10.4 管道阶段化 + 不变量审计（2026-08-01，v9.11 结构性根因止血）

**问题**：`translateBatch` 922 行单函数、`result[]` 23 处赋值（12 处集中在异常兜底链单点写入）。v9.11 漏翻静默 bug 的根因就是这个结构——中间检测点的 result 快照被后续兜底链覆盖，无任何机制能发现。当时靠"最终安全网"补丁治标，结构问题还在。

**改动**（对应"五点一、架构复盘"优化方向 ③兜底无不变量）：

| 改动 | 内容 | 位置 |
|------|------|------|
| 阶段化注释 | 922 行划分为 S1预处理→S2遮蔽→S3 Prompt→S4 LLM+解析→S5还原→S6安全后处理→S7异常六层(a检测/b统一重试/b-trunc截断标记/c-d激进+子兜底/e-f术语组合+标记)→S8最终兜底，每段 banner 注明输入/输出/允许做什么 | lib/llm-api.ts |
| auditStage 不变量审计 | 模块级私有函数，13 个审计点（S4/S5/S6/S7a/S7b/S7b-trunc/S7c-d/S7e-f/S8 出口）。三项不变量：①长度恒等（result.length===texts.length，漂移即阶段函数违约）②S5 后不得残留 __XXX_N__ 占位符 ③条目必须是字符串。**只报警不改数据**——审计里做隐式修复 = 给审计本身埋 v9.11 同款雷（决策见下） | lib/llm-api.ts |
| 阶段轨迹日志 | 每阶段一行 `S{n} 完成: N条 [关键计数]`（S1-S2 术语短路/遮蔽数、S4 空结果数、S6 品牌注入回退数、S8 返回数），翻译一批的日志从零散 debugWarn 变成 S1→S8 时间线，配合 v10.3 持久化可直接看阶段序列定位 | lib/llm-api.ts |

**关键决策（正反论证后拍板）**：
1. **S7 必须细分六层**——23 处 result 赋值中 12 处在 S7 内部（v9.11 事故现场），粗粒度阶段名形同虚设。审计点插在每个子层出口。
2. **审计只报警不改数据**——现有 L839 已有 LLM 解析出口硬归一化（`while(result.length<len) push(''); slice(0,len)`），此后所有 `result=f(result)` 的 f 都是保长映射，真正可能漂移的只有"外部函数违约返回不等长数组"。审计正是抓这种违约的——抓到了就该修那个函数，而不是在审计里叠隐式归一化（=给审计埋同款雷）。长度漂移只 uiLog+debugWarn 记录，不做截断/填充。
3. **不改函数签名/逻辑/顺序**——本次纯结构+审计，行为零变化；不拆文件（922 行拆 8 函数要传 10+ 上下文参数，风险大于收益）。

**测试**：`tests/test-v104-pipeline-audit.ts` 17/17（正常路径零告警 + S1-S8 阶段日志齐全 + 顽固漏翻全兜底链审计零告警 + 术语短路路径零告警 + 阶段日志计数正确）；全量回归全绿（v10.3 22 / v10.2 38 / v10.0 21 / v9.11 21 / v9.9+9.10 33 / v9.8 10 / v9.7 9 / v9.5 40 / 同语系 21 / v8.7 26 / 术语遮蔽 80）；typecheck 双配置 + build 通过；dist/index.html 含 auditStage + 阶段日志（v10.4 改动在 UI 线程包，dist/main.js 不含——translateBatch 由 UI 线程 import）。

### 2.0.1 v10.3 日志持久化 + 主线程跨线程可见（2026-08-01，优化方向 ④）

**问题**：①诊断日志（ui-debug-log 内存环形缓冲）插件关闭即丢，实机 bug 只能靠用户复述；②主线程（扫描/应用/撤销/字体替换）行为完全不可见，诊断面板只有 UI 线程日志。

**架构约束**：`mg.clientStorage` 只在主线程存在，UI 线程无 `mg` 全局。所有持久化必须 UI→UIMessage→主线程→clientStorage，回来走 PluginMessage。

**改动**：

| 改动 | 内容 | 位置 |
|------|------|------|
| 持久化通道 | UIMessage 加 `SAVE_UI_LOGS`(防抖2s+版本去重)/`LOAD_UI_LOGS`(启动)；PluginMessage 加 `MAIN_LOG`(主→UI推事件)/`UI_LOGS_LOADED`(启动恢复) | messages/types.ts |
| 存储 | `STORAGE_KEY_UI_LOGS='translate_ui_logs'`，主线程 `saveUiLogs`/`loadUiLogs`（clientStorage 落盘，截断500条） | lib/constants.ts, lib/main.ts |
| 跨线程 | 主线程 `mainLog()` 辅助函数推 MAIN_LOG；扫描(开始/完成/超上限/0节点/选中扫描)+应用译文+字体替换+撤销 完成事件埋点，tag 前缀 `main:` | lib/main.ts |
| UI 侧 | 容量 300→500；`receiveMainLog`(保留主线程时间戳)/`restoreUiLogs`(启动恢复+上次会话/本次会话分隔标记+脏数据防御)/`serializeUiLogs`(排除分隔行)；"清空"改 `clearDiagLogs()` 同时清持久化 | lib/ui-debug-log.ts, ui/App.vue |

**测试**：`tests/test-v103-log-persistence.ts` 22/22；全量回归全绿；typecheck + build 通过；dist/main.js + dist/index.html 均含 3 个新消息类型。

### 2.0.2 v10.2 截断误杀根治（2026-07-31，确立"代码管形式/LLM管语义"原则）

**问题**：实机日志 16:33——pt→ja `Resistente a altas temperaturas`（31字符）LLM 首调即翻对 `高温に強い`（6字符），却被 `detectTruncatedTexts` 判"截断"（比例 0.19 < 0.25 阈值），统一重试→激进重试→子兜底连环空耗后标记失败；同批 `Resistente a baixas temperaturas` 同命。另：诊断日志"复制日志"按钮在 MasterGo iframe 中失效（clipboard API 不可用）。

**根因**：代码拿"长度比"代理"语义完整性"——拉丁→CJK 字符密度天然差 3-5 倍，长度代理跨语系必然失效。20 语种普查：误杀集中在拉丁→ja/ko/zh 的 31~45 字符营销文案；拉丁→拉丁从不触发（膨胀率 1.5-1.9 保持在阈值之上）。

**宏观原则（本次确立，后续判定的归属依据）**：**代码管"形式"**（字符类型、集合包含、计数、空值——零误判铁律），**LLM 管"语义"**（完整性、等价性、风格——校对 CHECK）。历史全部误杀 = 代码用代理指标干语义的活。

**修复**：

| 改动 | 内容 | 位置 |
|------|------|------|
| 截断判定改写 | `detectTruncatedTexts` 新增 targetLang 参数：译文为空→截断（不变）；**非拉丁目标**（ja/ko/zh/th/ar/ru）只判译文含不含目标脚本字符，完全不做长度判定；拉丁目标长度比 0.25→0.15；无 targetLang 保持 0.25（测试兼容） | lib/llm-api.ts（两处调用点均传 targetLang） |
| TARGET_SCRIPT_PATTERNS | ja 假名+汉字 / ko 谚文 / cjk / th / ar / ru 脚本存在性正则，与 getTargetScript 配套 | lib/lang-detect.ts |
| 语义截断移交校对 | CHECK 1 新增 TRUNCATION CHECK：明确"拉丁→日/韩/中收缩 3-5 倍是正常的"，仅当源文独立信息要素完全缺失才判截断（中英 prompt 同步） | lib/prompt-constants.ts |
| 子兜底守卫 | 激进请求未发出（异常/超时）时跳过逐句拆分/大小写归一化连环子兜底 | lib/llm-api.ts |
| 膨胀率补表 | LANG_EXPANSION_RATIO 补 uk/el/he，消除 `?? 1.5` 兜底不确定性 | lib/post-process.ts |
| 日志埋点补齐 | 重试原始返回/重试结果应用/重试后再检测/截断判定明细/激进异常/子兜底各结果/上报漏翻索引 全部进 UI 诊断日志 | lib/llm-api.ts |
| 复制日志修复 | clipboard 不可用时 Range.selectNodeContents 自动全选日志 + toast 提示 Ctrl+C | ui/App.vue |

**测试陷阱（重要）**：队列式 mock 测试中，改判定逻辑会改变异常集构成 → 统一重试条数变化 → 旧脚本化响应队列错位串行污染后续场景。v10.2 后 v9.11 C3 异常集从 2 条缩为 1 条，重排队列后恢复 21/21（经 git stash A/B 证明代码正确、纯测试债）。**判定逻辑改动后测试失败，先查队列对齐再查代码。**

**测试**：`tests/test-v102-truncation-fix.ts` 38/38（pt→ja 误杀修复 + 非拉丁脚本存在性 + 真截断检出 + 拉丁 0.15 分支 + 无 targetLang 兼容 + 20 语种 pattern↔getTargetScript 一致性 + detectUntranslatedText 回归）；全量回归全绿（v9.7 9 / v9.8 10 / v9.9+9.10 33 / v9.11 21（队列重排）/ v10.0 21 / 同语系 21 / v8.7 26）；dist 字节级验证通过。

### 2.1 v10.0 判定逻辑收口（2026-07-31，架构复盘优化 #1+#2）

**改动**（对应"五点一、架构复盘"优化方向 1+2）：

| 改动 | 内容 |
|------|------|
| 新增 `lib/lang-detect.ts` | 语言检测单一事实源：detectSourceLanguage/detectSingleTextLanguage/detectLatinLang/getScriptClass/getTargetScript/isSameScriptLanguagePair/hasFunctionWords + 全部词表（LATIN_FUNCTION_WORDS/LATIN_DISTINCTIVE_WORDS/LATIN_DISTINCTIVE_CHARS）|
| 修死代码 | detectSingleTextLanguage 原独立字符统计（拉丁恒 'en'，v9.3/v9.11 两次踩坑）→ 委托批次级 detectSourceLanguage。拉丁单条弱信号仍保守回退 'en'（批次级 ≥3 票才细分），口径统一 |
| 新增 `lib/keep-source.ts` | 豁免中央注册表：shouldKeepSource（=isUntranslatable 规则）/ isSameLanguageExempt（v9.11 F3b 三重守卫迁入）/ re-export isSameScriptLanguagePair |
| llm-api.ts | 删 3 套本地实现 + 词表（约 -400 行），改为 re-export lang-detect 兼容既有导入；detectUntranslatedText 的 F3b 内联逻辑改调注册表 |
| ui/App.vue | 删 2 个死副本（isSameScriptLanguagePair / detectSingleTextLanguage 本地重复实现，零调用）|

**原则**（写入两个新模块头注释）：任何新增语言检测/豁免判定，改 lang-detect/keep-source，不要在别处新建检测器或豁免分支。

**测试**：`tests/test-v100-arch-consolidation.ts` 21/21（re-export 同一引用 + 死代码修复 + 注册表三重守卫全场景）。全部历史回归套件过（v9.3 21 / v9.5 40+40 / v9.7 9 / v9.8 10 / v9.9+9.10 33 / v9.11 21 / v8.7 26 / 术语遮蔽 80 / edge-cases 20 / all-langs-same-lang）。

### 2.1.1 v9.11 非英源文漏翻闭环（2026-07-31）

**问题**：pt 源文 `Resistente a altas temperaturas` / `Resistente a baixas temperaturas` → ja 漏翻，画布上无任何标记；单条重翻 toast 报"空值"；其他 AI 都能正常翻译。

**根因链**（三环断裂，缺一都不可见）：

1. **标注误导**：逐条 `detectSingleTextLanguage` 对拉丁文本恒返回 `'en'`（v9.3 已知死代码）→ user message 标注 `(en→ja)` → 模型看到非英文却标英文，困惑回显原文
2. **兜底链静默**：v9.8 检测 → 统一重试 → 激进重试全部失败（同一误导）→ Layer 3 **静默保留原文**（v8.7 设计，无标记）→ 用户零感知
3. **中间快照不可靠**：管道中间阶段的漏翻检测快照会被后续兜底写入静默覆盖——只有对**最终结果**的检测才可靠

**修复（F1-F3b）**：

| 修复 | 内容 | 位置 |
|------|------|------|
| F1 | user message 标注改用批次级 `detectedSource`（翻译 + 校对两条管道） | llm-api.ts translateBatch/proofreadBatch |
| F2 | 激进重试 system prompt 补"源文可能是任何语言（不一定是英文）"（中英双语） | llm-api.ts aggressiveSystemPrompt |
| F3 | `translateBatch` 新增 `untranslatedIndices` 输出参数 + **最终安全网**（返回前对最终结果跑完整漏翻检测） | llm-api.ts |
| F3 | UI 三条路径（批量翻译/批量重翻/单条重翻）将漏翻索引进 `translateErrors` → 待确认红条 + 阻塞应用 + 重翻入口；单条重翻漏翻 toast 明示原因 | ui/App.vue |
| F3b | `detectUntranslatedText` 同源拉丁语言豁免（de→de 校对工作流不误判），三重守卫 | llm-api.ts |

**F3b 三重守卫**（防 zh-TW→zh-CN 未转换/混合批次/弱信号三重回退）：
1. 仅拉丁目标语言白名单（zh/ja/ko 的 detectSourceLanguage 是粗字符集类，zh-TW 报 zh-CN 会误豁免）
2. 逐条 `detectLatinLang(src) === targetLang`（de 混 en 批次中 en 条目不误豁免）
3. 批次级复核 `detectSourceLanguage(sourceTexts) === targetLang`（单条弱信号如 "Hohe Geschwindigkeit" 仅 1 票回退 'en'，不误豁免）

**关键决策**：
- 翻译分支严格相等判断 `src === trans`（原 `normalize` 剥离引号导致 `"text"` vs `text` 假阳性）；引号微调场景由 v9.8 字符集校验覆盖
- 漏翻进 `translateErrors`（红色失败）而非黄色漏翻徽章——**更强**：阻塞批量应用 + 提供重翻路径

**测试**：`tests/test-v911-non-en-source.ts` 21/21（A 标注 6 断言 + B 激进指令 3 + C 漏翻上报 7 + D 豁免 5）。

### 2.2.1 v9.10 术语库双视图拆分（2026-07-31）

**问题**：v9.9 全语言 key 注册修复了匹配盲区，但把"判断类"消费者也暴露在全语言视图下——分类器是 EN 精确匹配，非 EN key 导致四类新风险。

**风险清单与处置**：

| # | 风险 | 处置 |
|---|------|------|
| R1 | 营销术语分类器 EN-only，非 EN key 绕过场景过滤 | **修复**：`buildTaskGlossaryHint` 改用 EN 视图 |
| R2 | 跨语言同形词撞 key（如 th 列值 == EN source） | **观测**：`console.warn`，行为仍先到者胜 |
| R3 | 术语 hint 对非 EN 源文半失效 | **不动**（遮蔽+校准兜底够用） |
| R4 | `noTranslateTerms` 用全语言视图 → 跨语言同形词整句不翻 | **修复**：改用 EN 视图（只认 EN 列 src===tgt） |
| R5 | `isUntranslatable` 用全语言视图 → 非 EN 同形词误判豁免漏翻 | **修复**：改用 EN 视图（宁可多重翻，不可漏判） |
| R6 | 校对路径无合规校验 + 复制 Map 漂移风险 | **修复**：复用同一 Map + 补合规校验 |
| R7 | 术语库 ja 值无 ®™，与 restoreTrademarkSymbols 加符号矛盾 | **已拍板**（2026-07-31）：现状即规则——去符号匹配术语库，®™ 由源文驱动 restoreTrademarkSymbols 恢复（源文有才加，没有不加），CSV 目标值不携带符号。行为与规则一致，无需改代码 |

**修复**：`buildGlossaryMaps()` 返回 `{ full, en }` 双视图（`ui/App.vue`）：

```ts
interface GlossaryMaps {
  full: Map<string, string>  // 全语言视图：匹配用（短路/遮蔽/校准/合规校验/漏翻检测）
  en: Map<string, string>    // EN 视图：判断用（场景过滤/noTranslateTerms/isUntranslatable）
}
```

| 消费者 | 视图 | 原因 |
|--------|------|------|
| 短路/遮蔽/enforceGlossaryTerms/合规校验 | full | 需要全语言 key 匹配任意源文 |
| buildTaskGlossaryHint（场景过滤） | en | isMarketingTerm/isComplianceTerm 是 EN 精确匹配 |
| noTranslateTerms | en | 只认 EN 列 src===tgt（全球统一不翻术语） |
| isUntranslatable / detectUntranslatedText | en | 豁免只认 EN，非 EN 同形词不豁免（保守方向） |
| proofreadBatch | full + 合规校验 | 复用同一 Map（删复制），整条命中锁死 |

**测试**：`tests/test-v99-glossary-all-langs.ts` 33/33（含 R1/R4/R5/R6 专测 + R5 对照证明旧逻辑确实误判）。

### 2.3.1 v9.9 术语库全语言 key 注册 + 合规锁（2026-07-31）

**问题**：pt-BR 源文 `Cartão Lexar® Professional SILVER PLUS SDXC™ UHS-I` 被译为 `Lexar®プロフェッショナル SILVER PLUS SDXC™ UHS-I カード`——LLM 自由发挥，术语库 ja 值 `Lexar Professional SILVER PLUS SDXC UHS-I カード` 完全未生效。

**根因**：`buildGlossaryMap()` 仅在**手动指定**非 EN 源语言时才注册该语言列的 key；`sourceLang='auto'`（默认）时，葡/德/法等源文不匹配任何术语 key → 5 层术语防线全部失效。

**修复**：

1. **全语言 key 注册**（`ui/App.vue` buildGlossaryMaps）：无条件把术语库全部语言列注册为 key，指向目标语言译文
2. **术语合规校验**（`lib/llm-api.ts` translateBatch/proofreadBatch）：整条源文 cleanKey 命中术语库 → 译文强制锁定为术语库值（绕过 LLM 输出）

**关键决策**：合规校验只锁"整条命中"，嵌入句不强制（交给遮蔽/enforceGlossaryTerms），避免误伤正常翻译。

### 2.4 v9.6 ® 符号字体修复（2026-07-29）

**问题**：Avenir 字体的 ® 符号渲染异常（过大且非上标），但修复逻辑存在漏洞——同语言/不翻译场景（`translatedText === sourceText`）完全跳过字体处理，导致 ® 保持 Avenir 显示。

**根因**：`applyTranslations` 中 `translatedText === sourceText` 分支直接 `continue`，不执行任何字体操作；`fixAvenirRegisterSymbol` 仅在文本被替换时触发。

**修复**（`lib/main.ts`）：

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 不翻译/同语言 | 完全跳过，® 保持 Avenir ❌ | 执行 `fixRegisterSymbolFont`，® 替换为 HarmonyOS ✅ |
| 翻译后应用 | 仅当 `effectiveFamily === 'Avenir'` 时修复 | 同样条件，代码统一到全局函数 ✅ |
| 字体替换 | 无条件替换所有 ®（可能覆盖用户设置） | 仅当替换前或替换后字体为 Avenir 时执行 ✅ |

**关键决策**：
- 仅 Avenir 字体的 ® 渲染异常，不过度修复其他字体
- MasterGo `TextNode` 无 `getRangeFontName`，无法读取单字符字体，直接写入 ® 区间（重复写同字符无副作用）
- 字体替换双检查：替换前字体或替换后字体任一为 Avenir 即触发修复

### 2.5 v9.5 三层漏翻检测架构（2026-07-29）

**问题**：v9.3 批次级豁免机制复杂且存在漏洞——简繁转换（zh-CN→zh-TW）相同文本未被判漏翻；拉丁语言对（es→pt-BR）边界模糊。

**架构**：代码 + LLM 三层协作

```
第一层：代码前置过滤（确定性规则，零误判）
  - isUntranslatable：品牌/数字/术语/单字符
  - 字符集分类：latin/cjk/ja/ko/th/ar/ru
  - 跨字符集 → 必须翻译，源文==译文=漏翻

第二层：代码变体校验（字符特征，高置信度）
  - 简繁转换：检测目标变体特征字（SIMPLIFIED_ONLY_CHARS / TRADITIONAL_ONLY_CHARS）
  - 拉丁变体（pt/pt-BR）：检测英文功能词混入
  - 同语言拉丁：功能词投票 ≥2 → verify（不检测）

第三层：LLM 语义校验（模糊边界，最终裁决）
  - 校对 CHECK 3 显式覆盖：简繁同形字、欧葡/巴葡词汇选择、极短文本
```

**核心函数**（`lib/llm-api.ts`）：
- `getScriptClass(text)` / `getTargetScript(targetLang)`：字符集分类
- `classifyNecessity(src, targetLang)`：逐条判断 `translate` / `variant` / `verify`
- `hasFunctionWords(text, lang)`：拉丁功能词检测（≥1 词且 ≥5% 占比）
- `hasSimplifiedOnlyChars` / `hasTraditionalOnlyChars`：简繁特征字检测

**测试**：`tests/test-untranslated-v3.ts` 40 用例全过；`tests/test-same-script-untranslated.ts` 21/21 回归。

### 2.6 v9.3 同语系豁免死代码修复（2026-07-29，已被 v9.5 取代）

**问题**：pt→pt-BR 翻译中，欧葡/巴葡写法完全相同的正确译文被误判漏翻。

**根因**：`detectSingleTextLanguage` 是字符集级检测，拉丁文本一律返回 `'en'`，导致同语系豁免成为死代码。

**修复**（已整合进 v9.5）：批次级 `detectSourceLanguage` 拉丁细分 + 并集豁免 + 纯度条件 + 二元守卫。

**核心原则**：批次级判定永远只做加法（多豁免），永不做减法（少检测）。

### 2.7 v9.2 术语遮蔽顺序修复（2026-07-29）

**问题**：`"Lexar Recovery Tool"` 日译为 `"Lexar リカバリーツール"`——术语库收录但未按术语库输出。

**根因**：`maskEntities` 先于 `maskGlossaryTerms`，术语被误判为产品名/型号实体抢先遮蔽。

**修复**：`lib/llm-api.ts` 两行调换——`maskGlossaryTerms`（术语优先）→ `maskEntities`（不触碰已遮蔽区域）。

**测试**：`tests/test-glossary-mask-all-langs.ts` 80/80 通过（4 场景 × 20 语种）。

### 2.8 v9.7 / v9.8 配套修复（2026-07-30）

- **v9.7 空结果标记**：LLM 返回空串的条目正确标记 `translateErrors`，UI 显示翻译失败；漏翻重试空结果回退源文后重新分类 necessity（`tests/test-v97-empty-result.ts` 9/9）
- **v9.8 目标字符集校验**：ja/ko/zh 目标译文必须含对应字符——LLM 微调源语言（如 pt 加 `às`）绕过 normalize 比对但译文仍非目标语言时检出（`tests/test-v98-script-validation.ts` 10/10）

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
  ↓ 后处理（stripEchoQuotes → 实体/术语还原 → postProcessTranslation → detectBrandInjection → detectTranslationExpansion → enforceGlossaryTerms → **术语合规校验 v9.9** → restoreTrademarkSymbols → detectUntranslatedText）
  ↓ 重试管道（统一重试 → 激进重试×3 → 分句翻译 → 大小写归一化 → 术语组合 → 保留原文 v8.7）
译文
```

**v9.2 遮蔽顺序**：`maskGlossaryTerms`（术语优先）→ `maskEntities`（实体不触碰已遮蔽区域）。

**v9.9/v9.10 术语合规校验**：整条源文 cleanKey 命中术语库（**full 视图**）→ 译文强制锁定为术语库值。在 enforceGlossaryTerms 之后、restoreTrademarkSymbols 之前执行；translateBatch 与 proofreadBatch 均覆盖。

**v9.10 双视图**：术语库 map 拆分为 `full`（全语言列 key，匹配用）与 `en`（仅 EN source，判断用）。判断类消费者（场景过滤/noTranslateTerms/isUntranslatable）一律用 en 视图；匹配类消费者（短路/遮蔽/校准/合规校验/漏翻检测）一律用 full 视图。

### 4.2 校对管道

```
源文 + 译文
  ↓ 预处理（maskEntitiesForProofread → CJK空格保护 → ™保护）
  ↓ Prompt 组装（MISSION + PROOFREAD_SYSTEM_PROMPT + glossaryHint + langBlock）
  ↓ LLM 调用（temperature=0.1）
  ↓ 后处理（实体还原 → 术语强制校准 → 商标还原 → 校对后漏翻检测 v9.5 三层架构）
校对结果
```

### 4.3 漏翻检测三层防线（v9.5 现状）

| 层级 | 机制 | 负责方 |
|------|------|--------|
| 第一层 | 代码前置过滤：`isUntranslatable` + 字符集分类 + 跨字符集必译 | 代码 |
| 第二层 | 代码变体校验：简繁特征字 / 拉丁功能词 / pt 变体英文混入检测 | 代码 |
| 第三层 | LLM 语义校验：校对 CHECK 3（简繁同形字、欧葡/巴葡词汇、极短文本） | LLM |

**v9.3 机制（已整合）**：批次级 `detectSourceLanguage` 拉丁细分仍用于辅助判断，但逐条 `classifyNecessity` 为主。

### 4.4 字体处理管道（v9.6 新增）

```
应用译文 / 字体替换
  ↓ 文本替换（如需）
  ↓ applyTextStyle（目标字体/字号/行高/字距/对齐）
  ↓ fixRegisterSymbolFont（® 修复：Avenir → HarmonyOS Sans SC）
```

**触发条件**：`effectiveFamily === 'Avenir'`（源字体或目标字体任一为 Avenir）。

### 4.5 术语库五层防线（v9.9/v9.10 现状）

| 层 | 机制 | 视图 | 位置 |
|----|------|------|------|
| 1 译前短路 | 整条源文 cleanKey 命中 → 直接返回术语库值，不调 LLM | full | App.vue startTranslate |
| 2 管道内预处理 | glossaryLookup 子串预替换 | full | llm-api.ts |
| 3 术语遮蔽 | maskGlossaryTerms → `__GLOSSARY_N__` 占位符 | full | entity-masker.ts |
| 4 glossaryHint | prompt 注入（场景过滤后） | **en** v9.10 | glossary-filter.ts |
| 5 译后强制校准 | enforceGlossaryTerms 子串校准 | full | post-process.ts |
| 6 合规校验 v9.9 | 整条命中 → 译文锁定术语库值（硬约束） | full | llm-api.ts translateBatch/proofreadBatch |

**判断类消费者（EN 视图，v9.10）**：场景过滤分类器（isMarketingTerm/isComplianceTerm）、noTranslateTerms、isUntranslatable——均为 EN 精确匹配，不暴露给非 EN key。

### 4.6 关键配置

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

### 坑 2: 字符集级语言检测不能用于拉丁语细分（v9.3）

`detectSingleTextLanguage` 按 Unicode 范围判断，拉丁文本一律返回 `'en'`。任何依赖它做拉丁语对判断的逻辑都是死代码。**拉丁语判定必须用批次级 `detectSourceLanguage` 或逐条 `classifyNecessity`。**

### 坑 3: es/pt 功能词表混淆

`LANG_FUNCTION_WORDS` 的 es/pt 表共享 17+ 词（que/para/por/de/a/se…），直接投票会把 es 误判成 pt。**拉丁语细分必须用独占区分词表 `LATIN_DISTINCTIVE_WORDS`。**

### 坑 4: 术语遮蔽顺序（v9.2）

`maskEntities` 先于 `maskGlossaryTerms` 会把术语误判为产品名/型号实体抢先遮蔽 → 术语库失效。**术语遮蔽永远先于实体遮蔽。**

### 坑 5: 风格指令冲突

gaming 产品线"参数精确" vs marketing 风格"淡化参数"。**具体指令覆盖通用指令**（productTone 抑制 styleGuide）。

### 坑 6: 指令语言错位

非 CJK 语种的指令语言是英文，prompt 字段用中文会干扰输出。新增提示词字段时明确语言策略。

### 坑 7: 同语言跳过场景的副作用遗漏（v9.6）

`translatedText === sourceText` 时认为"无变化不需要处理"，但字体层面 ® 仍需修复。**跳过文本替换时，检查是否还有其他副作用需要执行（如字体修复、样式校准）。**

### 坑 8: 术语库 key 注册依赖手动源语言（v9.9）

`buildGlossaryMap()` 原逻辑仅在手动指定非 EN 源语言时注册该语言列 key，`sourceLang='auto'`（默认）时非 EN 源文完全脱离术语库。**术语库 key 注册必须无条件覆盖全部语言列，与源语言检测方式解耦。**

### 坑 9: 匹配视图与判断视图混用（v9.10）

术语库 map 同时服务两类消费者：**匹配类**（需要全语言 key 覆盖任意源文）与**判断类**（分类器是 EN 精确匹配）。v9.9 把全语言视图暴露给判断类消费者后，非 EN key 导致场景过滤失效（R1）、跨语言同形词整句不翻（R4）、漏翻误判豁免（R5）。**匹配用 full 视图，判断用 en 视图，两者不可混用。**

### 坑 10: 中间阶段快照会被下游兜底覆盖（v9.11）

翻译管道是多个阶段顺序改写同一个 `result[]` 数组（首调→统一重试→激进→Layer 3 保留原文）。中间阶段检测出的漏翻/异常集合是**当时的快照**，后续兜底写入（`result[j]=`）会静默覆盖它——快照就此失真。**任何"最终暴露给用户"的判定必须对最终结果重新检测，不能信中间快照。**

### 坑 11: 静默兜底让用户零感知（v9.11）

v8.7 设计"激进失败→保留原文不标记，交给校对 LLM 判断"，但当 LLM 也失败时，画布上就是一条没有任何标记的原文。模型链路有任何一环持续失败时，**静默兜底 = 漏翻隐身衣**。兜底必须显式：要么标记，要么进待确认。

### 坑 12: 长度代理跨语系失效（v10.2）

`detectTruncatedTexts` 用"译文 < 源文×0.25"代理"截断"，但拉丁→CJK 字符密度天然差 3-5 倍——6 字符日文对 31 字符葡语是完全正确的翻译，比例 0.19 却被误杀。**代码判定只能用形式信号（空值/脚本存在性/字符集包含），语义判定（完整性/等价性）移交校对 LLM CHECK；任何代码层代理指标必须声明其有效域**（长度比只在拉丁→拉丁有效，且阈值已降到 0.15）。

### 坑 13: 队列式 mock 队列错位（v10.2）

测试的脚本化响应队列按调用次数顺序消费。改判定逻辑会改变异常集构成 → 统一重试条数变化 → 队列错位，残留响应串行污染后续场景（C5 消费到 C4 的残留响应）。**判定逻辑改动后测试失败，先核对 mock 队列与新调用序列是否对齐，再怀疑代码。**

---

## 五点一、架构复盘（2026-07-31，v9.11 之后）

> 开发 2-3 个月"每次使用都有不同 bug"的根因分析。**结论：设计思路无根本问题，bug 大头不是 LLM 不确定性，而是三处结构性的"假设腐化"。**

### 一、bug 大头是代码确定性缺陷

| 版本 | bug 本质 | 确定性缺陷？ |
|---|---|---|
| v9.9 | auto 源语言下术语库 5 层防线全失效 | ✅ 代码盲区 |
| v9.10 | 全语言视图喂给 EN 精确分类器 → 判断失真 | ✅ 视图混用 |
| v9.11 | 逐条标注恒 `(en→ja)` + Layer 3 静默保留原文 | ✅ 死代码 + 架构腐化 |

真正的 LLM 不确定性（同输入偶发不同输出）占比很小。先清完确定性缺陷，"每次都出 bug"的感觉会消失大半。

### 二、三个结构性问题

1. **同一判定多处实现，改一处漏一处**：语言检测现有 3 套并行实现（`detectSourceLanguage` 批次级 / `detectSingleTextLanguage` 逐条死代码 / `detectLatinLang` 又一套拉丁细分）。v9.3 和 v9.11 踩的是同一个坑的两次。
2. **豁免无中央注册表**（最危险）：`isUntranslatable`/`noTranslateTerms`/v9.3 同语系豁免/F3b 同语言豁免/校对 CHECK 3 例外/营销术语过滤散在不同函数互相不可见。修一个误判（放宽）就在别处制造漏翻（过度豁免），v8.7→v9.3→v9.5→F3b 在跷跷板上迭代四轮。
3. **兜底链无不变量审计**：约 5 个阶段顺序改写共享 `result[]`，无断言。v9.11 实测中间漏翻快照被后续兜底静默覆盖。没有不变量检查，每次修补只是把错误推向下游。

### 三、代码/LLM 职责边界（v10.2 已定原则）

**代码管"形式"，LLM 管"语义"**——这是 v10.2 确立的判定归属总原则，取代此前零散的边界讨论：

- **代码只做零误判的形式判定**：字符类型/脚本存在性/集合包含/计数/空值。任何形式判定可用代码实现，且必须声明代理指标的有效域。
- **语义判定（完整性/等价性/风格）一律移交校对 LLM CHECK**：如截断的"信息点缺失"判断（CHECK 1 v10.2）。代码不碰语义。
- 历史全部误杀 = 代码用代理指标（长度比等）干语义的活。

遗留的一处错位（设计约束，非可修 bug）：校对 CHECK 3 要求 LLM 判断"是否与源文同语言"——拉丁↔拉丁同文场景，"源语言是什么"的判断天然不可靠，代码层确定性检测也被语言对边界卡住。这是设计层面要正视的约束，不是再叠一层能解决的。

### 四、复杂度账本

- `translateBatch` 约 900 行、14 个参数（v9.9→v9.11 加了 2 个）
- llm-api.ts 2625 行 / prompt-constants.ts 2572 行 / App.vue 3105 行
- prompt 约 2600 行——越长模型对每条指令注意力越稀释，再加代码防线补偿，防线自身又有 bug，正反馈循环
- 测试是健康面：21 个测试文件全是行为级（mock XHR 打穿真实管道），bug 虽多但从不复发旧 bug

### 五、优化方向（收益/风险排序）

| # | 方向 | 定位 | 风险 |
|---|------|------|------|
| 1 | 判定逻辑单一事实源：合并 3 套语言检测为 1 套，删死代码 | 止血 | 低 |
| 2 | 豁免中央注册表：`shouldKeepSource(text, ctx)` 单出口，规则注册制 | 止血 | 低 |
| 3 | 管道阶段化 + 不变量审计：显式阶段产物，每阶段断言（无空串/无漏翻/占位符完整） | 结构改进 | 中 |
| 4 | Prompt 减肥：补救指令从主 prompt 移到重试层，主 prompt 越短首调成功率越高 | 结构改进 | 中 |
| 5 | LLM 输出 schema 化：逐条结构化输出替代 `[N] 文本` 解析，退役一批防御代码 | 结构改进 | 中高 |

**建议 1+2 捆绑做**——同是"判定逻辑分散"的两面，一起做比分开做风险小。

---

## 六、关键文件

| 文件 | 职责 |
|------|------|
| `lib/prompt-constants.ts` | 提示词常量（STYLE_GUIDES、LANG_SPECIFIC、PRODUCT_LINE_TONE_GUIDES、SCENE_CONSTRAINTS、CORE_PRINCIPLES、PROOFREAD_SYSTEM_PROMPT） |
| `lib/llm-api.ts` | LLM 调用 + 翻译/校对管道 + 重试逻辑 + v9.5 三层漏翻检测 + v9.9 术语合规校验 + v9.10 双视图分发 + v9.11 批次级标注/untranslatedIndices/最终安全网 + v10.0 re-export lang-detect（兼容层）+ v10.2 截断判定（脚本存在性）+ 子兜底守卫 + 诊断日志埋点 + **v10.4 管道阶段化(S1-S8)+auditStage 不变量审计** |
| `lib/lang-detect.ts` | v10.0 语言检测单一事实源（三套检测/词表/字符集分类/同语系对，detectSingleTextLanguage 死代码已修为委托批次级）+ **v10.2 TARGET_SCRIPT_PATTERNS** |
| `lib/keep-source.ts` | **v10.0 豁免中央注册表**（shouldKeepSource/isSameLanguageExempt，F3b 三重守卫迁入） |
| `lib/post-process.ts` | 译后处理（enforceGlossaryTerms、detectBrandInjection、restoreTrademarkSymbols、detectTranslationExpansion、cleanKey） |
| `lib/entity-masker.ts` | 实体/术语遮蔽（maskGlossaryTerms → maskEntities 顺序 v9.2） |
| `lib/glossary-filter.ts` | 术语过滤（filterRelevantGlossary、normalizeForMatch） |
| `lib/few-shot-examples.ts` | Few-shot 翻译示例（20语种 × 3 内容类型） |
| `lib/metrics.ts` | 翻译指标收集器 |
| `lib/text-normalizer.ts` | 文本预处理（Unicode NFC、全角→半角、零宽字符、↵保护） |
| `lib/default-glossary.ts` | 默认术语库（140 产品名 + 189 专属术语） |
| `lib/main.ts` | 插件主线程（扫描/appliedTexts 快照/undoAll 三方对比/selectionchange/**fixRegisterSymbolFont v9.6**） |
| `ui/App.vue` | UI 主组件（流程编排、sticky 操作区、待确认机制、busyPhase、computeUntranslatedBadge v9.5、**buildGlossaryMaps 双视图 v9.10**） |
| `ui/styles.css` | 全部样式（Apple 设计令牌、深色覆盖、.footer v9.3 恢复） |
| `ui/ui.ts` | UI 挂载入口 |
| `tests/test-untranslated-v3.ts` | **v9.5 三层漏翻检测全量回归（40 用例）** |
| `tests/test-same-script-untranslated.ts` | v9.3 同语系豁免测试矩阵（21 断言，已适配 v9.5 行为） |
| `tests/test-glossary-mask-all-langs.ts` | v9.2 术语遮蔽 20 语种回归（80 断言） |
| `tests/test-v87-plural-exemption.ts` | v8.7 单复数豁免单元测试（26 场景） |
| `tests/test-v99-glossary-all-langs.ts` | **v9.9 全语言注册 + v9.10 双视图回归（33 断言：A-E v9.9 + F-K v9.10）** |
| `tests/test-v97-empty-result.ts` | v9.7 空结果标记（9 断言） |
| `tests/test-v98-script-validation.ts` | v9.8 目标字符集校验（10 断言） |
| `tests/test-v911-non-en-source.ts` | **v9.11 非英源文漏翻闭环（21 断言：F1 标注/F2 激进指令/F3 漏翻上报/F3b 拉丁豁免）** |
| `tests/test-v100-arch-consolidation.ts` | v10.0 判定逻辑收口（21 断言：re-export 同一引用 + 死代码修复 + 注册表三重守卫） |
| `tests/test-v102-truncation-fix.ts` | **v10.2 截断误杀根治（38 断言：脚本存在性判定 + 真截断检出 + 拉丁 0.15 分支 + 20 语种一致性）** |

---

## 七、构建与测试

```bash
npm run typecheck    # tsc 双项目（plugin + UI），必须过
npm run build        # 生产构建，必须过

# 测试
npx tsx tests/test-untranslated-v3.ts           # v9.5 三层漏翻检测 40 用例
npx tsx tests/test-same-script-untranslated.ts   # v9.3 同语系豁免 21 断言
npx tsx tests/test-glossary-mask-all-langs.ts    # v9.2 术语遮蔽 80 断言
npx tsx tests/test-v87-plural-exemption.ts       # v8.7 单复数豁免 26 场景
npx tsx tests/test-v99-glossary-all-langs.ts     # v9.9+v9.10 术语库双视图 33 断言
npx tsx tests/test-v97-empty-result.ts           # v9.7 空结果标记 9 断言
npx tsx tests/test-v98-script-validation.ts      # v9.8 字符集校验 10 断言
npx tsx tests/test-v911-non-en-source.ts         # v9.11 非英源文漏翻闭环 21 断言
npx tsx tests/test-v100-arch-consolidation.ts    # v10.0 判定逻辑收口 21 断言
npx tsx tests/test-v102-truncation-fix.ts        # v10.2 截断误杀根治 38 断言
npx tsx tests/test-v103-log-persistence.ts       # v10.3 日志持久化+跨线程 22 断言
npx tsx tests/test-v104-pipeline-audit.ts        # v10.4 管道阶段化+不变量审计 17 断言
```

**铁律**：每次改代码后必须执行 `npm run typecheck` + `npm run build`。build 过 ≠ tsc 过。

---

## 八、后续建议

**短期**：
1. ~~实机验证 v10.2~~ **已通过（2026-07-31）**：pt→ja 两句温度文案正常翻译，不再标漏翻/失败。遗留可选回归（有空顺带验证）：de→de 无误报、zh-CN→zh-TW、en→拉丁、"复制日志"自动全选 fallback
2. 实机验证 v10.3/v10.4：跑一批翻译 → 诊断日志面板应看到 S1→S8 阶段轨迹 + 主线程 [main:scan]/[main:apply] 事件；关闭重开插件 → 应看到"── 恢复上次会话日志（N 条）──"分隔标记
3. 实机验证 v9.9/v9.10：pt-BR 自动检测 → ja 产品名走短路出术语库值；非电商场景营销术语不注入；校对改错术语时被合规校验拉回
4. 实机验证 v9.6：Avenir 字体的 `Lexar®` 文本，不翻译直接应用 + 字体替换后，® 是否都显示为 HarmonyOS 样式
5. ~~提交代码~~ **已提交 5df3af2 + 已推 GitHub**（v9.5-v10.2，2026-07-31）
6. ~~R7 决策~~（已拍板 2026-07-31：现状即规则——去符号匹配，®™ 由源文驱动恢复，CSV 不携带符号，无需改代码）

**架构优化（见"五点一、架构复盘"，按收益/风险排序）**：
1. ~~判定逻辑单一事实源 + 豁免中央注册表~~ **已完成 v10.0**（lib/lang-detect.ts + lib/keep-source.ts）
2. 结构改进：~~管道阶段化 + 不变量审计~~ **已完成 v10.4** → Prompt 减肥（~2600行 prompt 稀释注意力）→ LLM 输出 schema 化（退役 `[N] text` 解析防御）
3. ~~日志持久化~~ **已完成 v10.3**；剩余：⑤metrics UI 面板（finalizeMetrics 只 console.log）⑥detectTranslationExpansion 语义移交校对（v10.2 同型长度代理问题，反方向）

**中期**：
3. 指标收集器 UI 面板（当前只 console.log）
4. ~~校准 `LANG_EXPANSION_RATIO`~~（v10.2 已补全 uk/el/he 消除兜底；后续如需按实测数据微调数值再做）

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
[CHECK 1: COMPLETENESS] 不加不漏 + **截断按信息点判定不按长度**（拉丁→CJK 收缩 3-5 倍正常，v10.2）
[CHECK 2: MEANING & NATURALNESS] 事实/品类/自然度；术语库精确匹配覆盖品类词纠正
[CHECK 3: UNTRANSLATED TEXT] 相同→漏翻；例外：无动词产品名 + 跨语言同形词（v8.7）+ 简繁同形字/欧葡巴葡词汇/极短文本（v9.5）
[CHECK 4: GRAMMAR/SPELLING/PUNCTUATION]
[CHECK 5: TERMINOLOGY CONSISTENCY] 跨条目术语一致
[GLOSSARY REFERENCE] 精确匹配，不补全部分产品名
[OUTPUT FORMAT] JSON array only，reason 枚举中文
[VALIDATION: {targetLang}] 品类词对照 + quality + compliance + proofreadChecks
```

User Message：`[N] ({srcLang}→{targetLang}) source\nTrans：translation`

---

**最后更新**: 2026-07-31
