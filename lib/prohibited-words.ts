// ============================================================
// 电商平台违禁词表（代码内置，v11.12）
// ============================================================
//
// 背景：产品图文案上传电商平台受平台违禁词硬规则约束——
//   · 中文 → 京东（广告法绝对化用语/虚假承诺/无据功效；京东规则中心 rule.jd.com）
//   · 英文及小语种 → 各国亚马逊站点（test/100%/guarantee 类真实拦截词；
//     政策依据 G200390640 详情页通用政策 + 23501 禁搜关键词 + G200164510 电子产品政策；
//     亚马逊无统一违禁词清单，按原则性禁令语义识别——本表只收原则下最具体的拦截词）
// 文案侧中英都会尽量避开但难免有漏（→ 源文提醒，非阻塞）；
// 翻译侧可能把安全源文译成目标语违禁词（→ 校对 LLM 语义改写 + 代码回检）。
//
// 收录原则（宁漏勿滥 + 行业过滤：消费电子/存储——SSD/移动硬盘/U盘/TF卡/内存条）：
//   ✅ 行业文案真实会写的词（绝对化用语/test/100%/guarantee/无据安全声称/存储专属红线）
//   ✅ 平台明确拦截词（test 已确认为亚马逊真实拦截词，2026-08 用户确认）
//   ✅ 存储类目专属红线：扩容/升级容量/永不掉速/永不丢数据/终身质保/军工级（无认证）
//      ——这些在平台政策里点名禁止且我司文案真的会踩
//   ✅ 时效促销词（2026-08-14 用户拍板收录）：营销图会写促销文案，
//      亚马逊标题/五点/A+ 严禁、京东无精确起止时间即违规
//   ✅ 欧盟 ECGT 环保词：只收 eco-friendly 系（无第三方认证无条件违规，词表可判）；
//      durable/long lasting 是条件性违规（需附寿命参数），代码判不了不收
//   ⛔ 食品/化妆品/金融等行业词不收（与我们无关，收了只会误报）
//   ⛔ 有合法语义的普通词不收（es prueba：a prueba de agua=防水规格，必误报；
//      en free/heal/new 同理；zh 无损=lossless 技术术语）
//   ⛔ 竞品品牌名对比/诱导评价/站外引流/隐私间谍词/正品声称词不收
//      （文案从不写，且属侵权/运营违规非词表问题）
//
// 匹配规则（检测器 lib/prohibited-check.ts 实现，此处为数据约定）：
//   · 拉丁/西里尔/越南语词条 → 词边界正则（i flag，无 g flag 防 lastIndex 污染）
//   · CJK/泰/阿拉伯词条 → 子串匹配（无词边界概念/阿拉伯形态变化需子串）
//   · 符号词（100%/#1）→ 正则匹配 + 数字端 (?<!\d)/(?!\d)（防 1100% 误伤）
//   · 复合词（stress test/最大支持）→ 整词收录，空格弹性 \s+
//   · 重叠命中取最长（「全网最低」吞并「最低」，badge/note 只报最长的那个）
//   · 词条为纯文本，检测器负责 escapeRegExp，词表内禁止手写正则元字符
//
// zh-CN 目标语言直接复用 PROHIBITED_ZH（京东词表 = 中文目标语词表，
// en→zh-CN 翻译链同样需要规避广告法词）。
//
// 维护：平台规则变化/实机误报漏报 → 往这里加词/删词（不是加到术语库 CSV）。
// ============================================================

export interface ProhibitedWord {
  word: string
  /** 平台/法规依据说明（报告与徽章 hover 展示用） */
  note: string
}

