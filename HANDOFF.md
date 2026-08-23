# 项目交接文档

**日期**: 2026-08-23  
**版本**: v11.15（v11.14 自动入库守卫之上 + 实机五问题修复）  
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

**现有 prompt 各模块与六维的对应关系**（评审时对照）：一→CORE_PRINCIPLES #2 + detectBrandInjection/validateNumbers；二→IDENTITY_MISSION + LANGUAGE_MARKET_NOTES + LANG_SPECIFIC（**v11.0 起翻译与校对双端闭环**：翻译经 getStyleCard 注入分段市场语感，校对经 buildProofreadCalibration 注入同源同段白名单）；三→CATEGORY_WORDS + glossaryHint + enforceGlossaryTerms；四→PRODUCT_LINE_TONE_GUIDES + STYLE_GUIDES + SCENE_CONSTRAINTS（翻译端）；五→OUTPUT format + restoreTrademarkSymbols/capitalizeFirstLetter；六→LANG_SPECIFIC.compliance + SCENE_CONSTRAINTS.compliance_doc。

### 1.2 工作准则（协作铁律，2026-08-13 用户定）

1. **拿到需求先沟通，不动手** — 先与用户确认需求与要解决的问题；缺少信息就问，**不脑补不存在的东西**。
2. **先定根因与解法，再定执行计划** — 双方分析出根因和解决办法后，才制定执行计划、才写代码。
3. **改完必测** — 测试脚本 + `npm run typecheck` + `npm run build`（build 过 ≠ tsc 过）。
4. **想闭环** — 每次修改都要想：能否与其他功能模块闭环（不制造新的短路/豁免/兜底缺口）。

---

## 二、当前版本（v11.15）

### v11.15 实机五问题修复（2026-08-18，同形字误表/违禁词豁免/字体变大/跳过逻辑）

**背景（实机五事故）**：①「Lexar Recovery Tool 专业数据恢复（软件）」产品品类描述反复亮源文违禁词徽章（用户拍板：豁免，且 20 语种已覆盖）②「从开机第一秒到收工最后一刻」误命中广告法绝对化用语「第一」③字体映射卡手动选字体后点卡片「应用」字体变大 ④完美 zh-CN→zh-TW 译文（徹底釋放/語言）误报「翻译失败」⑤待处理面板「跳过」按钮把节点标记为"已应用"但从不写画布 → 批量应用永久跳过 → 好译文静默丢失（用户定性：违背自动化原则，会造成事故）。

**根因与修复（一问题一行）**：

| # | 问题 | 根因 | 修复 | 文件 |
|---|------|------|------|------|
| 1 | TW 译文误报翻译失败 | 简繁特征字表由词片段 split('') 建表，同形字「放」「言」混入两表（v9.5 手工清理 17 字的漏网残余）→ 含"釋放/語言"的正确繁体译文每层漏翻检测都被拒 → 全链重试后误报失败 | 两表删「放」「言」；真区分字（释/釋/语/語）仍在表，行为断言锁回归 | `lib/llm-api.ts` |
| 2 | Recovery Tool 品类描述亮徽章 | 豁免短语精确子串匹配，「专业」开在锚词中间即失效 | 豁免机制升级字符级弹性 regex（字符间 `\W*` 吞空格+中文修饰字，字母/数字是 `\w` 不被吞——放宽有界）+ 豁免表加 `'Recovery Tool 数据恢复'`（锚定产品名+品类词两端；裸"100%数据恢复"无锚仍命中）；纯中文相邻条目（最佳实践等）`\W*` 恒匹配空串 → 语义与 includes 精确剔除完全一致 | `lib/prohibited-check.ts` + `lib/prohibited-words.ts` |
| 3 | 「第一秒」误报 | 时间序数用法，豁免表漏词 | 豁免表加 `'第一秒'`（秒简繁同形，一条覆盖两形态） | `lib/prohibited-words.ts` |
| 4 | 卡片「应用」字体变大 | v7.5.9 修复（autoMapFonts 回填）的孪生缺口：`onFontSelected` 手动选字体不回填字号 → targetFontSize 0 → syncFontMappings 把 0 写回 item → APPLY_SINGLE 换字体不设字号 → MasterGo 按默认字号渲染 | A：`onFontSelected` 回填 targetFontSize/targetLineHeight/targetLetterSpacing（=源值）；B：`syncFontMappings` 兜底守卫（targetFamily 非空但属性为 0/null 时回退 item 源值）——任何路径产生的"换字体不设字号"组合都被拦截 | `ui/App.vue` |
| 5 | 「跳过」丢译文 | `skipPendingItem` 标记 appliedNodeIds 但不写画布 → 批量应用永久跳过该节点 | skipPendingItem 拆解为三个按类型的处置函数：`confirmKeepSource`（错词保留源文）/`dismissPendingItem`（知道了——清提示态+dismissedNodeIds，**不碰 appliedNodeIds**，卡片恢复可应用）/`applyWithoutGlossary`（应用但不入库）；待处理面板按类型渲染主操作（error/untranslated/placeholder→**重翻**+编辑+知道了；misspelled→确认保留源文+编辑；llmFallback→确认入库+应用但不入库+编辑；prohibitedTrans→**去校对规避**+编辑+知道了；其余→编辑+知道了）；item-actions 行条件 `!applied \|\| dismissed` 让"知道了"条目不再隐身 | `ui/App.vue` |

**译文侧 20 语种零改动**（问题①的 20 语种要求）：各语言违禁词表命中继续走 v11.12 既有"代码检测→AI 校对改写→代码回检"链，源文恒为中/英故源文侧豁免只需中文豁免表一处。

**豁免机制安全性（v11.15 新增不变量）**：`\W*` 只吞非单词字符（空格/中文修饰字），字母/数字是 `\w` 不在 `\W` 内 → "Recovery Tool 数据恢复X"（X 为字母/数字后缀）不会被错误剔除；裸功效宣称无锚不豁免（B 段防护断言锁）。

**测试**：新 `tests/test-v1115-variant-shared-chars.ts` 15/15（A 含放/言繁体词不判简体残留+双向对称/B 实机案例全文免疫/C 真漏翻仍拦/D 纯同形字句双向无证据）；`test-v1112` 追加 G 段 12 断言（Recovery Tool 三形态豁免/第一秒实机文案/裸词防护五连/既有豁免语义不变）→ 166/166。回归全绿：v105(39)/v106(46)/v107(14)/v108(21)/v109(86)/v110(91)/v111(42)/v112(48)/v113-exposed(6)/v113-fallback(18)/v114(26)/v115(41)/v117(245)/v118(45)/v119(62)/v1110(53)/v1111(22)/v1113(55)/v1114(86)。双 tsconfig typecheck + build 通过。

**回归套件环境教训**（2026-08-18，排查记录）：TS 6.x + ts-node 下历史套件全挂的三个假故障——①根 tsconfig `noUnusedLocals:true` 对 tests/ 误伤（tests 不在 include 内却沿用其 compilerOptions）②`lib:["esnext"]` 无 DOM → llm-api 的 XMLHttpRequest 类型缺失 ③TS6 rootDir 推断报错 5011。解法：TS_NODE_COMPILER_OPTIONS 显式带 `skipLibCheck+rootDir+importHelpers:false` + `TS_NODE_TRANSPILE_ONLY=true`（v1114 还需 importHelpers:false——node_modules 无 tslib）。全部历史套件实际行为全绿，无一真失败。

**实机复验清单（交用户）**：①zh-CN→zh-TW 翻"高达 1650MB/s…释放…"不再报翻译失败 ②Recovery Tool 两句文案不再亮违禁词徽章 ③字体映射卡手动选字体后点卡片「应用」字号不变 ④待处理面板按钮行为符合上表（重翻/知道了/确认保留源文/应用但不入库/去校对规避）。

---

### v11.13 第三方品牌/型号裸词豁免根治（2026-08-14，实机兼容性列表事故）

**背景（实机事故）**：用户粘贴第三方品牌/型号兼容性列表（DJI/GoPro/Nintendo/Lenovo/Logitech + Hero/Mavic/Mini/Switch 等数十型号多行混排），被标「翻译失败」「漏翻」「疑似拼写错误」或被直接翻译。用户：「这些都是品牌或者是型号…理论上他们应该是代码层面判定他不用翻译的呀」「这都是不对的」。用户委托决策：「可靠性最重要，你来决策吧」「我们有20个语言，有互翻的使用场景，请都考虑到」。

**根因（四重）**：
- **RC1 代码 bug**：`text-normalizer.ts` 在管道最前端把扫描文本 `\n` 转成 ` ↵ `（U+21B5），但 `isModelListOrCode` 只按 `/` 和 `\n` 切分、且段字符集 `/^[A-Za-z0-9\s\-*.®™©]+$/` 不含 ↵ → 多行型号列表豁免**整锅失败**（2026-08-14 实机现象主因）。
- **RC2 覆盖缺口**：裸品牌词（DJI/GoPro/Insta360/Nintendo/Lenovo/ASUS/Logitech）v11.9 刻意不收遮蔽表（宁漏勿滥），但作为独立文本节点出现时形态判定链全军覆没（isModelListOrCode 单段要数字、TITLE_CASE 要 Lexar 等级词、规则4要 ≥2 Lexar 关键词）。
- **RC3 错词误伤**：Nintendo/Lenovo/Logitech 形态上踩中 v10.6 `/^[A-Za-z]{6,}$/` 疑似错词 → 「疑似拼写错误」假阳性。
- **RC4 型号覆盖缺口**：Hero11/Hero10 Black 连写、Bones、Mavic Pro/Mini、Mini 5 Pro、Mini2、Mini 3 Pro、Avata 360、Lito 1/X1、Switch NS。

**修复（三条名单边界 + 一个切分符）**：

| # | 改动 | 文件 |
|---|------|------|
| 1 | `isModelListOrCode` 切分符补 `↵`（对齐 text-normalizer 既成事实——检测器永远见不到真换行） | `lib/llm-api.ts` |
| 2 | **遮蔽表**（`BUILTIN_THIRD_PARTY_ENTRIES`）新增：v11.13 型号（Hero11 Black/Mavic Pro/Mini 5 Pro/Mini2/Mini 3 Pro/Avata 360/Lito 1/Lito X1）+ 裸品牌词（DJI/GoPro/Insta360/Nintendo/Lenovo/ASUS/Logitech）——品牌名任何语言都不译，遮蔽即正确 | `lib/third-party-models.ts` |
| 3 | **整词豁免名单**（`BUILTIN_THIRD_PARTY_WHOLE_TEXT_TERMS`）：裸品牌词 + Bones + Hero 7 Black——整条命中即豁免（`isBuiltinThirdPartyWholeText`），但只 DJI/GoPro/Insta360/Nintendo/Lenovo/ASUS/Logitech 进遮蔽表（`MASK_ONLY_WHOLE_TEXT`）；Bones/Hero 7 Black 只豁免不进遮蔽表（无数字裸词子串风险/切碎既有 'Hero 7' 词条） | `lib/third-party-models.ts` |
| 4 | **段名单**（`BUILTIN_MODEL_SEGMENT_SET`：Mini/Switch NS）：只用于 isModelListOrCode 段判定，不豁免不进遮蔽表（无数字裸词段，切碎既有词条/过遮蔽） | `lib/third-party-models.ts` |
| 5 | 豁免/段判定查询统一走 `BUILTIN_THIRD_PARTY_ALL_KEYS`（遮蔽表 ∪ 整词豁免名单归一化 key）——「收录即钦定型号的形态认证」，与遮蔽表解耦（Bones 收录在豁免名单也能被段判定认出） | `lib/llm-api.ts` |
| 6 | `isSuspectMisspelledWord` 前置整词豁免——Nintendo/Lenovo/Logitech 不再标疑似错词 | `lib/llm-api.ts` |
| 7 | llm-api 豁免链自带内置表冗余（不依赖 UI 层注入）——用户删/换 CSV 后第三方豁免链依然完整（v11.9 内置化初衷闭环） | `lib/llm-api.ts` |

**三条名单的边界（名单即边界，改一处必须同步另一处）**：
- 只豁免+遮蔽：DJI/GoPro/Insta360/Nintendo/Lenovo/ASUS/Logitech（裸品牌，任何上下文都该保留原文）
- 只豁免不遮蔽：Bones/Hero 7 Black（无数字裸词/切碎既有词条）
- 只进段名单（不豁免不遮蔽）：Mini/Switch NS（无数字裸词段，仅在【整条全是型号段】的列表语境认段）

**遮蔽子串嵌套安全性**（20 语种互翻场景关键）：maskGlossaryTerms 按 cleanKey 长度降序 + 重叠防护，先锚长词——'GoPro Hero 13 Black' 先锚 'Hero 13 Black'，剩余 'GoPro' 再锚，不切碎；'Nintendo Switch OLED' 先锚 'Switch OLED'，剩余 'Nintendo' 再锚。裸品牌词进遮蔽表是**有意为之**（v11.9 '宁漏勿滥'针对无事故预先铺开；v11.13 这批全部实机事故驱动，品牌遮蔽"保留原文"永远正确）。

