// ═══════════════════════════════════════════════════════════════
// 文件: prompt-constants.ts — 翻译与校对 LLM 的 System Prompt 组装
// ═══════════════════════════════════════════════════════════════
//
// 模块清单及职责边界:
//
// 翻译 LLM 接收的模块（buildSystemPrompt 组装）:
//   1. IDENTITY_MISSION  — 目标语言使命宣言（全语种）
//   2. IRON_RULES        — 轻量行为约束，不列具体保留术语
//   3. LANG_SPECIFIC     — 语言专属规则 + 品类词对照（renderLangForTranslate）
//   4. TONE & STYLE      — 电商场景专属（产品线调性 + 风格）
//   5. FEWSHOT            — 翻译示例（电商场景）
//   6. OUTPUT_ANCHOR      — 输出格式锚点
//   ✅ 注入 glossaryHint — 术语对照表（当前批次出现的术语，最高优先级）
//
// 校对 LLM 接收的模块（proofreadBatch 组装）:
//   1. PROOFREAD_SYSTEM_PROMPT  — 校对角色 + 检查清单
//   2. glossaryHint              — 术语对照表（校对需要参照验证）
//   3. LANG_SPECIFIC             — 校验标准（renderLangForProofread，含 quality）
//   ⛔ 不注入 IRON_RULES — 校对用独立的 CHECKLIST
//
// 关键约束:
//   ⛔ 翻译 prompt 不列保留术语 — 术语库是唯一保留词权威
//   ⛔ 校对 prompt 不含 "Do NOT re-translate" / "Keep fixes minimal" —
//      校对 LLM 只输出有修改的条目，OK 的不输出
//   ⛔ 品类词不独立注入 — 已合并到 LANG_SPECIFIC 渲染中
// ═══════════════════════════════════════════════════════════════

// ============================================================
// Module 1: IDENTITY & BOUNDARIES
// ============================================================

/** Core mission statement per target language — activates the target semantic space */
export const IDENTITY_MISSION: Record<string, string> = {
  // CJK 语言：使用母语指令（与 [IDENTITY] 英文一致）
  'zh-CN': `核心使命：将源文本精准、地道地翻译为简体中文。通过调整词汇色彩、句式结构来适配产品线与受众。`,
  'zh-TW': `核心使命：將源文本精準翻譯為台灣繁體中文並完成用語在地化。透過調整詞彙色彩、句式結構來適配產品線與受眾。`,
  'ja': `コアミッション：原文を正確かつ自然な日本語に翻訳してください。語彙や文体を製品ラインと読者に合わせて調整します。`,
  'ko': `핵심 미션: 원문을 정확하고 자연스러운 한국어로 번역하세요. 어휘와 문체를 제품 라인과 독자에 맞게 조정하세요.`,

  // 非 CJK 语言：仅目标语言使命宣言（英文上下文已由 IRON_RULES/CONSTRAINTS 提供）
  // 目标语言文本激活目标语义空间，无需冗余英文前言
  'fr': `Mission : Traduisez le texte source de manière précise et naturelle en français. Adaptez le vocabulaire, la structure des phrases et le registre à la gamme de produits et au public cible.`,
  'de': `Kernauftrag: Übersetzen Sie den Ausgangstext präzise und idiomatisch ins Deutsche. Passen Sie Wortwahl, Satzbau und Register an Produktlinie und Zielgruppe an.`,
  'es': `Misión principal: Traduzca el texto fuente de manera precisa y natural al español. Adapte el vocabulario, la estructura de las frases y el registro a la línea de productos y al público objetivo.`,
  'pt': `Missão principal: Traduza o texto fonte de forma precisa e natural para português europeu. Adapte o vocabulário, a estrutura frásica e o registo à linha de produtos e ao público-alvo.`,
  'pt-BR': `Missão principal: Traduza o texto fonte de forma precisa e natural para português brasileiro. Adapte o vocabulário, a estrutura frásica e o registro à linha de produtos e ao público-alvo.`,
  'it': `Missione principale: Traduca il testo sorgente in modo accurato e naturale in italiano. Adatti vocabolario, struttura delle frasi e registro alla linea di prodotti e al pubblico target.`,
  'nl': `Kernmissie: Vertaal de brontekst nauwkeurig en natuurlijk naar het Nederlands. Pas woordkeuze, zinsbouw en register aan op de productlijn en doelgroep.`,
  'pl': `Misja główna: Przetłumacz tekst źródłowy dokładnie i naturalnie na język polski. Dostosuj słownictwo, strukturę zdań i rejestr do linii produktów i grupy docelowej.`,
  'sv': `Huvuduppdrag: Översätt källtexten exakt och naturligt till svenska. Anpassa ordförråd, meningsbyggnad och ton till produktlinjen och målgruppen.`,
  'tr': `Temel Misyon: Kaynak metni Türkçeye doğru ve doğal bir şekilde çevirin. Kelime seçimini, cümle yapısını ve üslubu ürün grubuna ve hedef kitleye göre uyarlayın.`,
  'ru': `Основная миссия: Переведите исходный текст точно и естественно на русский язык. Адаптируйте лексику, структуру предложений и стиль под линейку продуктов и целевую аудиторию.`,
  'vi': `Sứ mệnh cốt lõi: Dịch văn bản nguồn chính xác và tự nhiên sang tiếng Việt. Điều chỉnh từ vựng, cấu trúc câu và giọng điệu phù hợp với dòng sản phẩm và đối tượng mục tiêu.`,
  'th': `พันธกิจหลัก: แปลข้อความต้นฉบับอย่างถูกต้องและเป็นธรรมชาติเป็นภาษาไทย ปรับคำศัพท์ โครงสร้างประโยค และโทนเสียงให้เข้ากับกลุ่มผลิตภัณฑ์และกลุ่มเป้าหมาย`,
  'id': `Misi utama: Terjemahkan teks sumber secara akurat dan alami ke dalam bahasa Indonesia. Sesuaikan kosakata, struktur kalimat, dan gaya bahasa dengan lini produk dan audiens target.`,
  'ar': `المهمة الأساسية: ترجمة النص المصدر بدقة وبشكل طبيعي إلى اللغة العربية. تكييف المفردات وبنية الجمل والأسلوب بما يتناسب مع خط الإنتاج والجمهور المستهدف.`,
  'en': `Core mission: Translate the source text accurately and idiomatically into English. Adapt vocabulary, sentence structure, and register to fit the product line and target audience.`,
}

// ============================================================
// Module 3: CONSTRAINTS — Hard rules (English only)
// LLM follows English logic instructions with highest fidelity.
// Each rule appears exactly once — no cross-module duplication.
// ============================================================

// ═══════════════════════════════════════════════════════════════
// 共享常量: BRAND_ASSET_RULES — 品牌资产白名单（翻译+校对共用）
// ═══════════════════════════════════════════════════════════════
// 职责: 定义品牌/产品名保留规则，翻译用它"保护"，校对用它"放行"
// 注入: 翻译 IRON_RULES Rule #2 引用 + 校对 PROOFREAD_SYSTEM_PROMPT 引用
// ═══════════════════════════════════════════════════════════════

// 校对精简版品牌规则（~500 chars，替代完整 BRAND_ASSET_RULES 的 1,578 chars）
// 校对只需判断"产品名保留 vs 描述性文本翻译"，不需要完整的决策树和示例
export const BRAND_ASSET_RULES_PROOFREAD = `[BRAND NAME RULES — QA REFERENCE]
✅ Keep in English: product names (Lexar NM790), brand names (Lexar, AMD), model numbers.
❌ Must translate: descriptive sentences containing brand words.
Rule: No verbs/prepositions = product name → keep English. Has verbs/adjectives = description → translate.`

