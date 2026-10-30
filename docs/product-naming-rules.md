# Lexar 产品命名规则与兜底方案

- 整理日期：2026-10-30
- 适用项目：Lexar 翻译插件（MasterGo 主仓库；翻译业务同步适用于 Figma 副本）
- 范围：已入库产品名的使用，以及未入库英文产品名的识别、规则生成与人工确认
- 语言：20 个语言代码，即英语加 19 个目标语言
- 性质：当前实现说明，不是要求大模型自由翻译产品名的提示词，也不代表插件已发布

## 1. 总原则

1. **已有整条钦定译名优先**：命中产品名术语库时，使用对应语言的已审核译名。
2. **新品译名由代码生成**：识别结构后，按品类、规格、语序和语言词表生成，不让大模型编写产品译名。
3. **辅助识别不等于辅助翻译**：模型可以参与“是不是产品名”的识别；识别成功后仍调用同一个确定性生成器。
4. **未知信息不猜不删**：保留未支持的片段，返回审核原因，走现有待确认流程。
5. **地区例外不外推**：已有地区官方名、中文营销名、人工钦定规格，不自动成为所有新品的通则。
6. **匹配和输出分层**：匹配不任意重排词序；输出只执行明确支持的局部规格排版。

> 实现边界：“不让模型编写产品译名”适用于成功进入产品名保护链的条目。代码和辅助识别均未确认的文本，目前会回到普通翻译管道，尚不是“所有疑似产品名一律保留英文”的全覆盖硬锁，详见第 13、14 节。

## 2. 产品名组成

```text
品牌 + [Professional] + [系列/等级] + [型号] + [规格] + 品类
另按产品增加：[磁吸属性]、[世代]、[尾部系列名]、[配件]
```

| 字段 | 规则 |
|---|---|
| 品牌 | Lexar 保留，新品不自动译成“雷克沙” |
| 产品线标识 | Professional 保留，不译成“专业级”等 |
| 系列、等级、型号 | ARES、THOR、JumpDrive、DIAMOND、GOLD、Z99 等保留 |
| 技术标准 | CFexpress、microSDXC、UHS-II、PCIe、NVMe 等保留 |
| 品类 | 按产品子类和目标语言处理 |
| 结构标签 | Type、Series、2nd Gen 按已支持规则本地化 |
| 配件 | 与主体拆分，不混入型号或主体品类 |
| 中文营销名 | 不自动创造，不跨型号继承 |
| (EOL) | 下架状态，从生成输出移除，产品记录保留 |

不补接口代数、容量、速度、NVMe、UDIMM/SODIMM 或其他源文缺失信息。

## 3. 基础语序

“主体”指品牌、产品线、系列、型号及保留的规格。

| 基础语序 | 语言代码 |
|---|---|
| 主体 + 品类 | zh-CN、zh-TW、ja、ko、de、en |
| 品类 + 主体 | fr、es、it、pt、pt-BR、ru、th、id、ar、nl、pl、sv、tr |
| 按品类决定 | vi |

越南语：SSD、Card、Desktop Memory、Laptop Memory 品类前置；Portable SSD 品类后置；Reader、Enclosure、Hub 当前整条英文产品名保留；双接口盘另走专门分支。

**特殊结构优先于基础语序**：意语存储卡、双接口盘、系列后缀、配件各有分支。

## 4. 存储卡细分

### 4.1 CFexpress

完整规格块：`CFexpress + [版本] + Type A/B`。

- CFexpress 不翻译；Type A/B、2.0/4.0 不混同。
- 源文无版本时不补版本。
- 当前明确支持 Type A/B；其他 Type 字母不视为已覆盖格式。

| 源文 | de | es | it | 其他语言 |
|---|---|---|---|---|
| Type A | Typ A | Tipo A | Tipo A | Type A |
| Type B | Typ B | Tipo B | Tipo B | Type B |
| Type-C | Typ-C | Tipo-C | Tipo-C | Type-C |

不使用 Tye 或 Tipe。德语 Typ 是本项目选定的本地化标准，不表示所有官网都只使用 Typ。

```text
源文：Lexar Professional DIAMOND CFexpress 4.0 Type A Card

de：Lexar Professional DIAMOND CFexpress 4.0 Typ A Karte
es：Tarjeta Lexar Professional DIAMOND CFexpress 4.0 Tipo A
it：Scheda CFexpress 4.0 Tipo A Lexar Professional DIAMOND
```

