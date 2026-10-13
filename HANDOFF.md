# 项目交接文档（精简版）

**日期**: 2026-10-01
**版本**: v12.56（代码/提示词复盘落地轮：UI 漏翻徽章双视图根治 + glossaryEnMap identity 残留收口 + 技术语域卡×市场语感冲突护栏 + STYLE_GUIDES 死表退役）
**项目**: Lexar 翻译插件（MasterGo 插件）

> **本文件是精简版（日常加载）**——完整过程记录/测试细节/排查证据链在 **`HANDOFF-archive.md`**（304KB，原样保留）。需要细节时按「十一、archive 索引」检索完整版。

---

## 零·〇、Figma 版副本说明（2026-10-13）

**本仓库是 MasterGo 版（原版，平台差异的唯一权威）**。Figma 版已另立副本并存：

- **Figma 版仓库**：`github.com/free9527/figma-translate`（私有），本地 `Desktop/materGO/translate-figma`
- **移植方式**：反向 shim（`figma` 包成 `mg`），翻译业务承重墙零改动；平台差异收敛到 Figma 版的 3 个新文件（`lib/platform-shim.ts` / `lib/node-style.ts` / `lib/mg-shim.d.ts`），另有 2 个业务文件节点形状适配（`lib/text-collector.ts` / `lib/main.ts`）+ `manifest.json` 重写
- **两版同步**：本文件的版本史/架构/坑清单是翻译业务知识，两版共享。MG 版改翻译业务 → Figma 版 `git diff` 只对齐「翻译业务文件」，勿覆盖 Figma 版专属的 shim/manifest/typings 配置
- **维护手册（核心）**——**单向流动 + MG 权威**：翻译业务只在 **MG 版**迭代，做完同步到 Figma 版；Figma 版独立产出只有「平台适配外壳」。文件分三类：①纯业务（lib 除②③外/ui/messages/tests/typings/术语素材）→ 直接覆盖；②分叉文件只有 2 个（`lib/text-collector.ts` / `lib/main.ts`，`visible`/`readsFontName`/`installPlatformShim`/`BaseNode` 是 Figma 写法）→ 手工合并；③Figma 专属（platform-shim/node-style/mg-shim.d.ts/manifest/tsconfig/package）→ 永不覆盖。反向：Figma 实机发现的翻译业务 bug 回 MG 版修。**完整流程与同步命令见 Figma 副本 HANDOFF.md「零·〇」节**
- **Figma 版特有说明**（platform-shim 职责、networkAccess 通配风险、SharedPluginData 半失效、上架前换 plugin id 待办）详见 Figma 副本 HANDOFF.md「零·〇」节

---

## 零、当前版本速览（v12.47–v12.56，2026-09-29/10-01）

| 版本 | 一句话 | 验证 |
| :--- | :--- | :--- |
| **v12.56** | 复盘落地四件——①UI 漏翻徽章双视图根治（`computeUntranslatedBadge` 原传 full 视图、后端 `detectUntranslatedText` 传 en，v9.10 红线违规；改 en 对齐，错词豁免保持 full）②`glossaryEnMap` identity 残留收口（v11.3 兜底 + 独立校对路径两处 `set(term, term)` 改存译名，v12.50 同根复发）③技术语域卡×marketNote 冲突护栏（非详情页不再注入「满血版/战未来」市场语感，否则显式 override 技术卡第 5 条客观化）④STYLE_GUIDES 3×20 营销调死表退役（`getProductLineTone` generic fallback 恒非空致 `isEcommerce && !productTone` 恒假，整表从未进 prompt） | typecheck+build 绿；回归 40/40、54/54、61/61、26/26、40+40、48/48、94/94、177/177 全绿 |
| **v12.55** | 终态异常快照收口——`S1-identity保留英文`（软件名/硬件型号走术语库 source===target 通道保英文）是钦定正常路径，移出「终态异常」快照（此前误挂异常标签，实为正常行为惰性噪音）；可见性由上方 S1 短路汇总行保证 | typecheck+build 绿 |
| **v12.54** | #6/#7 根因修复——`confirmLlmFallbackTerm` 语义纠正（用户拍板：确认入库=收录进待入库池、**不 splice 池不标记 appliedNodeIds**）。旧实现 splice 池 → #6「确认入库后待入库术语归零」；标记 appliedNodeIds → 批量应用静默跳过 → #7「有译文但点应用画布不变」。修复：引入 `poolConfirmedKeys` 只消「待确认」阻塞、池保留原料、翻译照常走应用 | typecheck+build 绿；#6 实机下载拿到 1 条（旧 bug 0 条）/#7 实机 40 条目应用 42 节点成功 0 失败 |
| **v12.53** | #5 待处理面板重排（代码驱动，截图解码非插件 UI 不可用）——`pending-list` max-height 160→280px、条目 padding 8→10、源/译文 line-height 1.4、按钮区 flex-wrap+max-width 150px | typecheck+build 绿 |
| **v12.52** | 术语库 CSV 列序对齐——`serializeGlossaryCSV` 把 `en` 恒排最后一列（对齐产品名/专属内置库头部；UI 下拉 LANGUAGES en 在第 3 列但 CSV 导出序与其解耦）。parseGlossaryCSVText 按表头名解析不依赖列序，导入往返不受影响 | typecheck+build 绿 + 回归 86/86、28/28 |
| **v12.51** | 诊断日志增强——每条文本判定路径透出（`路径[源文]: 走的哪条路 → 译文`）+ S1 短路分支细分（`identity保留英文X条 [具体条目] / 术语命中Y条`）+ 覆盖变更追踪（`译文变更: 生成值 → 被X覆盖为Y`）+ 翻译批次完成锚点（`待应用N条（已译K条/译文=原文M条[应用时跳过替换]）`） | typecheck+build 绿；bundle 验证 6 个新日志串全在产物 |
| **v12.50** | **根因修复**——`glossaryEnMap.set(d.term, d.term)`（v11.2 新产品名 en 视图设成 identity）改为 `set(d.term, targetVal)`（存译名 src≠tgt）。**根因：identity 导致这条被 noTranslateTerms 收录为「保留英文不翻译」，S1 短路 identity 分支用英文原文覆盖代码生成的西语译文**（PLAY X 判定成产品名走了代码翻译却输出英文） | 298/298 断言全绿（10 套件，重点 test-v1114/test-v1232 identity 语义未受影响）；实机验证 PLAY X 出 `Unidad de estado sólido (SSD) Lexar PLAY X M.2 PCIe 4.0 NVMe` |
| **v12.49** | 术语治理收口——三个自动搜集口子（校后歧义词/手动修正译文/v11.2/v11.3 产品名）统一收录「待入库术语」池不静默入库 + 下载发开发者审核写回后台 + `loadGlossaryWithMerge` 发版**直接覆盖**内置默认库（GLOSSARY_VERSION 9→10，用户本地自定义全清）+ 专属库重置 127 条（删第三方品牌重复） | typecheck+build 绿；test-v119 E 段 3 断言待更新（合并升级→直接覆盖语义变更预期失败） |
| **v12.48** | 产品名代码生成规格词序归一——`generateProductNameTranslations` core 槽位 `M.2 ↔ PCIe` 相邻规格对归一到钦定 `M.2 PCIe 4.0`（与画布录入词序解耦，PLAY X es 出钦定形态） | 23 断言全绿 |
| **v12.47** | 产品名结构归一 key——`productStructureKey`（剥品类词+token 排序）+ `alignToGlossaryWordOrder`（**当前无生产调用点**，留作未来 S1 匹配层词序归一短路备用，用户已否决匹配层词序归一命中——保词序匹配是 S1 精确性保证） | 21 断言全绿 |