export const BRAND_ASSET_RULES = `[BRAND & PRODUCT NAME RULES]
✅ Keep in English (do NOT translate):
- Complete product names: "Lexar PLAY PRO microSDXC Express Card"
- Pure brand names / model numbers: "Lexar", "NM790", "ARES DDR5"

Model number patterns:
- Memory cards: speed code + grade color (e.g., "2000x GOLD", "633x BLUE", "CFexpress Type A SILVER")
- SSD/Memory/USB: alphanumeric code + optional suffix (e.g., "NM790", "D40E", "F35 PRO")
- ⛔ Color words (GOLD/SILVER/BLUE/DIAMOND) in model names are grade identifiers, NOT colors — keep as-is

❌ MUST translate (even if containing brand words):
- Descriptive phrases: "high-speed memory card"
- Slogans, taglines, headlines, footnotes
- Sentences with brand names: "Paired with AMD and Intel CPUs" → translate sentence, keep "AMD"/"Intel" English

⚠️ CRITICAL DISTINCTION:
- Product name = standalone identifier (no verbs, no prepositions) → KEEP English
- Descriptive sentence = contains verbs/prepositions/adjectives → TRANSLATE

🔍 HOW TO DECIDE:
Ask yourself: "Does this text describe something (action/feature/benefit)?"
- YES → It's descriptive → TRANSLATE (keep only brand names in English)
- NO → It's a label/identifier → KEEP English

Examples (real Lexar copy — patterns apply to ALL target languages):

[KEEP ENGLISH] Pure product name — no verbs, no prepositions:
  "Lexar ARMOR GOLD SDXC UHS-II Card" → "Lexar ARMOR GOLD SDXC UHS-II Card" (unchanged in all languages)

[TRANSLATE] Title Case headline — Title Case is NOT a product name:
  "Steel-Armored, Unstoppable Performance"
  → CN: "这卡, 够钢！"  DE: "Stahlgepanzerte, unerschütterliche Leistung"  ES: "Blindada de acero, rendimiento imparable"

[TRANSLATE] Descriptive sentence — keep only brand names (Lexar/AMD/Intel) in English:
  "Equipped with an IP68 rating, the Lexar ARMOR GOLD SDXC UHS-II Card safeguards your card against damage"
  → CN: "IP68 防水防尘等级，Lexar ARMOR GOLD SDXC UHS-II 存储卡可保护您的存储卡免受损坏"
  → DE: "Mit IP68-Schutzklasse schützt die Lexar ARMOR GOLD SDXC UHS-II Karte Ihre Karte vor Beschädigungen"

[TRANSLATE] With placeholders — preserve __XXX_N__ and line breaks exactly as-is:
  "Up to __PRD_0__ MB/s Read Speed↵Suitable for professional creators"
  → CN: "高达 __PRD_0__ MB/s 读取速度↵适合专业创作者"
  → DE: "Lesegeschwindigkeit bis zu __PRD_0__ MB/s↵Geeignet für professionelle Kreative"`

// ═══════════════════════════════════════════════════════════════
// 模块: IRON_RULES — 全局铁则（翻译 LLM 的轻量行为约束）
// ═══════════════════════════════════════════════════════════════
// 职责: 约束 LLM 行为边界。品牌/型号规则由 BRAND_ASSET_RULES 共享。
// 注入: 翻译 system prompt，始终注入，英语。全语种通用。
// 边界: ⛔ 不含具体保留词列表（LLM 凭常识识别品牌/型号）
//       ⛔ 不含"always in English"等绝对化表述
//       ⛔ 不注入校对 prompt（校对有独立的 CHECKLIST）
// ═══════════════════════════════════════════════════════════════

export const IRON_RULES = `${BRAND_ASSET_RULES}

[IRON RULES]
1. FAITHFUL TO SOURCE: Translate ONLY source content — no omission, addition, fabrication,
   or external knowledge injection. Numbers, capacities, and speed values preserved verbatim.
   ⛔ NEVER complete partial product names.
   ✅ You MAY adapt phrasing, word choice, and sentence structure to sound natural.

2. PRESERVE BRANDS & MODEL NUMBERS: Follow [BRAND & PRODUCT NAME RULES] above.

3. CATEGORY PRECISION: Use the category word table. "Read speed" and "Write speed" are distinct — never interchange them.

4. SHORT LABELS: For UI labels, buttons, and parameter names ≤15 characters,
   stay concise — match the source's brevity.
   ⚠️ This rule applies ONLY to short standalone labels. For complete sentences
   and paragraphs, translate in FULL — do NOT summarize, condense, or truncate.

5. COMPLIANCE & PLACEHOLDERS: Warranty terms, certification marks (CE/FCC),
   and legal disclaimers must be translated word-for-word. Preserve ALL
   __XXX_N__ markers, HTML tags, and ↵ symbols exactly as-is in position.
   ⛔ NEVER add spaces or characters inside __XXX_N__ markers —
      __XXX_ 1__ or __XXX _1__ are FORBIDDEN. Keep them exactly as given.

6. TRADEMARK SYMBOLS: ⛔ Do NOT manually add trademark symbols (®™©).
   Trademark symbols are handled automatically by code: if source has them,
   they will be added to translation; if source doesn't have them, they won't appear.
   You do NOT need to add any ®™© symbols in your translation.

7. ⛔ TRANSLATE EVERYTHING — CRITICAL RULE:
   - ALL text must be translated, including: titles, headlines, marketing copy,
     technical descriptions, footnotes, disclaimers, and legal notes.
   - Even if text contains brand names (AMD, Intel, PCIe, etc.), the descriptive
     parts MUST be translated. Only keep the brand names themselves in English.
   - If you're unsure whether to translate, TRANSLATE IT.
   - It's better to over-translate than to leave text untranslated.
   - Use the decision process in [BRAND & PRODUCT NAME RULES] above:
     contains verbs/prepositions/descriptive words → DESCRIPTIVE → TRANSLATE.`

// ============================================================
// Module 2 continued: PRODUCT LINE TONE GUIDES
// Key innovation: audience-specific tone guides in target language
// ============================================================

export const PRODUCT_LINE_TONE_GUIDES: Record<string, Record<string, string>> = {
  gaming_dimm: {
    'default': `[Product Tone·Gaming Memory]
Audience: Hardcore PC gamers, overclockers, DIY enthusiasts, esports teams.
Usage: Gaming PC builds, overclocking, high-FPS gaming, streaming, AI computing.
Tone: Hardcore geek, spec-precise (DDR gen/frequency MHz/CL timings/voltage/PMIC).`,
  },

  gaming_ssd: {
    'default': `[Product Tone·Gaming SSD]
Audience: PC gamers, PS5/Xbox users, handheld DIY players, 3A game collectors, streamers.
Usage: Game storage expansion, PC game drives, fast loading, handheld M.2 upgrades.
Tone: Energetic, direct, youth-oriented. Highlight "goodbye loading lag", "store full 3A library".`,
  },

  gaming_card: {
    'default': `[Product Tone·Gaming Card]
Audience: Switch/Steam Deck/ROG Ally handheld gamers, portable gaming users.
Usage: Handheld game storage expansion, 3A game downloads, screenshot/video storage.
Tone: Young, casual, energetic. Use gamer vocabulary naturally.`,
  },

  professional_imaging: {
    'default': `[Product Tone·Professional Imaging]
Audience: Commercial photographers, cinematographers, drone pilots, outdoor vloggers, post-production studios.
Usage: 8K/6K RAW video recording, high-speed burst shooting, extreme outdoor environments, on-set backup.
Tone: Calm, restrained, premium quality. Emphasize reliability, stability, professional trust.`,
  },

  pc_productivity: {
    'default': `[Product Tone·PC Productivity]
Audience: Office workers, students, designers, light editors, business mobile users.
Usage: Laptop/desktop office expansion, document storage, light photo editing, daily file backup.
Tone: Practical, moderate, simple and neutral. No exaggerated marketing.`,
  },

  consumer_cards: {
    'default': `[Product Tone·Consumer Cards]
Audience: General families, phone users, home surveillance, dashcams, entry-level action cameras.
Usage: Dashcam loop recording, home camera storage, phone photo backup, entry drone/camera shooting.
Tone: Friendly, natural, easy to understand. Lightweight short sentences.`,
  },

  portable_storage: {
    'default': `[Product Tone·Portable Storage]
Audience: Mobile creators, field business, phone photography users, privacy data storage needs.
Usage: Outdoor shooting backup, phone album auto-backup, business travel file carrying, encrypted storage.
Tone: Convenient, practical, modern, reassuring. "Anytime, anywhere", "seamless", "built tough".`,
  },

  innovation_lifestyle: {
    'default': `[Product Tone·Innovation Lifestyle]
Audience: Trend lovers, brand collectors, phone power users, lifestyle enthusiasts, football/esports fans.
Usage: Daily portable creative storage, trendy digital matching, gift giving, IP collaboration collecting.
Tone: Trendy, youthful, design-focused. Emphasize design, aesthetics, cross-over collaboration.`,
  },
}

