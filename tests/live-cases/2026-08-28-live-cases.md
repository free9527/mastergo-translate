# 实机测试素材库 · 2026-08-28

**收录纪律**（2026-08-28 用户指令）：今后每次拿到完整实机调试日志，提取源文进 `tests/live-cases/<date>-live-cases.md`（或按日期分文件），标注原 LLM 输出 + 润色行为 + 价值标签 + 极端句全收——作为 judge 校准 / best-of-2 回归 / 润色管道回归的实机锚点。

**本日收录**：
- **第一节~第七节**：en→ja SILVER CFexpress 4.0 Type A（48 条目，v12.9 构建）
- **第八节**：en→tr NM1090 PRO + SILVER CFexpress 4.0（72 条目，v12.9 构建）

---

# 第一部分 · en→ja · SILVER CFexpress 4.0 Type A Card

**来源**：2026-08-28 MasterGo 实机调试日志（选中扫描 73 节点 → 合并 48 条目，三波 13+15+10 条翻译，润色管道 ja 灰度开启）
**产品线**：professional_imaging（SILVER CFexpress 4.0 Type A）
**用途**：极端句测试素材库——后续 best-of-2 择优、judge 校准、润色管道回归的实机锚点。**提取纪律：每条标注原 LLM 输出 + 润色行为 + 价值标签。**

---

## 一、极端标语（extreme-slogan）——质量方差最大区，best-of-2 主战场

### S1 ⭐核心案例：for All 标语（三次产出 ⭐⭐~⭐⭐⭐⭐⭐）

```
Source: CFexpress 4.0 Pro Performance, for All.
```

三次实机/评价产出对比（母语评审打分）：

| # | ja 译文 | 评审 | 问题 |
|---|---|---|---|
| ① | すべてのユーザーに CFexpress 4.0 のプロ仕様性能を | ⭐⭐ | 语序颠倒（受众前置），像句子半截，不适合 Slogan |
| ② | **CFexpress 4.0 のプロ仕様性能を、すべての人に** | ⭐⭐⭐⭐⭐ | **最佳锚点**：产品性能前置、for All 收尾，日本影像/存储品牌经典标语句式；プロ仕様性能=Pro Performance 精确对应 |
| ③ | すべてのユーザーへ、プロ向け CFexpress 4.0 の性能を | ⭐⭐ | **语义偏移**：プロ向け=面向专业人士，与 for All（开放给所有人）内核冲突——本次日志润色产物，全部硬锁+二次判定放行（verify 无事实锚定的盲区实锤） |

**judge 校准锚点**：② 是 5 星标准。best-of-2 择优若在 ①/② 间选择应稳定选 ②；在 ②/③ 间选择应稳定选 ②（③ factsIntact=false）。

### S2 标语：ワンランク上系

```
Source: Next-level CFexpress 4.0 performance
LLM: ワンランク上のCFe 4.0パフォーマンス
```
标签：calque 风险（CFe 缩写自创）/ 润色未触发（极短豁免）

### S3 标语：高速化した転送速度

```
Source: Faster transfer speeds
LLM: 高速化した転送速度
```
标签：极短营销标签 / 润色命中（第二波 [5]）但润色结果未在日志透出（命中后未见生效/回退行——疑似二次判定或 changes=0 静默路径）

### S4 标语：あらゆるショットを保存できる余裕（润色生效佳例）

```
Source: Room for every shot
LLM: あらゆるショットを保存できる余裕
润色生效: → 思う存分撮れる大容量
```
标签：**润色正样本**——「余裕」直译感 → 「思う存分撮れる」母语自然 + 「大容量」补足卖点语境

### S5 标语：プロ仕様 CFexpress 4.0（润色语义偏移事故现场）

```
Source: Pro-level CFexpress 4.0 performance for all users（大意，按日志译文反推）
LLM: プロ仕様のCFexpress 4.0パフォーマンス…
润色生效: → すべてのユーザーへ、プロ向けCFexpress 4.0 の性能を
```
标签：**润色负样本**——语义偏移（プロ仕様→プロ向け）实锤案例，verify 事实锚定的动机来源