// ═══════════════════════════════════════════════════════════════
// 中文词表（京东 + 广告法）— 兼作 zh-CN 目标语言词表
// ═══════════════════════════════════════════════════════════════
export const PROHIBITED_ZH: ProhibitedWord[] = [
  // ── 绝对化用语（广告法第九条，京东重点巡检）──
  { word: '最佳', note: '广告法绝对化用语' },
  { word: '最好', note: '广告法绝对化用语' },
  { word: '最优', note: '广告法绝对化用语' },
  { word: '最先进', note: '广告法绝对化用语' },
  { word: '最快速', note: '广告法绝对化用语' },
  { word: '最强', note: '广告法绝对化用语' },
  { word: '最高', note: '广告法绝对化用语' },
  { word: '最大', note: '广告法绝对化用语' },
  { word: '最低', note: '广告法绝对化用语' },
  { word: '最快', note: '广告法绝对化用语（京东"最"系）' },
  { word: '最高速', note: '广告法绝对化用语' },
  { word: '最大容量', note: '绝对化容量宣称' },
  { word: '最低价', note: '京东价格绝对化' },
  { word: '最耐用', note: '绝对化耐用宣称' },
  { word: '最稳定', note: '绝对化稳定宣称' },
  { word: '最划算', note: '京东价格绝对化' },
  { word: '第一', note: '广告法绝对化用语（销量/品质/行业第一等）' },
  { word: '首选', note: '广告法绝对化用语' },
  { word: '首创', note: '广告法绝对化用语' },
  { word: '首家', note: '广告法绝对化用语' },
  { word: '顶级', note: '广告法绝对化用语' },
  { word: '顶尖', note: '广告法绝对化用语' },
  { word: '尖端', note: '广告法绝对化用语（京东"最"系延伸）' },
  { word: '极致', note: '广告法绝对化用语' },
  { word: '终极', note: '广告法绝对化用语' },
  { word: '极品', note: '广告法绝对化用语' },
  { word: '巅峰', note: '广告法绝对化用语' },
  { word: '王者', note: '广告法绝对化用语（性能王者等）' },
  { word: '之王', note: '广告法绝对化用语（存储之王等）' },
  { word: '至尊', note: '广告法级别类违禁词' },
  { word: '冠军', note: '广告法绝对化用语（品质冠军等）' },
  { word: '独一无二', note: '广告法绝对化用语' },
  { word: '绝无仅有', note: '广告法绝对化用语' },
  { word: '空前绝后', note: '广告法绝对化用语' },
  { word: '全网最低', note: '京东价格类违禁词' },
  { word: '全网第一', note: '广告法绝对化用语' },
  { word: '唯一', note: '广告法绝对化用语（唯一选择等）' },
  { word: 'NO.1', note: '排名第一宣称' },
  { word: 'TOP1', note: '排名第一宣称' },
  { word: '宇宙级', note: '广告法级别类违禁词' },
  { word: '最高级', note: '广告法级别类违禁词' },
  { word: '销量第一', note: '无据销量宣称（京东"第一"系）' },
  { word: '史上最强', note: '广告法绝对化用语' },
  { word: '仅此一款', note: '广告法绝对化用语' },
  { word: '独家', note: '广告法绝对化用语（无授权独家宣称）' },
  { word: '首发', note: '广告法绝对化用语（无据首发宣称）' },
  { word: '首款', note: '广告法绝对化用语（无据首款宣称）' },
  { word: '遥遥领先', note: '广告法绝对化用语' },
  { word: '全球领先', note: '无据领先宣称（广告法）' },
  { word: '世界领先', note: '无据领先宣称（广告法）' },
  { word: '行业领先', note: '无据领先宣称（广告法）' },
  { word: '国际领先', note: '无据领先宣称（广告法）' },
  { word: '国家级', note: '广告法禁用语（国家级产品等）' },
  { word: '世界级', note: '广告法绝对化用语' },
  { word: '100%', note: '绝对化宣称（100%兼容/100%安全等）' },
  { word: '百分百', note: '绝对化宣称' },
  // ── 虚假承诺 ──
  { word: '永久', note: '虚假承诺（永久保修/永久使用等）' },
  { word: '终身质保', note: '京东重点管控：仅品牌官方公示可执行的终身保修才可标注' },
  { word: '终身保修', note: '京东重点管控：同上' },
  { word: '万能', note: '虚假承诺（万能兼容等）' },
  { word: '零风险', note: '虚假承诺' },
  { word: '零故障', note: '虚假承诺（存储产品可靠性绝对化）' },
  { word: '绝对安全', note: '无据安全声称' },
  { word: '绝对可靠', note: '无据安全声称' },
  { word: '永不损坏', note: '虚假承诺' },
  { word: '永不丢失', note: '虚假承诺（数据永不丢失等）' },
  { word: '永不卡顿', note: '虚假承诺（内存/U盘高频踩坑词）' },
  { word: '无效包退', note: '京东管控促销承诺词' },
  { word: '假一赔万', note: '京东管控促销承诺词' },
  // ── 存储类目专属红线（京东3C审核重点，禁售/误导描述）──
  { word: '扩容卡', note: '扩容改造产品：京东禁售禁宣传' },
  { word: '扩容盘', note: '扩容改造产品：京东禁售禁宣传' },
  { word: '扩容U盘', note: '扩容改造产品：京东禁售禁宣传' },
  { word: '升级盘', note: '扩容改造产品：京东禁售禁宣传' },
  { word: '强制扩容', note: '扩容改造产品：京东禁售禁宣传' },
  { word: '可扩容', note: '暗示容量扩容改造，京东违禁' },
  { word: '一键扩容', note: '暗示容量扩容改造，京东违禁' },
  { word: '虚标扩容', note: '扩容改造相关描述，京东违禁' },
  { word: '全盘满速', note: '无实测完整测试报告禁止绝对化性能描述' },
  { word: '永不掉速', note: '无据性能承诺（需完整第三方测试报告）' },
  { word: '全速不掉速', note: '无据性能承诺（需完整第三方测试报告）' },
  { word: '数据绝对安全', note: '绝对化数据保障' },
  { word: '军工级', note: '无据品质声称（无官方认证禁止标注）' },
  { word: '工业级', note: '无据品质声称（无官方工业规格认证禁止标注）' },
  { word: '航天级', note: '无据品质声称（需认证依据）' },
  { word: '医疗级', note: '无据品质声称（需认证依据）' },
  // ── 无据功效/安全声称（存储行业相关）──
  { word: '修复数据', note: '无据功效声称' },
  { word: '数据恢复', note: '无据功效声称（功效宣称需检测/认证依据）' },
  { word: '防病毒', note: '无据功效声称' },
  { word: '防黑客', note: '无据功效声称' },
  // ── 时效促销词（京东管控；2026-08-14 用户拍板收录——营销图会写促销文案）──
  { word: '限时秒杀', note: '促销管控词：无精确起止时间即违规' },
  { word: '最后一波', note: '促销管控词：京东禁止' },
  { word: '清仓甩卖', note: '促销管控词：京东禁止' },
]