意语：**品类 + 完整介质规格块 + 品牌及系列/型号**。

### 4.2 SD

规格块：`SD / SDHC / SDXC + [UHS-I / UHS-II / Express]`。

保留原介质和等级，不把 SDXC 改成 SDHC，不把 UHS-I 升级成 UHS-II。意语完整规格块前置。

```text
Lexar Professional NOVA SDXC UHS-II Card
it → Scheda SDXC UHS-II Lexar Professional NOVA
```

### 4.3 microSD

规格块：`microSD / microSDHC / microSDXC + [UHS-I / UHS-II / Express]`。

- 支持源文明示的斜杠双格式，如 microSDHC/microSDXC UHS-I。
- 不因另一产品使用双格式，就给单格式新品补另一种介质。
- microSDXC Express 不降为普通 UHS 卡；意语规格块整体前置。

```text
Lexar Professional NOVA microSDXC Express Card
it → Scheda microSDXC Express Lexar Professional NOVA
```

### 4.4 NM Card 与其他格式

NM Card 不套 SD/microSD 介质重排模板。CFast 等未支持格式保留信息并返回审核原因。能识别 Card 品类，不等于支持该卡格式的完整命名。

## 5. 等级与系列后缀

### 5.1 前置等级

`Lexar Professional GOLD …`、`Lexar Professional DIAMOND …` 中的等级原位保留，不译成金色、钻石。

### 5.2 尾部 Series

当前支持尾部 GOLD、SILVER、BLUE、DIAMOND、Elite Legends + Series。

| 语言 | GOLD Series 后缀 |
|---|---|
| de | der GOLD-Serie |
| fr | série GOLD |
| es、it | Serie GOLD |
| zh-CN、zh-TW | GOLD 系列 |
| ja | GOLD シリーズ |
| ko | GOLD 시리즈 |
| 其他 | GOLD Series |

德语 Elite Legends 单独使用 Elite Legends-Serie。**Series 表示系列，不表示复数卡。**

```text
Lexar Professional CFexpress Type A Card GOLD Series

de → Lexar Professional CFexpress Typ A Karte der GOLD-Serie
it → Scheda CFexpress Tipo A Lexar Professional Serie GOLD
es → Tarjeta Lexar Professional CFexpress Tipo A Serie GOLD
```

### 5.3 E-Series / Plus

| 语言 | E-Series Plus 后缀 |
|---|---|
| de | der E-Serie Plus |
| fr | série E Plus |
| es | Serie-E Plus |
| it | Serie E Plus |
| 其他 | E-Series Plus |

不吞入型号；未覆盖系列后缀保留并记录审核原因。

## 6. U盘细分

### 6.1 普通 Flash Drive

| 语言 | 产品名品类词 |
|---|---|
| zh-CN / zh-TW | 闪存盘 / 隨身碟 |
| de | Flash-Laufwerk |
| fr | Clé USB |
| es | Unidad flash |
| it | Unità flash |
| ja | フラッシュドライブ |
| ko、vi | Flash Drive |
| pt / pt-BR | Pen USB / Pen Drive |

德语源文含 USB Flash Drive 时组合为 USB-Flash-Laufwerk。

### 6.2 Dual Drive

与普通 Flash Drive 分开：

- de、it：保留 Dual Drive 原槽位，并本地化 Type 标签。
- es：Unidad dual + 去除英文品类后的主体。
- fr：Lecteur double + 去除英文品类后的主体。
- ko、vi：保留英文结构。
- zh-CN、zh-TW、ja：保留 Dual Drive 结构并追加相应闪存盘品类。
- 其余语言按现有分支保留 Dual Drive 信息并添加相应品类，不视为所有语言均已深度本地化。

```text
Lexar JumpDrive Dual Drive Z99 USB 3.2 Gen 1 Type-C

de → Lexar JumpDrive Dual Drive Z99 USB 3.2 Gen 1 Typ-C
es → Unidad dual Lexar JumpDrive Z99 USB 3.2 Gen 1 Tipo-C
it → Lexar JumpDrive Dual Drive Z99 USB 3.2 Gen 1 Tipo-C
```

### 6.3 Solid State Dual Drive

| 语言 | 主要表达 |
|---|---|
| de | Dual-SSD，保留原品类槽位 |
| es | SSD doble |
| fr | Lecteur double SSD |
| it | a stato solido Dual Drive，保留原品类槽位 |
| zh-CN | 双接口高速固态U盘 |
| zh-TW | 雙介面高速固態隨身碟 |
| ja | ソリッドステートデュアルドライブ |
| ko、vi | 保留英文结构 |