---

## 二、长从句嵌套（long-clause）——结构镜像高危区

### L1 三速度并列长句（v11.3 兜底判非产品名，正确）

```
Source: The Lexar Professional SILVER CFexpress 4.0 Type A Card is future-proofed with max read speeds of 1750MB/s, max write speeds of 1650MB/s, and sustained write speeds of up to 1300MB/s.
LLM: Lexar Professional SILVER CFexpress 4.0 Type A カードは、最大読み出し速度1750MB/s、最大書き込み速度1650MB/s、持続書き込み速度最大1300MB/sを実現し、将来を見据えた仕様です。
```
标签：negation-polarity（up to→最大，限定词保留 ✅）/ 三数字并列 / 术语遮蔽 4 词
润色行为：第一波判定命中 [3]（未生效——日志未见该行润色生效，可能 changes=0 或二次判定路径）

### L2 对比从句（GLOSSARY 占位符嵌入）

```
Source: The Lexar Professional SILVER CFexpress 4.0 Type A Card delivers speeds more than twice as fast as our previous Professional SILVER CFexpress 2.0 Type A cards.
LLM: Lexar Professional __GLOSSARY_1__ CFexpress 4.0 Type A カードは、当社従来の__GLOSSARY_0__ SILVER CFexpress 2.0 Type A カードと比べて2倍以上の速度を実現します。
```
标签：对比极性（more than twice→2倍以上）/ 双占位符嵌套 / v11.3 兜底判非产品名（正确）

### L3 兼容性长句（Sony 双品牌+future-proof 双从句）

```
Source: The Lexar Professional SILVER CFexpress 4.0 Type A Card is compatible with current Sony Alpha and Sony FX cameras and, with cutting-edge PCIe 4.0 performance, it is future-proofed for next-gen Sony cameras as well.
LLM: Lexar Professional SILVER CFexpress 4.0 Type A カードは、現行の__GLOSSARY_0__ Alphaおよび__GLOSSARY_1__ FXカメラに対応し、最先端のPCIe 4.0性能により、次世代の__GLOSSARY_2__カメラにも対応できる将来性を備えています。
```
标签：三占位符 / 双从句 / v11.3 兜底判非产品名（正确）

### L4 三防规格长句（↵ 尾随行，多限定词）

```
Source: （大意）Designed for harsh environments, these cards are IP68 rated dust and water resistant, drop-proof up to 5m, and withstand strong bends, pressure, vibration, and shock for the durability demanded in the field.
LLM: 過酷な環境でも性能を発揮できるよう設計されたこれらのカードは、IP68相当の防塵・防水性能、最大5mの耐落下性を備え、強い曲げ、圧力、振動、衝撃にも耐える設計で、現場で求められる耐久性を実現します。↵
```
标签：spec-list + negation-polarity（up to 5m→最大5m ✅）/ 五并列名词 / ↵ 尾随行（润色后结构锁触发风险区）

### L5 大容量场景长句

```
Source: With up to 2TB of capacity, save countless burst photos and hours of 8K video without swapping cards mid-shoot.
LLM: 最大2TBの容量で、数えきれないほどの連写写真や何時間分もの8K映像を保存でき、撮影中にカードを交換する必要がありません。
```
标签：negation-polarity（up to 2TB→最大2TB ✅；without→必要がありません 否定保留 ✅）

### L6 恢复工具+保修句（术语偏离观察点 ⚠️）

```
Source: Accidentally deleted or formatted photos and videos can be easily recovered with the Lexar Recovery Tool, and the limited lifetime warranty gives you extra peace of mind.
LLM: 誤って削除したり、フォーマットしてしまったりした写真や動画も、Lexar復元ツールでかんたんに復元できます。さらに、限定ライフタイム保証でより安心してお使いいただけます。
```
标签：**术语偏离观察**——术语库 ja 钦定值是「Lexar リカバリーツール」（v9.2 修复对象），本条 LLM 输出「Lexar復元ツール」未走遮蔽（源文含 the Lexar Recovery Tool 完整形态应命中遮蔽——待复验：是源文形态变体未命中，还是遮蔽漏网）/ compliance（limited lifetime warranty 合规豁免 ✅ 未触发违禁词卡）