/** Get the product line tone guide for a specific target language, with fallback to 'default' (English) */
export function getProductLineTone(productLine: string | null, targetLang: string): string {
  if (!productLine) {
    // Generic fallback
    const genericGuides: Record<string, string> = {
      'zh-CN': `[产品调性·通用存储] 受众：3C数码消费者。语感方向：专业、清晰、自然。使用行业标准术语，避免过度技术化或过度营销化。`,
      'ja': `[製品トーン·一般ストレージ] 対象：3Cデジタル消費者。トーン：プロフェッショナル、明瞭、自然。業界標準の用語を使用し、過度な技術用語や過剰なマーケティング表現を避ける。`,
      'de': `[Produkt-Ton·Allgemeiner Speicher] Zielgruppe: 3C-Digitalverbraucher. Ton: Professionell, klar, natürlich. Branchenübliche Terminologie verwenden.`,
      'default': `[Product Tone·General Storage] Audience: 3C digital consumers. Tone: Professional, clear, natural. Use industry-standard terminology.`,
    }
    return genericGuides[targetLang] || genericGuides['default'] || ''
  }
  const guides = PRODUCT_LINE_TONE_GUIDES[productLine]
  if (!guides) return ''
  return guides[targetLang] || guides['default'] || ''
}

// ============================================================
// Module 2: SCENE CONSTRAINTS — Scene-specific constraints for non-ecommerce scenes
// ============================================================

// 场景映射：将UI场景ID映射到约束分组
export const SCENE_GROUP_MAP: Record<string, string> = {
  'ecommerce': 'ecommerce',
  'technical_params': 'technical_doc',
  'spec_sheet': 'technical_doc',
  'manual': 'operation_guide',
  'after_sales': 'compliance_doc',
  'packaging': 'compliance_doc',
  'ui': 'software_ui',
}

// 场景约束 - 翻译阶段注入
// 定位：格式规范 + 术语统一 + 场景化表达指引
// 原则：忠于源文内容，用场景惯例表达
export const SCENE_CONSTRAINTS: Record<string, {
  universal: string[]  // 所有语种通用
  langOverrides?: Record<string, string[]>  // 语种特定惯例
}> = {
  ecommerce: {
    universal: [
      'Expression: Front-load selling points, use short sentences, highlight user experience benefits',
      'Expression: Find equivalent expressions in target language for source-specific phrases, avoid literal translation',
      'Expression: Advertising phrases and rhetorical questions allowed, keep product series names in UPPERCASE for brand recognition',
      'Format: Preserve __XXX_N__ markers, HTML tags, and ↵ line breaks exactly as-is',
      'Terminology: Keep terminology consistent within the same product line',
    ],
    langOverrides: {
      'ja': [
        '日语惯例：商品详情页使用です・ます敬体',
        '日语惯例：允许适度活力表达（「ゲームの遅延を完全カット」等）',
      ],
      'de': [
        '德语惯例：电商文案注意文本长度，德语通常比英语长20-30%',
      ],
      'nl': [
        '荷兰语惯例：电商文案预期扩展约20%',
      ],
    },
  },

  technical_doc: {
    universal: [
      'Format: Use ※N format for footnote markers (※1, ※2, ※3), placed immediately after values/terms',
      'Format: Table rows must correspond 1:1, no merging or splitting; preserve "-"/"N/A"/"TBD"/"Typ."/"Max."/"Min." as-is',
      'Format: Speed/capacity values must include test conditions when mentioned in source',
      'Terminology: Keep terminology consistent within the same document (e.g., "read speed" always translated the same way)',
      'Expression: Technical documents should objectively state performance, avoid overly promotional language',
    ],
    langOverrides: {
      // CJK 语种
      'ja': [
        '日语惯例：规格书常用常体/である体（区别于电商场景的です・ます体）',
        '日语惯例：耐久性能术语统一（耐摩耗、耐温度、耐落下衝撃、X線耐性、耐振動、耐磁気、耐衝撃）',
        '日语惯例：品牌初出时标注「レクサー」，后续使用 Lexar',
      ],
      'ko': [
        '韩语惯例：技术文档使用하십시오체（습니다/ㅂ니다）敬体',
        '韩语惯例：避免最高级表达（최고 → 높은 성능）',
        '韩语惯例：品牌标注「렉사르」',
      ],
      'zh-CN': [
        '中文惯例：技术文档避免极限词（极致、领先、革命性）',
        '中文惯例：使用客观陈述（具有XX性能，而非"极致性能"）',
      ],
      'zh-TW': [
        '繁体中文惯例：技术文档避免极限词，使用客观陈述',
        '繁体中文惯例：使用台湾本土术语（記憶卡、固態硬碟、讀卡機）',
      ],
      // 欧洲语种
      'de': [
        '德语惯例：技术文档避免最高级，倾向客观描述',
        '德语惯例：复合名词必须连写（Lesegeschwindigkeit, nicht Lese Geschwindigkeit）',
        '德语惯例：所有名词首字母大写',
      ],
      'fr': [
        '法语惯例：技术文档避免最高级（le plus rapide → haute performance）',
        '法语惯例：小数点用逗号（7,5 Mo/s）',
        '法语惯例：使用法国本土法语，非魁北克法语',
      ],
      'es': [
        '西班牙语惯例：技术文档使用客观描述，避免夸张修饰',
        '西班牙语惯例：使用国际卡斯蒂利亚西班牙语',
      ],
      'pt': [
        '葡萄牙语惯例：技术文档使用正式表达',
        '葡萄牙语惯例：使用葡萄牙本土葡萄牙语',
      ],
      'pt-BR': [
        '巴西葡萄牙语惯例：技术文档使用客观描述',
        '巴西葡萄牙语惯例：使用巴西葡萄牙语',
      ],
      'it': [
        '意大利语惯例：技术文档使用客观表达',
        '意大利语惯例：名词形容词性数一致',
      ],
      'nl': [
        '荷兰语惯例：技术文档避免夸张表达',
        '荷兰语惯例：复合名词正确连写',
      ],
      'pl': [
        '波兰语惯例：技术文档使用正式表达',
        '波兰语惯例：保留所有变音符号（ą ę ł ń ó ś ź ż）',
      ],
      'sv': [
        '瑞典语惯例：技术文档使用客观描述',
        '瑞典语惯例：保留特殊字符（å ä ö）',
      ],
      // 其他语种
      'tr': [
        '土耳其语惯例：技术文档使用正式书面语',
        '土耳其语惯例：保留所有特殊字符（ı İ ö ü ç ş ğ）',
      ],
      'ru': [
        '俄语惯例：技术文档使用客观描述',
        '俄语惯例：单位使用西里尔字母（ГБ, МБ, ТБ）',
        '俄语惯例：使用西里尔字母，Lexar和技术符号保持拉丁',
      ],
      'vi': [
        '越南语惯例：技术文档使用北方标准语',
        '越南语惯例：保留所有声调符号',
      ],
      'th': [
        '泰语惯例：技术文档使用通用语体，避免皇室/宗教用语',
        '泰语惯例：保留所有上标/下标元音和声调符号',
      ],
      'id': [
        '印尼语惯例：技术文档使用正式标准印尼语',
        '印尼语惯例：使用Anda称呼，避免口语化表达',
      ],
      'ar': [
        '阿拉伯语惯例：技术文档使用现代标准阿拉伯语（MSA）',
        '阿拉伯语惯例：RTL方向，嵌入英文/数字保持LTR',
      ],
      'en': [
        '英语惯例：技术文档使用美式拼写，避免复杂从句',
        '英语惯例：使用American English拼写（color, center, fiber）',
      ],
    },
  },

  operation_guide: {
    universal: [
      'Format: Operation steps must correspond 1:1 strictly, no merging or splitting',
      'Format: WARNING/CAUTION/NOTE must preserve original hierarchy levels',
      'Expression: Operation guidance first — state "what to do" before "why"',
      'Expression: Use clear instructional sentence patterns',
    ],
    langOverrides: {
      // CJK 语种
      'ja': [
        '日语惯例：说明书使用「～してください」敬体',
        '日语惯例：警告格式统一为【警告】【注意】【注釈】',
      ],
      'ko': [
        '韩语惯例：说明书使用하십시오체敬体',
        '韩语惯例：警告格式使用[경고][주의][참고]',
      ],
      'zh-CN': [
        '中文惯例：说明书使用"请"字句（请按下X键）',
        '中文惯例：警告格式使用【警告】【注意】【说明】',
      ],
      'zh-TW': [
        '繁体中文惯例：说明书使用「請」字句',
        '繁体中文惯例：警告格式使用【警告】【注意】【說明】',
      ],
      // 欧洲语种
      'de': [
        '德语惯例：说明书使用Sie称呼，动词用祈使句',
        '德语惯例：警告格式使用WARNUNG/ACHTUNG/HINWEIS',
      ],
      'fr': [
        '法语惯例：说明书使用vous称呼',
        '法语惯例：警告格式使用AVERTISSEMENT/ATTENTION/REMARQUE',
      ],
      'es': [
        '西班牙语惯例：说明书使用Usted称呼',
        '西班牙语惯例：警告格式使用ADVERTENCIA/PRECAUCIÓN/NOTA',
      ],
      'pt': [
        '葡萄牙语惯例：说明书使用você称呼',
      ],
      'pt-BR': [
        '巴西葡萄牙语惯例：说明书使用você称呼',
      ],
      'it': [
        '意大利语惯例：说明书使用祈使句',
      ],
      'nl': [
        '荷兰语惯例：说明书使用u称呼',
      ],
      'pl': [
        '波兰语惯例：说明书使用Pan/Pani称呼',
      ],
      'sv': [
        '瑞典语惯例：说明书使用du称呼',
      ],
      // 其他语种
      'tr': [
        '土耳其语惯例：说明书使用Siz称呼',
      ],
      'ru': [
        '俄语惯例：说明书使用Вы称呼',
        '俄语惯例：警告格式使用ВНИМАНИЕ/ОСТОРОЖНО/ПРИМЕЧАНИЕ',
      ],
      'vi': [
        '越南语惯例：说明书使用您/bạn称呼',
      ],
      'th': [
        '泰语惯例：说明书使用通用语体',
      ],
      'id': [
        '印尼语惯例：说明书使用Anda称呼',
      ],
      'ar': [
        '阿拉伯语惯例：说明书使用现代标准阿拉伯语',
      ],
      'en': [
        '英语惯例：说明书使用祈使句（Press the button）',
      ],
    },
  },

  compliance_doc: {
    universal: [
      'Format: Certification marks (CE/FCC/UL, etc.), warranty periods, contact information format must match source',
      'Format: Preserve __XXX_N__ markers, HTML tags, and ↵ line breaks exactly as-is',
      'Terminology: Legal terms and warranty clauses must be translated word-for-word, no paraphrasing or omission',
      'Expression: After-sales and warranty documents should use rigorous, formal language',
    ],
    langOverrides: {},
  },

  software_ui: {
    universal: [
      'Format: UI labels/buttons ≤15 characters must remain concise',
      'Format: Preserve __XXX_N__ markers and variable placeholders ({0}, %s) exactly as-is',
      'Terminology: Translations of the same feature must be consistent across different screens',
      'Expression: Error messages should be action-first (state what to do first, then why)',
    ],
    langOverrides: {
      'de': [
        '德语惯例：UI文本注意扩展，德语通常比英语长20-30%',
      ],
      'nl': [
        '荷兰语惯例：UI文本预期扩展约20%，优先使用简短形式',
      ],
    },
  },
}