其余语言使用分支内的固态U盘词表。Dual Drive Portable SSD 仍以移动 SSD 为主体，不直接套普通双接口U盘模板。

## 7. SSD 细分

### 7.1 内置 SSD

M.2、2280、PCIe 4.0、Gen4x4、NVMe 等参数保留。

| 语言 | 产品名品类 |
|---|---|
| zh-CN / zh-TW | 固态硬盘 / 固態硬碟 |
| de、fr、ja、ko | SSD |
| es | Unidad de estado sólido (SSD) |
| it 普通款 | SSD |
| it Professional 或带 Heatsink 款 | Unità a stato solido |

```text
Lexar Z99 NVMe SSD
it → SSD Lexar Z99 NVMe

Lexar Professional Z99 NVMe SSD
it → Unità a stato solido Lexar Professional Z99 NVMe
```

### 7.2 Portable SSD

| 语言 | 产品名品类 |
|---|---|
| zh-CN / zh-TW | 移动固态硬盘 / 行動固態硬碟 |
| de | tragbare SSD |
| fr | SSD portable |
| es | SSD portátil |
| it | SSD portatile |
| ja | ポータブル SSD |
| ko | 휴대용 SSD |

### 7.3 Magnetic Portable SSD

Magnetic 为主体属性，不等于附带 Magnetic Set。

```text
Lexar Z99 Magnetic Portable SSD

zh-CN → Lexar Z99 磁吸移动固态硬盘
de → Lexar Z99 magnetische tragbare SSD
fr → SSD portable magnétique Lexar Z99
es → SSD portátil magnética Lexar Z99
it → SSD portatile magnetica Lexar Z99
```

当前还为繁中、欧葡、巴葡、阿语设置属性表达；没有单列属性本地化的语言保留英文信息。

## 8. 内存

| 品类 | de | es | it |
|---|---|---|---|
| Desktop Memory | Desktop-Arbeitsspeicher | Memoria de sobremesa | Memoria per Desktop |
| Laptop Memory | Laptop-Arbeitsspeicher | Memoria para portátil | Memoria per Laptop |

DDR4、DDR5、RGB、型号保留。不补频率、UDIMM/SODIMM 或中文营销名。

当前明确支持 2nd Gen：

| 语言 | 表达 | 位置 |
|---|---|---|
| de | der 2. Generation | 后缀 |
| es | de 2.ª generación | 后缀 |
| it | di seconda generazione | 后缀 |
| ja | 第 2 世代 | 原世代槽位 |
| ko | 2세대 | 原世代槽位 |
| fr | 2e Gen | 原世代槽位 |
| vi | 2nd Gen | 原世代槽位 |

其他语言按世代词表作后缀。

```text
Lexar ARES RGB 2nd Gen DDR5 Desktop Memory

de → Lexar ARES RGB DDR5 Desktop-Arbeitsspeicher der 2. Generation
es → Memoria de sobremesa Lexar ARES RGB DDR5 de 2.ª generación
it → Memoria per Desktop Lexar ARES RGB DDR5 di seconda generazione
```

已检测到的未支持英文世代形式保留并报审核原因；当前检测不是所有世代表述的自然语言解析器。

## 9. 读卡器、硬盘盒与 Hub

### 9.1 分类优先级

对 Lexar 开头的名称，先检查 with 配件前的主体结构：Reader、Enclosure、Hub、Portable SSD 优先于内部介质词；其余按已知品类最长优先识别。

- CFexpress Card Reader 是读卡器，不是存储卡。
- M.2 SSD Enclosure 是硬盘盒，不是 SSD 本体。
- Portable SSD with Hub 是移动 SSD，不是独立 Hub。

### 9.2 Reader

Card Reader 按复合品类处理，避免残留额外 Card。德语固定 Kartenleser；Multi-Card Reader 使用 Multi-Kartenleser。

```text
Lexar Professional Workflow CFexpress 4.0 Type A Card Reader

de → Lexar Professional Workflow CFexpress 4.0 Typ A Kartenleser
it → Lettore Lexar Professional Workflow CFexpress 4.0 Tipo A
```

### 9.3 SSD Enclosure

| 语言 | 复合品类 |
|---|---|
| de | SSD-Gehäuse |
| fr | Boîtier SSD |
| es | Receptáculo de SSD |
| it | Custodia per SSD |

### 9.4 2.5英寸硬盘盒