**v12.47-v12.51 复盘（PLAY X 实机事故驱动，三连问逼出根因）**：

**根因链**（用户三连问）：画布 `Lexar PLAY X PCIe 4.0 M.2 NVMe SSD`（词序反）→ S1 cleanKey 保词序匹配漏配（**用户拍板：这是对的，录入/书写问题非程序问题**）→ v11.2 检出为「新产品名」→ 代码生成 es 钦定形态 → **但被 S1 identity 短路覆盖回英文**。

**三层根因逐层剥离**：
1. **词序漏配**（表层）：cleanKey 不保词序归一 → 词序变体漏配（**用户否决匹配层词序归一命中**：保词序是精确性保证）→ 生成层 core 规格词序归一补（v12.48）
2. **identity 误伤**（核心，v12.50 根治）：v11.2 把 adhoc term 的 `glossaryEnMap` 设成 identity（`term→term`），导致 `noTranslateTerms`（en 视图 src===tgt 收录）把它当「保留英文不翻译」，S1 短路 identity 分支用英文原文覆盖代码生成的西语。**这是「判定成产品名走了代码翻译但输出英文」的直接根因**
3. **诊断日志盲区**（放大器，v12.51 补）：identity 短路把译文锁成英文但**完全无日志**，只能看到 v11.2 生成了西语、看不到被 identity 覆盖——排查只能靠用户截图译文列。补齐后「译文不对」可只凭日志定位路径+覆盖点

**术语治理（v12.49）**：自动搜集三类（校后歧义词/手动修正译文/产品名）此前静默写 `glossaryExclusive` 污染钦定库——统一收录**待入库术语**池（独立 clientStorage，不参与 S1 生效，「不与后台钦定混在一起」），用户点「下载」打包 21 列 CSV 发开发者审核 → 写回后台 → 发版 `loadGlossaryWithMerge` **直接覆盖**全员（原「合并升级保留用户词条」作废，污染条目一升级全清）。

---

## 零·五、历史版本速览（v12.30–v12.35，2026-09-24/28）

| 版本 | 一句话 | commit | 验证 |
| :--- | :--- | :--- | :--- |
| **v12.35** | 归一化口径统一——normalizeGlossaryKey 委托 cleanKey（ZV-E10 型连字符型号 S1 短路命中差异根治） | 待提交 | 全量回归绿 |
| **v12.34** | 宏观架构优化四件——S6 校验层收敛 4 位 + 品类词钦定校验闭环 + 重试保留 tone + 错词提示收口 | 待提交 | 26 断言全绿 |
| **v12.33** | 错词机制词典词误伤根治——LLM 语义判定（valid/misspelled）替代纯形态判定 | 待提交 | 57 断言全绿（含 G 段词典词直通 8 断言） |
| **v12.30** | 产品名归一+型号提取归一+品线闭环——C40E 命名事故根治 | 86a1341 | 型号提取 140/140、品线推导 24/24、归一 16/16 |
| **v12.31** | 技术语域卡——非详情页默认严谨专业，替代营销两层 | 0e99ad6 | 33 断言全绿 |
| **v12.32** | 保英文品类词锁词——v12.27 Fix 2 遗留根治 | c13dfe2 | 12 断言全绿 |

**v12.33-v12.35 宏观复盘与优化**（2026-09-28，ja 实机 Creators/Vloggers 被冤枉回退驱动，用户要求「不要头痛医头」宏观架构优化）：

**复盘方法**：两个侦察 agent 并行（prompt 注入链全模块 + 判定匹配机制矩阵），产出 10 段翻译 prompt/12 段校对 prompt 注入全景表 + 40+ 判定机制矩阵 + 判定矩阵总表（文本类型×机制）。