**测试**：`tests/test-v1113-brand-model-exemption.ts` 55/55（A 原稿 21 行逐条豁免含真实 ↵/B 整词豁免正反样例+段名单边界/C 疑似错词不误伤品牌+真错词仍标/D 形态负样本防回归）。回归：v119(62)/v118(45——de 视图数据源从用户 CSV 换成内置层，v11.9 内置化后 CSV 已无第三方词条)/v1112(154)/v1111(22)/v1110(53)/v106(46)/v105(39)/v99(33) 全绿。双 tsconfig typecheck + build 通过。

**GLOSSARY_VERSION 不动**（维持 6）：内置层变更不进 clientStorage，无需版本戳升级（v11.9 升 5→6 是因为 CSV 专属库 -16 行结构调整；v11.13 纯代码内置层增补）。

---

### v11.12+ 术语库最高优先级：违禁词锁定豁免（2026-08-14，v11.12 增强补丁）

**背景（用户两条拍板）**：①「终生有限质保是没问题的」——「有限终身质保」是 Limited Lifetime Warranty 官方钦定译值，被 zh 词表裸「终身质保」误伤；②「术语库是最高优先级…违禁词可以适当放松，优先级也不高，做到提示就好。你是LLM，你来决策吧，我要对整个链路太大干扰，可靠性以及翻译的流畅性」——用户委托决策。

**结构性死锁（根因）**：若对术语库锁定项照常走改写链，校对层术语合规校验会把改写结果锁回钦定值 → 回检仍命中 → 徽章永不消（改写→锁回→再命中）。必须在 LLM 调用前豁免。

**决策（用户两次委托 LLM 拍板锁定：「你是LLM，你来决策吧」→「你做决策吧」）**：
- **术语库锁定项**（源文整条命中术语库且译文==钦定值）→ **恒只提示不改写**：proofreadBatch 预豁免（进 prompt 前从 fixMap 剪除）+ UI 徽章走 `prohibitedLockedIds` 独立通道（描边徽章「⚠ 术语库违禁词」+待确认非阻塞条目），永不进改写链、永不计 `prohibitedFixedCount`。
- **非锁定项**（含 test 类）：开校对=维持 v11.12 自动改写（复用已有 LLM 调用零边际成本，回检保证徽章准确）；关校对=只提示。判定依据：用户原文「没有明确向test这种其余的看能否只提示」中「能否」是探讨语气，而「对整个链路太大干扰」是硬约束——关自动改写反而违背已验收标准 ③「翻译到目标语言自动替换违禁词」。

| # | 改动 | 文件 |
|---|------|------|
| 1 | 词表豁免 4 形态：有限终身质保/有限终身保修/有限終身保固/有限終身保修（裸「终身质保/终身保修」仍命中——豁免不放行裸承诺） | `lib/prohibited-words.ts` |
| 2 | `isGlossaryLockedTranslation(sourceText, translatedText, normalizedGlossaryMap)` 纯函数：cleanKey(源文) 查表 + 译文严格等值才判锁定；map 缺失/译文≠钦定值 → false（保守不豁免，照常进修正链） | `lib/prohibited-check.ts` |
| 3 | proofreadBatch 预豁免块（prompt 组装前）：锁定项从 fixMap 删除 → 该条不生成违禁词 note。曾误写一份「锁定后补豁免」死代码（prompt 已构建、调用方窗口已过，纯摆设），已删除——**豁免必须在 LLM 调用前** | `lib/llm-api.ts` |
| 4 | UI 双徽章通道：`routeProhibitedHits` 统一路由（锁定→prohibitedLockedIds，否则→prohibitedTransIds）；5 处徽章写入点全部走路由（翻译写回/翻译终检/校对写回/串扰回退/校对终检）；待确认面板 prohibitedLocked 非阻塞类型+横幅计数；描边徽章样式与实心区分 | `ui/App.vue` + `ui/styles.css` |

**不变量**：锁定徽章恒不计「自动规避」数；回检干净时双 map 同清（trans 侧删才计数++）；回退恢复译文时按恢复后文本重新路由到对应 map。

**测试**：F 段 18 断言（F1-F4 豁免四形态/F5-F7 裸词仍命中+混合/F8-F13 锁定判定六场景/F14-F15 预豁免请求体零 note+fixMap 清空/F16-F18 混合批次分段断言+自由发挥不豁免）。**测试教训**：按译文文本+定长窗口定位 note 会「出血」——锁定项无 note 后，[2] 的 note 落在 [1] 译文 200 字符内；正确做法是按 `[n]` 条目标题切分段落断言。全套 154/154 绿；tsc --noEmit + build 通过。

---

### v11.12 电商平台违禁词检测与规避（2026-08-14，六维之六「合规」落地）

**背景**：产品图文案上传电商平台受违禁词硬规则约束——中文上京东（广告法绝对化用语/虚假承诺/无据功效）、英文及小语种上各国亚马逊站点（test 已确认为真实拦截词）。文案侧难免有漏（→源文提醒），翻译侧可能把安全源文译成目标语违禁词（de `beste`/`Test`——→校对改写）。

**需求锁定**（用户三条验收标准，逐字）：覆盖 20 个语种；原文遇违禁词有提醒；翻译到目标语言自动替换违禁词。

**方案**（用户拍板：翻译提示词不变；可靠性第一/少操作充分自动化；代码管形式 LLM 管语义）：
**代码检测 → AI 校对语义改写 → 代码回检**（与 v9.5 三层漏翻/v10.6 错词同构）。修正绑定校对开关：开=全自动闭环，关=只检测+提醒零 LLM 成本。源文/译文两类违禁词均**非阻塞**（平台风险≠翻译错误）。

| # | 改动 | 文件 |
|---|------|------|
| 1 | 词表数据层：PROHIBITED_ZH（京东/广告法）+豁免短语表（最佳实践/最高可达不误报）+PROHIBITED_AVOID 20 语种与 LANGUAGES 严格对表。收录原则：只收消费电子/存储行业相关、宁漏勿滥 | `lib/prohibited-words.ts`（新增） |
| 2 | 检测器纯函数：拉丁/西里尔词边界正则（i flag，**无 g flag** 防 lastIndex 污染）；CJK/泰/阿拉伯子串；符号词 100%/#1 数字端 `(?<!\d)` 防 1100% 误伤；复合词 `\s+` 弹性；zh 先剔豁免再匹配；重叠取最长。detectSourceLangForProhibited 自实现（CJK 优先——detectSourceLanguage 一票制会把"中文+英文型号"混排误判 en） | `lib/prohibited-check.ts`（新增） |
| 3 | proofreadBatch 第 10 参 prohibitedFixMap（Map 非 Set——语义改写必须列具体词）；per-item note 祈使句防 LLM 复述违禁词；buildProofreadSystemPrompt 条件注入 PROOFREAD_PROHIBITED_NOTE 全局块（不传时逐字节不变，快照锁） | `lib/llm-api.ts` + `lib/prompt-constants.ts` |
| 4 | UI：SCAN_RESULT 源文检测徽章；翻译写回处（缓存命中与 API 返回汇流点，v10.7 缓存旧译文也抓得到）+四个旁路（手改/恢复校对/CSV导入/单条重翻）全检测只提醒；两处校对链 fixMap+写回处回检（干净删徽章+计数，仍命中留徽章）；待确认面板 prohibitedSrc/prohibitedTrans 非阻塞；**enableProofread 默认值翻 true+一次性迁移**（proofreadDefaultMigrated 标记存 settings 内，防反复覆盖后续手动关闭） | `ui/App.vue` + `ui/styles.css` |

**用户拍板决策**：①旁路译文全检测+只提醒 ②中文配豁免短语表 ③校对默认值翻转+老用户迁移一次 ④重扫已翻译稿自动校对维持现状。**增补轮（08-14）**：⑤时效促销词收录（营销图会写促销文案——en new arrival/on sale/clearance/free gift 等 + zh 限时秒杀/清仓甩卖）⑥欧盟环保词只收 eco-friendly 系（durable/long lasting 条件性违规代码判不了不收）。

**收录红线（宁漏勿滥）**：竞品品牌名对比/诱导评价/站外引流/隐私间谍词/正品声称词不收（文案从不写，属侵权/运营违规非词表问题）；有合法语义的普通词不收（es prueba：a prueba de agua=防水规格必误报；en free/heal/new 同理）。

**修复的实现 bug（测试推理抓出）**：compileEntry 原分支条件把纯符号词（100%/#1）路由到纯 indexOf 子串分支，文档承诺的 `(?<!\d)` 数字端防护（防 1100% 误伤）形同虚设。改为唯一条件 `!SUBSTRING_SCRIPT_RE.test(word)`。**教训：文档写的设计≠实现，写完测试后先推理一遍实现再跑。**

**测试**：`tests/test-v1112-prohibited-words.ts` 154 通过（A 词表对表 20 语种+增补收录/B 检测单元 59 含 g-flag 回归锁+增补命中与误伤防护/C 校对端到端 16/D 关校对快照锁 7/E 源语言判定 7/F v11.12+ 术语库最高优先级 18）。回归：v119(62)/v117(245)/v1111(22)/mask-all-langs(80)/repro-mask-hang/v99(33)/v104(17)/v105(39)/v107(14)/v911(21)/v1110(43) 全绿；v118 维持 28 个文档化时间点预期失败。双 tsconfig typecheck + build 过。

**Windows 环境教训**：Edit 工具经 GBK 控制台会损毁越南语变音符——非 ASCII 外科手术一律 `python -X utf8` 文件操作；批量替换编号断言注意防塌缩（降序替换会把已变的再变一次，用正则回调计数器）。

---

## 二点四、上一版本（v11.9）

### v11.9 第三方型号内置化 + 术语库合并升级（2026-08-13，v11.8 结构性风险收口）

**背景（v11.8 留下的结构风险）**：v11.8 把第三方型号保护做成术语库 CSV 的 16 条 identity 行——防线有效，但**承重墙放错了位置**：术语库 CSV 是用户可替换/可精简的数据，用户一旦更新术语库（删第三方词条保持"纯 Lexar"），S1 短路 / S2 遮蔽 / 漏翻豁免三层防线**静默失效**，且无任何告警。用户决策："第三方品牌内置到代码里，后续术语库更新更纯粹"——按推荐方案 B 实施（内置 = 16 事故词条 + 高频兼容场景型号预先收录；UI 加只读展示区）。

**方案（四层改动）**：

| # | 改动 | 文件 |
|---|------|------|
| 1 | **第三方词条下沉代码内置层**：`BUILTIN_THIRD_PARTY_ENTRIES`（119 条 = 16 事故词条 + 103 高频型号：iPhone 15-17 系/iPad/MacBook/AirPods Pro、Galaxy S23-S25/Z Fold/Flip/Tab/Buds、DJI Osmo/Mavic/Mini/Air/RS/Inspire/Mic、GoPro/Insta360、Sony A7/ZV/WH-1000XM5、Canon EOS R/Nikon Z、Logitech MX/G PRO、Razer、Keychron、Switch）。identity 语义用通配键 `translations['*']` 表达（免 20 列 CSV 运行时解析）——`{source, translations: {'*': source}}` | `lib/third-party-models.ts`（新增） |
| 2 | **buildGlossaryMaps 三方合并**：内置第三方 ∪ 用户产品名 ∪ 用户专属；内置**先于**用户词条注册（Map first-wins = 撞 key 内置胜出）。内置只进内存、不进 clientStorage——用户删/换 CSV 不再削弱防线（兜底核心）。**行为变化**：此前用户库同 key 后写覆盖先写，现 first-wins——双库内部 source 唯一无影响；跨库同 key 现产品名库优先（products 在前，合理） | `ui/App.vue` buildGlossaryMaps |
| 3 | **专属 CSV 纯化**：删除 16 行第三方 identity 词条（205→189），重跑 merge 重新生成 default-glossary.ts；GLOSSARY_VERSION 5→6。此后版本号只管用户双库，内置层随代码发布 | `术语素材/Lexar术语库_专属.csv` + `lib/default-glossary.ts` + `lib/constants.ts` |
| 4 | **合并升级取代整体覆盖**（v11.8 升级警告的根治）：版本升级时默认词条优先 + 用户自定义词条按 `source.trim().toLowerCase()` diff 保留追加；**版本戳写回**——修复 v11.8 及以前「升级分支从不写回 STORAGE_KEY_GLOSSARY_VERSION → 每次启动重复走升级」的既有 bug。抽 `lib/glossary-store.ts` 纯函数（loadGlossaryWithMerge / saveGlossaryWithVersion / mergeGlossaryOnUpgrade），插件线程与 UI save 封装双端委托，保证戳与内容永不失配 | `lib/glossary-store.ts`（新增）+ `lib/main.ts` |