西语、意语使用不限制 SSD/HDD 的表达，不因历史译名缩窄兼容范围。

```text
Lexar 2.5 Inch Hard Drive Enclosure

de → Lexar 2,5-Zoll-Festplattengehäuse
es → Carcasa Lexar para unidades de 2,5 pulgadas
it → Box esterno Lexar per unità da 2,5 pollici
```

### 9.5 Hub

独立 Hub 走 Hub 品类；with Hub 走配件词表。德语 USB-C Hub 组合为 USB-C-Hub。

## 10. 配件与状态

| 配件 | de | es | it |
|---|---|---|---|
| with Heatsink | mit Kühlkörper | con disipador de calor | con dissipatore di calore |
| with Magnetic Set | mit Magnetset | con juego magnético | con set magnetico |
| with Hub | mit Hub | con concentrador | con concentratore |

- 配件通常置于主体品名之后。
- 日语 Hub 使用前置“ハブ搭載”；韩语 Hub 使用后置“(허브 포함)”。
- 中文 Magnetic Set 紧接品类，形成“移动固态硬盘磁吸套装”等表达。
- 部分语言的部分配件当前保留英文，不声称全部已经母语化。
- 只提取满足已知词组及允许后续结构边界的配件，不做任意子串截取。

```text
Lexar Z99 Portable SSD with Magnetic Set

de → Lexar Z99 tragbare SSD mit Magnetset
es → SSD portátil Lexar Z99 con juego magnético
it → SSD portatile Lexar Z99 con set magnetico
zh-CN → Lexar Z99 移动固态硬盘磁吸套装
```

with Hub Adapter 不允许只截取 with Hub；未知配件保留源信息并提示审核。

(EOL) 从生成源名及各语言输出移除，不因此删除产品记录，不回填译名。

## 11. 匹配与输出归一化

### 匹配层允许的格式等价

cleanKey 处理大小写、®™©、连续空白、连字符/下划线、×/x，以及已支持的 Gen 规格空格写法。例如：

```text
Lexar® NOVA PCIe Gen 4 × 4 SSD
Lexar NOVA PCIe Gen4x4 SSD
```

上述按已支持的格式规则归一，不表示原文信息可以任意删除。

### 不允许合并

- Type A / Type B。
- CFexpress 2.0 / 4.0。
- 1TB / 2TB。
- 普通款 / with Hub。
- Magnetic / with Magnetic Set。
- 不同型号、不同世代。
- token 集合相同但词序不同的名称，不通过 token 排序自动合并。

不启用 alignToGlossaryWordOrder 作为当前匹配路径。

### 输出层独立排版

```text
PCIe Gen 4 × 4 → PCIe Gen4x4
USB 3.2 Gen 2x2 → 保留 USB 规格的 Gen 前空格
PCIe 4.0 M.2 → M.2 PCIe 4.0（已支持的相邻规格对）
```

这是明确支持的生成排版，不是任意词序匹配权限。

## 12. 商标恢复

- Lexar® 的 ® 恢复到 Lexar 后；CFexpress™ 的 ™ 恢复到 CFexpress 后。
- 不因意语重排额外补出第二个 CFexpress。
- 唯一商标词重排时可按精确词位恢复；重复实例沿用原逐实例恢复路径。
- 不凭空增加商标，不随意合并不同实例。

```text
Lexar® Professional DIAMOND CFexpress™ 4.0 Type A Card
it → Scheda CFexpress™ 4.0 Tipo A Lexar® Professional DIAMOND
```

## 13. 兜底方案：已实现机制

### 13.1 分层处理流程

```text
待处理文本
  ├─ 命中已有整条术语 → 使用钦定译值
  └─ 未命中
      ├─ 代码识别为新品名
      │   → 确定性规则生成 → 本批次术语保护 → 待入库池 → 人工处置
      └─ 代码识别失败
          ├─ 满足辅助识别候选条件
          │   ├─ 辅助识别通过校验 → 同一规则生成器 → 待入库池
          │   └─ 非产品名/解析失败 → 普通翻译管道
          └─ 不满足候选条件 → 普通翻译管道
```

此流程描述批量翻译入口。批量翻译、独立校对、单条重翻与失败项重试复用同一代码生成与辅助识别准备；辅助识别仅判断身份，译名始终由代码生成。

### 13.2 已有术语钦定兜底