**确认的结构性问题与决策**（全部落地）：

| # | 问题 | 方案 | 版本 |
|---|---|---|---|
| 1 | 错词机制误伤词典词（形态判定词典词/真错词同形） | 判定权移交 LLM 语义（S2.5 形态预筛→LLM valid/misspelled 判定，json_object/30s/会话缓存）；判定失败=缺省 valid 放行；回退兜底不退役（misspelled+被音译仍兜回） | v12.33 |
| 2 | 品类词注入→校验断链（v12.27/v12.32 修了注入层，校验层空） | `enforceCategoryTerminology`（S6-V1 位）：源文含注入了的品类词→译文必须含钦定译法，不含→回退源文走重试链；`computeAllowedCategoryWords` 与注入层共享集合（注入什么校验什么）；保英文锁词/术语库命中/productName override 豁免；ja 片假名/de 复合词归一化 | v12.34 |
| 3 | 重试 STYLE 卡置空（v11.5 减肥误伤，重试产物无风格约束） | `getStyleCardSplit` 拆段：toneCard（产品线 tone+技术卡+FORMAT+DONT+MARKET NOTE，轻量 2-4 行）重试保留，styleGuideCard（完整营销调 5-6 行）重试砍掉 | v12.34 |
| 4 | S6 校验散落（9 个校验调用无编排，坑 15 位置判断事故源） | 收敛 4 个显式校验位：V1 术语合规/V2 事实完整性/V3 格式修复/V4 检测透出；只改编排不改校验内部，物理顺序不变（品牌注入仍在术语校准前） | v12.34 |
| 5 | 错词提示两次打扰（体检预判不准+黄条措辞指控性强） | 体检 misspelled 默认 false（判定前移 S2.5 后体检预判重复）；黄条「疑似拼写错误」→「未识别词·已保留原形」（中性不指控）；复用单条重翻出口（不新增白名单机制） | v12.34 |
| 6 | 归一化口径分裂（cleanKey 含 [-_]→空格，normalizeGlossaryKey 不含——ZV-E10 在 S1 短路不命中但在 enforceGlossaryTerms 命中） | normalizeGlossaryKey 委托 cleanKey（单一事实源），S1 短路与译后校准命中一致 | v12.35 |

**架构方向确认（v12.36+ 独立版本）**：判定置信度分层（高置信=代码形式判→直接执行/中置信=LLM 判→执行+用户可见/低置信=形态模糊→不执行只提示）——v12.33-v12.34 是错词域试点；统一待确认队列（中置信判定统一汇入，用户一处裁决）+ JudgmentTable 铺开（重复判定热点收敛：isUntranslatable 5 处/含数字 5 处/限定词 3 表）是后续版本。

**学习持久化原则（用户拍板）**：用户裁决只影响本次会话（复用单条重翻，不新增白名单机制）；持久化=后台手动（实机日志审计判定结果→手动加术语库/内置名单→下版本生效）。

**复盘裁决「不做」的**（防未来重复提出）：❌ 统一「词身份判定层」大方案（判定升格为闸门风险+漏翻错误模式）❌ 校验层统一回退策略（各策略不同是有意设计）❌ consistency 探测→回写（语义判断探测层零修改是对的）❌ 校对 prompt 减肥（质量地板不动）❌ 合并 LLM 判定调用（人设/verify/consistency 输入人设失败回退各不同，合并违背隔离原则）。

**v12.38 测试证实「不值得做」补充**（tests/test-feasibility-probe.ts 数据驱动，防重复提出）：
❌ **consistency 高置信自动对齐**——①-1 实测已收录型号（ZV-E10）遮蔽→还原保形，现有六层防线兜得住；且要撬「探测层零修改」红线（consistency-check.ts:12），LLM 语义判定有误判率（本次实机 2 条全正当变体误报），驱动自动改写=把语义风险写进画布。型号不一致正确解法=术语库收录变体，非事后对齐。
❌ **JudgmentTable 收敛**——②-1 实测 shouldKeepSource ≡ isUntranslatable(en 视图) 薄封装**已收口非真重复**；②-2 含数字条目级(every)≠批次级(some) 口径不同；②-3 5 处调用点视图分化（有/无 glossaryMap 行为不同）。**「名义重复实语义不同」，收敛=埋雷（v9.10 双视图红线 + 限定词承重墙）**。改事故驱动：真改某判定漏一处出事故时，再针对性收敛那一处。

---

## 一、项目背景与工作准则

MasterGo 设计工具插件，将 Lexar 产品设计稿从英文翻译成 20 个目标语言。核心目标：**不漏翻 / 不加戏 / 意思一致 / 适配 20 语种**。

**六维质量评审标准**（判断代码与修改是否达标的依据，不注入 LLM prompt）：①准确忠实（底线）②本地化表达 ③行业表达 ④调性匹配 ⑤格式规范统一 ⑥合规与文化适配。各 prompt 模块与六维的对应关系见 archive 一节。

**协作铁律（2026-08-13 用户定）**：
1. 拿到需求先沟通，不动手——缺信息就问，不脑补
2. 先定根因与解法，再定执行计划，才写代码
3. 改完必测——测试脚本 + `npm run typecheck` + `npm run build`（build 过 ≠ tsc 过）
4. 想闭环——每次修改想：能否与其他功能模块闭环（不制造新的短路/豁免/兜底缺口）

---

## 二、近期版本索引（一行一条，详情 archive）