**UI**：术语库面板新增第三个只读灰化子块「内置·第三方型号（N 条）」（词条列表可滚动审计）；section-count 含内置数；hint 补"内置第三方型号由代码保护，不受替换影响"。

**收录红线（宁漏勿滥）**：只收具体型号形态（多词+数字/专有 token）；裸词仅已发生事故的 Steam（同 PLAY/Honor 先例）。初版曾误收裸词 Flip/Neo，被测试 A4 断言（高危裸词清单）当场抓出删除——**遮蔽是子串匹配，裸词 = 大面积过遮蔽**。`GoPro MAX` 这类型号化用法保留（大写占比+数字类形态同 v10.5 判定直觉）。

**测试**：`tests/test-v119-builtin-third-party.ts` 58/58（A 内置完整性 5：含裸词红线断言；B CSV 纯化 2；C 合并优先级 3：用户库恶意冲突值被内置压制；D 三层防线全走内置层 24：豁免/遮蔽往返/长度优先/S1 短路 E2E；E 合并升级 12：自定义保留/同 key 覆盖/normKey/版本戳写回/启动幂等/空存量回落/save 写戳；F 回归 2）。回归：v10.5 39/39、v9.9+v9.10 33/33、mask-all-langs 80/80、v10.7 14/14、v11.7 245/245 全绿；typecheck 双配置 + build 通过。

**时点测试失效说明**：`tests/test-v118-third-party-model-names.ts` A/B/C 段依赖"16 词条在专属 CSV"的 v11.8 时点数据，v11.9 纯化后整体失效（28 处）——文件头已加演进注释，三层防线现行回归以 v11.9 测试 D 段为准；v118 的 D/E 段（不依赖 CSV 词条位置）仍有效。

---

## 二点五、历史版本（v11.8 及以前）

### v11.8 第三方型号/设备名保护（2026-08-13，实机 en→de 事故根治）

**背景（实机 bug，20 语种通病，非德语独有）**：第三方品牌设备/型号名被 LLM 加戏或直译——"Luna Ultra"→"Kameramodell: Luna Ultra"；"Pocket 4P / ... / Action 6"→"Kameramodelle: ..."；"Mavic 4 Pro / Mavic 3 / Mavic 2 Pro"→"Drohnenmodelle: ..."；"Antigravity A1"→"Drohne Antigravity A1"；"Osmo 360"→"Kamera Osmo 360"；"Legion Go"/"Steam Deck"/"ROG ALLY"/"G Cloud"→"Handheld-Konsole ..."；bare "Steam"→"Dampf"。用户定调：**产品型号不应被翻译**，20 语种同规则。

**三条独立根因**：
- **A. isModelListOrCode 结构性豁免不了无数字纯文本型号**（Mavic 3 大写占比 1/5 等全不命中，只有 ROG ALLY 全大写命中）——无形式特征可抓。
- **B. v10.5 豁免只是漏翻判定层**：不遮蔽、不进 prompt；LLM 加戏后译文≠源文 → 漏翻检测不触发 → 豁免防重试 → 加戏译文干净落地。
- **C. LEAN prompt 原则 1 只举 Lexar 型号例**，无第三方判定标准 → LLM 行为漂移。

**方案（零检测/豁免代码改动 + 一处遮蔽层 bug 修复）**：

| # | 改动 | 文件 |
|---|------|------|
| 1 | **词表 identity 行 ×16**（src===target 21 列全同形）一石三鸟：S1 整条短路 + S2 译中遮蔽（`__GLOSSARY_N__`）+ 漏翻豁免（isUntranslatable 规则1/lemma）。词条：Steam Deck、Legion Go、ROG ALLY、G Cloud、Osmo 360、Antigravity A1、Luna Ultra、Pocket 4P、Pocket 4、Pocket 3、Pocket 2、Action 6、Mavic 4 Pro、Mavic 3、Mavic 2 Pro、Steam | `术语素材/Lexar术语库_专属.csv`（189→205）+ merge 重新生成 `lib/default-glossary.ts` |
| 2 | **prompt LEAN/LEAN_ZH 原则 1 各 +1 句**：第三方设备/型号名同样属于型号，原样保留，不得在其前添加品类词或前缀（"Kameramodell:"/"Drohne"/"Handheld-Konsole" 等反例）——承载残余缺口：遮蔽防"词条被改"不防"占位符前加前缀" | `lib/prompt-constants.ts` |
| 3 | **GLOSSARY_VERSION 4→5** 存量静默升级 | `lib/constants.ts:29` |
| 4 | **maskGlossaryTerms 位置漂移 bug 修复**（潜在既有 bug，由列表形态 identity 词条暴露）：占位符替换使 cleanKey 空间收缩慢于原文空间（9 字符术语→14 字符 `__GLOSSARY_0__`，cleanKey 后仅 10 字符），连续遮蔽列表第 3 个起 offset 期望位置超前实测 Δ=−9 > 容差 5 → 正则候选全被拒 → 术语静默漏遮蔽漏翻。修复 = 懒惰重匹配：`!found` 时在当前 cleanKey 空间**向后**重定位该术语（向后=防误锚已遮蔽前缀造成无限循环），命中则把漂移吸收进 offset 并重锚期望原点后重试一次（`mi--`）。v7.5.1 预遮蔽场景行为不变（indexOf 找不到掩码内术语明文，落到原有 stillExists 分支） | `lib/entity-masker.ts` maskGlossaryTerms |

**取舍与护栏**：bare "Steam" 收录理由 = 已发生实机事故（→Dampf），且 PLAY/Rode/Honor 裸词行同型风险已被项目接受；长度降序保证 "Steam Deck" 先匹配不被切；不收 bare Pocket/Action/Legion/Luna/Go（高频普通词=大面积过遮蔽，宁漏勿滥）；不改 isModelListOrCode/PRODUCT_CODE_RE（放宽阈值会把 "Ultra HD" 类描述短语误判为型号）。

**⚠️ 升级警告（GLOSSARY_VERSION 4→5）**：首次启动会**整体覆盖** clientStorage 术语库（含产品名库）——用户在 UI 里手动添加/修改过的自定义词条会被冲掉。同 v4 升级的既有行为。升级前若有自定义词条请先导出备份，升级后再导入。

**测试**：`tests/test-v118-third-party-model-names.ts` 46/46（A 豁免 21 断言：16 词条+lemma 复数+3 反样例；B 遮蔽往返 12：双词嵌入/长度优先/Pocket 列表 5 占位符/同词两处独立遮蔽；C S1 短路 E2E 6：identity 行原文落地、零重试、零漏翻、真实句照翻；D 回归护栏 3；E prompt 断言 2）；回归 v10.5 39/39、v9.9+v9.10 33/33、mask-all-langs 80/80（4 场景×20 语种——entity-masker 改动关键回归面）；typecheck 双配置 + build 通过。

---

## 二点五、历史版本（v11.7 及以前）

### v11.7 品类词 3 源统一为 CATEGORY_WORDS 单一事实源（2026-08-05，v11.4 遗留收口）

**背景**：v11.4 修复 detectCategory 大小写敏感时，发现代码库存在多个品类词数据源各自漂移。本次统一剩余 3 个"值漂移"源：

| # | 源 | 职责 | 统一前问题 |
|---|---|---|---|
| ① | `prompt-constants.CATEGORY_WORDS` | prompt 品类词对照表（注入 LANG_SPECIFIC） | 无 en 列 |
| ② | `product-name-generator.CATEGORY_TRANSLATIONS` | 产品名 20 语种生成 | 本地副本，与 ① 50 处值漂移（en 列缺失 + 7 条译法不同） |
| ③ | `glossary-filter.isCategoryWord` | 品类词豁免（不重复注入） | 硬编码 19 词含 **7 个幽灵词**（SDXC Card/microSDXC Card/CFexpress Card/CompactFlash Card/Card Reader/Memory Card/USB Stick——从未在术语库出现，占位无匹配） |

**方案**（单一事实源 +  override 模式）：
- `CATEGORY_WORDS` 升级为 `CategoryWordEntry`：含全部 20 语言（新增 en 列）+ 可选 `productName` override 字段——产品名生成译法与 prompt 对照译法不同的词条（7 条：SSD ru/vi、Desktop Memory zh-CN、Flash Drive ja/ko、Dual Drive 全语种、Solid State Dual Drive 拉丁语系 15 语种）
- ② 删本地 `CATEGORY_TRANSLATIONS`，改 `categoryTranslation()` 从 `CATEGORY_WORDS` 派生（override 优先）
- ③ `isCategoryWord` 从 `Object.keys(CATEGORY_WORDS)` 派生（11 词），幽灵词剔除
- `buildCategoryTerminology` 排除 `productName` 字段（Record 类型不外泄到 prompt 对照表）

**关键设计决策**：Desktop Memory zh-CN override = `台式电脑内存`（非 `台式机内存条`）——与术语库 CSV 全 12 条台式内存一致；prompt 对照保留 `台式机内存条`（注入 LANG_SPECIFIC 用），两者职责不同故并存。

**测试**：`tests/test-v117-category-unify.ts` 244/244（A 结构 223 + B 生成保真 10 + C prompt 纯净 7 + D 派生 3 + E CSV 一致性 2——B 断言 override 命中=删前 generator 值，防"统一=改值"）；全量回归 17 文件全绿（v9.9-v11.5 共 609 断言）；typecheck 双配置 + build 通过。

**收益**：新增品类词只改 `CATEGORY_WORDS` 一处；幽灵词豁免消除（若 `SDXC Card` 未来进术语库会被正常注入而非误豁免）；v11.4"5 源不一致"结构坑收口。

---

### v11.5 Prompt 减肥——补救指令移到重试层（2026-08-05，架构复盘方向 #4 落地）

**背景**：架构复盘（arch-review-2026-07）指出 prompt 存在**正反馈循环**：prompt 越长 → 模型注意力稀释 → 首调失败率升 → 加代码防线/加 prompt 补救条款 → prompt 更长。v9.x-v11.x 每个版本的实机事故都以"往 prompt 塞一条修复条款"止血，首调全程背负所有历史事故的补救文本（实测 CORE_PRINCIPLES 25 行中 11 行是⛔补救 + BRAND ~500 字符 + commonErrors 5-8 行 ≈ 30%）。

**方案**（四层：瘦身 → 按需注入 → 重试瘦身 → 校对瘦身）：

| # | 改动 | 位置 | 要点 |
|---|------|------|------|
| 1 | CORE_PRINCIPLES 拆 LEAN + REMEDIATION | prompt-constants.ts | LEAN（三原则主干+占位符保留——结构性要求不搬）首调保留；REMEDIATION（⛔补全产品名+⛔品类精度+⛔错词 7 行）重试层注入；旧常量=组合形式（兼容引用点零回归） |
| 2 | BRAND 段移出首调 | llm-api.ts buildSystemPrompt | 新增 `includeRemediation` 参数，首调不传 → 省 ~500 字符；安全依据：术语遮蔽+enforceGlossaryTerms+校对 CHECK 2 三重兜底 |
| 3 | commonErrors 条件注入 | renderLangForTranslate | 新增 `includeCommonErrors` 参数（默认 true 兼容）；首调传 false——常见错误对照表是补救型历史事故表，重试时拿着对照表才有针对性；rules/compliance 保留首调 |
| 4 | 统一重试瘦身 + 全量补救 | llm-api.ts forceTranslate 分支 | 不再"首调全文+[RETRY] 追加"（~95行最重），改"精简骨架（无 styleCard/fewShot）+ 补救全量回归（BRAND/补全/品类精度/错词/commonErrors）"（~40行，减60%+） |
| 5 | 校对 VARIANT_CHECKS + EXPANSION_NOTE 条件化 | prompt-constants.ts + buildProofreadSystemPrompt | 变体专项检查仅 zh-CN↔zh-TW/pt↔pt-BR 变体对注入（其余语种省 10 行死文本）；超长提示仅 expansionFlags 非空时注入（v10.8 先例上移到 system prompt 层） |

**效果**：首调 core+brand 从 2175 字符减到 1008 字符（**-54%**）；首调整体（含 commonErrors）减 25-35%；统一重试 prompt 减 60%+。

**关键架构观察**：激进重试已是 7 行精简 prompt（llm-api.ts:1341+）且工作良好——"重试用瘦身 prompt"有工程先例；本次把同样思路推广到统一重试层，并按需注入补救条款实现"按需补救"而非"全程背负"。

**测试**：`tests/test-v115-prompt-diet.ts` 41/41（A 首调瘦身 17 断言含 **20 语种全覆盖** rules 保留/commonErrors 剔除/重试回归 + B 重试补救回归 6 + C 校对条件注入 11 + D 规模回归 2 + E 旧常量兼容 5）；全量回归 15 文件全绿（v9.9+v9.10 33 + v10.0 21 + v10.2 38 + v10.3 22 + v10.4 17 + v10.5 39 + v10.6 46 + v10.7 14 + v10.8 21 + v10.9 86 + v11.0 91 + v11.1 42 + v11.2 48 + v11.3 18 + v11.4 26）；typecheck 双配置 + build 通过。