复用术语匹配、整条短路和校准链，不重新自由翻译已有产品名。匹配使用 full 视图，判断用途使用 en 视图。规则生成值加入两个视图时都保存目标译名，不误存成“源名 → 同一个英文源名”。地区例外不扩展成新品补参通则。

### 13.3 代码识别与临时保护

识别要求包括：

- 独立文本通过长度、字符集等形态检查；当前解析长度范围为 4–120 字符。
- Lexar 开头，商标符号可选。
- 有支持的品类指纹。
- 系列/型号形态符合检查，排除明显句子、功能词和动词；Type A 等规格有上下文豁免。
- 通过术语库新颖性判断，不重复收集已有条目。

成功后生成 20 个语言代码的名称，将目标译名加入本批次术语链，走整条短路保护。翻译入口的新名称统一进入待入库池，**不仅是有 reviewReasons 的名称才进池**；不静默写产品名库或专属库。

新颖性仅按整条归一化匹配判重；作为更长 key/value 的子串不等于已有本条译名，不得据此阻止规则生成。识别前统一横向空白并去除零宽字符，保留真实换行；原始画布文本不改写。

### 13.4 规则不足：保留信息与审核信号

| 情况 | 当前行为 | reviewReasons |
|---|---|---|
| 无支持品类 | 生成器各语言返回清理后的源名 | No supported category |
| with Quantum Kit 等未知配件 | 保留未知词组，其余已知部分仍可本地化 | Unknown accessory: preserve source and review |
| with Hub Adapter 非完整匹配 | 不只翻 Hub，保留未知结构 | 同上 |
| 未支持系列后缀 | 保留信息，不套已支持系列模板 | Unsupported series suffix |
| 已检测到的未支持世代 | 保留原世代，不替换成第二代 | Unsupported generation |
| 未支持卡格式，如 CFast、CFexpress Type C | 保留格式，不改成 SD 或 Type A/B | Unsupported card format |

边界：

- 保留未知信息通常不等于整条不翻译，而是已知部分生成、未知部分保留。
- 主 UI 新品识别要求有品类，不能据生成器的无品类分支，声称所有无品类文本都会自动受到保护。
- reviewReasons 当前主要通过日志透出，不是逐条结构化原因审批面板。
- 未触发检查不等于结构完整，更不等于通过母语质量认证。

### 13.5 辅助识别，不辅助翻译

各入口只有同时满足以下条件才考虑辅助识别：Lexar 开头、有支持品类、代码解析失败或无效、未被新颖性检查排除。

模型仅返回产品名身份和系列等识别信息；代码再做形式校验。通过后仍由确定性生成器产生译名，模型不提供译名。

判非产品名、无法解析或校验失败时，不伪造识别成功，退出新品保护，回普通翻译管道。非 Lexar 开头或未知品类不会无限放宽识别。

这条辅助识别可能调用 API；“规则生成零模型调用”不等于整个翻译任务零 API 调用。

### 13.6 人工确认与持久化

待确认区显示“新品名待确认（规则生成／辅助识别）”。未处置新品属于批量应用阻塞项，提供明确出口：

| 操作 | 效果 |
|---|---|
| 确认入库 | 在待入库池标记 confirmed 并持久化，本客户端立即作为术语使用；不是自动写入所有用户内置库 |
| 应用但不入库 | 从待入库池移除该条，不确认长期术语；当前译文仍可应用 |

新品没有通用“知道了”按钮将其默认确认。

独立校对入口复用同一代码识别、辅助识别及生成器，识别出的新品统一收录待入库池；确定性译名不交给校对自由改写。

确认当前条目会使该池条目的多语言候选本地生效，**不等于逐语言完成母语审核**。

治理闭环：审核待入库译值 → 按现有流程下载交开发者核实 → 整合维护 CSV 和默认库 → 测试 → 授权发布，才让升级用户共享。

### 13.7 简繁与商标形式兜底

繁中目标与简中生成结果同形时，调用已有产品品类词简繁映射；只覆盖已知词，不是完整中文翻译引擎，不创造营销名。商标按第 12 节恢复。日语品类校验容忍片假名与拉丁字母间的格式空格，避免“ポータブルSSD / ポータブル SSD”纯排版差异误回退。

### 13.8 版本与旧缓存兜底