// 获取场景约束（翻译阶段）
// suppressExpression: 当 style 已明确设定时，抑制场景约束中的"表达/语调"行，
//   避免与 Style Guide 的语调指令冲突（如 ecommerce "使用广告语" vs Standard "无夸大宣传"）
export function getSceneConstraints(scenePreset: string, targetLang: string, suppressExpression?: boolean): string {
  const groupId = SCENE_GROUP_MAP[scenePreset]
  if (!groupId) return ''

  const config = SCENE_CONSTRAINTS[groupId]
  if (!config) return ''

  // 当 style 已设定时，只保留格式/术语类约束，抑制语调/表达类约束
  // Expression: 前缀 = 语调类 → 与 Style Guide 职责重叠 → 抑制
  // Format:/Terminology: 前缀 = 格式/术语类 → 始终注入
  const lines = suppressExpression
    ? config.universal.filter(l => !l.startsWith('Expression:'))
    : [...config.universal]

  // 添加语种特定惯例
  if (config.langOverrides?.[targetLang]) {
    lines.push(...config.langOverrides[targetLang])
  }

  if (lines.length === 0) return ''

  return `\n\n【${groupId} 场景约束】\n${lines.map(l => `- ${l}`).join('\n')}`
}

// ============================================================
// Module 2 continued: STYLE GUIDES (per target language)
// ============================================================

export const STYLE_GUIDES: Record<string, Record<string, string>> = {
  standard: {
    'default': `[Style·Standard]
Core: Complete restoration of all source information, no additions/omissions, no deliberate literary flair, no marketing hype, objective and neutral.
Rules:
- Strictly faithful to source semantics, 100% information restoration, no subjective polishing, no eye-catching rewriting
- Plain and accessible wording for general office, family, student users
- No exaggerated promotion, no literary phrases, no gaming/trendy language, standard sentence structure`,
  },
  professional: {
    'default': `[Style·Professional]
Core: Restrained premium, emphasizing stability, reliability, professional creative trust, no flashy marketing.
Rules:
- Concise and calm sentences, targeting photographers, film crews, drone operators
- Can pair with minimalist literary quality slogans (style: restrained premium, emphasizing craftsmanship and trust — express in target language, do NOT copy Japanese)
- High-frequency use of imaging professional terminology: sustained write, RAW, 8K, outdoor extreme protection
- Focus on professional value: V60/V90/VPG400 video ratings, IP68 protection, metal durable body
- No hot-blooded, lightweight e-commerce language, no gaming terminology`,
  },
  marketing: {
    'default': `[Style·Marketing]
Core: E-commerce traffic-oriented, eye-catching, impactful, highlighting usage experience improvement for conversion.
Rules:
- Youthful, light expression, downplay dry parameters, highlight usage pleasure
- Allow advertising slogans, rhetorical questions, preserve product series uppercase English for brand recognition
- Gaming products (dimm/ssd/card): Use gamer-friendly language that emphasizes performance benefits and eliminates pain points (e.g., "no more lag", "store everything")
- Trendy lifestyle products: Focus on aesthetics, atmosphere, IP collaboration
- Strong promotional feel, suitable for e-commerce homepage traffic, main image large text promotion`,
  },
}

export function getStyleGuide(style: string, targetLang: string): string {
  const guides = STYLE_GUIDES[style] || STYLE_GUIDES['standard']
  return guides[targetLang] || guides['default'] || ''
}

// ═══════════════════════════════════════════════════════════════
// 模块: LANG_SPECIFIC — 目标语言专属提示词
// ═══════════════════════════════════════════════════════════════
// 职责: 该语言一切专属内容。翻译和校对都通过此模块注入。
// 注入: 目标语言匹配时，翻译和校对各自渲染不同视角。
// 边界: ⛔ 不含跨语言通用规则（那是 IRON_RULES 的职责）
//       ⛔ 不含产品线策略（那是 PRODUCT_LINE_TONE_GUIDES 的职责）
//       ⛔ 不含翻译示例（那是 FEWSHOT_STORE 的职责）
// ───────────────────────────────────────────────────────────────
// 结构: 每个语言 4 个字段
//   rules       — 排版/语法/用字/术语规范（翻译+校对都注入）
//   compliance  — 广告法/文化禁忌（翻译+校对都注入）
//   quality     — 母语者语感品质要求（仅校对注入）
//   terminology — 品类词术语对照（由 renderer 从 CATEGORY_WORDS
//                  动态生成，不手动维护）
// ═══════════════════════════════════════════════════════════════

interface LangBlock {
  /** 排版/语法/用字/术语规范 — 翻译+校对都注入 */
  rules: string
  /** 广告法/文化禁忌 — 翻译+校对都注入 */
  compliance: string
  /** 母语者语感品质 — 仅校对注入 */
  quality: string
}