**已知遗留（诚实声明）**：首调成功率升/降**无法单元测试闭环验证**——只能实机跑量观察首调漏翻率/待确认率（v10.3 日志持久化已具备观测能力）；若某语种（如 zh-TW 同语系场景）首调品牌直译率明显上升，可单语种把 BRAND 段加回首调（粒度可控）。OUTPUT 段 ↵/引号 4 行未搬（收益/风险比不划算）；prompt 模块化注册表（数据表懒加载）留待后续。

**实机验证（2026-08-05，已通过）**：`tests/test-v115-live-translation.ts`（gpt-5.5 真实 API + 真实术语库 140 条 + 真实 CSV 素材）两条产品线 27 格 × 4 语种（zh-CN/zh-TW/ja/de）全管道：首调异常 0、漏翻 0、品牌直译 0、占位符残留 0。PLAY PRO microSD 12 格全绿；NM1090 PRO 15 格抓到 2 个非 v11.5 问题（见 v11.6）。

---

### v11.6 术语库差异提示（2026-08-05，实机测试发现的 UX 盲区修复）

**背景**：NM1090 PRO 实机测试中，`Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD` 被标"疑似拼写错误"——但译文**正确**（=术语库官方 zh-CN 值 `...PCIe Gen5X4 NVMe固态硬盘`，术语库有意本地化改写写法）。用户看到"疑似拼写错误，请核对源稿"会误以为源稿有错，实际是术语库差异。

**修复**（UI 提示层，不动 v10.6 判定器）：
- `isGlossaryDivergedItem`（App.vue）：源文含术语库 key（≥12 字符产品名级）+ 译文含对应值 + key≠value → 新增 `glossaryDiverged` 待确认类型
- 橙色非阻塞提示"术语库差异提示（译文与源文写法不同，来自术语库官方值）"，不阻塞批量应用（hasPendingBlockingIssue 排除），排 pendingItems 最末（优先级最低不遮挡真问题）
- 条目弱化为 75% 不透明度（非阻塞观感）

**不改 v10.6 判定器的理由**：`isSuspectMisspelledWord` 在 lib/llm-api.ts（管道层），UI 的 glossaryMap 在 App.vue——管道层豁免需要传入"该条被术语库校准"的上下文，跨层传参复杂；且该条目确实值得用户知晓（术语库值与源文写法不同），只是"疑似拼写错误"的措辞不对。UI 层提示既保留信息又消除误导。

**实机测试另一发现（已确认非 bug）**：源文 `Microsoft DirectStorage3` 是**源稿真实笔误**（产品名是 DirectStorage，"3"是源文自带），我方译文忠实保留——不是 LLM 加戏。

---

### v11.5-followup 20 语种全量实机验证（2026-08-05，v11.5 唯一未闭环假设验证通过）

**背景**：v11.5 已知遗留"首调成功率升/降无法单元测试闭环验证"，此前仅 zh-CN/zh-TW/ja/de 4 语种实机。本次把 `test-v115-live-translation.ts` 扩展到 20 语种能力并跑完剩余 15 个语种（en→en 同语言管道非验证对象跳过）。

**脚本扩展**（`tests/test-v115-live-translation.ts`，新增 `--strict` 与 `--concurrency N`）：
- brand 检测全语种化：zh-CN/zh-TW/ja 保留官方同形 pattern（專業級/プロフェッショナル）；**ko/ru/th/ar 等非拉丁语种无官方同形 pattern**（这些语言 "Professional" 保留英文是术语库官方行为），strict 模式下逐条标注"⚠无检测pattern，0≠无问题"（诚实声明检测盲区）
- 拉丁语系→拉丁语系新增"疑似整行未翻"检测：沿用 v10.6 判定器精神降噪——短行（<15 token）/含数字（规格行）/术语库覆盖（isGlossaryCoveredInTest 同逻辑）豁免，只标记长营销行整行未翻
- en 自动跳过；`--concurrency N` 语种级并行（N=4 实测 15 语种 ~7 分钟）

**结果（NM1090 PRO 15 格 × 15 语种 = 225 次首调，加此前 4 语种合计 20 语种 300 次首调）**：

| 指标 | 15 语种合计 | 说明 |
|---|---|---|
| 首调异常 | **0** | v11.5 减肥后 20 语种首调可靠性实证 |
| 漏翻（最终） | **0** | |
| 品牌直译 | **0** | ko/ru/th/ar 为人工抽查产品名条目确认（术语库官方值原样保留） |
| 占位符残留 | **0** | |
| 与源文相同 | **0** | |
| 疑似整行未翻（拉丁语系新检测） | **0** | 降噪设计零误报 |
| 校对修改 | 36 条 / 225 格（16%） | fr 6 / th 5 / nl 4 / pl 4 / pt 3 / ru 3 / id 3 / ar 3 / ko 2 / es 2 / tr 2 / it 1 / vi 1 / sv 0 / pt-BR 0 |

**校对修改性质抽查**（确认真修正非误改）：fr 数字千分位空格（14 000 Mo/s）+% 前空格（200 %）+ TB→To 法语单位——真本地化修正；nl 单位与数字间空格（4TB→4 TB）——真书写规范修正；th 标点 3/5——泰文标点规范。**校对闭环在 15 个新语种全部正常工作，无误改迹象**。

**已知噪声（非 bug）**：ru 2 条"疑似错词"标记——误报（Кэш DRAM/6-нм контроллер 是俄语正确写法，拉丁技术词混入西里尔文本触发 v10.6 启发式；与 NM1090 PRO 此前"术语库差异"同型：判定器形式信号 vs 术语/语言现实的落差，UI 层 v11.6 提示已覆盖类似场景）。

**结论**：v11.5 Prompt 减肥在 **20 语种全量**下无质量回退——首调异常 0/300。唯一未实机验证假设闭环。剩余检测盲区（诚实声明）：ko/ru/th/ar 品牌直译无形式检测手段（依赖术语库遮蔽+人工抽查）；非拉丁语种的"整行未翻"无对应检测（拉丁语系专属启发式）。

---

### v11.4 产品名检测大小写形态统一修复（2026-08-05，根因修复：detectCategory 大小写敏感 + 系列名 camelCase 形态）

**背景**：用户指出 nCard 已停产，单纯为 nCARD 打补丁没有意义——要找"这类问题"的根因。探索发现代码库 **5 个品类词数据源大小写策略不一致**，`detectCategory` 是唯一大小写敏感的匹配（其余全是 cleanKey 归一化或 `/i` flag），系列名首字母大写规则拒绝品牌 camelCase 形态（nCARD/eSeries）。这是形态判定的系统性盲区：CSV 140 条仅 1 条小写品类词（nCARD，Huawei 合作品牌遗留），但**未来新品/设计稿手写变体**（`Lexar NQ790 ssd`）同类问题必然重现。

**根因（三个耦合缺陷）**：
1. `detectCategory` 大小写敏感（product-name-generator.ts 无 `i` flag）——小写 `card` 不匹配 `\bCard\b` → 品类指纹门失败 → v11.2 代码检测 + v11.3 LLM 兜底双跳过
2. 同文件 core-strip 正则继承同样缺陷——只修检测不修剥离会导致译名重复品类词
3. 系列名首字母大写规则（new-product-detect.ts `/^[A-Z]/`）——`nCARD` 小写 `n` 被拒

**修复**（用户拍板：极小改动 + 品名语境守卫防误伤）：

| # | 改动 | 位置 | 要点 |
|---|------|------|------|
| 1 | `detectCategory` 双遍匹配 | product-name-generator.ts | 第一遍官方写法精确匹配**直通**（既有行为零变化）；第二遍大小写不敏感匹配 + **品名语境守卫**（命中须在文本结尾 + 前一 token 含大写/数字）——`Insert card into slot`（card 在句中）/ `card reader`（双词连用）不误伤 |
| 2 | core-strip 正则 i flag | product-name-generator.ts | 剥掉源文实际写法的小写品类词，防译名重复（"Lexar nCARD NM card 存储卡"） |
| 3 | 系列名允许 camelCase 品牌形态 | new-product-detect.ts | `/^[a-z][A-Z]/`（nCARD/eSeries——小写首字母+大写第二字母是商标形态）；`pro`/`fast` 全小写普通词仍被拒 |

**守卫设计**（v11.4 核心决策）：大小写不一致命中时（源文 `card` vs canonical `Card`），要求 ①品类词是文本最后一个词（CSV 140 条实证品类词恒结尾）②前一 token 含大写字母或数字（品名形态信号：Lexar/系列/型号/规格必含）。官方写法命中（完全一致）直通无守卫——**既有 140 条 + v11.2/v11.3 全部用例零影响**。

**测试**：`tests/test-v114-case-insensitive-category.ts` 26/26（A detectCategory 8 + B core-strip 3 + C camelCase 5 + D nCARD 端到端 4 + E 回归 6）；v113 两测试文件同步更新（nCARD 断言从"裸奔"翻转为"已检出"）；全量回归 12 文件全绿；typecheck 双配置 + build 通过（dist/index.html 725.36 KiB / main.js 289.61 KiB）。

**已知遗留（诚实声明）**：`Lexar E300 ssd enclosure` 这类"混合大小写双品类词连用"形态守卫 1 拦截（大小写命中不在结尾）——该形态既非官方写法也非品名形态，走正常翻译可接受；5 个品类词数据源统一（结构性改进）留待后续。

---

### v11.3 LLM 兜底产品名检测（2026-08-05，代码判定失败时 LLM 解析兜底 + 待确认入库）

**背景**：v11.2/v11.2.1 纯代码判定能覆盖绝大多数产品名形态，但真实新品 `Lexar SUPER PCIe Gen5x4 NVMe SSD` 被 `DESCRIPTIVE_WORDS`（防 "Lexar Fast" 误保护的营销词表）误杀——SUPER 恰好是合法的系列名。这类"营销词 vs 系列名"的判定本质需要语义理解，代码用静态词表必然有边界。

**用户决策**（2026-08-05）：你是 LLM，按你的理解来，我们要的是**可靠性**。

**方案**（三层架构，代码与 LLM 各司其职）：

```
第一层：代码检测（v11.2 不变）—— 五门判定，零误判
        ↓ 判定失败（parseProductName valid:false）
第二层：LLM 兜底（v11.3 新增）—— 语义解析"是不是产品名？系列名是什么？"
        ↓ 结构化 JSON 输出 → 代码形式校验 → 代码渲染 20 语种
第三层：人工确认（v8.9 pendingItems）—— 不静默入库，待确认后显式入库
```

**核心原则**：LLM 输出**结构化 JSON**（isProductName/series/model），**不输出译名**——译名由代码渲染（五槽位+语序模板+品类译法表），保证 20 语种风格统一。

**三重收窄触发条件**（`detectFallbackCandidates`，可靠性优先）：
1. **强锚点**：含 `Lexar®`（® 是"完整产品名"强信号，设计稿常态写法）
2. **品类指纹**：`detectCategory ≠ null`（规则文档严格界定的 11 个核心品类词）
3. **代码判定失败**：`parseProductName` 返回 null 或 valid:false

**不触发**（保持现状，不放宽）：
- 无 Lexar® 锚点（纯系列名如 "MUSE Portable SSD"）→ 人工确认通道
- 未知品类词（"Memory Stick" 不在 11 词表）→ 人工确认通道
- parseProductName 成功（正常检出路径已覆盖）

**LLM 解析**（`parseProductNameWithLLM`）：
- **双 prompt**（EN/ZH 按指令语言路由）：`PRODUCT_NAME_PARSE_PROMPT` / `PRODUCT_NAME_PARSE_PROMPT_ZH`——ROLE 是 Lexar 产品名分析器，RULES 明确"系列名（THOR/ARES/PLAY/MUSE/SUPER/VELOCIS）是专有名词不翻译；描述词（Fast/High/Speed）不是系列名"
- **结构化 JSON 输出**：`{"isProductName":boolean,"series":string,"model":string}`，temperature=0.1
- **代码形式校验**（防 LLM 编造）：
  1. isProductName 必须是 boolean（防解析失败）
  2. series 必须是源文子串或空串（防 LLM 编造不存在的系列名）
  3. model 必须是源文子串或空串（防 LLM 编造型号）
  4. series 不在 DESCRIPTIVE_CHECK 集合（fast/high/speed/new/ultra-fast/ultrafast——防 LLM 把描述词判为系列名）
  - 任何校验失败或异常 → 返回 null（放弃保护，走正常管道）

**入库策略**（v10.7 教训：LLM 参与的产物走显式通道）：
- **不静默入库**：LLM 判定为产品名后，生成 20 语种译名 → 当前目标语种并入 glossaryMap（S1 短路当前批次）+ 写入 `llmFallbackTerms` 待确认集合 → UI 显示"新品名待确认（LLM 辅助识别）"→ 用户点击"确认入库"后才写入 glossaryExclusive
- **放弃保护**：LLM 判 isProductName=false 或校验失败 → 日志记录"放弃保护，走正常管道"→ 不标记待确认（让 LLM 正常翻译/校对处理）