| 版本 | 一句话 |
|---|---|
| v12.47-51 | PLAY X 实机事故根治五连：v12.48 生成层 core 规格词序归一钦定 + v12.49 三自动搜集口子收录待入库池不静默入库+发版直接覆盖（GLOSSARY_VERSION 10）+ **v12.50 根因修复——glossaryEnMap 不设 identity（noTranslateTerms 误伤代码生成译名根治）** + v12.51 诊断日志增强（每条文本判定路径/S1 短路分支细分/覆盖变更追踪/批次完成锚点）；**用户否决匹配层词序归一命中**（保词序是 S1 精确性保证） |
| v12.52-55 | 待确认/应用/面板/CSV 闭环轮（用户「UI 太丑/替换翻译/画布没反馈」一并处理）：v12.52 CSV en 末列对齐 / v12.53 待处理面板重排 / v12.54 #6 确认入库 splice 池归零 + #7 标记 appliedNodeIds 致应用静默跳过双根因修复（poolConfirmedKeys 分离「待确认」与「池」）/ v12.55 S1-identity 保英文移出异常快照 |
| **v12.56** | 复盘落地四件（四路侦察 agent 审计 + 我复核确认）：①UI 漏翻徽章双视图根治（v9.10 红线违规唯一生产存活点，改 en 视图对齐后端）②glossaryEnMap identity 残留收口（v11.3 兜底+独立校对路径两处，v12.50 同根）③技术语域卡×marketNote 冲突护栏（非详情页不注营销热词）④STYLE_GUIDES 死表退役（3×20 营销调从未进 prompt） |
| v12.39-46 | 校对确定性豁免（术语/规则翻译不走 AI 校对改写）/ ® 盲区修复（isGlossaryLockedTranslation de-® 比较）/ S5 unmask 连写修复 / 语料库 1704 条喂 TM + 语料锚点注入 judge/proofread / v12.42 人设候选→综合润色 A/B 测试失败已回滚 |
| **v12.58** | 人工钦定语料母库全量灌入 + 数字守卫落地：母库 `术语库/素材/商详小语种` 86 CSV 递归扫描（1704→**5245** 条，85 可解析）喂 TM 三闸（短路/few-shot/锚点）；三安全闸收口「提升翻译质量同时不出错」——长度闸 15~160（整段 listing 叙事死重弃）+ **数字守卫 NFKC 数字多重集相等**（HANDOFF 264 行挂起 TODO 落地，生成端+运行时双道）/ 品牌守卫（Lexar→Lexware 同款）；`CORPUS_VERSION=2` 进缓存键（语料更新旧缓存自然失配重翻，否则旧缓存遮蔽新钦定）；母库只读不回写 |
| **v12.59** | 术语库格式治理 + 匹配归一化收口（「原文不管，译文写对，匹配做归一」三原则落地）：①术语库 source 统一官方写法（Gen 规格词 Gen4x4 去空格/大小写/乘号、USB Gen1 补空格、2×2 字母 x、英寸弯引号→直引号、en 列 identity 补 (EOL) 2 条）——译文书写符合当地规范；②cleanKey 升级 5 处同源实现（post-process/entity-masker/glossary-guard/new-product-detect/glossary-filter）同步加「×→x + Gen 规格空格归一」两 arm——画布变体（Gen 4x4/Gen4X4/Gen 4×4/Gen 4 x 4）归一后命中术语库；③术语库语料书写规范清理（PUA/康熙部首），`GLOSSARY_VERSION` 11→**12** |
| v12.29 | ko 术语规范：smartphone→스마트폰 + 신뢰성/표준 시험→시험（收窄版，性能测试保留 테스트）；外部 agent 评审采信纪律：格式类先验伪影/术语类查钦定源/整段重写作废 |
| v12.28 | 质量×效率四杠杆（lib/batch-context.ts）：场景×阶段矩阵（客观陈述+格式敏感类关润色，bestOf2 收窄恒 true）/ consistency 连续 3 次超时降级 / 质量回归门禁三模式 / 源文前置体检 preflightSource（v12.34 起 misspelled 项默认关——判定前移 S2.5） |
| v12.27 | 品类词「裸奔」修复：buildCategoryTerminology 注入扩为「产品线映射 ∪ 源文动态检测」（只收多词品类词防泛词误判，向后兼容 token 零膨胀）；教训：正确方向是收敛判定所有权不是再加判定源 |
| v12.26 | 规格书语体场景卡扩充 20 语种（ja 6 条其余各 3 条）：敬语排除/广告修饰替换（替换非删除=红线）/动词直译回避；架构约束：override 须无 Expression: 前缀才能穿透 suppressExpression |
| v12.25 | 规格书三件套：含数字批次跳过 best-of-2 双跑 / 日志区分真一致与豁免 / 脚标「400MB/s1」单位族归一（`\b`→`(?!\w)`、mb/s→mb 同数值对应，数值篡改红线不破）；限定词表维持 8 语种不补齐 |
| v12.24 | 说明书场景优化：上下文注入假设被三轮实测推翻（+38% token 仅 1-3 条改进），落点=场景卡语体指令（es tú 亲体/ja 陈述体）；方法论：抽象方向假设必须实机对照验证 |
| v12.22 | 字重映射根治：AVENIR_TO_HARMONYOS_STYLE 表外字重透传致整条没换字体→normalizeFontStyle 26 条移 lib/font-mapper.ts 单一事实源，斜体降正体+表外兜底 Regular+结果强制∈真实字重表 |
| v12.21 | 相机品牌双语标签（佳能 Canon 式）漏翻误报根治：CAMERA_BRAND_CJK 17 品牌映射+isBilingualCameraBrand 严格两段判定，检测层豁免不动术语库 |
| v12.20 | 源文违禁词人工合规白名单：L0 白名单阻塞翻译/L1 豁免表补 15 条 zh-TW/L2 译文检测不动；红线：100% 不豁免、加锚不删词；合规语义判定交还人做 |
| v12.19 | best-of-2 引号归一化 + 判定类 30s 短超时（四判定任务失败走缺省安全路径）+ consistency fire-and-forget 8s；**判定层锦上添花/翻译层承重墙** |
| v12.18 | usage token 透出 + 校对骨架边界指令 + 校对批次动态化（>2000 字符 8→4）+ TM 短路（≥0.99）；GPT-5.6 prompt caching 本架构不通，缓存重排不做 |
| v12.17 | 术语整词边界守卫（app 切碎 applicability）+ Microsoft DirectStorage 内置 + 20 语种违禁词豁免补漏；PROHIBITED_WORDS_VERSION 词表/豁免表任何增删必须 +1 |
| v12.12-16 | 按段润色（splitSemanticSegments+段级硬锁）/ TM few-shot（origin=user ≥0.90 ≤2 条）/ 判定批次并行+润色违禁词豁免 / zh「最高+规格」豁免补漏 |
| v12.10-11 | verify factsIntact 事实锚一票否决 + best-of-2 翻译择优 / OEC 亚马逊清单增补（CTA/sale/new/free 裸词拒收红线）+ 缓存版本戳 |
| v12.0-9 | LLM 输出 schema 化（json_object+i 索引）/ judge 基线 19 语种 GO / 人设驱动判定→润色→八层硬锁 / ™™根治+逐实例恢复 / ↵收窄+zh-TW 灰度 |
| v11.x | 新产品名全生命周期（代码判定+代码翻译 LLM 不碰产品名）/ LLM 兜底产品名（三重收窄+JSON 结构化+形式校验）/ 违禁词全链 / 术语库双视图 / Prompt 减肥（首调 -54%）/ 自动入库守卫 |
| v9-v10.x | 术语遮蔽顺序 / 漏翻三层防线 / 判定逻辑收口（lang-detect+keep-source 单一事实源）/ 管道阶段化 S1-S8+不变量审计 / 截断误杀根治（长度代理→脚本存在性） |