export const LANG_SPECIFIC: Record<string, LangBlock> = {
  'zh-CN': {
    rules: `术语强制统一：存储卡、固态硬盘、读卡器、读写速度、移动固态硬盘。禁止港台用语混入：禁用「記憶卡、固態硬碟、讀卡機、行動硬碟、相機、影片」等繁体词汇。禁止将英文营销俚语直译成中文网络梗，保持专业数码产品文案调性。禁止自行增加原文没有的夸张修饰。`,
    compliance: `严格遵守中国大陆广告法：禁用极限词（最佳、第一、顶级、秒杀、极致、碾压、国家级、全网最低等）。不得出现虚假宣传、绝对化用语。`,
    quality: `以简体中文母语者的语感审视译文——是否自然流畅、符合中国大陆的行业表达习惯？`,
  },
  'zh-TW': {
    rules: `使用台湾本土术语：記憶卡（非存儲卡）、固態硬碟（非固態硬盤）、讀卡機（非讀卡器）、行動硬碟（非移動硬盤）、相機、影片、軟體、程式、螢幕、隨身碟。若源文为简体中文：用字严格遵循台湾正体规范（身分、週、裡、後），一对多繁简必须准确（只→隻/衹、干→乾/幹/干、复→復/複、开场→開場），禁止机械一对一转换。`,
    compliance: `禁用大陆特有政策词汇与网络用语。文案符合台湾公平交易法，不得出现绝对化用语。`,
    quality: `以台灣繁體中文母語者的語感審視譯文——是否自然流暢、符合台灣的產業用語習慣？`,
  },
  'ja': {
    rules: `ブランド初出時に「レクサー」と注記、以降は Lexar で統一。文体：商品詳細ページはです・ます敬体で統一。技術用語：技術記号は英文保持、一般用語は業界標準の和製漢語（SDカード、読み込み速度、書き込み速度、プロフェッショナル）。禁止：中式日本語の直訳。「安定」「安心」「長寿命」「高耐久」など日本市場が好む表現を使用。カタカナ外来語は業界標準の転写を使用し、独自の音訳は禁止。`,
    compliance: `景品表示法・薬機法を遵守：過度な誇張表現、最上級表現（日本一、世界最高等）、未実証の効能効果を禁止。`,
    quality: `日本語ネイティブとして訳文を吟味してください——自然で業界標準の表現になっていますか？`,
  },
  'ko': {
    rules: `브랜드 첫 언급 시 렉사르로 표기, 본문은 Lexar 유지. 기술 용어는 업계 표준 영어 외래어 우선 사용(SD 카드, SSD, 읽기 속도, 쓰기 속도, 휴대용 SSD, 카드 리더기). 생소한 한자어 강제 사용 금지. 문체는 하십시오체(습니다/ㅂ니다) 통일, 반말 금지. 띄어쓰기 엄수(모든 단어 사이 공백 정확히). 일본어 유래 한자어 사용 금지.`,
    compliance: `표시·광고의 공정화에 관한 법률 준수: 최고급, 최대, 1위 등 최고급 표현 및 허위·과장 광고 금지.`,
    quality: `한국어 원어민의 감각으로 번역문을 검토하세요 — 자연스럽고 업계 표준 표현에 맞습니까？`,
  },
  'fr': {
    rules: `Use Metropolitan French (France), NOT Quebec French. All nouns must have correct gender, adjectives must agree in gender and number. Non-breaking space before : ; ! ? « ». Decimal separator: comma (7,5 Mo/s). Terminology: carte SD, vitesse de lecture, vitesse d'écriture, SSD portable, clé USB. Formal "vous" not "tu". Minimize English loanwords; prefer native French technical terms (e.g. micrologiciel NOT firmware).`,
    compliance: `Respecter la loi EGALIM et la réglementation publicitaire française: éviter les superlatifs absolus (le meilleur, le plus rapide) sans preuves. Pas de claims médicaux ou de bien-être non vérifiés.`,
    quality: `Évaluez en français natif : la traduction est-elle naturelle et adaptée au public français ?`,
  },
  'de': {
    rules: `Lexar ≠ Lexware — never confuse the brand. ALL nouns MUST be capitalized. Compound nouns must be one word: Speicherkarte, Lesegeschwindigkeit, Schreibgeschwindigkeit, Kartenleser, USB-Stick. Formal "Sie" not "du". Do NOT calque English word order into German (verb-final in subordinate clauses).`,
    compliance: `UWG (Gesetz gegen den unlauteren Wettbewerb) beachten: Keine absoluten Superlative (der beste, der schnellste) ohne Nachweis. Keine irreführenden Werbeaussagen.`,
    quality: `Prüfen Sie als deutscher Muttersprachler: klingt die Übersetzung natürlich und zielgruppengerecht?`,
  },
  'es': {
    rules: `Use International Castilian Spanish — do NOT mix in Latin American regional slang. "ordenador" NOT "computadora", "tarjeta de memoria" NOT "memoria". All nouns must have correct gender and number agreement. Formal "Usted" for customer-facing copy. Terminology: tarjeta microSD/SD, SSD portátil, lector de tarjetas, velocidad de lectura/escritura.`,
    compliance: `Cumplir con la Ley General de Publicidad de España: evitar superlativos absolutos (el mejor, el más rápido) sin evidencia. No usar afirmaciones engañosas.`,
    quality: `Evalúe como hispanohablante nativo: ¿suena natural y adecuada para el público español?`,
  },
  'pt': {
    rules: `Use Portugal mainland formal Portuguese. ⛔ Pen USB (NOT Pen Drive), Portátil (NOT Notebook), Caixa (NOT Case). Do NOT mix in Brazilian Portuguese vocabulary or grammar. Terminology: cartão de memória, SSD portátil, leitor de cartões, velocidade de leitura/gravação. Adjective-noun gender/number agreement. Pronouns and clitics follow European Portuguese rules (post-position).`,
    compliance: `Cumprir a legislação publicitária portuguesa: evitar superlativos absolutos sem comprovação. Não usar afirmações enganosas.`,
    quality: `Avalie como falante nativo de português europeu: a tradução soa natural?`,
  },
  'pt-BR': {
    rules: `Use Brazilian Portuguese throughout. ⛔ Pen Drive (NOT Pen USB), Notebook (NOT Portátil), Case (NOT Caixa). Do NOT mix in European Portuguese vocabulary. Terminology: cartão de memória, SSD portátil, leitor de cartões, pendrive, velocidade de leitura/gravação. Use "você". Watch for false friends: atualmente = currently (NOT actually).`,
    compliance: `Cumprir o Código de Defesa do Consumidor (CDC) do Brasil: evitar superlativos absolutos sem comprovação. Não usar afirmações enganosas ou abusivas.`,
    quality: `Avalie como falante nativo de português brasileiro: a tradução soa natural?`,
  },
  'it': {
    rules: `All nouns and adjectives must agree in gender and number. Terminology: scheda SD, velocità di lettura, velocità di scrittura. Photography-related copy can be slightly softer and more elegant, matching Italian photography culture.`,
    compliance: `Rispettare la normativa pubblicitaria italiana: evitare superlativi assoluti (il migliore, il più veloce) senza prove. Non usare affermazioni ingannevoli.`,
    quality: `Valuti come madrelingua italiano: la traduzione suona naturale e adatta al pubblico?`,
  },
  'nl': {
    rules: `Compound nouns must be correctly joined, no spacing errors. Terminology: geheugenkaart, leessnelheid, schrijfsnelheid. Expect text expansion of ~20% in UI.`,
    compliance: `Naleving van de Nederlandse Reclame Code: vermijd absolute superlatieven (de beste, de snelste) zonder bewijs. Geen misleidende claims.`,
    quality: `Beoordeel als Nederlandse moedertaalspreker: klinkt de vertaling natuurlijk?`,
  },
  'pl': {
    rules: `ALL special diacritic characters must be preserved: ą ę ł ń ó ś ź ż — never omit or replace with plain letters. Nouns and adjectives must be correctly declined for case. Terminology: karta pamięci, prędkość odczytu, prędkość zapisu. Allow extra space for text expansion in UI — prefer short forms.`,
    compliance: `Przestrzegać polskiego prawa reklamowego: unikać absolutnych superlatywów (najlepszy, najszybszy) bez dowodów. Nie wprowadzać w błąd konsumentów.`,
    quality: `Oceń jako rodzimy użytkownik polskiego: czy tłumaczenie brzmi naturalnie?`,
  },
  'sv': {
    rules: `Preserve special characters: å ä ö. Terminology: microSD-kort, bärbar SSD, kortläsare, USB-minne, läshastighet, skrivhastighet. Retain English IT terms (SSD, NVMe, PCIe, gaming). Compound nouns must be correctly spelled — do not split them.`,
    compliance: `Följ svensk marknadsföringslag: undvik absoluta superlativ (bäst, snabbast) utan bevis. Ingen vilseledande marknadsföring.`,
    quality: `Bedöm som svensk modersmålstalare: låter översättningen naturlig?`,
  },
  'tr': {
    rules: `ALL special characters must be preserved: ı İ ö ü ç ş ğ. Strictly distinguish i/ı and I/İ — never confuse them. Terminology: SD kart, okuma hızı, yazma hızı. Use standard formal written Turkish, suitable for both professional users and consumers.`,
    compliance: `Türk reklam mevzuatına uyun: kanıtlanmamış mutlak üstünlük ifadelerinden (en iyi, en hızlı) kaçının. Yanıltıcı iddialar kullanmayın.`,
    quality: `Ana dili Türkçe olan biri olarak değerlendirin: çeviri doğal geliyor mu?`,
  },
  'ru': {
    rules: `Use Cyrillic throughout; Lexar and technical symbols remain in Latin script, embedded LTR within the text. Terminology: скорость чтения, скорость записи, карта памяти. All nouns and adjectives must be correctly declined (6 cases).`,
    compliance: `Соблюдайте закон о рекламе РФ: избегайте абсолютных превосходных степеней (лучший, самый быстрый) без доказательств. Не используйте вводящие в заблуждение утверждения.`,
    quality: `Оцените как носитель русского языка: звучит ли перевод естественно?`,
  },
  'vi': {
    rules: `ALL tone marks and special characters must be preserved: đ ư ơ ă â — missing tones change meaning. Use Northern standard Vietnamese (Hanoi accent), NOT Southern dialect. Verify no broken syllables in output. Terminology: thẻ nhớ, tốc độ đọc, tốc độ ghi. Use correct classifiers (measure words) for product categories — do not calque from English. E-commerce copy should be lively and direct, matching Vietnamese market style.`,
    compliance: `Tuân thủ Luật Quảng cáo Việt Nam: tránh các từ tuyệt đối hóa (tốt nhất, nhanh nhất) khi không có bằng chứng. Không sử dụng tuyên bố gây hiểu lầm.`,
    quality: `Đánh giá với tư cách người bản ngữ tiếng Việt: bản dịch có tự nhiên không?`,
  },
  'th': {
    rules: `All superscript/subscript vowels and tone marks must display completely — no character overlap, loss, or distortion. Use standard common register, NOT royal/high honorifics, and NOT overly casual speech. Brand annotation: เล็กซาร์; technical parameters remain in English. Word breaking must follow Thai writing conventions — never break mid-word.`,
    compliance: `ปฏิบัติตามกฎหมายโฆษณาไทย: หลีกเลี่ยงคำกล่าวอ้างที่เกินจริง (ดีที่สุด เร็วที่สุด) โดยไม่มีหลักฐาน ระวังเนื้อหาที่อ่อนไหวต่อพุทธศาสนา`,
    quality: `ประเมินในฐานะเจ้าของภาษาไทย: งานแปลฟังดูเป็นธรรมชาติหรือไม่?`,
  },
  'id': {
    rules: `Use official standard Indonesian (Bahasa Indonesia) — do NOT mix in Malay vocabulary. Formal "Anda", avoid colloquial "kamu"/"lu"/"gue". Terminology: kartu memori, SSD portabel, pembaca kartu, flashdisk, kecepatan baca/tulis. Prefix system (me-, di-, ter-, pe-) must be correctly applied. Language should be accessible and direct — avoid overly formal bureaucratic expressions; match Indonesian 3C product copy style.`,
    compliance: `Patuhi peraturan periklanan Indonesia: hindari kata-kata absolut (terbaik, tercepat) tanpa bukti. Jangan gunakan klaim yang menyesatkan.`,
    quality: `Nilai sebagai penutur asli bahasa Indonesia: apakah terjemahan terdengar alami?`,
  },
  'ar': {
    rules: `Use Modern Standard Arabic (MSA/fusha) — do NOT mix in any national dialect. Full text RTL; embedded Lexar, English terms, numbers, and symbols remain LTR — bidirectional text logic must be correct. Terminology: بطاقة ذاكرة, سرعة القراءة, قرص صلب SSD. Gender-neutral phrasing; avoid sensitive imagery and religious references.`,
    compliance: `التزم بقوانين الإعلان في الشرق الأوسط: تجنب الادعاءات المطلقة (الأفضل، الأسرع) بدون أدلة. تجنب المحتوى الحساس دينياً أو politically sensitive.`,
    quality: `قيّم بصفتك متحدثًا أصليًا للعربية: هل الترجمة طبيعية ومناسبة للجمهور المستهدف؟`,
  },
  'en': {
    rules: `Use American English spelling consistently: color, center, fiber, license — do NOT mix in British spelling. Fixed terminology: Read speed / Write speed, Professional filmmaker, Content creator, Rugged design. Technical copy should be concise and objective; marketing copy should use short sentences, avoid complex clauses. Do NOT literally translate Chinese four-character marketing slogans into awkward English; use native digital industry expressions.`,
    compliance: `Follow FTC advertising guidelines: avoid absolute superlatives (best, fastest) without evidence. No deceptive claims or unsubstantiated performance assertions.`,
    quality: `Evaluate as a native English speaker: does the translation sound natural for the target audience?`,
  },
}