**改动**：

| 文件 | 改动 |
|---|---|
| `lib/prompt-constants.ts` | 新增 `PRODUCT_NAME_PARSE_PROMPT` / `PRODUCT_NAME_PARSE_PROMPT_ZH`（含 5 个示例，关键对比：SUPER→true vs Fast→false） |
| `lib/new-product-detect.ts` | 新增 `detectFallbackCandidates`（三重收窄触发 + 新颖性门） |
| `lib/llm-api.ts` | 新增 `parseProductNameWithLLM`（LLM 解析 + 四重代码校验 + 异常兜底返回 null） |
| `ui/App.vue` | startTranslate 集成第二层兜底 + `llmFallbackTerms` ref + `confirmLlmFallbackTerm` 显式入库 + pendingItems 新增 `llmFallback` 类型（最先检查） + skipPendingItem/retranslateSingle 清理 |
| `ui/styles.css` | `.llm-fallback-tag` + `.pending-item.llmFallback` 样式（蓝色边框 #007aff，与错误红/漏翻黄/校对绿区分） |

**核心语义验证**（`tests/test-v113-llm-fallback.ts` 18/18）：
- **A 组（7 断言）触发条件**：SUPER 触发 / MUSE 不触发（代码已检出）/ 无 Lexar® 不触发 / 未知品类词不触发 / 已收录不触发 / 营销文案不触发 / 无品类词不触发
- **B 组（2 断言）校验逻辑**：parseProductNameWithLLM 函数存在 + 校验在函数内部（需集成测试）
- **C 组（4 断言）端到端**：
  - C1 SUPER：触发兜底 → 代码渲染 fr `SSD Lexar SUPER PCIe Gen5x4 NVMe` / zh-CN `Lexar SUPER PCIe Gen5x4 NVMe 固态硬盘`
  - C2 Fast：触发兜底（代码判描述词失败）→ LLM 应判 isProductName=false → 放弃保护（集成测试覆盖）
  - C3 nCARD：不触发兜底（detectCategory 不识别小写 card）→ 人工确认通道
  - C4 正常路径检出后兜底不触发
- **D 组（3 断言）回归**：v11.2 检测/生成不受影响 + SUPER 代码路径拒绝但兜底触发

**全量回归**：v9.9+v9.10 (33) + v10.0 (21) + v10.2 (38) + v10.5 (39) + v10.6 (46) + v10.7 (14) + v10.8 (21) + v10.9 (86) + v11.0 (91) + v11.1 (42) + v11.2 (48) 全绿；typecheck 双配置 + build 通过（dist/index.html 725.13 KiB / main.js 289.61 KiB）。

**已知遗留（诚实声明）**：
- ~~**nCARD 小写系列名走人工确认**——`detectCategory('NM card')` 不识别小写 card（CATEGORY_KEYS `\bCard\b` 大小写敏感），如需覆盖要把品类词表扩展到大小写不敏感，但那是改 v11.2 检测逻辑，本次不动~~ **v11.4 已修复**（detectCategory 双遍匹配 + camelCase 系列名放宽）
- **B2-B6 校验逻辑需集成测试覆盖**——单元测试验证了触发条件与函数存在性，但 series 非源文子串/model 编造/DESCRIPTIVE_CHECK 等校验逻辑在 parseProductNameWithLLM 内部，需 mock XHR 集成测试覆盖（当前 18 断言已覆盖核心语义）

**设计决策记录**：
1. **LLM 不输出译名**——20 语种风格统一是 v11.2 核心收益，LLM 只做"是不是产品名/系列名是什么"的语义判断，渲染交给代码
2. **三重收窄触发**——不为捞"疑似产品名"放宽形态门；无锚点/未知品类词走人工确认（同 ARES→战神 不可自动继承的决策）
3. **待确认入库非静默**——v10.7 教训：LLM 参与的产物（缓存/译文/产品名）必须走显式通道，静默入库 = 永久污染风险
4. **校验失败放弃保护**——最坏结果 = 回到 v11.2 之前的状态（LLM 自由翻译），不会引入新风险

---

### v11.2.2 修复新产品名入库短路场景漏入库（2026-08-04，零 API 调用时入库块被跳过）

**问题**：单条产品名被 `normalizedGlossaryMap` 短路、零 API 时 startTranslate 提前 return（`apiTotal===0 && autoSkipped===total`），尾部入库块被跳过——检测到了新品名但没入库，下次扫描还会重复检测。

**修复**（`ui/App.vue`）：抽 `persistAdhocProductNames()` 纯函数，两处调用：
1. `apiTotal===0` 提前 return 前——零 API 场景也入库
2. 正常走完到尾部——混合场景（部分短路+部分已译）也覆盖

**测试**：E 段 6 断言（短路场景检测/入库 key/cleanKey 一致/already 判重/19 语种）；48/48 通过；typecheck 双 config + build 全绿。

---

### v11.2.1 全品线扫描缺口修复（2026-08-03，真实产品名误杀清零 + 已知系列新子型号入库）

**背景**：v11.2 上线后用 52 个全品线形态用例（CSV 140 条变体 + 假想新品 + 用户提供的 2 个真实新品）扫描，发现 7 个真实产品名被解析器误杀、1 个语义缺口导致已知系列新子型号不入库。

**修复**（全部在 `lib/new-product-detect.ts`）：

| # | 缺口 | 修复 | 验证用例 |
|---|------|------|---------|
| 1 | ™在规格 token 上（`microSDXC™`）被吞进系列串 → valid:false | 一切判定基于 `stripTrademark` 后的裸 token | `Lexar® Professional SILVER GO microSDXC™ UHS-I Card`（用户真实新品）✅ |
| 2 | 斜杠双格式（`microSDHC/microSDXC`）混入系列串 | `SLASH_SPEC_RE` 终止系列串 | `BLUE PLUS microSDHC/microSDXC` ✅ |
| 3 | 单字母系列修饰（`PLAY X`/`THOR Z`）被"≥2字符"拒 | 系列串允许单大写字母 token | `PLAY X`、`THOR Z RGB`、`TITAN X` ✅ |
| 4 | `with` 配件话术（`with Heatsink/Hub`）被功能词误杀 | `with` 移出 FUNCTION_WORDS_RE（命名规则文档定义的标准话术） | `EQ790 with Heatsink`、`Go Portable SSD with Hub` ✅ |
| 5 | 括号规格（`(6Gb/s)`/`(EOL)`）被 NAME_SHAPE_RE 拒 | 形态门加 `()` + `PAREN_SPEC_RE` 终止系列串 | `NM100 (6Gb/s)`、`M900 (EOL)` ✅ |
| 6 | `Type A/B` 单字母规格后缀被功能词"a"误杀 | `SPEC_LETTER_CONTEXT_RE` 豁免（`Type/USB/Gen + A-C`、`/A-C`、`-A/` 是规格代号不是冠词） | `CFexpress Type A`、`USB-A/C Reader` ✅ |
| 7 | **已知系列新子型号不入库**（语义缺口） | 新颖性门 2 语义修正：仅"裸已知系列"（整条==锚点+系列名）才跳过；整条新颖性由门 1 判定。ARES 已知 ≠ `Lexar ARES PCIe Gen4x4 M.2 2280 NVMe SSD` 整条已知 | 用户 ARES 用例 ✅ |

另修 2 个隐藏 bug：`Type`/`B` 进 SPEC_TOKENS（CFexpress Type A/B 终止系列串）；`CAPACITY_TOKEN_RE` 的 `\d{2,5}` 漏掉单数字容量（`2TB`），改为 `\d{1,5}` 并在系列串尾部剥离容量 token（"TITAN 2TB"→series 只留 TITAN）。

**全品线扫描结果**：52 用例检出 45 → 剩 7 个未检出全是合理的（2 个已在术语库被新颖性门拦 + 4 个已在 CSV 的已知型号 + 1 个对照组）。

**测试**：`tests/test-v112-product-name-v2.ts` 42 断言全绿（A 检测 22 含 A14-A22 九个新缺口用例 + B 生成并入 6 + C 入库语义 6 + D NF100 端到端 8）。
- 全量回归：v9.9+v9.10 (33) + v10.0 (21) + v10.2 (38) + v10.5 (39) + v10.6 (46) + v10.7 (14) + v10.8 (21) + v10.9 (86) + v11.0 (91) + v11.1 (42) 全绿；typecheck 双配置 + build 通过。

**已知遗留（诚实声明）**：`nCARD NM card`/`Multi-Card`/`Dual-Slot` 等连字符/小写读卡器配件形态未检出（P2 低风险，LLM 直译可接受）；命名规则文档与 CSV 的 5 处品类词偏差（ja 内蔵SSD/ko 내장SSD/fr Disque SSD interne/zh-TW 桌上型記憶體/id Card Reader）未动，生成表仍以 CSV 现状为准（保证新品名与已有 140 条风格统一）。

---

### v11.2 新产品名宏观方案（2026-08-03，代码/LLM 各司其职 + 整条入库 + 生成译名首轮并入）

**背景**：v11.1 用真实产品名 `Lexar® NF100 2.5-inch SATA III SSD` 复盘暴露两个致命缺陷——® 把锚点门整体打死（`lexar® ≠ lexar`，设计稿常态写法全部失效）；系列名被当成必填槽（CSV 42/140 是纯型号形态无系列名，NF100/NM790/ES3 全被拒之门外）。用户拍板宏观方向：充分利用代码和 LLM 的特性，两者结合各自守住边界。

**方案**（`lib/new-product-detect.ts` + `lib/product-name-generator.ts` + `ui/App.vue`）：

```
代码判定（确定性，LLM 不参与）：整条独立 + Lexar锚点(®=强信号) + 品类词指纹 + 无动词/功能词
        ↓
代码翻译（五槽位+语序模板+品类译法表，零 LLM）：生成 20 语种厂形译名
        ↓
首轮：当前目标语种译名并入 glossaryMap → S1 整条短路直接输出（LLM 不碰产品名）
长期：无®整条 + 20 语种静默写入专属术语库 → 下次零成本 + 校对同世界
```

**关键语义**（与用户确认）：
- **® 处理**：带 ® 是"完整产品名"强信号；入库 key 一律去 ®（与 CSV 140 条无®惯例对齐）；`cleanKey` 匹配时剥离 ®™© → 无® key 天然命中带®变体（模糊匹配成立）；`restoreTrademarkSymbols` 译后按源文加回 ®。
- **系列名可选槽**：锚点后允许直接跟型号/规格（覆盖 42/140 纯型号形态）。
- **候选术语=整条原文**（去®）：与 CSV key 惯例对齐，吃 S1 短路 + 跨批次一致性。
- **品类词必含门**：`detectCategory ≠ null` 才判定产品名（规则文档严格界定的 11 个核心品类词是"产品名"指纹）。
- **中文营销名留空**：ARES→战神/THOR→雷神 内部不一致、Air→小轻块为特例，均不可安全自动继承，由用户日后补全。

**改动**：
1. `new-product-detect.ts` — ®修复 + 系列可选 + 整条候选 + 品类指纹门 + SPEC_TOKENS 扩充（UDIMM/SODIMM/MHz/CL值等内存规格）
2. `App.vue` — 首轮并入改为**当前目标语种生成译名**（替代 v11.1 的 source===target 原样并入），zh-TW 走 `zhCNtoZhTW` 简繁兜底；静默入库写无®整条；独立校对路径同世界并入
3. `product-name-generator.ts` — 商标符号语义明确化（输入/输出均无®）

**测试**：`tests/test-v112-product-name-v2.ts` 33 断言全绿；NF100 复盘脚本确认 S1 短路命中厂形译文（fr `SSD Lexar NF100 2.5-inch SATA III`）、遮蔽路径整体 `__GLOSSARY_0__` 占位（不再零件拼装）。

---

### v11.1 新产品名检测+20语种生成（2026-08-03，初版——已被 v11.2 取代，仅留档追溯）

**背景**：术语库未收录的新产品名（THOR Ultra/VELOCIS）裸奔进 LLM，可能被翻译/音译污染 20 语种。

**初版方案**：检测（形态门+锚点门+新颖性门）→ adhoc 并入（source===target 原样保护）→ 翻译完成后按五槽位规则生成 20 语种静默入库。

**两个新模块**：
- `lib/new-product-detect.ts` — 五槽位解析 + 三重门检测
- `lib/product-name-generator.ts` — 20 语种品类词译法表（CSV 现状为准）+ 语序模板（suffix: zh-CN/zh-TW/ja/ko/de/en；prefix: 其余 13 语种；vi 按品类分前置/后置/外设保留英文）+ 简→繁转换

**缺陷（v11.2 已修）**：® 锚点门失效 + 系列名必填（漏 30% 纯型号形态）+ 候选术语是片段非整条 + 首轮仅原样保护非厂形译文。