- 当前 GLOSSARY_VERSION = 13。
- 新版启动时，产品名库和专属库分别覆盖为最新默认值，数量 141 / 126；旧库及旧自定义按授权覆盖。
- 两份库分别记版本，避免只升级第一份；库与缓存写成功后才标记该库升级完成，中断可下次重试。
- 清除持久化翻译缓存，缓存键包含术语版本，避免旧缓存先返回后复活旧值。
- 这是版本升级覆盖，不是每次启动重置；当前版本手动导入仍可保留。
- 已确认待入库池是独立本地层。本次双库覆盖不代表清除了所有本地确认新增项。
- 未安装新版插件的客户端不会因本地代码变更而远程升级。

## 14. 当前限制与人工处理建议

以下是已知边界和操作建议，**不是新增功能已实现的声明**。

| 限制/风险 | 当前建议 |
|---|---|
| 疑似产品名未被任一入口确认 | 人工核对，必要时补审核后的整条术语；不要假定必被新品待确认拦住 |
| 辅助识别失败后回普通翻译 | 检查品牌、型号、规格和词序；当前没有统一“疑似产品名识别失败即硬阻塞”机制 |
| 单条重翻／失败重试的产品名 | 已接入同一规则生成与本地短路；生成值保留在待入库池，不经自由翻译 |
| 规则只覆盖部分明确结构 | 保留未知片段并审核，不用自动补参、模糊型号纠错、token 排序扩大命中 |
| 个别语言仍保留英文配件/属性 | 交对应语言审核，不宣称所有词组彻底本地化 |
| 当前语言确认与整条多语言池绑定 | 注意其他语言也是候选，并非已验收译名 |
| reviewReasons 主要在日志 | 查看“新品规则待审核”日志；没有独立原因字段可直接逐项审批 |
| 无报警不等于质量认证 | 只表示未触发已有检查，不等于所有语言质量满分 |
| 钦定值本身可能过时 | 查地区官方事实再修库，不拿历史错误当新品通则 |

未来如需更保守的硬兜底，可另行评估：对具备明确形式信号但识别/生成未通过的疑似新品保留并阻塞、持久化审核原因。本轮未实施这些扩展。

## 15. 验收清单

1. Type A/B、不同 CFexpress 版本可区分。
2. SD/microSD 的 HC/XC、UHS、Express、斜杠格式不被擅改。
3. 意语介质块在 Lexar 前，品牌、等级、商标不重复。
4. 德语固定 Typ A/B、Typ-C，不出现 Tye/Tipe。
5. Card Reader、SSD Enclosure、Portable SSD with Hub 分类正确。
6. Flash Drive、Dual Drive、Solid State Dual Drive 不共用一个简化模板。
7. Magnetic 与 with Magnetic Set 不混同。
8. Series 不导致复数卡；E-Series Plus 保留 Plus。
9. USB Gen 空格和 PCIe Gen 格式分开处理。
10. 已检测到的未知结构保留信息并返回审核原因。
11. (EOL) 不出现在生成结果，产品记录保留。
12. 品牌、型号、容量、版本不猜不补；不通过排序跨结构合并。
13. 未确认新品在现有链中显式处置，不静默写主库。
14. 双库两种升级顺序一致，中断可重试，新版不命中旧缓存。

## 16. 实现与测试索引

| 文件 | 职责 |
|---|---|
| `lib/product-name-generator.ts` | 品类、语序、规格、系列、配件生成及 reviewReasons |
| `lib/prompt-constants.ts` | CATEGORY_WORDS 及 productName 专用覆盖 |
| `lib/new-product-detect.ts` | 形态解析、新颖性与辅助识别候选 |
| `lib/post-process.ts` | cleanKey、商标恢复及品类校验格式归一 |
| `ui/App.vue` | 本批次术语链、日志、待入库池和人工确认 |
| `lib/glossary-store.ts`、`lib/constants.ts` | 双库升级与缓存清理 |
| `术语素材/Lexar术语库_产品名.csv` | 已审核整条名称及地区例外 |
| `术语素材/Lexar术语库_专属.csv` | 专属术语 |
| `lib/default-glossary.ts` | 与维护 CSV 同步的默认库 |
| `tests/test-v1261-product-name-rules.ts` | 组合、匹配边界、未知结构、商标不变量 |
| `tests/test-v1261-de-localization.ts` | 德语及数据约束、内置同步 |
| `tests/test-v1261-glossary-localization.ts` | 语言修正、地区例外、完整性 |
| `tests/test-v1261-glossary-upgrade.ts` | 加载顺序、覆盖、缓存、幂等、中断重试 |

维护时先写失败用例，再调整共享规则；改代码后运行 `npm run typecheck`、`npm run build` 和相关回归。文档不替代真实客户端验收或多语言人工审校。