### L7 Lexar 品质ラボ句

```
Source: All Lexar products undergo extensive testing in the Lexar Quality Lab with thousands of cameras and digital devices to ensure performance, quality, compatibility, and reliability.
LLM: すべてのLexar製品は、数千種類のカメラやデジタル機器を備えたLexar品質ラボで広範なテストを受けており、性能、品質、互換性、信頼性を確保しています。
```
标签：compliance-adjacent（テスト 质量背书豁免「広範なテスト」✅ v12.9 新增豁免命中，未触发违禁词卡）

---

## 三、↵ 多行格（arrow-multiline）——结构锁实战区

### A1 双行标题（润色生效，↵ 结构保留）

```
Source: High-speed performance ↵ Stunning burst shooting
LLM: 高速パフォーマンス  ↵ 圧巻の連写撮影を実現
润色生效: → 高速性能 ↵ 高速連写をしっかりサポート
```
标签：arrow-multiline 润色正样本——↵ 个数不变 + 段内改写

### A2 脚注多行长文（润色生效，↵ 结构保留）

```
Source: ※Speeds based on internal testing. Actual performance may vary. ↵ *Current cameras are still based on CFexpress 2.0; until CFexpress 4.0 cameras arrive, the card's maximum speeds cannot be fully utilized. Combined with the Lexar Professional Workflow CFexpress 4.0 Type A card reader, ...
LLM: ※速度は社内テストに基づくものです。実際の性能は異なる場合があります。↵* 現在、現行のカメラはまだCFexpress 2.0規格に基づいているため、CFexpress 4.0対応カメラが登場するまでは、本カードの最大速度を十分に活用できません。Lexar Professional Workflow CFexpress 4.0 Type A カードリーダーと組み合わせることで、...
润色生效: [7] → …の性能は異なる場合があります。 ↵ * 現時点では、現行のカメラはまだCFexp…
```
标签：arrow-multiline + compliance（社内テスト豁免 ✅）+ 长脚注 / 润色段内保守（时间词微调）

### A3 回退案例：↵ 结构破坏（v12.7 结构锁首次实战立功）

```
（第二波 [5]）源文 0 个 ↵，润色后 1 个 ↵ → 硬锁回退
```
标签：**结构锁负样本**——LLM 擅自加断行被拦

---

## 四、合规/认证句（compliance）——豁免验证区

### C1 速度脚注（社内テスト）

```
Source: *Based on internal testing. Actual performance may vary.
LLM: ※社内テストに基づきます。実際の性能は異なる場合があります。
润色生效: → * 社内テストに基づく結果です。実際の性能は異なる場合があります。
```
标签：compliance（社内テスト豁免 ✅）/ 润色微调保守（基づきます→基づく結果です）/ ※→* 符号变化（观察点）

### C2 VPG 认证句（数字+认证规格）

```
Source: VPG200 support guarantees minimum sustained write speeds of 200MB/s...（日志截断）
LLM: VPG200に対応し、最低200MB/sの持続書き込み速度を維持するこ…（截断）
```
标签：spec + compliance-adjacent（VPG200 认证规格，「最低」限定词保留 ✅）

---

## 五、规格短句/标签（spec-short）——极短豁免区

```
Source: IPX8 waterproof          → LLM: IPX8の防水性能
Source: 5m drop resistance       → LLM: 5mの耐落下性
Source: Shock resistance         → LLM: 耐衝撃性
Source: Durable design           → LLM: 耐久性を追求した設計
Source: Designed for CFexpress Type A cameras → LLM: CFexpress Type A対応カメラのために設計
Source: CFA executive member     → LLM: CFAのエグゼクティブメンバー
Source: 1750MB/s*                → LLM: 1750MB/s*（恒等）
Source: 800MB/s*                 → LLM: 800MB/s*（恒等）
```
标签：spec-short / 极短豁免（≤3 词不润 ✅）——第二波人设判定命中多条此类短标签（白烧观察：命中后润色空间为零，大概率二次判定回退——短标签判定阈值待灰度数据定）