---

### v11.0 校对市场语感校准（2026-08-03，翻译↔校对上下文闭环）

**背景**：用户重申最终目标——"匹配目标语言国家语言习惯和产品对应人群与使用场景，同时保证可靠性：不漏翻、不加戏、意思与原文一致，适配 20 个语种"。对照六维评审表发现：维度二（本地化表达）的模块（IDENTITY_MISSION + LANGUAGE_MARKET_NOTES + LANG_SPECIFIC）中，**市场语感只注入了翻译，没注入校对**——校对把翻译故意使用的正确市场原生词（满血版/가성비/Preis-Leistung）误当"不自然表达"拦下，v10.9 的分段红利被校对吃掉。翻译和校对看到的世界不一致，闭环只闭了长度信号（v10.8）和术语库两个通道。

**改动**（`lib/prompt-constants.ts` + `lib/llm-api.ts`）：

| # | 改动 | 要点 |
|---|------|------|
| 1 | `buildProofreadCalibration()` 新增 | 与翻译**同源同段**（复用 `getMarketNote`，保证两个 LLM 拿到同一份词汇表）+ **双向边界指令**：① 白名单校准（这些词已获准，不得当不自然/误译拦截改写）② 禁止加词（源文没有依据的促销/风味词即使在清单中也必须拦——校准是白名单，不是加戏许可证）。② 防 v10.2 同型病：好心信号被 LLM 读成行动指令 |
| 2 | `buildProofreadSystemPrompt()` 提取纯函数 | 校对 prompt 组装从 proofreadBatch 提取为可测纯函数；模块顺序 MISSION → PROOFREAD_PROMPT → glossaryHint → **calibration** → langBlock（calibration 在 VALIDATION 检查清单之前——先建立"不许拦什么"的边界） |
| 3 | proofreadBatch 委托组装 | 删内联组装代码（missionBlock/proofreadPrompt/langBlock 拼接），委托纯函数；llm-api.ts 清理失效 import |
| 4 | `getMarketNote` 提升 export | 校对复用同一函数，杜绝两份词汇表漂移 |

**守住不动的边界**（决策记录）：
- **Success 意图行不进校对**——校对职责是"查错"不是"拦意图偏离"，注入会扩大误判面（风险大于收益）
- **Success 行维持保留在场景约束中**（不被 suppressExpression 抑制）——它是意图信号不是语调指令，与 style 不冲突
- **productLine 映射不改**（pc_productivity→consumer 等）——无实机数据支持改动，分段边界保持 v10.9 拍板结果
- **校对仍不注入 scene/tone/style**——翻译已负责风格，校对聚焦正确性；市场语感是唯一例外（它决定"什么词算正确"）

**测试**：`tests/test-v110-proofread-calibration.ts` 91 断言全绿（A 分段注入 10 + B 双向边界 8 + C 组装完整性 7 + D 指令语言路由 4 + E 回退全段 2 + F 20 语种×3：校准非空/校对段==翻译段/翻译风格卡含同段 60）。
- **填补了校对 prompt 组装的测试真空**——此前 86 条 v10.9 断言 100% 在翻译路径，proofreadBatch 的 prompt 组装 0 覆盖。
- 全量回归：v9.9+v9.10 (33) + v9.11 (21) + v10.0 (21) + v10.2 (38) + v10.3 (22) + v10.4 (17) + v10.5 (39) + v10.6 (46) + v10.7 (14) + v10.8 (21) + v10.9 (86) 全绿；typecheck 双配置 + build 通过。

**已知遗留（诚实声明）**：分段映射（8 产品线→3 段）未经实机输出对比验证；v11.0 消除的是"校对误杀正确市场词"的风险，"分段选择是否最优"仍需实机抽查（professional_imaging vs pc_productivity 对比）。

---

### 2.0.0-pre v10.9 Prompt 注意力优化（2026-08-03，市场语感分段注入 + 场景 Success 意图行 + 风格越界清理）

**背景**（站在"接收 prompt 的 LLM"立场复盘三套数据后拍板）：~2600 行 prompt 稀释注意力。四个观察：
1. **抽象形容词对 LLM 几乎无效**——"语气：友好、自然、易懂"改变不了选词；但**市场原生词汇**（满血版/가성비/Preis-Leistung）会直接出现在输出里
2. **市场原生词汇早已存在**——LANGUAGE_MARKET_NOTES 每条按 gaming/professional/consumer 三段写好，但**不分产品线整段注入**：翻电竞内存时 LLM 同时收到"消费级突出性价比"无关段落，稀释注意力 + 浪费 token
3. **场景约束只说"不许做什么"，没说"用户拿这段文字干什么"**——这是 LLM 生成前最需要的一行意图信号
4. **风格模块越界**——marketing 风格藏产品线规则（"游戏产品用玩家友好语言"）、professional 风格藏影像行业内容（"V60/V90/VPG400、IP68"）；产品线存在时这些被抑制成死代码，无产品线时又可能注错行业

**四项改动**（全部在 `lib/prompt-constants.ts`）：

| # | 改动 | 要点 |
|---|------|------|
| P1 | 市场语感按产品线分段注入 | `LANGUAGE_MARKET_NOTES` 20 语种拆 `{gaming, professional, consumer, shared}` 四段（**纯数据搬迁零新内容**）；新增 `PRODUCT_LINE_MARKET_SEGMENT` 映射（gaming_dimm/gaming_ssd/gaming_card→gaming，professional_imaging→professional，其余 4 条→consumer）；`getMarketNote(lang, productLine)` 只注入命中段+shared，无产品线/未映射注入全段（行为不变）。有产品线时 token 减 ~40% |
| P2 | 6 场景各加一行 Success: | ecommerce「3 秒货架决策」/ technical_doc「工程师零歧义核对规格」/ operation_guide「首次用户独立完成」/ packaging「3 秒货架+法务审查」/ compliance_doc「目标市场法律滴水不漏」/ software_ui「第一眼定位功能」。**Success: 不在 suppressExpression 抑制列表**——意图信号与 style 语调指令不冲突 |
| P3 | 风格越界清理 | marketing 20 语种删 2 条产品线规则（已由 P1 分段覆盖）；professional 20 语种删 2 条影像专属规则（V60/V90/VPG400、IP68——有产品线时本就死代码，无产品线时注错行业） |
| P4 | 空 langOverrides 不填 | compliance_doc / software_ui 的 per-language 内容已在 LANG_SPECIFIC.compliance/rules——填了=重复=注意力稀释，空着才是正确状态（加注释说明） |

**测试**：`tests/test-v109-prompt-attention.ts` 86 断言全绿（A 分段注入 20 + B 无产品线行为不变 7 + C 未映射回退 2 + D Success 注入/抑制边界 12 + E 风格越界清零 25 + F 20 语种完整性 20）。
- ⚠️ **测试设计陷阱**：getStyleCard 聚合 5 个数据源，场景 langOverrides 与市场语感**共用词汇**（de "Preis-Leistung"、pt-BR "custo-benefício"、ko "프레임 방어" 场景约束也会注入）——分段断言须用 `marketNoteOnly()` 辅助函数（完整卡 − 产品调性 − 场景约束）隔离市场语感产物，不能对整卡断言"不含某段词汇"。
- 全量回归：v10.5 (39) + v10.6 (46) + v10.7 (14) + v10.8 (21) 全绿；typecheck 双配置 + build 通过。

---

### 2.0.0-pre v10.8 扩展检测语义移交校对（2026-08-03，长度代理误杀正常译文根治）

**问题**（v10.2 同型病，方向相反）：`detectTranslationExpansion` 用「译文长度/源文长度」比例判加戏，命中即**自动截断**（`translated.slice(0, maxLen)`，在句号/逗号/空格处硬切）。长度≠加戏——de/pt/fr 天然比 en 长 50-90%，一条正常详尽翻译可能完全没加戏，代码却一刀切截断，造出半截句子上画布。这是 v10.2 截断误杀（过短方向）的同型病，方向相反（过长误杀）：**代码用长度代理干语义的活**。

**根因**：HANDOFF 已确立总原则「代码管形式，LLM 管语义。历史全部误杀 = 代码用代理指标干语义的活」。`detectTranslationExpansion` 是最后一个「代码用形式代理干语义活」的残留——长度长 ≠ 加戏（de/pt/fr 天然长 50-90%），真实加戏往往不靠变长体现（靠换词），长度检测对它漏检。误杀正常译文（高假阳）+ 漏检真实加戏（高假阴），两头不占。

**修复**（沿用 v10.2 路径，与 v10.7「只报警不改数据」审计哲学一脉相承）：**删自动截断 + 长度信号上移校对，代码只做「检测+提示」不做「修改」**。

| 层 | 改动 | 位置 | 要点 |
|---|------|------|------|
| 纯检测 | `detectTranslationExpansion` 删除所有截断逻辑，原样返回输入译文，只透出 `expandedIndices` + 长度比 | lib/post-process.ts:690 | 代码管形式：只量化「是否显著超长」，不裁决 |
| 删截断 | S6 调用处删除 `result = expansionResult.texts`，`debugWarn`→`console.warn`（可观测） | lib/llm-api.ts:1052 | 移除静默破坏点 |
| 信号透传 | `translateBatch` 新增 `expansionIndices` 输出参数，把 S6 超长索引透传给 App.vue | lib/llm-api.ts:639 | 参考 v10.6 `misspelledIndices` 模式 |
| 校对 hint | `proofreadBatch` 新增 `expansionFlags` 入参，对超长条目在校对 user prompt 追加中性提示 | lib/llm-api.ts:1682 | LLM 管语义：裁决加戏 vs 合法详尽 |
| prompt 对齐 | CHECK 1 补「长度异常提示的含义与处理原则」（中英双语） | lib/prompt-constants.ts | 明确「长≠错」，防诱导 LLM 过度改写 |

**关键决策**：
1. **不删信号，只删自动截断**——长度异常仍是有价值的量化信号，但裁决权移交校对 LLM（结合语义判「真加戏→改写 / 合法详尽→放行」）。信号上移，裁决权移交。
2. **中性措辞防诱导**——hint 明确「若语义忠实、表达自然，请保持原样」，避免 LLM 把合法详尽译文也改写短。
3. **未开校对场景**：S6 `console.warn` 始终可见（与 v10.7 同标准），长度异常条目进日志面板；比「静默截断成半截句」安全得多——半截句是确定的物料事故，超长详尽句最坏是「啰嗦但没错」。
4. **20 语言通吃**——长度检测基于 `LANG_EXPANSION_RATIO`（已覆盖 20 语种），校对 hint 按指令语言（zh/en）自动切换。

**测试**：`tests/test-v108-expansion-to-proofread.ts` 21/21（A 纯检测不修改 8 + B 信号透传 3 + C 校对 hint 注入 zh/en 双语 7 + D 端到端：超长译文不再截断、校对判加戏→精简/判合法→保持 3）；全量回归 v10.5 (39) + v10.6 (46) + v10.7 (14) + v10.8 (21) 全绿；typecheck 双配置 + build 通过（dist/index.html 715.09 KiB, dist/main.js 289.61 KiB）。

---

### 2.0 v10.7 缓存术语库合规校验（2026-08-03，翻译缓存闭环缺口修复）

**问题**（TW→TW 实机日志）：术语库条目 `Lexar® Professional SILVER PLUS SDXC™ UHS-I 記憶卡` 被输出为 `Lexar®專業級 SILVER PLUS SDXC™ UHS-I 記憶卡`（`Professional`→`專業級`）。日志只有 scan/apply，零 translate/proofread——错误译文非本次 LLM 产出。

**根因**（两次会话叠加）：
1. **早先会话**：该条目当时是漏翻状态（v10.x 修三层漏翻检测之前）→ 进校对 → 校对 LLM 违反术语库把 `Professional` 润色成 `專業級` → v9.10 术语合规校验**理论上**应兜住但偶发漏网 → 错误译文写入**跨会话持久化翻译缓存**（`translationCache`，按 `源文+目标语言+术语库hash` 做 key）
2. **本次会话**：扫描到同一文本 → 缓存命中 → 直接套用错误译文 → 术语库短路（`normalizedGlossaryMap` 整条命中）和缓存是**平级分支**，缓存优先 → 短路未执行 → 错误复活

**核心缺口**：翻译/校对管道的术语合规校验（v9.10）只管"本次新产生的译文"，**缓存读取路径没有任何术语校验**——它假设"缓存里的都是好译文"，但旧版本 bug 或校对偶发漏网会污染缓存并永久复活。

**修复**（四层防御，用户拍板"可靠性最重要"）：