完整版本史：archive 二节。

---

## 三、仍然有效的机制（勿破坏）

- **撤销语义**：appliedTexts 快照；undoAll 三方对比——画布文本仍等于译文的才恢复，用户手改的跳过
- **待确认机制（v8.9 业务契约）**：3 类阻塞（翻译失败/占位符残留/漏翻保留原文）强制处理后才能批量应用；红底=错误/占位符，黄底=漏翻，绿底=校对（不阻塞）
- **漏翻兜底（v8.7）**：保留原文不标 ⚠️[UNTRANSLATED] 是**错误教训**——v9.11 起漏翻必须进 translateErrors（静默兜底=漏翻隐身衣）
- **提示词系统（v8.6 定稿）**：getStyleCard productTone 存在时抑制 styleGuide（产品调性优先）；全组件 20 语种覆盖；CJK 中文指令非 CJK 英文指令

---

## 四、系统架构

**翻译管道**：
```
源文 → 预处理（HTML保护→标准化→术语预替换→maskGlossaryTerms→maskEntities→CJK空格→™剥离）
     → S2.5 疑似错词 LLM 判定（v12.33：形态预筛→valid/misspelled 分流）
     → Prompt 组装（10 段；重试保留 tone 砍 styleGuide，v12.34）→ LLM（temp=0.1）
     → S5 还原 → S6 校验层（v12.34 四位：V1 术语合规[enforceGlossaryTerms/合规锁/品类词校验] → V2 事实完整性[品牌注入/数字] → V3 格式修复[™/单位/首字母] → V4 检测透出[扩展/连写]）
     → S7 漏翻/截断检测 → 重试链 → S8 安全网 → 译文
```

**术语库六层防线**：1 译前短路 / 2 管道内预替换 / 3 术语遮蔽 / 4 glossaryHint 注入 / 5 译后强制校准 / 6 合规校验（整条命中锁定钦定值）。**双视图（v9.10）**：匹配类消费者用 full 视图（全语言 key），判断类消费者用 en 视图（仅 EN source）——不可混用。**归一化单一事实源（v12.35）**：cleanKey（含 [-_]→空格归一），normalizeGlossaryKey 已委托。

**品类词三层防线（v12.34 闭环）**：1 注入（buildCategoryTerminology 产品线映射∪源文动态检测+保英文锁词）/ 2 遮蔽（术语库收录的品类词遮蔽）/ 3 校验（enforceCategoryTerminology 源文含注入品类词→译文必须含钦定译法，不含回退重翻）。

**漏翻检测三层**：代码前置过滤（isUntranslatable）→ 代码变体校验（简繁特征字/拉丁功能词）→ LLM 语义校验（校对 CHECK 3）。

**关键配置**：TRANSLATE_BATCH_SIZE=15 / PROOFREAD_BATCH_SIZE=8 / CONCURRENCY=4 / API_TIMEOUT_MS=90000（判定类 30s）/ MAX_SCAN_NODES=1500 / UI 480×840。

---

## 五、踩过的坑（一行一条，绝对不要再踩；详情 archive 五节）