---

## 六、润色硬锁回退案例集（负样本——每类锁的实战形态）

| 锁类型 | 案例 | 回退原因 |
|---|---|---|
| 数字锁 | 第一波 [11] | 数字不一致（validateNumbers） |
| 术语锁 | 第二波 [6] | 术语库值被润色篡改（enforceGlossaryTerms） |
| 极性锁 | 第二波 [7] | 限定词/否定极性丢失（detectPolarityBreach） |
| 结构锁 | 第二波 [5] | ↵ 结构破坏（源文 0 个 ↵，润色后 1 个） |
| ™ 锁 | 第二波 [9] | ™完整性缺失（CompactFlash®） |
| 二次判定 | 第二波 [8][10] | 润色后无改善 |

### 润色生效佳例（正样本）

```
第三波 [12]: 決定的瞬間を逃さない—美しい連写撮影を支える高速性能
          → 決定的瞬間を逃さない。高画質な連写を支える高速性能
          （破折号→句号，断句改善；美しい→高画質な 具体化）
第三波 [13]: 最大1650MB/sの書き込み速度と最大1300MB/sの持続書き込み速度…
          → 最大書込速度1650MB/s、持続書込速度最大1300MB/s…
          （语序重组，素材同款「速度最大」后置形态——与 v12.9 ja 豁免表「速度最大」条目对齐 ✅）
第三波 [15]: …（別売）と組み合わせることで、このカードはCFexpress 2.0カードと比べ…
          → …（別売）と組み合わせることで、CFexpress 2.0カードと比べて、ポストプ…（截断）
第三波 [11]: …高速な持続書き込み速度により、シネマ品質の8K動画をコマ落ちなくシームレスに撮影…
          → …高速な持続書き込み速度により、映画のような高画質の8K動画をコマ落ちなくスムーズ…
          （シネマ品質→映画のような高画質，calque 修复佳例）
```

---

## 七、判定方差观察（judge-variance）

- 第一波 eligible 6 → 命中 2（33%）
- 第二波 eligible 10 → **命中 10（100%）**——召回尖峰，含多条极短规格标签（白烧）
- 第三波 eligible 7 → 命中 5（71%）
- 命中列表顺序漂移：`[1][2][3][4][5][8][9][10][6][7]`（并发批次完成序进 Map 键序）

**素材库使用建议**：本文件条目可作为 `tests/test-judge-baseline.ts --csv` 输入复跑，对比 best-of-2 前后 judge 分数；S1 标语三译文是 verify factsIntact / 择优判定的现成校准锚点。

---

## 八、tr 实机日志补充（2026-08-28，NM1090 PRO + SILVER CFexpress 4.0，en→tr）

**来源**：2026-08-28 tr 实机调试日志（89 节点 → 合并 72 条目，四波 15+15+14+4 条翻译，tr 灰度润色开启）
**产品线**：professional_imaging（NM1090 PRO SSD + SILVER CFexpress 4.0 Type A）
**版本**：v12.9 构建（非 v12.10——best-of-2 未启用，润色是 v12.3 灰度机制）
**特殊价值**：tr 限定词表实战立功 + 润色 ↵ 事故实锤 + en 绝对化词源文噪音实锤

### T1 极端句：性能标语（润色 ↵ 事故现场）

```
Source: Performance for the Next Level
LLM: Üst Düzey Performans（大意，按日志截断反推）
润色生效: [14] "Bir Üst Seviye için Perfo…" → "Üst Seviye ↵ Performans"
画布显示: Üst Seviye ↵ Performans ↵（字面 ↵ 字符——v12.10.2 修复对象）
```
标签：**润色 ↵ 事故实锤**——润色写回在 postProcessTranslation 之后执行，字面 ↵ 直接上画布（坑 20）