| 层 | 改动 | 位置 | 要点 |
|---|------|------|------|
| 缓存读取校验 | `isDirtyCache` 加第 4 条：源文整条命中术语库但缓存值 ≠ 术语库目标值 → 弃用并重新翻译 | ui/App.vue:1517 | 与 v9.10 同维度（`cleanKey` 归一化），但语义不同：不抛脏缓存，而是**强制重新走翻译管道**（触发术语库短路，零 LLM 调用） |
| 启动全量清洗 | `TRANSLATION_CACHE_LOADED` 追加术语库合规清洗：同维度删除存量违规缓存 | ui/App.vue:2957 | 一次性清掉历史污染；用户下次启动插件自动生效 |
| 用户修正豁免 | corrections 里的手动修正译文优先于术语库值（最高优先级） | ui/App.vue:1517 + 2957 | 避免"启动清洗删了术语库违规缓存，但用户之前手动改的译文被误杀" |
| 校对日志升级 | `proofreadBatch` 术语合规校验日志从 `debugWarn`（依赖 DEBUG_MODE）升级为 `console.warn`（默认可见） | lib/llm-api.ts:1860 | 未来再漏网时可追溯，不再静默 |

**关键决策**：
1. **缓存校验放在读取时而非写入时**——写入时校验无法拦截"旧版本已写入的脏缓存"；读取时校验 + 启动清洗组合覆盖存量+增量。
2. **用户修正 > 术语库值**——术语库是默认值，用户手动改过的译文是最终意图；清洗/校验都豁免 corrections 记录。
3. **20 语言通吃**——`cleanKey` 是语言无关的文本归一化（大小写/连字符/®™©/空白不敏感），非拉丁目标（ja/ko/zh/ru/ar/th）同样生效。
4. **不推翻 v9.10/v10.6**——缓存校验是**补充**而非替代；翻译/校对管道的合规校验继续兜底新译文，缓存校验兜底旧译文。

**测试**：`tests/test-v107-cache-glossary-compliance.ts` 14/14（A 脏缓存拒用+重新翻译短路 5 + B 用户修正豁免 3 + C 启动清洗逻辑 4 + D 20 语种 cleanKey 等价性 2）；v10.6 回归 46/46；v10.5 回归 39/39；typecheck 双配置 + build 通过（main.js 289.61 KiB）。

**测试基建**：`package.json` 新增 `npm test` 命令（`test:v105/v106/v107`），本地安装 `ts-node` + `tsconfig-paths`，解决 Windows 下 `--compiler-options` JSON 解析问题（改用 `cross-env TS_NODE_COMPILER_OPTIONS`）。

---

### 2.0.0 v10.6 疑似错词保留 + 回退兜底（2026-08-01，错词不翻不猜不音译不自动改）

**问题**（zh-CN→zh-TW 实机日志）：源稿错别字 `Panasionic` 匹配不上术语库（`panasionic ≠ panasonic`）→ 进 LLM 被音译成 `帕納西奧尼克` 上画布。错词被翻成诡异词是物料事故。

**用户关键洞察**：错别字是**通用现象**，品牌名只是恰好撞上。`Spede`/`Transfser` 同样会被 LLM 自由发挥——这跟是不是品牌名无关。因此不能围绕"品牌名匹配"头疼医头。

**宏观方向（用户拍板：站在 LLM 视角）**：判"什么是错词"需要多语言词表，代码做不到（20 语言要 20 套词典），但 **LLM 天然内建多语言语感**。所以**判定权交给 LLM（prompt 规则），代码只做最保守的回退硬兜底**。对齐 CAT 工具（Trados/memoQ）行业标准：错词不翻、不猜、不音译、**不自动改**（用户明确否决"差一个字母自动替换成 Panasonic"的编辑距离方案——怕引入新 bug）。

**改动**：

| 层 | 改动 | 位置 | 要点 |
|---|------|------|------|
| prompt 层（主，软约束） | CORE_PRINCIPLES / CORE_PRINCIPLES_ZH 第 2 条【忠实】加"疑似错词保留原形"硬规则 | lib/prompt-constants.ts | "不音译、不猜测词义、不编造译名，原样保留源文拼写；保留原形永远优于猜测"，附 Panasionic→帕納西奧尼克 反例。LLM 用内建多语言语感判错词，**20 语言通吃**，零新增判定代码 |
| 代码兜底层（硬） | 新增 `revertMisspelledWordTranslation` | lib/llm-api.ts | LLM 万一没忍住翻了（音译成非拉丁文字），兜回源文原形 + 进待确认（untranslatedIndices）|

**代码兜底 5 重保守约束**（全部命中才回退，宁可漏不可误）：
1. 源文单个拉丁词（无空格/标点/数字），长度 ≥6 —— 只碰"单词"
2. 源文不在术语库（key/value，大小写无关）—— 已收录品牌走 LOCK 不兜底
3. 源文不被 isUntranslatable 豁免（型号/单位/品牌词已有归属）—— 不重复拦截
4. 译文 ≠ 源文（LLM 确实改了）
5. 译文含非拉丁字符（音译/意译铁证）—— **仅非拉丁目标有此硬信号；拉丁目标直接跳过**（拉丁→拉丁猜测无法与合法翻译形式区分，归校对 LLM 语义裁决）

**关键决策（正反论证）**：
1. **判定权在 LLM 不在代码**——"什么是错词"需多语言词表，代码做不到；LLM 内建语感，一条 prompt 规则 20 语言通用。这正是"LLM 管语义"的延伸：**LLM 也管"错词识别"这种需要语言感的判断**。
2. **代码兜底只回退不替换**——零编辑距离/零词典/零自动改，规避用户担忧的"差一个字母改错"风险。最坏结果 = 合法词被保留+提示，人工确认即可，不会造成物料事故。
3. **兜底调用点在 S7f 之后**——若放在 S7 检测前，回退为源文（src===trans）会被漏翻检测二次拦截触发无效重试。
4. **拉丁目标不兜底**——`Panasionic→某拉丁词`无法与合法翻译区分，硬回退会误伤；交给校对 CHECK。

**测试**：`tests/test-v106-misspelled-word.ts` 34/34（A prompt 规则注入中英双语 6 + B 正反样例 4 + C 端到端 Panasionic→帕納西奧尼克回退+独立通道 5 + D 20 语种：拉丁 de 不兜底/ja/ko/zh-CN/ru/ar/th 均兜底且与漏翻区分 19）；全量回归全绿；typecheck 双配置 + build 通过（dist/index.html 710.26 KiB）。

**v10.6.1 补充（同日，用户反馈"提示是翻译失败⚠️漏翻"语义错位）**：疑似错词被复用的"漏翻"通道标成了"翻译失败"——它是源稿疑似拼错，不是翻译失败。改为**独立待确认类别**：
- translateBatch 新增 `misspelledIndices` 输出参数（疑似错词走独立通道，不进 untranslatedIndices）
- App.vue 新增 `misspelledIds` ref + pendingItems 加 `type:'misspelled'` + "疑似拼写错误"徽章/横幅计数/待确认项"请核对源稿"前缀
- **关键修复**：v9.11 最终安全网会把回退为源文的疑似错词（src===trans）二次判漏翻进 untranslatedIndices，与 misspelledIds 双通道混淆——安全网豁免 misspelledIndices 已标记的索引
- UI 状态管理：startTranslate/clearItems 清空 misspelledIds；skipPendingItem/retranslateSingle 清除该 id

### 2.0.1 v10.5 型号/单位豁免 + 检测层豁免（2026-08-01，误报清零 + 消灭无效兜底 API 空转）

**问题**（zh-CN→zh-TW 实机日志）：一批"漏翻"全是误报——
- 相机型号列表（`EOS R5 / ...`、`A1 / A7M4 / ...`、`X-H2S / ...`、`E-M1-Mark-II`）本不该翻，LLM 原样回显是**正确行为**，但 `isUntranslatable` 白名单只认 Lexar 自有型号（BRAND_GRADE_RE），`MODEL_CAPACITY_RE` 又是"整条"正则匹配不上多行/带斜杠列表 → 误判漏翻 → 每条空转 4 次兜底 API 后标红；
- `MB/s*` 裸单位无数字开头落不穿 `NUM_UNIT_RE`（`^[\d,.]+` 强制数字开头）→ 误判漏翻；
- `detectTruncatedTexts` 对型号列表误报截断（zh 目标只查 CJK 字符），且 S7b-trunc 对"重试后仍截断"执行 `result[j]=''`（静默清空无标记）；
- 源稿错别字 `Panasionic` 被 LLM 纠正为 `Panasonic`（术语库值）后，最终安全网的"必须含 CJK 字符"脚本校验仍误报漏翻。

**"之前没这个问题"的真相**：不是新 bug。以前这些条目 LLM 原样返回后静默过了（用户无感知）；v9.5 三层检测 + v9.11 最终安全网把它们抓出来标红。检测变灵敏了，但"第三方型号/裸单位/库值纠正"这三个豁免类别没跟上。

**改动**（全部在 lib/llm-api.ts，纯代码确定性豁免，符合"代码管形式/LLM管语义"总原则）：

| # | 改动 | 位置 | 要点 |
|---|------|------|------|
| 1 | 型号/型号列表豁免 `isModelListOrCode` | isUntranslatable 规则 2.6 | 按 `/`/换行切段；单段=含数字+大写占比≥50%（覆盖 E-M1-Mark-II）；多段=每段皆型号形态（含数字且大写≥50%，或全大写）。不误判 `4K/8K video recording`（小写词为主）/`SUPER FAST SPEED`（无数字） |
| 2 | 裸单位豁免 `PURE_UNIT_RE` | isUntranslatable 规则 2 后 | `/^(GB|MB|TB|KB|MB\/s|GB\/s|TB\/s|MHz|GHz|TBW)\*?$/i`，去尾 `*` 后匹配。**不动 NUM_UNIT_RE**（v8.7 教训：不扩已有规则宽松度） |
| 3 | 截断检测跳过不可翻译条目 | detectTruncatedTexts | 空值检查**之后**加 `if (isUntranslatable(src)) continue`（空译文仍触发重试）。堵死 S7b-trunc 静默清空型号列表的洞 |
| 4 | 脚本校验豁免术语库已知值 | detectUntranslatedText | 译文归一化 ∈ glossaryMap 值集合 → 跳过 ja/ko/cjk 三处脚本校验。**只管脚本校验，不管 src===trans**（错别字原样回显仍被抓走纠正链） |

**关键决策**：
1. **豁免在检测层不在 prompt 层**——型号/单位是形式可判定的，代码在 S1 前拦住，不进 LLM 也不进兜底链（符合 arch-review"代码管形式"原则）。
2. **改动 4 用"值集合"而非"key 匹配"**——源文是错别字（Panasionic）匹配不上 key，但译文被 LLM 纠正后命中术语库值，此时应认可"库内正确拼写"是合规结果。
3. **不动 MAX_AGGRESSIVE_RETRIES=3 / 术语匹配逻辑**——改动 1 落地后型号列表根本不进兜底链，上限失去相关场景；错别字匹配不上术语库是正确设计。

**测试**：`tests/test-v105-model-list-exemption.ts` 33/33（A 型号正/反样例 13 + B 裸单位 6 + C 截断豁免 4 + D 脚本校验库值豁免 5 + E 端到端队列 mock 5——**E4 断言型号列表回显仅首调 1 次 API、零重试零漏翻上报**）；全量回归全绿（v10.4 17 / v10.3 22 / v10.2 38 / v10.0 21 / v9.11 21 / v9.9+9.10 33 / v9.8 10 / v9.7 9 / 同语系 21 / v8.7 26 / 术语遮蔽 80）；typecheck 双配置 + build 通过（dist/index.html 707.08 KiB / main.js 289.61 KiB）。

**排障记录**（测试先行暴露的两个断言设计问题，非生产代码 bug）：
- C4 初版用 `'Another list A7M4/...'` 含小写功能词段，被规则正确判为非型号列表 → 改用纯型号段（EOS 系列）。
- D5 初版源文 `'高速传输 极致体验'` 含简体特征字（传），在 zh-TW 目标下被 s2t 特征字校验**先行**拦截，根本走不到脚本校验 → 改用 ja 目标 + 纯拉丁源文直达脚本校验路径。

### 2.0.2 v10.4 管道阶段化 + 不变量审计（2026-08-01，v9.11 结构性根因止血）

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

### 2.0.3 v10.3 日志持久化 + 主线程跨线程可见（2026-08-01，优化方向 ④）

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

### 2.0.4 v10.2 截断误杀根治（2026-07-31，确立"代码管形式/LLM管语义"原则）

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

### 坑 14: 营销词表静态边界必然误杀合法系列名（v11.3）

`DESCRIPTIVE_WORDS` 防 "Lexar Fast" 误保护，但 SUPER 恰好是合法系列名——静态词表无法区分"营销形容词"vs"系列名"（语义判定）。**代码用静态词表做语义判定必然有边界；LLM 内建多语言语感，结构化 JSON 输出 + 代码形式校验（子串/描述词检查）可在可靠性优先前提下兜住边界。**

### 坑 15: 豁免/修正若加在"锁定之后"就是死代码（v11.12+）