// ═══════════════════════════════════════════════════════════════
// LANG_SPECIFIC 渲染函数
// ═══════════════════════════════════════════════════════════════
// 同一份数据源，翻译和校对各自渲染不同视角
// 翻译: 指令式 — "你必须用 X，禁止 Y"
// 校对: 检查式 — "检查是否用了 X 而非 Y"
// 术语部分从 CATEGORY_WORDS 动态读取，不重复维护
// ═══════════════════════════════════════════════════════════════

/**
 * 渲染翻译视角的语言专属提示词。
 * 包含: 品类词术语 + rules + compliance + 场景约束 + 语气风格
 */
export function renderLangForTranslate(
  targetLang: string,
  productLine?: string | null,
  scenePreset?: string,
  style?: string,
): string {
  const block = LANG_SPECIFIC[targetLang]
  if (!block) return ''

  const categoryBlock = buildCategoryTerminology(targetLang, productLine)
  // v7.5.2: 当 style 明确设定时，抑制场景约束中的 Expression 行，
  // 避免与 Style Guide 的语调指令冲突
  const sceneConstraints = scenePreset ? getSceneConstraints(scenePreset, targetLang, !!style) : ''

  // 语气风格：从校对移入翻译，让翻译LLM一次到位
  const productTone = getProductLineTone(productLine || null, targetLang)
  const styleGuide = style ? getStyleGuide(style, targetLang) : ''

  const parts = [categoryBlock, block.rules, block.compliance, sceneConstraints, productTone, styleGuide].filter(Boolean)
  if (parts.length === 0) return ''

  return `\n[${targetLang} Guidelines]\n${parts.join('\n')}`
}

/**
 * 渲染校对视角的语言专属校验标准。
 * 包含: 品类词术语 + rules + quality + compliance
 * ⛔ 不注入 sceneChecklist/productTone/styleGuide — 翻译已负责风格，校对不重复
 */
export function renderLangForProofread(
  targetLang: string,
  productLine?: string | null,
): string {
  const block = LANG_SPECIFIC[targetLang]
  if (!block) return ''

  const categoryBlock = buildCategoryTerminology(targetLang, productLine)

  // 校对做硬性检查：品类词 + rules + quality + compliance
  // quality 让校对 LLM 以母语者视角检查译文自然度
  // compliance 让校对 LLM 知道广告法/合规要求，避免误判翻译的合规性调整
  const parts = [categoryBlock, block.rules, block.quality, block.compliance].filter(Boolean)

  if (parts.length === 0) return ''

  return `\n[VALIDATION: ${targetLang}]\n${parts.join('\n')}`
}