// ═══════════════════════════════════════════════════════════════
// 中文豁免短语表（检测时先剔除再匹配，防误报稀释信任）
// 收录原则：短语整体有合法/规格语义，且必须真的包含表中违禁词
// （不含违禁词的短语收了也没用，反而制造"豁免了什么"的误读）
// ═══════════════════════════════════════════════════════════════
export const PROHIBITED_ZH_EXEMPTIONS: string[] = [
  // ── 技术/时间语境 ──
  '最佳实践',      // best practice 技术语境
  '最佳實踐',      // 繁体形态（zh-TW 目标语检测共用本表）
  '第一时间',      // 时间状语
  '第一時間',      // 繁体形态
  '第一次',        // 序数用法
  '第一手',        // 第一手资料
  '第一秒',        // 时间序数（2026-08-18 用户拍板："从开机第一秒到收工最后一刻"误报；秒简繁同形，一条覆盖两形态）
  // ── 存储行业规格语境（spec 陈述非绝对化宣称）──
  '最大支持',      // 最大支持2TB容量
  '最大容量',      // 最大容量2TB
  '最大限度',      // 程度描述
  '最大程度',
  '最高可达',      // 读取速度最高可达2050MB/s（Lexar 标准速度表述）
  '最高可達',      // 繁体形态
  '最高工作温度',  // 工作温度规格
  '最高工作溫度',
  '最高温度',
  '最高溫度',
  '最低工作温度',
  '最低工作溫度',
  '最低温度',
  '最低溫度',
  // ── 保修承诺语境（2026-08-14 用户拍板：品牌官方可执行的有限终身保修可标注）──
  // 京东管控的是"终身质保/终身保修"裸承诺；「有限终身质保」（Limited Lifetime Warranty）
  // 是存储行业国际通行保修条款，有官方条款背书，非虚假承诺。术语库 Limited Lifetime
  // Warranty 词条的 zh-CN/zh-TW 官方译值即此形态——不豁免则术语库值与违禁词表死锁。
  '有限终身质保',
  '有限终身保修',
  '有限終身保固',  // 繁体形态（zh-TW 目标语检测共用本表）
  '有限終身保修',
  // ── 产品名锚定语境（2026-08-18 用户拍板）──
  // Lexar Recovery Tool 是软件产品名（已收术语库），"专业数据恢复（软件）"是其品类描述，
  // 非无据功效吹嘘。豁免锚定产品名+品类词两端，中间修饰词（专业/软件/Software 等）由
  // prohibited-check 的字符级弹性匹配吞掉（v11.15）——覆盖"Lexar Recovery Tool 专业
  // 数据恢复软件"全部文案形态；裸"数据恢复"宣称（"100%数据恢复，误删秒找回"）无锚仍命中。
  'Recovery Tool 数据恢复',
]