对会被下游强制锁回的值做修正类豁免，豁免必须插在**锁定发生之前**——v11.12+ 初版把术语库锁定项的违禁词豁免写在 prompt 组装之后（改 fixMap 但 prompt 已构建、调用方读取窗口已过），功能为零纯摆设。**修正链路上每个豁免点都要问一句：这个变异在谁之前生效？数据流下游还有谁会读它？** 同类：徽章/计数的写入必须对最终结果做（坑 10 中间快照同理）。

### 坑 16: 测试按"邻近文本+定长窗口"断言会出血（v11.12+）

定位 prompt 中某条的 note 时，用 `indexOf(译文)` + 固定 200 字符窗口断言"窗口内不含 note"——当被测条**没有** note 时，**下一条**的 note 会落进窗口（条目越短越必然出血）。**断言按结构边界切段（`[n]` 条目标题），不按字符数窗口。** 根因同坑 10：对位置的假设比对内容的假设脆弱。

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
| `lib/prompt-constants.ts` | 提示词常量（STYLE_GUIDES、LANG_SPECIFIC、PRODUCT_LINE_TONE_GUIDES、SCENE_CONSTRAINTS、CORE_PRINCIPLES、PROOFREAD_SYSTEM_PROMPT、v11.3 PRODUCT_NAME_PARSE_PROMPT/ZH LLM 产品名解析、**v11.12 PROOFREAD_PROHIBITED_NOTE/_ZH 违禁词校对全局块**） |
| `lib/llm-api.ts` | LLM 调用 + 翻译/校对管道 + 重试逻辑 + v9.5 三层漏翻检测 + v9.9 术语合规校验 + v9.10 双视图分发 + v9.11 批次级标注/untranslatedIndices/最终安全网 + v10.0 re-export lang-detect（兼容层）+ v10.2 截断判定（脚本存在性）+ 子兜底守卫 + 诊断日志埋点 + v10.4 管道阶段化(S1-S8)+auditStage 不变量审计 + v10.5 型号/裸单位豁免(isModelListOrCode/PURE_UNIT_RE)+截断跳过不可翻译+脚本校验豁免术语库已知值 + v10.6 revertMisspelledWordTranslation 疑似错词回退兜底 + v11.3 parseProductNameWithLLM LLM 兜底产品名解析 + **v11.12 proofreadBatch 第 10 参 prohibitedFixMap（per-item 违禁词改写 note）+ v11.12+ 术语库锁定项预豁免（prompt 组装前剪除，破改写→锁回死锁）** |
| `lib/prohibited-words.ts` | **v11.12 违禁词表**（PROHIBITED_ZH 京东/广告法 + PROHIBITED_ZH_EXEMPTIONS 豁免短语 + PROHIBITED_AVOID 20 语种与 LANGUAGES 严格对表；收录红线：宁漏勿滥，有合法语义的普通词不收；**v11.12+ 豁免 +4：有限终身质保/有限终身保修/有限終身保固/有限終身保修**） |
| `lib/prohibited-check.ts` | **v11.12 违禁词检测纯函数**（detectProhibited/hasProhibited/detectSourceLangForProhibited：拉丁词边界 i flag 无 g flag、CJK 子串、符号词 `(?<!\d)`、zh 先剔豁免、重叠取最长）+ **v11.12+ isGlossaryLockedTranslation 术语库锁定判定（cleanKey 查表+译文严格等值）** |
| `lib/lang-detect.ts` | v10.0 语言检测单一事实源（三套检测/词表/字符集分类/同语系对，detectSingleTextLanguage 死代码已修为委托批次级）+ **v10.2 TARGET_SCRIPT_PATTERNS** |
| `lib/keep-source.ts` | **v10.0 豁免中央注册表**（shouldKeepSource/isSameLanguageExempt，F3b 三重守卫迁入） |
| `lib/new-product-detect.ts` | **v11.2/v11.3 新产品名检测**（五槽位解析 parseProductName + 五门判定 detectAdhocProductTerms + v11.3 LLM 兜底触发 detectFallbackCandidates）+ **v11.4 系列名 camelCase 品牌形态（nCARD/eSeries）** |
| `lib/product-name-generator.ts` | **v11.2 产品名 20 语种生成**（五槽位渲染 + CATEGORY_TRANSLATIONS 品类译法表 + WORD_ORDER 语序模板 + detectCategory 品类指纹）+ **v11.4 detectCategory 双遍匹配（大小写不敏感+品名语境守卫）+ core-strip i flag** |
| `lib/post-process.ts` | 译后处理（enforceGlossaryTerms、detectBrandInjection、restoreTrademarkSymbols、detectTranslationExpansion、cleanKey） |
| `lib/entity-masker.ts` | 实体/术语遮蔽（maskGlossaryTerms → maskEntities 顺序 v9.2） |
| `lib/glossary-filter.ts` | 术语过滤（filterRelevantGlossary、normalizeForMatch） |
| `lib/few-shot-examples.ts` | Few-shot 翻译示例（20语种 × 3 内容类型） |
| `lib/metrics.ts` | 翻译指标收集器 |
| `lib/text-normalizer.ts` | 文本预处理（Unicode NFC、全角→半角、零宽字符、↵保护） |
| `lib/default-glossary.ts` | 默认术语库（140 产品名 + 189 专属术语） |
| `lib/main.ts` | 插件主线程（扫描/appliedTexts 快照/undoAll 三方对比/selectionchange/**fixRegisterSymbolFont v9.6**） |
| `ui/App.vue` | UI 主组件（流程编排、sticky 操作区、待确认机制、busyPhase、computeUntranslatedBadge v9.5、buildGlossaryMaps 双视图 v9.10、v11.2 新产品名检测/生成/入库 + v11.3 LLM 兜底集成 + llmFallbackTerms 待确认 + **v11.12 违禁词徽章全链（源文/译文/四个旁路/校对回检/enableProofread 默认翻 true 迁移）+ v11.12+ prohibitedLockedIds 双徽章通道 + routeProhibitedHits 统一路由**） |
| `ui/styles.css` | 全部样式（Apple 设计令牌、深色覆盖、.footer v9.3 恢复、**v11.12 .prohibited-badge #e8890c + v11.12+ .locked 描边变体**） |
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
| `tests/test-v105-model-list-exemption.ts` | **v10.5 型号/裸单位豁免（39 断言：A 型号正反样例 + B 裸单位 + C 截断豁免 + D 脚本校验库值豁免 + E 端到端零重试 + F 20 语种普遍性）** |
| `tests/test-v106-misspelled-word.ts` | **v10.6 疑似错词保留+回退兜底（27 断言：A prompt 规则中英双语 + B 正反样例 + C 端到端音译回退+待确认 + D 20 语种拉丁不兜底/非拉丁兜底）** |
| `tests/test-v112-product-name-v2.ts` | **v11.2/v11.2.1/v11.2.2 新产品名全生命周期（48 断言：A 检测 22 + B 生成并入 6 + C 入库语义 6 + D NF100 端到端 8 + E 短路场景入库 6）** |
| `tests/test-v113-llm-fallback.ts` | **v11.3 LLM 兜底产品名检测（18 断言：A 触发条件 7 + B 校验逻辑 2 + C 端到端 SUPER/Fast/nCARD/正常路径 4 + D v11.2 回归 3）** |
| `tests/test-v113-exposed-product-names.ts` | v11.3 裸奔产品名分类验证（6 断言：C1 SUPER 误杀 / C2 MUSE 检出 / V1 nCARD **v11.4 起已检出** / V2-V4 不触发场景） |
| `tests/test-v114-case-insensitive-category.ts` | **v11.4 大小写形态统一（26 断言：A detectCategory 双遍匹配+守卫 8 + B core-strip 3 + C camelCase 系列 5 + D nCARD 端到端 4 + E 回归 6）** |
| `tests/test-v1112-prohibited-words.ts` | **v11.12 + v11.12+ 违禁词全链（154 断言：A 词表对表 20 语种+增补收录 / B 检测单元 59 含 g-flag 回归锁 / C 校对端到端 16 / D 关校对快照锁 7 / E 源语言判定 7 / F 术语库锁定豁免 18：豁免四形态+裸词仍命中+锁定判定六场景+预豁免零 note+混合批次分段断言+自由发挥不豁免）** |

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
npx tsx tests/test-v105-model-list-exemption.ts  # v10.5 型号/裸单位豁免+检测层豁免 39 断言（含 F 段 20 语种普遍性）
npx tsx tests/test-v106-misspelled-word.ts       # v10.6 疑似错词保留+回退兜底+独立待确认类别 34 断言（prompt 规则+非拉丁兜底+20 语种+漏翻通道区分）
npx tsx tests/test-v112-product-name-v2.ts       # v11.2/v11.2.1/v11.2.2 新产品名全生命周期 48 断言（检测/生成/入库/端到端/短路场景）
npx tsx tests/test-v113-llm-fallback.ts          # v11.3 LLM 兜底产品名检测 18 断言（触发条件/SUPER 端到端/Fast 拒绝/v11.2 回归）
npx tsx tests/test-v114-case-insensitive-category.ts  # v11.4 大小写形态统一 26 断言（detectCategory 双遍匹配+守卫/core-strip/camelCase 系列/nCARD 端到端）

# v11.12 起新增测试（ts-node 运行，tsx 不适用——package.json 模式）：
TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true,"types":["node"]}' npx ts-node -r tsconfig-paths/register tests/test-v1112-prohibited-words.ts  # v11.12 + v11.12+ 违禁词全链 154 断言（A 词表对表/B 检测单元/C 校对端到端/D 关校对快照锁/E 源语言判定/F 术语库锁定豁免）
```

**铁律**：每次改代码后必须执行 `npm run typecheck` + `npm run build`。build 过 ≠ tsc 过。

---

## 八、后续建议

**短期**：
1. ~~实机验证 v10.2~~ **已通过（2026-07-31）**：pt→ja 两句温度文案正常翻译，不再标漏翻/失败。遗留可选回归（有空顺带验证）：de→de 无误报、zh-CN→zh-TW、en→拉丁、"复制日志"自动全选 fallback
2. **实机验证 v11.12/v11.12+（当前版本，优先）**：①中文源文含「最佳」「终身质保」→ 扫描后源文徽章提醒；②zh→de 译文出现 `beste`/`Test` → 开校对自动改写+回检销徽章，关校对只提醒；③术语库条目 `Limited Lifetime Warranty`→`有限终身质保` → 译文锁定值命中词表但走**描边徽章**「⚠ 术语库违禁词」只提示不改写，且改写徽章不计数；④校对默认开（老用户一次性迁移）
3. 实机验证 v10.3/v10.4：跑一批翻译 → 诊断日志面板应看到 S1→S8 阶段轨迹 + 主线程 [main:scan]/[main:apply] 事件；关闭重开插件 → 应看到"── 恢复上次会话日志（N 条）──"分隔标记
4. 实机验证 v9.9/v9.10：pt-BR 自动检测 → ja 产品名走短路出术语库值；非电商场景营销术语不注入；校对改错术语时被合规校验拉回
5. 实机验证 v9.6：Avenir 字体的 `Lexar®` 文本，不翻译直接应用 + 字体替换后，® 是否都显示为 HarmonyOS 样式
6. 实机验证 v11.3：扫描含 `Lexar® SUPER PCIe Gen5x4 NVMe SSD` 的设计稿 → 应触发 LLM 兜底 → 待确认区显示"新品名待确认（LLM 辅助识别）"→ 点击"确认入库"后写入专属术语库；扫描含 `Lexar® Fast SSD` 的设计稿 → 应触发兜底但 LLM 判 isProductName=false → 放弃保护走正常管道
7. ~~提交代码~~ **全部已提交 + 已推 GitHub**（2026-08-23）：v9.5-v10.2 `5df3af2`；v11.7-v11.11 `921427b`；v11.12-v11.13 `b47d753`；v11.14-v11.15 `252c950`（远程 origin/master 与本地一致）
8. ~~R7 决策~~（已拍板 2026-07-31：现状即规则——去符号匹配，®™ 由源文驱动恢复，CSV 不携带符号，无需改代码）

**架构优化（见"五点一、架构复盘"，按收益/风险排序）**：
1. ~~判定逻辑单一事实源 + 豁免中央注册表~~ **已完成 v10.0**（lib/lang-detect.ts + lib/keep-source.ts）
2. 结构改进：~~管道阶段化 + 不变量审计~~ **已完成 v10.4** → ~~Prompt 减肥（~2600行 prompt 稀释注意力）~~ **v10.9 已做第一步**（市场语感分段注入 -40% token + 风格越界清理 + 场景 Success 意图行；剩余：模块归并/瘦身空间仍在）→ LLM 输出 schema 化（退役 `[N] text` 解析防御）
3. ~~日志持久化~~ **已完成 v10.3**；剩余：⑤metrics UI 面板（finalizeMetrics 只 console.log）⑥~~detectTranslationExpansion 语义移交校对~~ **已完成 v10.8**

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

**最后更新**: 2026-08-23