/** 从 CATEGORY_WORDS 数据源按语言和产品线动态生成品类词对照表 */
function buildCategoryTerminology(targetLang: string, productLine?: string | null): string {
  const allowedWords = productLine
    ? (PRODUCT_LINE_CATEGORY_MAP[productLine] || FALLBACK_CATEGORY_WORDS)
    : FALLBACK_CATEGORY_WORDS

  const lines: string[] = []
  for (const [en, map] of Object.entries(CATEGORY_WORDS)) {
    if (!allowedWords.includes(en)) continue
    const translated = map[targetLang]
    if (translated && translated !== en) {
      lines.push(`  ${en} → ${translated}`)
    }
  }
  if (lines.length === 0) return ''
  return `品类词对照：\n${lines.join('\n')}`
}


// ============================================================
// Module 3 continued: CATEGORY WORDS (10 categories × 20 languages)
// ============================================================

// ═══════════════════════════════════════════════════════════════
// 数据源: CATEGORY_WORDS — 品类词多语言对照表
// ═══════════════════════════════════════════════════════════════
// 职责: 纯数据，10品类词×20语言的对照表
// 注入: ⛔ 不直接注入 prompt。由 LANG_SPECIFIC 渲染时按需读取
// 边界: ⛔ 不是独立注入模块，只是数据源
//       ⛔ 不写规则，只存对照数据
// ═══════════════════════════════════════════════════════════════

export const CATEGORY_WORDS: Record<string, Record<string, string>> = {
  'SSD': {
    'zh-CN': '固态硬盘', 'zh-TW': '固態硬碟', 'ja': 'SSD', 'ko': 'SSD',
    'fr': 'SSD', 'de': 'SSD', 'es': 'Unidad de estado sólido (SSD)',
    'pt': 'SSD Interno', 'pt-BR': 'SSD Interno', 'it': 'SSD',
    'ru': 'SSD', 'vi': 'Ổ Cứng SSD', 'th': 'SSD ภายใน', 'id': 'SSD Internal',
    'ar': 'SSD داخلي', 'nl': 'Interne SSD', 'pl': 'Dysk SSD wewnętrzny',
    'sv': 'Intern SSD', 'tr': 'Dahili SSD',
  },
  'Portable SSD': {
    'zh-CN': '移动固态硬盘', 'zh-TW': '行動固態硬碟', 'ja': 'ポータブルSSD', 'ko': '휴대용 SSD',
    'fr': 'SSD portable', 'de': 'Tragbare SSD', 'es': 'SSD portátil',
    'pt': 'SSD Portátil', 'pt-BR': 'SSD Portátil', 'it': 'SSD portatile',
    'ru': 'Портативный SSD', 'vi': 'SSD Di Động', 'th': 'SSD แบบพกพา', 'id': 'SSD Portabel',
    'ar': 'SSD محمول', 'nl': 'Draagbare SSD', 'pl': 'Przenośny dysk SSD',
    'sv': 'Portabel SSD', 'tr': 'Taşınabilir SSD',
  },
  'Desktop Memory': {
    'zh-CN': '台式机内存条', 'zh-TW': '桌上型電腦記憶體', 'ja': 'デスクトップメモリ', 'ko': '데스크탑 메모리',
    'fr': 'Mémoire pour ordinateur de bureau', 'de': 'Desktop Arbeitsspeicher',
    'es': 'Memoria de sobremesa', 'pt': 'Memória RAM para Desktop', 'pt-BR': 'Memória RAM para Desktop',
    'it': 'Memoria per Desktop', 'ru': 'Оперативная память для ПК',
    'vi': 'Bộ Nhớ Máy Tính Để Bàn', 'th': 'แรมคอมพิวเตอร์ตั้งโต๊ะ', 'id': 'RAM Desktop',
    'ar': 'ذاكرة RAM لأجهزة الكمبيوتر المكتبية', 'nl': 'RAM-geheugen voor desktop',
    'pl': 'Pamięć RAM do komputera stacjonarnego', 'sv': 'Arbetsminne för stationär dator',
    'tr': 'Masaüstü RAM',
  },
  'Laptop Memory': {
    'zh-CN': '笔记本电脑内存', 'zh-TW': '筆記型電腦記憶體', 'ja': 'ラップトップメモリ', 'ko': '랩탑 메모리',
    'fr': 'Mémoire pour ordinateur portable', 'de': 'Laptop Arbeitsspeicher',
    'es': 'Memoria para portátil', 'pt': 'Memória RAM para Portátil', 'pt-BR': 'Memória RAM para Notebook',
    'it': 'Memoria per Laptop', 'ru': 'Оперативная память для ноутбука',
    'vi': 'Bộ Nhớ Máy Tính Xách Tay', 'th': 'แรมโน้ตบุ๊ก', 'id': 'RAM Laptop',
    'ar': 'ذاكرة RAM لأجهزة الكمبيوتر المحمولة', 'nl': 'RAM-geheugen voor laptop',
    'pl': 'Pamięć RAM do laptopa', 'sv': 'Arbetsminne för bärbar dator',
    'tr': 'Laptop RAM',
  },
  'Flash Drive': {
    'zh-CN': '闪存盘', 'zh-TW': '隨身碟', 'ja': 'USBメモリ', 'ko': 'USB 메모리',
    'fr': 'Clé USB', 'de': 'USB-Stick', 'es': 'Unidad flash',
    'pt': 'Pen USB', 'pt-BR': 'Pen Drive', 'it': 'Unità flash',
    'ru': 'USB-флеш-накопитель', 'vi': 'Flash Drive', 'th': 'แฟลชไดร์ฟ', 'id': 'Flashdisk',
    'ar': 'محرك فلاش USB', 'nl': 'USB-stick', 'pl': 'Pendrive',
    'sv': 'USB-minne', 'tr': 'USB Bellek',
  },
  'Dual Drive': {
    'zh-CN': '双接口U盘', 'zh-TW': '雙接頭隨身碟', 'ja': 'デュアルドライブ', 'ko': '듀얼 드라이브',
    'fr': 'Clé USB double interface', 'de': 'Dual-USB-Stick', 'es': 'Unidad flash de doble interfaz',
    'pt': 'Pen USB Dupla Interface', 'pt-BR': 'Pen Drive Dupla Interface', 'it': 'Unità flash a doppia interfaccia',
    'ru': 'USB-накопитель с двумя разъёмами', 'vi': 'USB Hai Đầu', 'th': 'แฟลชไดร์ฟสองพอร์ต', 'id': 'Flashdisk Dual Interface',
    'ar': 'محرك فلاش ثنائي الواجهة', 'nl': 'Dual-USB-stick', 'pl': 'Pendrive z dwoma złączami',
    'sv': 'USB-minne med dubbla gränssnitt', 'tr': 'Çift Arayüzlü USB Bellek',
  },
  'Solid State Dual Drive': {
    'zh-CN': '固态U盘', 'zh-TW': '固態隨身碟', 'ja': 'ソリッドステートデュアルドライブ', 'ko': '솔리드 스테이트 듀얼 드라이브',
    'fr': 'Clé USB SSD double interface', 'de': 'SSD-Dual-USB-Stick', 'es': 'Unidad flash SSD de doble interfaz',
    'pt': 'Pen USB SSD Dupla Interface', 'pt-BR': 'Pen Drive SSD Dupla Interface', 'it': 'Unità flash SSD a doppia interfaccia',
    'ru': 'SSD-накопитель с двумя разъёмами', 'vi': 'USB SSD Hai Đầu', 'th': 'โซลิดสเตทแฟลชไดร์ฟสองพอร์ต', 'id': 'SSD Flashdisk Dual Interface',
    'ar': 'محرك أقراص صلب ثنائي الواجهة', 'nl': 'SSD Dual-USB-stick', 'pl': 'Pendrive SSD z dwoma złączami',
    'sv': 'SSD USB-minne med dubbla gränssnitt', 'tr': 'SSD Çift Arayüzlü USB Bellek',
  },
  'Card': {
    'zh-CN': '存储卡', 'zh-TW': '記憶卡', 'ja': 'カード', 'ko': '카드',
    'fr': 'Carte', 'de': 'Karte', 'es': 'Tarjeta',
    'pt': 'Cartão', 'pt-BR': 'Cartão', 'it': 'Scheda',
    'ru': 'Карта памяти', 'vi': 'Thẻ', 'th': 'เมมโมรี่การ์ด', 'id': 'Kartu Memori',
    'ar': 'بطاقة ذاكرة', 'nl': 'Geheugenkaart', 'pl': 'Karta pamięci',
    'sv': 'Minneskort', 'tr': 'Hafıza Kartı',
  },
  'Reader': {
    'zh-CN': '读卡器', 'zh-TW': '讀卡機', 'ja': 'リーダー', 'ko': '리더',
    'fr': 'Lecteur', 'de': 'Lesegerät', 'es': 'Lector',
    'pt': 'Leitor', 'pt-BR': 'Leitor', 'it': 'Lettore',
    'ru': 'Картридер', 'vi': 'Reader', 'th': 'การ์ดรีดเดอร์', 'id': 'Card Reader',
    'ar': 'قارئ بطاقات', 'nl': 'Kaartlezer', 'pl': 'Czytnik kart',
    'sv': 'Kortläsare', 'tr': 'Kart Okuyucu',
  },
  'Enclosure': {
    'zh-CN': '硬盘盒', 'zh-TW': '硬碟盒', 'ja': 'ケース', 'ko': '케이스',
    'fr': 'Boîtier', 'de': 'Gehäuse', 'es': 'Receptáculo',
    'pt': 'Caixa', 'pt-BR': 'Case', 'it': 'Custodia',
    'ru': 'Корпус', 'vi': 'Enclosure', 'th': 'กล่อง', 'id': 'Casing',
    'ar': 'علبة', 'nl': 'Behuizing', 'pl': 'Obudowa',
    'sv': 'Kabinett', 'tr': 'Kutusu',
  },
  'Hub': {
    'zh-CN': '扩展坞', 'zh-TW': '擴充埠', 'ja': 'ハブ', 'ko': '허브',
    'fr': 'Hub', 'de': 'Hub', 'es': 'Concentrador',
    'pt': 'Hub', 'pt-BR': 'Hub', 'it': 'Hub',
    'ru': 'Хаб', 'vi': 'Hub', 'th': 'ฮับ', 'id': 'Hub',
    'ar': 'موزع', 'nl': 'Hub', 'pl': 'Hub',
    'sv': 'Hubb', 'tr': 'Hub',
  },
}