### T2 极端句：加载速度标语（↵ 结构保留润色佳例）

```
Source: Accelerate load times by up to 200%*
LLM: Yükleme Sürelerini ↵ %200'e Varan Hızlandırın（大意，按日志截断反推）
润色生效: [15] "Yükleme Sürelerini\n%200'e Varan …" → "Yüklemeleri ↵ %200'e Kadar Hızla…"
```
标签：arrow-multiline 润色正样本 + negation-polarity（up to 200%→%200'e Kadar ✅）+ tr 百分号前置形态（%200 非 200%）

### T3 极端句：DirectStorage 连写（格式净化+润色双重修复）

```
Source: Microsoft DirectStorage technology support significantly reduces game loading times.
LLM: MicrosoftDirectStorageteknolojisi desteği, oyun yükleme süresini önemli ölçüde azaltır.
润色生效: [7] "MicrosoftDirectStorageteknolojisi …" → "Microsoft DirectStorage teknolojis…"
```
标签：**连写拆分实锤**——LLM 把 Microsoft DirectStorage teknolojisi 连写成一词，v12.7 格式净化+润色双重修复

### T4 极端句：AI PC 营销长句（润色生效）

```
Source: Unleashing ultimate performance for AI PCs with exceptional speed and massive capacity.
LLM: Yapay zekâ PC'lerinin üst düzey ihtiyaçlarını olağanüstü performans ve geniş kapasiteyle karşılar.
润色生效: [5] "Yapay Zekâ PC'si için Üst Düzey…" → "Yapay zekâ bilgisayarları için …"
```
标签：营销长句润色佳例 + **源文侧 ultimate 违禁词卡**（v12.10.1 豁免对象——「ultimate performance for」语境锚定）

### T5 极端句：兼容性长句（限定词回退）

```
Source: Paired with the latest AMD and Intel CPUs and PCIe 5.0 motherboards, it ensures full compatibility for ultimate performance. Also backward compatible with PCIe 3.0 and PCIe 4.0 systems for broad usage compatibility.
LLM: En güncel AMD ve Intel işlemciler ve PCIe 5.0 anakartlarla birlikte kullanıldığında, üst düzey performans için tam uyum sağlar. Ayrıca, kapsamlı kullanım uyumluluğu sağlamak üzere PCIe 3.0 ve PCIe 4.0 sistemlerle de __GLOSSARY_2__ yapıdadır.
```
标签：双从句兼容性长句 + 三占位符 + **源文侧 perfect/ultimate 双违禁词卡**（v12.10.1 豁免对象）+ 润色回退（[2] 数字不一致——PCIe 代际数字被改）

### T6 极端句：容量选择句（三规格并列）

```
Source: Offers 1TB/2TB/4TB/8TB storage options for OS, large games, and HD media libraries.
LLM: 1TB/2TB/4TB/8TB depolama seçenekleri sunar. İşletim sistemi, büyük oyunlar ve HD medya de…（截断）
```
标签：spec-list 四规格并列 / 润色回退（[10] 限定词丢失——up to 类限定词在 tr 译文丢失）

### T7 极端句：IOPS 规格标签（极短豁免区）

```
Source: 4K Random Read Up to / 2100K IOPS / Up to / 8TB / Random Read Speed (IOPS) / 2100K / 2000K / 1650K / 1700K / 1800K / Random Write Speed (IOPS) / 4GB / DRAM Capacity / 700TBW*
LLM: 4K Rastgele Okuma En Fazla / 2100K IOPS / En Fazla / 8TB / Rastgele Okuma Hızı (IOPS) / 2100K / 2000K / 1650K / 1700K / 1800K / Rastgele Yazma Hızı (IOPS) / 4GB / DRAM Kapasitesi / 700__GLOSSARY_0__*
```
标签：spec-short 极短豁免（≤3 词不润 ✅）+ tr「En Fazla」= up to 限定词译法（与 ja「最大」同型——tr 限定词表 required=['en fazla','kadar','maksimum'] 对齐）+ 700TBW* 术语遮蔽（__GLOSSARY_0__）