// ═══════════════════════════════════════════════════════════════
// 20 语种目标语言词表（亚马逊各站点 + 当地平台通用禁忌）
// key = messages/types.ts LANGUAGES 的 20 个语言代码，缺一即漏防线
// ═══════════════════════════════════════════════════════════════
export const PROHIBITED_AVOID: Record<string, ProhibitedWord[]> = {
  // ── 中文简体目标语（en→zh-CN 翻译链同样受京东/广告法约束）──
  'zh-CN': PROHIBITED_ZH,
  // ── 英语（亚马逊全球站点通用拦截词；政策 G200390640 + 23501）──
  'en': [
    { word: 'test', note: '亚马逊真实拦截词（2026-08 用户确认）' },
    { word: 'tests', note: 'test 复数形态（词边界正则不会顺带命中）' },
    { word: 'stress test', note: 'test 复合词整收' },
    { word: 'speed test', note: 'test 复合词整收' },
    { word: 'best', note: '主观绝对化（亚马逊全站点禁止）' },
    { word: '#1', note: '排名第一宣称' },
    { word: 'No.1', note: '排名第一宣称' },
    { word: 'top rated', note: '评分绝对化（亚马逊禁止）' },
    { word: '100%', note: '绝对化宣称' },
    { word: 'guarantee', note: '无据保证' },
    { word: 'guaranteed', note: '无据保证' },
    { word: 'lifetime warranty', note: '存储行业高频雷：仅品牌官方全球保修政策可验证才可标注' },
    { word: 'lifetime guarantee', note: '同上（虚假承诺类）' },
    { word: 'cure', note: '医疗声称' },
    { word: 'treat', note: '医疗声称' },
    { word: 'miracle', note: '夸大功效' },
    { word: 'lowest price', note: '价格绝对化' },
    { word: 'cheapest', note: '价格绝对化（亚马逊主观宣称禁令）' },
    { word: 'perfect', note: '绝对化宣称' },
    { word: 'safest', note: '安全绝对化' },
    { word: 'fastest', note: '速度绝对化（应改客观参数如 read up to 7300MB/s）' },
    { word: 'ultimate', note: '绝对化宣称' },
    { word: 'superior', note: '无据优越性宣称' },
    { word: 'permanent', note: '虚假承诺' },
    { word: 'risk-free', note: '虚假承诺' },
    // ── 存储类目全球红线（亚马逊 Misleading 下架高频原因）──
    { word: 'expandable capacity', note: '扩容描述：亚马逊全球禁售禁宣传' },
    { word: 'upgraded capacity', note: '扩容描述：亚马逊全球禁售禁宣传' },
    { word: 'expandable storage', note: '扩容暗示：同红线' },
    { word: 'never lose data', note: '绝对化数据保障（亚马逊禁止）' },
    { word: '100% data safety', note: '绝对化数据保障（亚马逊禁止）' },
    { word: 'no speed drop', note: '无据性能承诺（需完整第三方测试报告）' },
    { word: 'never drops speed', note: '无据性能承诺' },
    { word: 'constant full speed', note: '无据性能承诺（应改 sustained performance under specified workload）' },
    { word: 'military grade', note: '无对应规格认证禁止随意标注' },
    { word: 'industrial grade', note: '无对应规格认证禁止随意标注' },
    // ── 时效促销词（亚马逊标题/五点/A+ 严禁；2026-08-14 用户拍板收录——营销图会写促销文案）──
    { word: 'new arrival', note: '时效促销词（亚马逊严禁）' },
    { word: 'brand new', note: '时效促销词（亚马逊严禁）' },
    { word: 'limited time', note: '时效促销词（亚马逊严禁）' },
    { word: 'on sale', note: '时效促销词（亚马逊严禁）' },
    { word: 'clearance', note: '时效促销词（清仓，亚马逊严禁）' },
    { word: 'special offer', note: '时效促销词（亚马逊严禁）' },
    { word: 'giveaway', note: '促销诱导词（亚马逊严禁）' },
    { word: 'free gift', note: '促销诱导词（亚马逊严禁）' },
    { word: 'hot sale', note: '时效促销词（亚马逊严禁）' },
    // ── 担保承诺短语（亚马逊禁止；单词 guarantee 已在上方收录，此处收高频复合形态）──
    { word: 'satisfaction guarantee', note: '担保承诺短语（亚马逊禁止）' },
    { word: 'money back guarantee', note: '担保承诺短语（亚马逊禁止）' },
    { word: 'full refund', note: '退款承诺（亚马逊禁止）' },
    // ── 欧盟 ECGT 环保词（无第三方认证无条件违规——词表可判；durable/long lasting 条件性违规不收）──
    { word: 'eco-friendly', note: '欧盟 ECGT：无认证环保声称无条件违规' },
    { word: 'environmentally friendly', note: '欧盟 ECGT：无认证环保声称无条件违规' },
  ],
  // ── 繁体中文（台湾平台：PChome/momo，广告法同系）──
  'zh-TW': [
    { word: '最佳', note: '絕對化用語' },
    { word: '最好', note: '絕對化用語' },
    { word: '最優', note: '絕對化用語' },
    { word: '最強', note: '絕對化用語' },
    { word: '最高', note: '絕對化用語' },
    { word: '最低', note: '絕對化用語' },
    { word: '最大', note: '絕對化用語' },
    { word: '最快', note: '絕對化用語' },
    { word: '第一', note: '絕對化用語' },
    { word: '首選', note: '絕對化用語' },
    { word: '頂級', note: '絕對化用語' },
    { word: '頂尖', note: '絕對化用語' },
    { word: '極致', note: '絕對化用語' },
    { word: '巔峰', note: '絕對化用語' },
    { word: '獨一無二', note: '絕對化用語' },
    { word: '領先', note: '無據領先宣稱' },
    { word: '100%', note: '絕對化宣稱' },
    { word: '測試', note: '亞馬遜攔截詞對應（test）' },
    { word: '保證', note: '無據保證' },
    { word: '永久', note: '虛假承諾' },
    { word: '終身保固', note: '虛假承諾（終身質保對應）' },
    { word: '萬能', note: '虛假承諾' },
    { word: '擴容', note: '存儲類目紅線：擴容改造禁售禁宣傳' },
    { word: '永不掉速', note: '無據性能承諾' },
    { word: '軍工級', note: '無據品質聲稱' },
    { word: '工業級', note: '無據品質聲稱' },
    { word: '醫療級', note: '無據品質聲稱' },
  ],
  // ── 日语（亚马逊日本站）──
  'ja': [
    { word: '最高', note: '絶対化表現（最高の性能等）' },
    { word: '最速', note: '絶対化表現' },
    { word: '最強', note: '絶対化表現' },
    { word: '最大', note: '絶対化表現' },
    { word: '最低', note: '絶対化表現（最低価格等）' },
    { word: '一番', note: '絶対化表現' },
    { word: 'No.1', note: 'ランキング絶対化' },
    { word: '第一位', note: 'ランキング絶対化' },
    { word: 'テスト', note: 'test 対応（アマゾン拦截詞）' },
    { word: '保証', note: '無根拠の保証' },
    { word: '完璧', note: '絶対化表現' },
    { word: '完全', note: '絶対化表現（景品表示法点名；完全防水/完全互換等）' },
    { word: '絶対', note: '絶対化表現（景品表示法点名）' },
    { word: '業界最速', note: '景品表示法優良誤認（存储高频坑）' },
    { word: '永久保証', note: '虚偽の約束（終身質保対応）' },
    { word: '100%', note: '絶対化表現' },
    { word: '永久', note: '虚偽の約束' },
    { word: '万能', note: '虚偽の約束' },
    { word: '治療', note: '医療効能声称' },
    { word: '医療級', note: '無根拠品質声称' },
  ],
  // ── 韩语（韩国平台：Coupang/Naver）──
  'ko': [
    { word: '최고', note: '절대화 표현' },
    { word: '최상', note: '절대화 표현' },
    { word: '최강', note: '절대화 표현' },
    { word: '최저', note: '절대화 표현（최저가 등）' },
    { word: '1위', note: '순위 절대화' },
    { word: '1등', note: '순위 절대화' },
    { word: '테스트', note: 'test 대응' },
    { word: '보증', note: '근거 없는 보증' },
    { word: '완벽', note: '절대화 표현' },
    { word: '100%', note: '절대화 표현' },
    { word: '영구', note: '허위 약속' },
    { word: '만능', note: '허위 약속' },
    { word: '치료', note: '의료 효능 주장' },
    { word: '의료급', note: '근거 없는 품질 주장' },
  ],
  // ── 法语（亚马逊法国站）──
  'fr': [
    { word: 'test', note: 'mot intercepté Amazon' },
    { word: 'meilleur', note: 'superlatif absolu' },
    { word: 'meilleure', note: 'superlatif absolu' },
    { word: 'parfait', note: 'affirmation absolue' },
    { word: 'parfaite', note: 'affirmation absolue' },
    { word: 'garanti', note: 'garantie sans fondement' },
    { word: 'garantie', note: 'garantie sans fondement' },
    { word: '100%', note: 'affirmation absolue' },
    { word: 'n° 1', note: 'revendication de classement' },
    { word: 'numéro 1', note: 'revendication de classement' },
    { word: 'permanent', note: 'promesse trompeuse' },
    { word: 'guérit', note: 'allégation médicale' },
    { word: 'guérison', note: 'allégation médicale' },
    { word: 'miracle', note: 'allégation exagérée' },
    { word: 'le moins cher', note: 'prix absolu' },
    { word: 'sans risque', note: 'promesse trompeuse' },
  ],
  // ── 德语（亚马逊德国站，UWG 严格）──
  'de': [
    { word: 'Test', note: 'Amazon 拦截词（i flag 兼配小写；词边界防 Protest 误伤）' },
    { word: 'Tests', note: 'Test 复数形态（词边界不顺带命中）' },
    { word: 'beste', note: 'Superlativ（UWG）' },
    { word: 'bester', note: 'Superlativ（UWG）' },
    { word: 'bestes', note: 'Superlativ（UWG）' },
    { word: 'besten', note: 'Superlativ（UWG）' },
    { word: 'Nr. 1', note: 'Platzierungsbehauptung' },
    { word: 'Nummer 1', note: 'Platzierungsbehauptung' },
    { word: 'garantiert', note: 'unbegründete Garantie' },
    { word: 'Garantie', note: 'unbegründete Garantie' },
    { word: '100%', note: 'absolute Behauptung' },
    { word: 'perfekt', note: 'absolute Behauptung' },
    { word: 'heilt', note: 'medizinische Behauptung' },
    { word: 'Heilung', note: 'medizinische Behauptung' },
    { word: 'Wunder', note: 'übertriebene Behauptung' },
    { word: 'risikofrei', note: 'irreführendes Versprechen' },
    { word: 'am günstigsten', note: 'Preis-Superlativ' },
    { word: 'sicherste', note: 'Sicherheits-Superlativ' },
    { word: 'lebenslange Garantie', note: 'unbegründete Garantie（终身质保对应；DE 严格审查）' },
    { word: 'unglaublich', note: 'Superlativ-Übertreibung（UWG 德国站重点审查）' },
    { word: 'spitzenklasse', note: 'Klassen-Superlativ（UWG 德国站重点审查）' },
  ],
  // ── 西班牙语（亚马逊西班牙站）──
  // 注意：不收 prueba —— "a prueba de agua"（防水）是存储卡规格标准表述，必误报
  'es': [
    { word: 'test', note: 'palabra interceptada Amazon' },
    { word: 'mejor', note: 'superlativo absoluto' },
    { word: 'perfecto', note: 'afirmación absoluta' },
    { word: 'perfecta', note: 'afirmación absoluta' },
    { word: 'garantizado', note: 'garantía sin fundamento' },
    { word: 'garantizada', note: 'garantía sin fundamento' },
    { word: 'garantía', note: 'garantía sin fundamento' },
    { word: '100%', note: 'afirmación absoluta' },
    { word: 'número 1', note: 'reivindicación de clasificación' },
    { word: 'n.º 1', note: 'reivindicación de clasificación' },
    { word: 'permanente', note: 'promesa engañosa' },
    { word: 'cura', note: 'alegación médica' },
    { word: 'curar', note: 'alegación médica' },
    { word: 'milagro', note: 'alegación exagerada' },
    { word: 'sin riesgo', note: 'promesa engañosa' },
    { word: 'el más barato', note: 'precio absoluto' },
  ],
  // ── 葡萄牙语（亚马逊欧洲站/通用）──
  'pt': [
    { word: 'teste', note: 'test 对应葡语形态' },
    { word: 'melhor', note: 'superlativo absoluto' },
    { word: 'perfeito', note: 'afirmação absoluta' },
    { word: 'perfeita', note: 'afirmação absoluta' },
    { word: 'garantido', note: 'garantia sem fundamento' },
    { word: 'garantida', note: 'garantia sem fundamento' },
    { word: 'garantia', note: 'garantia sem fundamento' },
    { word: '100%', note: 'afirmação absoluta' },
    { word: 'número 1', note: 'reivindicação de classificação' },
    { word: 'permanente', note: 'promessa enganosa' },
    { word: 'cura', note: 'alegação médica' },
    { word: 'curar', note: 'alegação médica' },
    { word: 'milagre', note: 'alegação exagerada' },
    { word: 'sem risco', note: 'promessa enganosa' },
    { word: 'mais barato', note: 'preço absoluto' },
  ],
  // ── 巴西葡语（亚马逊巴西站）──
  'pt-BR': [
    { word: 'teste', note: 'test 对应葡语形态' },
    { word: 'melhor', note: 'superlativo absoluto' },
    { word: 'perfeito', note: 'afirmação absoluta' },
    { word: 'perfeita', note: 'afirmação absoluta' },
    { word: 'garantido', note: 'garantia sem fundamento' },
    { word: 'garantida', note: 'garantia sem fundamento' },
    { word: 'garantia', note: 'garantia sem fundamento' },
    { word: '100%', note: 'afirmação absoluta' },
    { word: 'número 1', note: 'reivindicação de classificação' },
    { word: 'permanente', note: 'promessa enganosa' },
    { word: 'cura', note: 'alegação médica' },
    { word: 'curar', note: 'alegação médica' },
    { word: 'milagre', note: 'alegação exagerada' },
    { word: 'sem risco', note: 'promessa enganosa' },
    { word: 'mais barato', note: 'preço absoluto' },
  ],
  // ── 俄语（当地平台：Ozon/Wildberries）──
  'ru': [
    { word: 'тест', note: 'test 对应俄语形态' },
    { word: 'лучший', note: 'превосходная степень' },
    { word: 'лучшая', note: 'превосходная степень' },
    { word: 'лучшее', note: 'превосходная степень' },
    { word: 'идеальный', note: 'абсолютное утверждение' },
    { word: 'гарантия', note: 'необоснованная гарантия' },
    { word: 'гарантированно', note: 'необоснованная гарантия' },
    { word: '100%', note: 'абсолютное утверждение' },
    { word: '№1', note: 'заявление о рейтинге' },
    { word: 'номер один', note: 'заявление о рейтинге' },
    { word: 'постоянный', note: 'ложное обещание' },
    { word: 'лечит', note: 'медицинское заявление' },
    { word: 'чудо', note: 'преувеличенное заявление' },
    { word: 'без риска', note: 'ложное обещание' },
    { word: 'самый дешёвый', note: 'абсолютная цена' },
  ],
  // ── 意大利语（亚马逊意大利站）──
  'it': [
    { word: 'test', note: 'parola intercettata Amazon' },
    { word: 'migliore', note: 'superlativo assoluto' },
    { word: 'migliori', note: 'superlativo assoluto' },
    { word: 'perfetto', note: 'affermazione assoluta' },
    { word: 'perfetta', note: 'affermazione assoluta' },
    { word: 'garantito', note: 'garanzia senza fondamento' },
    { word: 'garantita', note: 'garanzia senza fondamento' },
    { word: 'garanzia', note: 'garanzia senza fondamento' },
    { word: '100%', note: 'affermazione assoluta' },
    { word: 'numero 1', note: 'rivendicazione di classifica' },
    { word: 'permanente', note: 'promessa ingannevole' },
    { word: 'cura', note: 'asserzione medica' },
    { word: 'curare', note: 'asserzione medica' },
    { word: 'miracolo', note: 'asserzione esagerata' },
    { word: 'senza rischio', note: 'promessa ingannevole' },
    { word: 'il più economico', note: 'prezzo assoluto' },
  ],
  // ── 越南语（当地平台：Shopee/Lazada）──
  'vi': [
    { word: 'tốt nhất', note: 'so sánh tuyệt đối（最好）' },
    { word: 'tuyệt vời nhất', note: 'so sánh tuyệt đối' },
    { word: 'hoàn hảo', note: 'tuyên bố tuyệt đối（完美）' },
    { word: 'đảm bảo', note: 'bảo đảm không căn cứ（保证）' },
    { word: 'bảo hành vĩnh viễn', note: 'hứa hẹn sai（永久保修）' },
    { word: '100%', note: 'tuyên bố tuyệt đối' },
    { word: 'số 1', note: 'tuyên bố xếp hạng' },
    { word: 'hàng đầu', note: 'tuyên bố dẫn đầu（领先）' },
    { word: 'kiểm tra', note: 'test 对应越语形态' },
    { word: 'chữa khỏi', note: 'tuyên bố y tế' },
    { word: 'phép màu', note: 'tuyên bố phóng đại（奇迹）' },
    { word: 'rẻ nhất', note: 'giá tuyệt đối（最便宜）' },
    { word: 'không rủi ro', note: 'hứa hẹn sai（零风险）' },
    { word: 'vĩnh viễn', note: 'hứa hẹn sai（永久）' },
    { word: 'an toàn tuyệt đối', note: 'tuyên bố an toàn vô căn cứ' },
  ],
  // ── 泰语（当地平台：Shopee/Lazada 泰国站）──
  'th': [
    { word: 'ดีที่สุด', note: 'ข้อความเชิงเปรียบเทียบสัมบูรณ์（最好）' },
    { word: 'สมบูรณ์แบบ', note: 'ข้อความสัมบูรณ์（完美）' },
    { word: 'รับประกัน', note: 'การรับประกันไม่มีหลักฐาน（保证）' },
    { word: '100%', note: 'ข้อความสัมบูรณ์' },
    { word: 'อันดับ 1', note: 'ข้อความจัดอันดับ（第一）' },
    { word: 'ทดสอบ', note: 'test 对应泰语形态' },
    { word: 'รักษา', note: 'ข้อความทางการแพทย์（治疗）' },
    { word: 'ปาฏิหาริย์', note: 'ข้อความเกินจริง（奇迹）' },
    { word: 'ถูกที่สุด', note: 'ราคาสัมบูรณ์（最便宜）' },
    { word: 'ไม่มีความเสี่ยง', note: 'สัญญาที่ผิด（零风险）' },
    { word: 'ถาวร', note: 'สัญญาที่ผิด（永久）' },
    { word: 'ปลอดภัยที่สุด', note: 'ความปลอดภัยสัมบูรณ์' },
  ],
  // ── 印尼语（当地平台：Tokopedia/Shopee 印尼站）──
  'id': [
    { word: 'terbaik', note: 'superlatif absolut（最好）' },
    { word: 'termurah', note: 'harga absolut（最便宜）' },
    { word: 'tercepat', note: 'superlatif absolut（最快）' },
    { word: 'sempurna', note: 'klaim absolut（完美）' },
    { word: 'dijamin', note: 'jaminan tanpa dasar（保证）' },
    { word: 'garansi', note: 'jaminan tanpa dasar' },
    { word: '100%', note: 'klaim absolut' },
    { word: 'nomor 1', note: 'klaim peringkat（第一）' },
    { word: 'teruji', note: 'test 对应印尼语形态（经测试）' },
    { word: 'menyembuhkan', note: 'klaim medis（治疗）' },
    { word: 'ajaib', note: 'klaim berlebihan（奇迹）' },
    { word: 'bebas risiko', note: 'janji menyesatkan（零风险）' },
    { word: 'permanen', note: 'janji menyesatkan（永久）' },
    { word: 'paling aman', note: 'keamanan absolut（最安全）' },
  ],
  // ── 阿拉伯语（亚马逊沙特/阿联酋站；子串匹配兼配冠词形态）──
  'ar': [
    { word: 'أفضل', note: '最高级宣称（最好）' },
    { word: 'الأفضل', note: '最高级宣称（带冠词形态）' },
    { word: 'مثالي', note: '绝对宣称（完美）' },
    { word: 'مضمون', note: '无据保证' },
    { word: 'ضمان', note: '无据保证' },
    { word: '100%', note: '绝对宣称' },
    { word: 'رقم 1', note: '排名宣称（第一）' },
    { word: 'الأول', note: '排名宣称' },
    { word: 'اختبار', note: 'test 对应阿语形态' },
    { word: 'يعالج', note: '医疗声称' },
    { word: 'علاج', note: '医疗声称' },
    { word: 'معجزة', note: '夸大宣称（奇迹）' },
    { word: 'الأرخص', note: '价格绝对化（最便宜）' },
    { word: 'بدون مخاطر', note: '虚假承诺（零风险）' },
    { word: 'دائم', note: '虚假承诺（永久）' },
    { word: 'الأكثر أمانًا', note: '安全绝对化' },
  ],
  // ── 荷兰语（亚马逊荷兰站）──
  'nl': [
    { word: 'test', note: 'Amazon 拦截词' },
    { word: 'beste', note: 'superlatief absoluut' },
    { word: 'perfect', note: 'absolute bewering' },
    { word: 'perfecte', note: 'absolute bewering' },
    { word: 'gegarandeerd', note: 'ongefundeerde garantie' },
    { word: 'garantie', note: 'ongefundeerde garantie' },
    { word: '100%', note: 'absolute bewering' },
    { word: 'nummer 1', note: 'rangschikkingsclaim' },
    { word: 'nr. 1', note: 'rangschikkingsclaim' },
    { word: 'permanent', note: 'misleidende belofte' },
    { word: 'geneest', note: 'medische claim' },
    { word: 'genezing', note: 'medische claim' },
    { word: 'wonder', note: 'overdreven claim' },
    { word: 'goedkoopste', note: 'prijssuperlatief' },
    { word: 'zonder risico', note: 'misleidende belofte' },
    { word: 'veiligste', note: 'veiligheidssuperlatief' },
  ],
  // ── 波兰语（亚马逊波兰站）──
  'pl': [
    { word: 'test', note: 'słowo blokowane Amazon' },
    { word: 'najlepszy', note: 'superlatyw absolutny' },
    { word: 'najlepsza', note: 'superlatyw absolutny' },
    { word: 'najlepsze', note: 'superlatyw absolutny' },
    { word: 'idealny', note: 'bezwzględne twierdzenie' },
    { word: 'gwarantowany', note: 'bezpodstawna gwarancja' },
    { word: 'gwarantowana', note: 'bezpodstawna gwarancja' },
    { word: 'gwarancja', note: 'bezpodstawna gwarancja' },
    { word: '100%', note: 'bezwzględne twierdzenie' },
    { word: 'numer 1', note: 'roszczenie rankingowe' },
    { word: 'najtańszy', note: 'superlatyw cenowy' },
    { word: 'leczy', note: 'roszczenie medyczne' },
    { word: 'cud', note: 'przesadne twierdzenie' },
    { word: 'bez ryzyka', note: 'wprowadzająca w błąd obietnica' },
    { word: 'na zawsze', note: 'wprowadzająca w błąd obietnica（永久）' },
    { word: 'najbezpieczniejszy', note: 'superlatyw bezpieczeństwa' },
  ],
  // ── 瑞典语（亚马逊瑞典站）──
  'sv': [
    { word: 'test', note: 'Amazon-blockerat ord' },
    { word: 'bäst', note: 'absolut superlativ' },
    { word: 'bästa', note: 'absolut superlativ' },
    { word: 'perfekt', note: 'absolut påstående' },
    { word: 'garanterad', note: 'ogrundad garanti' },
    { word: 'garanterat', note: 'ogrundad garanti' },
    { word: 'garanti', note: 'ogrundad garanti' },
    { word: '100%', note: 'absolut påstående' },
    { word: 'nummer 1', note: 'rankningspåstående' },
    { word: 'billigast', note: 'prissuperlativ' },
    { word: 'botar', note: 'medicinskt påstående' },
    { word: 'mirakel', note: 'överdrivet påstående' },
    { word: 'utan risk', note: 'vilseledande löfte' },
    { word: 'permanent', note: 'vilseledande löfte' },
    { word: 'säkrast', note: 'säkerhetssuperlativ' },
  ],
  // ── 土耳其语（亚马逊土耳其站）──
  'tr': [
    { word: 'test', note: 'Amazon engellenen kelime' },
    { word: 'en iyi', note: 'mutlak üstünlük（最好）' },
    { word: 'en hızlı', note: 'mutlak üstünlük（最快）' },
    { word: 'en ucuz', note: 'fiyat mutlaklığı（最便宜）' },
    { word: 'mükemmel', note: 'mutlak iddia（完美）' },
    { word: 'garantili', note: 'dayanaksız garanti' },
    { word: 'garanti', note: 'dayanaksız garanti' },
    { word: '100%', note: 'mutlak iddia' },
    { word: '%100', note: 'mutlak iddia（土耳其语百分号前置形态）' },
    { word: 'numara 1', note: 'sıralama iddiası' },
    { word: 'bir numara', note: 'sıralama iddiası' },
    { word: 'kalıcı', note: 'yanıltıcı vaat（永久）' },
    { word: 'tedavi eder', note: 'tıbbi iddia' },
    { word: 'mucize', note: 'abartılı iddia（奇迹）' },
    { word: 'risksiz', note: 'yanıltıcı vaat（零风险）' },
    { word: 'en güvenli', note: 'güvenlik mutlaklığı' },
  ],
}