/** Product line → relevant category words (only inject what the current product line needs) */
export const PRODUCT_LINE_CATEGORY_MAP: Record<string, string[]> = {
  professional_imaging: ['Card', 'Reader'],
  consumer_cards: ['Card', 'Reader'],
  gaming_card: ['Card'],
  gaming_ssd: ['SSD', 'Portable SSD'],
  gaming_dimm: ['Desktop Memory', 'Laptop Memory'],
  pc_productivity: ['SSD', 'Portable SSD', 'Hub'],
  portable_storage: ['Portable SSD', 'Flash Drive', 'Dual Drive', 'Card', 'Reader', 'Enclosure', 'Hub'],
  innovation_lifestyle: [],
}

const FALLBACK_CATEGORY_WORDS = ['SSD', 'Card', 'Flash Drive']


// ============================================================
// Module 5: OUTPUT ANCHOR (English only, unified)
// ============================================================

export const OUTPUT_ANCHOR = `[OUTPUT]
Self-check before output (do NOT output the check process):
1. __XXX_N__ markers, HTML tags, and ↵ line break markers preserved
2. No fabricated specs, brand names, or claims not in the source
3. No trademark symbols (®™©) added that are not in the source
Check passed → output in format: "[N] translated text" — one line per item.
⛔ Absolutely NO markdown — no \`\`\`, no **bold**, no \`code\`, no HTML.
⛔ Each [N] is exactly ONE line. Do NOT wrap or split across lines.
⛔ Output plain text only — no explanations, no prefixes, no JSON.
→ Output translations now:`

// ═══════════════════════════════════════════════════════════════
// 模块: PROOFREAD_SYSTEM_PROMPT — AI 校对指令（校对 LLM 的 System Prompt）
// ═══════════════════════════════════════════════════════════════
//
// AI校对功能说明（2026-07-12 v7.4 精简）
//
// 【核心职责】
// AI校对只做代码做不到的事：检查完整性、含义准确性。
// 代码已处理的问题（符号、术语、换行、格式、漏翻等）AI校对不重复检查。
//
// 【为什么这样设计】
// 历史教训：早期校对prompt包含多项检查（语言检查、占位符、自然度等），
// 导致LLM执行重复检查时浪费token，甚至"顺手重写"整段译文引入新错误。
// v7.4精简为2项核心检查，让校对更单纯、更高效。
//
// 【AI校对检查项（v7.4精简后）】
// 1. 完整性：译文是否包含源文的所有信息？有无漏译/截断/加戏？
// 2. 含义准确：译文含义是否与源文一致？有无错译/品类词错误？
//
// 【AI校对边界 — 不检查这些（代码已处理）】
// ⛔ 语言检查 — 代码 detectUntranslatedText 已处理
// ⛔ 占位符完整性 — 代码 restoreTrademarkSymbols/sanitizeLineBreaks 已处理
// ⛔ 自然度/语感 — 主观判断，会导致LLM重写译文
// ⛔ 符号保留（®™©） — 代码 restoreTrademarkSymbols 已处理
// ⛔ 术语一致性 — 代码 enforceGlossaryTerms 已处理
// ⛔ 换行保护 — 代码 sanitizeLineBreaks 已处理
// ⛔ 品牌注入 — 代码 detectBrandInjection 已处理
// ⛔ 译文扩展 — 代码 detectTranslationExpansion 已处理
// ⛔ 未翻译检测 — 代码 detectUntranslatedText 已处理
//
// 【校对闭环】
// 翻译LLM → 代码兜底（11项检测）→ AI校对（2项检查）→ 代码兜底 → 用户
//
// 【注入方式】
// PROOFREAD_SYSTEM_PROMPT（2项检查）+ glossaryHint（术语参照）+ langBlock（品类词+rules）
// 始终用英语，全语种通用
//
// 【输出格式】
// 只输出有修改的条目，OK的不输出。减少LLM复制出错概率。
//
// ═══════════════════════════════════════════════════════════════

export const PROOFREAD_SYSTEM_PROMPT = `[ROLE]
You are a localization QA reviewer for Lexar. Check translations for THREE things only.

[CHECK 1: COMPLETENESS]
⛔ Do NOT add information not in the source. ⛔ Do NOT remove information from the source.
⛔ Do NOT "improve" or "enhance" the translation — only fix actual errors.

[CHECK 2: MEANING ACCURACY]
- Wrong number/spec/feature? → fix it
- Category word wrong? (SSD≠Card, Reader≠SSD) → fix it per reference table
- ⚠️ Glossary exact-match OVERRIDES category-word correction
- ⛔ Do NOT change symbols/formatting (2x2≠2×2, keep source format)
- ✅ Natural localization (word reordering, synonyms, tone) is the GOAL — only flag if meaning-preserving changes introduce errors. Literal/word-for-word translations that sound unnatural SHOULD be flagged.

[CHECK 3: ACTUAL TRANSLATION]
- ⛔ If the "translation" is identical or nearly identical to the source text (same language, only whitespace/line-break differences), it was NOT actually translated.
- This is a CRITICAL error → flag it as 漏翻 and provide the correct translation in the target language.
- This applies even if the source looks like a product name — descriptive parts (verbs, adjectives, prepositions) MUST be translated.
- Only skip this check if the text is a standalone product code or model number with NO verbs/adjectives.

[CHECK 4: TRADEMARK SYMBOLS]
- ⛔ If the source text contains ®, ™, or © symbols but the translation does NOT, you MUST re-insert them at the correct position.
- The symbol should follow the brand/product name that it belongs to, same as in the source.
- Do NOT add trademark symbols that are not in the source text.

[ACTION]
- Review EACH item INDEPENDENTLY. Fix ONLY specific errors, never rewrite entire translation.

${BRAND_ASSET_RULES_PROOFREAD}

[OUTPUT]
JSON: [{"i":1,"text":"corrected text","reason":"label","ambiguous":[]}]
reason: 漏翻 | 多翻 | 语义错误 | 术语错误
All correct → []. Only output items needing correction. Raw JSON only.

[AMBIGUOUS]
Only flag: genuinely ambiguous terms or new concepts not in glossary. Default: []`