### T8 极端句：BIT 测试句（润色生效）

```
Source: After 30 minutes of BIT operation...（大意，按日志截断反推）
LLM: BIT 30 dakika çalıştıktan sonra…
润色生效: [5] "BIT 30 dakika çalıştıktan…" → "30 dakikalık BIT çalışmas…"
```
标签：润色语序重组佳例（主语后置→前置，tr 语序自然化）

### T9 极端句：游戏性能标语（润色生效）

```
Source: Unleash Your Gaming Power
LLM: Oyun Gücünü Ortaya Çıkarın
润色生效: [4] "Oyun Gücünü Ortaya Çıkarın" → "Oyun performansınızı ortaya çı…"
```
标签：标语润色佳例（命令式→第二人称所有格，tr 营销语感）

### T10 极端句：脚注（社内测试）

```
Source: ※ Speeds based on internal testing. Actual performance may vary.
LLM: ※ Hızlar dahili testlere dayanmaktadır. Gerçek performans değişiklik gösterebilir.
```
标签：compliance-adjacent（test 词在 tr 词表——tr 译文「testlere」命中 tr 词表「test」？词表 word='test'，tr 译文 dahili testlere 含 test 子串——但 tr 日志零违禁词卡，说明 tr 词表检测对「testlere」形态的处理（词边界正则 \b 挡后缀）正确豁免）

### T11 en 源文违禁词噪音实锤（v12.10.1 豁免对象）

```
Source: Ultimate Performance for AI PC          → 源文违禁词卡（ultimate）→ v12.10.1「ultimate performance for」豁免
Source: Best Match for AI PCs                   → 源文违禁词卡（best）→ v12.10.1「Best Match」豁免
Source: The NM1090 PRO SSD offers superior Gen 5 performance → 源文违禁词卡（superior）→ v12.10.1「superior Gen」豁免
Source: The NM1090 PRO is the perfect match for ... → 源文违禁词卡（perfect）→ v12.10.1「perfect match」豁免
Source: Paired with the latest AMD and Intel CPU... → 源文违禁词卡（perfect、ultimate）→ v12.10.1 双豁免
Source: Unleashing ultimate performance          → 源文违禁词卡（ultimate）→ v12.10.1「Unleashing ultimate performance」豁免
```
标签：**en 绝对化词源文噪音实锤**——6 张卡全部是产品线官方文案的固定搭配/标题锚定形态，非无据宣称（与 ja「最大」同型）

### T12 判定召回尖峰实锤（与 ja 同型）

```
第一波 eligible 1 → 命中 1（100%——但只有 1 条）
第二波 eligible 8 → 命中 8（100%——含极短标签 [2][3]）
第三波 eligible 11 → 命中 10（91%——命中列表 [2][3][4][5][6][7][9][10][11][8] 乱序）
第四波 eligible 6 → 命中 4（67%）
```
标签：judge-variance——tr 判定召回与 ja 同型尖峰 + 短标签白烧（[2][3] 极短标签命中后回退）+ 命中列表乱序（v12.10 已修）

### T13 tr 译文侧零违禁词卡观察

```
全日志无 tr 译文违禁词记录——tr LLM 全部成功规避：
  Ultimate Performance → Üst Düzey Performans（üst düzey=upper level，安全表达）
  Best Match → ideal uyum（ideal=ideal，安全表达）
  perfect match → ideal seçenek / tam uyum（安全表达）
两种可能：①tr LLM 对绝对化词天然保守（üst düzey/ideal 这类安全表达）
         ②tr 词表覆盖形态与 tr LLM 实际输出形态错位（词表收 en iyi/mükemmel，LLM 输出 üst düzey/ideal——检测盲区）
```
标签：**检测盲区观察**——tr 译文侧是真规避还是漏检，待 tr 母语者抽查确认（记入待办）