1. tsconfig.ui.json 通配符陷阱——`npm run build` 过 ≠ `tsc --noEmit` 过，两者都查
2. 字符集级语言检测不能用于拉丁细分——拉丁判定必须用批次级 detectSourceLanguage 或逐条 classifyNecessity
3. es/pt 功能词表混淆——拉丁细分必须用独占区分词表 LATIN_DISTINCTIVE_WORDS
4. 术语遮蔽必须先于实体遮蔽（v9.2）
5. 风格指令冲突——具体指令覆盖通用指令（productTone 抑制 styleGuide）
6. 指令语言错位——非 CJK 语种指令语言是英文
7. 同语言跳过场景的副作用遗漏——跳过文本替换时检查字体修复等其他副作用（v9.6）
8. 术语库 key 注册必须无条件覆盖全部语言列，与源语言检测方式解耦（v9.9）
9. 匹配视图（full）与判断视图（en）不可混用（v9.10）
10. 中间阶段快照会被下游兜底覆盖——「最终暴露给用户」的判定必须对最终结果重新检测（v9.11）
11. 静默兜底=漏翻隐身衣——兜底必须显式（标记或进待确认）
12. 长度代理跨语系失效——代码判定只能用形式信号，语义判定移交校对 LLM；代理指标必须声明有效域（v10.2）
13. 队列式 mock 队列错位——判定逻辑改动后测试失败，先核对 mock 队列与新调用序列对齐，再怀疑代码
14. 静态词表做语义判定必然有边界——LLM 结构化 JSON+代码形式校验可兜边界（v11.3）
15. 豁免/修正若加在「锁定之后」就是死代码——每个豁免点问：这个变异在谁之前生效？（v11.12+）
16. 测试按「邻近文本+定长窗口」断言会出血——断言按结构边界 `[n]` 切段，不按字符数窗口
17. 模型能力升级导致旧防护对新失败模式失效——形式校验层覆盖边界要随模型能力定期重审；形式问题代码修比 prompt 修可靠 100 倍，但要覆盖模型实际输出形态非想象形态
18. 归一化函数多处定义必漂移——同一「归一化」概念的函数必须单一事实源（v12.35 cleanKey 收口：normalizeGlossaryKey 无 [-_]→空格归一致 ZV-E10 型连字符型号 S1 短路与译后校准命中不一致）
19. 注入层修好了不等于闭环——「注入→校验」是两层，LLM 不遵守注入时校验层是最后防线（v12.34 品类词：v12.27/v12.32 修注入，v12.34 补校验）

---

## 五点一、架构复盘结论（2026-07-31）

**bug 大头是代码确定性缺陷非 LLM**。三个结构性问题：①同一判定多处实现改一处漏一处 ②豁免无中央注册表（最危险）③兜底链无不变量审计。

**代码/LLM 职责边界（v10.2 定原则）**：代码管「形式」（字符类型/脚本存在性/集合包含/计数/空值，零误判），LLM 管「语义」（完整性/等价性/风格）。历史全部误杀=代码用代理指标干语义的活。

五方向全清：判定收口（v10.0）/ 豁免注册表（v10.0）/ 管道阶段化（v10.4）/ Prompt 减肥（v11.5）/ 输出 schema 化（v12.0）。

---

## 六、关键文件

| 文件 | 职责 |
|------|------|
| `lib/prompt-constants.ts` | 提示词常量（STYLE_GUIDES、LANG_SPECIFIC、PRODUCT_LINE_TONE_GUIDES、SCENE_CONSTRAINTS、CORE_PRINCIPLES、TECHNICAL_REGISTER、PROOFREAD_SYSTEM_PROMPT、违禁词校对块、v12.34 getStyleCardSplit 拆段/computeAllowedCategoryWords 共享集合） |
| `lib/llm-api.ts` | LLM 调用+翻译/校对管道+重试+三层漏翻+术语合规+管道阶段化 S1-S8+v12.33 错词 LLM 判定（judgeMisspelledWords）+v12.34 S6 四位校验编排+人设判定/润色；**归一化单一事实源 cleanKey（v12.35）** |
| `lib/polish-guard.ts` | 润色资格负面清单+八层硬锁（数字/术语/极性/单位/™/↵/违禁词） |
| `lib/prohibited-words.ts` + `lib/prohibited-check.ts` | 违禁词表（20 语种对表+豁免总表+`#`数字锚定语法）+ 检测纯函数；**词表增删必须 bump PROHIBITED_WORDS_VERSION** |
| `lib/lang-detect.ts` / `lib/keep-source.ts` | 语言检测单一事实源 / 豁免中央注册表 |
| `lib/new-product-detect.ts` / `lib/product-name-generator.ts` / `lib/product-model-extract.ts` | 新产品名检测（五槽位+五门+LLM 兜底）/ 产品名 20 语种生成 / 型号提取归一（xlsx 140 行钦定） |
| `lib/third-party-models.ts` | 内置第三方词条+整词豁免名单+相机品牌双语映射（只豁免不遮蔽/只豁免+遮蔽/只进段名单三类边界） |
| `lib/post-process.ts` | 译后处理（enforceGlossaryTerms/detectBrandInjection/™还原/数字格式修复/finalizeForCanvas/**v12.34 enforceCategoryTerminology 品类词钦定校验**） |
| `lib/batch-context.ts` | 场景×阶段矩阵+consistency 降级+源文前置体检（v12.34 起 misspelled 项默认关）+effective 开关计算 |
| `lib/translation-memory.ts` | TM 模板匹配+few-shot 检索（origin=user ≥0.90 数字集合相等防线） |
| `lib/entity-masker.ts` / `lib/glossary-filter.ts` / `lib/font-mapper.ts` | 实体/术语遮蔽（术语先实体后）/ 术语过滤 / 字重映射单一事实源 |
| `lib/judge-personas.ts` / `lib/consistency-check.ts` | judge 人设库（20 语种×2）/ 跨批次一致性探测（timedOut 报告语义） |
| `lib/default-glossary.ts` | 默认术语库（140 产品名+189 专属术语） |
| `lib/main.ts` | 插件主线程（扫描/appliedTexts 快照/undoAll/fixRegisterSymbolFont） |
| `ui/App.vue` | UI 主组件（流程编排/待确认机制/违禁词徽章全链/润色管道集成/缓存 key 含版本戳） |
| `tests/` | 行为级测试套件（mock XHR 打穿真实管道），test-v*.ts 按版本编号 |

---

## 七、构建与测试

```bash
npm run typecheck    # tsc 双项目（plugin + UI），必须过
npm run build        # 生产构建，必须过

# 常用回归（完整清单 archive 七节）
npx tsx tests/test-untranslated-v3.ts           # v9.5 漏翻三层 40 用例
npx tsx tests/test-v99-glossary-all-langs.ts    # v9.9+v9.10 术语库双视图 33 断言
npx tsx tests/test-v106-misspelled-word.ts      # v10.6+v12.33 错词机制 57 断言
npx tsx tests/test-v1234-category-verify.ts     # v12.34 品类词校验/校验位/重试 tone/错词提示 26 断言
npx tsx tests/test-v112-product-name-v2.ts      # 产品名全生命周期 48 断言

# v11.12 起部分套件用 ts-node（tsx 不适用）：
TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true,"types":["node"]}' npx ts-node -r tsconfig-paths/register tests/test-v1112-prohibited-words.ts
```

**铁律**：每次改代码后必须 `npm run typecheck` + `npm run build`。build 过 ≠ tsc 过。

**记忆与文档位置**：项目记忆 `~/.claude/projects/C--Users-Administrator-Desktop-materGO-translate/memory/`（MEMORY.md 索引+每事件一文件）；全局记忆不存在（`~/.claude/CLAUDE.md` 未创建）。

---

## 八、后续建议（当前待办）

**待实机验证**（2026-09-16 协议，v12.20-v12.21.1 三连）：
1. 一致性探测病灶格：zh-TW 重扫兼容性列表，看日志格8/格10「源/译」全文 → 按根因（H1 措辞不统一/H2 真漏翻/H3 judge 误判）再出方案
2. 相机品牌双语：zh-TW「佳能 Canon」等 7 条 → 零漏翻徽章、不重试、不出现「佳能 Canon品牌」加戏
3. 违禁词白名单：源文真违禁词→「判定合规」→ 阻塞翻译→点击放行→重开插件白名单仍在（clientStorage 落盘验证点）

**待办事项**：
- v12.30 泄露的 API key 需轮换（已进 git 历史）；真实质量门禁待配 `LEXAR_LIVE_API_KEY` 环境变量
- 品牌词规则缺口备忘（H1 根因成立时候选方向，archive 八节）
- 亚马逊违禁词清单 diff 已收口（2026-09-16 零新增可收，备忘在 lib/prohibited-words.ts 头注释）
- v12.25 限定词表快速补表通道：任何语种实机再现「品牌注入回退」→ 贴源文+译文，10 分钟定位补表

**v12.33-v12.35 待实机验证**（本次宏观架构优化三连）：
1. 重翻含 Creators/Vloggers 的设计稿 → 词典词正常音译（不回退不黄条）
2. 含连字符型号（ZV-E10 型）设计稿 → S1 短路命中（归一化统一效果）
3. 含品类词但 LLM 自由发挥的 → 品类词校验触发回退重翻

**中期/长期**：判定置信度分层完整版（统一待确认队列+会话级裁决）/ ~~JudgmentTable 铺开~~（v12.38 测试证实不值得做，见零节不做清单）/ ~~限定词三表合并~~（v12.56 复盘确认 POLARITY_TABLE 与 MEASURE_QUALIFIERS 语义独立勿合并，已加交叉护栏注释——改任一语种限定词须检查另一表同步）/ 指标收集器 UI 面板 / 术语库版本管理。

**v12.38 待办（实机驱动）**：连字符型号无连字符变体缺口——`cleanKey('ZV-E10')='zv e10'` ≠ `cleanKey('ZVE10')='zve10'`，术语库只收 `ZV-E10` 时源文写 `ZVE10` 匹配不上。**按事故驱动不预防式补词**：实机真碰到 `ZVE10` 类无连字符变体漏匹配时，术语库补 identity 变体（third-party-models.ts），不动 cleanKey 口径（影响全管道）。

**v12.49 待办**：
- test-v119-builtin-third-party.ts E 段 3 断言（E6/E7/E9）测的是旧「合并升级保留用户词条」语义，v12.49 改直接覆盖后过时，**待更新为「直接覆盖」新语义断言**
- test-v118 B3c unmask 空格插入（`Pocket 4 P` vs `Pocket 4P`）是遮蔽-还原链既有缺陷，**与 v12.49 无关**，单独排查 `unmaskGlossaryTerms` 对含数字+字母后缀词条的还原
- v12.49 实机验证：PLAY X 词序变体 es 出钦定形态 / 待入库术语模块收录+下载清空+提示 / 升级后本地污染条目被直接覆盖清除

**v12.50/51 待实机验证**：
- PLAY X 点开始翻译 → 译文列出 `Unidad de estado sólido (SSD) Lexar PLAY X M.2 PCIe 4.0 NVMe`（西语，不再英文）→ 应用翻译写进画布
- v12.51 诊断日志：翻译完看日志能否直接定位路径——`路径[源文]: 走的哪条路 → 译文` / `S1短路: identity保留英文X条 [具体条目] / 术语命中Y条` / `译文变更: 生成值 → 被X覆盖为Y` / `翻译批次完成: 待应用N条（已译K条/译文=原文M条[应用时跳过替换]）`
- 验证点：下次「译文不对」只凭诊断日志定位，不再需要用户截图译文列/确认操作顺序

**v12.56 待办（复盘产出，两件翻译质量提升项单独立项）**：
1. **TM 语料锚点效果证据链**——v12.46 的语料锚点（judge/proofread 向人工钦定对齐）是「按行业经验」注入，全库**无任何量化证据**（锚点注入前后质量差异零数据）。做法：跑一次 A/B 对照（无锚点 vs 有锚点），复用 `claude-tmp/test-v1242-polish-ab.ts` 的编辑距离脚本（要烧一次性 API token）。~~②在 `loadHumanCorpus` 加「源文数字==钦定译文数字」形式守卫~~ **→ v12.58 已落地**（生成端 gen-corpus-inline.ts + 运行时 loadHumanCorpus 双道数字守卫 + 长度闸 + 品牌守卫）。
2. **翻译首调去整句化锚点**——现在翻译首调 few-shot 是「整条原文→整条译文」（`lib/llm-api.ts` fewShotBlock 替换处），改成抽**具体关键词/短语对照表**（复用术语库/品类词/品牌词表，代码可判的形式信号，不引入 LLM 抽词）。依据：v12.24 教训「上下文注入 +38% token 仅 1-3 条改进」+ 项目铁律「具体词汇>抽象形容词」。**前提：先设计抽词逻辑（何种短语值得锚）再动手。**

**v12.56 复盘归档「不要再提」（防重复提出）**：
- ❌ 人设判定→润色整链加投入（v12.42 A/B 已回滚：润色后编辑距离 -6.6% 变差、21/30 持平；v12.3 迭代4「32 次润色 0 生效」两次证据同向）
- ❌ 限定词双表合并（语义独立，见「中期/长期」划线行）
- ❌ STYLE_GUIDES 恢复/复活（已退役，generic fallback 已承担通用语感，恢复反而制造 v12.56 前已审计出的 A1/A2 冲突）
- ❌ 给「该断不断」加独立改写信号（定性为可靠性约束的故意取舍）
- ❌ 松/紧 TM 相似度阈值 0.90（数字防线已锁死规格错位风险，分层合理）

---

## 八点五、长期方向：去除机翻感（持续迭代，非一次性任务）

机翻感=四类型合称（结构镜像/词汇机翻味/语域错位/该断不断），解药各异。核心认知：**抽象形容词对 LLM 几乎无效，具体词汇/反例/对照表才有效**；无人值守场景的去机翻感有天花板——天花板由形式可验证性划定。

**现状**：方案 B（机翻味反面词表 v12.2）✅；方案 C（judge 基线 v12.1，19 语种 fidelity 全线 4.77+）✅；方案 A 轻润色（v12.3 人设判定→润色→硬锁，de/es/ru/tr/zh-TW 灰度）✅ 已上线但**迭代 5 诚实判定=有效但有限（锦上添花层不再投入优化）**；重写级润色在无人值守下**永久取消**（语义判断必须可形式化）。

完整方案 A 设计定稿+迭代记录：archive 八点五节。

---

## 九、Prompt 组装结构

**翻译**：IDENTITY → CORE_PRINCIPLES（LEAN 首调/REMEDIATION 重试层）→ MISSION → STYLE（getStyleCard：详情页=产品 tone+style，非详情页=技术语域卡）→ EXAMPLES → LANG Guidelines → CONTEXT → GLOSSARY → OUTPUT（json_object `{"translations":[{"i,"text"}]}`）

**校对**：MISSION → ROLE → CORE DIRECTIVE（修客观错不做主观改）→ CHECK 1-5（完整性/语义自然/漏翻/语法拼写/术语一致；已润色条目走 CHECK 1R 分叉=信息点对应非逐句对应）→ GLOSSARY REFERENCE → OUTPUT（json_object）→ VALIDATION

User Message 格式：翻译 `[N] ({src}→{tgt}) "source"` / 校对 `[N] ({src}→{tgt}) source\nTrans：translation`

---

## 十、环境联网搜索定案

**本环境原生 WebSearch/WebFetch 永久不可用**（kimi 网关只实现聊天补全，域名验证地址硬编码 api.anthropic.com）。**外部搜索一律走 Tavily**：MCP（主，`mcp__tavily__search`）+ 脚本 `npx tsx claude-tmp/tavily-search.ts "query"`（备，多 key 轮询）。免费 1000 次/月；额度不够补 Bing CLI（cn.bing.com 本机直连可抓，未实现）。3 个 key 已明文建议轮换。完整排查证据链：archive 十节。

---

## 十一、archive 索引（HANDOFF-archive.md 章节检索）

| 要找什么 | archive 章节 |
|---|---|
| v12.24-v12.32 完整过程记录/用户拍板细节/测试明细 | 零、二（各版本小节） |
| v12.8 及以前完整版本史 | 二、历史版本 / 二点四 / 二点五 |
| 六维质量标准与 prompt 模块对应关系 | 一、1.1 |
| 17 个坑的完整案例与根因 | 五 |
| 架构复盘五方向完整论述 | 五点一 |
| 全部测试文件清单与断言数 | 六（关键文件表 tests 段）、七 |
| 去机翻感方案 A 设计定稿（资格负面清单/动作白名单/CHECK 1R/硬锁四层/facts 三标注）+ 迭代 1-5 记录 | 八点五 |
| Prompt 模板完整骨架 | 九 |
| 联网搜索排查证据链（可复验） | 十 |
| 实机验证协议/品牌词缺口备忘/v12.25 决策备忘 | 八 |

---

**最后更新**: 2026-10-01（v12.56 代码/提示词复盘落地四件：UI 漏翻徽章双视图根治 + glossaryEnMap identity 残留收口 + 技术语域卡×市场语感冲突护栏 + STYLE_GUIDES 死表退役；完整版 → HANDOFF-archive.md）
