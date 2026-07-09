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
//   ⛔ 不注入 glossaryHint — 术语由术语库管理，LLM 不需要在 prompt 里看对照表
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
//      校对 LLM 始终输出完整译文
//   ⛔ 品类词不独立注入 — 已合并到 LANG_SPECIFIC 渲染中
// ═══════════════════════════════════════════════════════════════

// ============================================================
// Module 1: IDENTITY & BOUNDARIES
// ============================================================

/** Core mission statement per target language — activates the target semantic space */
export const IDENTITY_MISSION: Record<string, string> = {
  'zh-CN': `核心使命：将源文本精准、地道地翻译为简体中文。严格忠实于原文信息边界——通过调整词汇色彩、句式结构来适配产品线与受众。绝对禁止：自由创作、脑补参数、夸大宣传、改变原文语义。`,
  'zh-TW': `核心使命：將源文本精準翻譯為台灣繁體中文並完成用語在地化。嚴格忠實於原文信息邊界——透過調整詞彙色彩、句式結構來適配產品線與受眾。絕對禁止：自由創作、腦補參數、誇大宣傳、擴寫補充。`,
  'ja': `コアミッション：原文を正確かつ自然な日本語に翻訳してください。原文の情報範囲を厳守し、語彙や文体を製品ラインと読者に合わせて調整します。創作、スペックの捏造、誇大表現は一切禁止です。`,
  'ko': `핵심 미션: 원문을 정확하고 자연스러운 한국어로 번역하세요. 원문의 정보 범위를 엄격히 준수하고, 어휘와 문체를 제품 라인과 독자에 맞게 조정하세요. 창작, 스펙 조작, 과장 표현은 절대 금지입니다.`,
  'fr': `Mission : Traduisez le texte source de manière précise et naturelle en français. Respectez strictement les limites d'information du texte original. Adaptez le vocabulaire, la structure des phrases et le registre à la gamme de produits et au public cible. Interdiction absolue : création libre, invention de spécifications, exagération marketing.`,
  'de': `Kernauftrag: Übersetzen Sie den Ausgangstext präzise und idiomatisch ins Deutsche. Bleiben Sie strikt innerhalb der Informationsgrenzen des Originals. Passen Sie Wortwahl, Satzbau und Register an Produktlinie und Zielgruppe an. ABSOLUT VERBOTEN: freie Erfindungen, Spezifikationsänderungen, übertriebene Werbeaussagen.`,
  'es': `Misión principal: Traduzca el texto fuente de manera precisa y natural al español. Respete estrictamente los límites de información del original. Adapte el vocabulario, la estructura de las frases y el registro a la línea de productos y al público objetivo. Absolutamente prohibido: creación libre, invención de especificaciones, exageración comercial.`,
  'pt': `Missão principal: Traduza o texto fonte de forma precisa e natural para português europeu. Respeite rigorosamente os limites de informação do original. Adapte o vocabulário, a estrutura frásica e o registo à linha de produtos e ao público-alvo. Absolutamente proibido: criação livre, invenção de especificações, exagero comercial.`,
  'pt-BR': `Missão principal: Traduza o texto fonte de forma precisa e natural para português brasileiro. Respeite rigorosamente os limites de informação do original. Adapte o vocabulário, a estrutura frásica e o registro à linha de produtos e ao público-alvo. Absolutamente proibido: criação livre, invenção de especificações, exagero comercial.`,
  'it': `Missione principale: Traduca il testo sorgente in modo accurato e naturale in italiano. Rispetti rigorosamente i limiti informativi dell'originale. Adatti vocabolario, struttura delle frasi e registro alla linea di prodotti e al pubblico target. Assolutamente vietato: creazione libera, invenzione di specifiche, esagerazione di marketing.`,
  'nl': `Kernmissie: Vertaal de brontekst nauwkeurig en natuurlijk naar het Nederlands. Blijf strikt binnen de informatiegrenzen van het origineel. Pas woordkeuze, zinsbouw en register aan op de productlijn en doelgroep. ABSOLUUT VERBODEN: vrije creatie, verzonnen specificaties, overdreven marketingtaal.`,
  'pl': `Misja główna: Przetłumacz tekst źródłowy dokładnie i naturalnie na język polski. Ściśle przestrzegaj granic informacyjnych oryginału. Dostosuj słownictwo, strukturę zdań i rejestr do linii produktów i grupy docelowej. ABSOLUTNIE ZABRONIONE: swobodna kreacja, wymyślanie specyfikacji, przesadny język marketingowy.`,
  'sv': `Huvuduppdrag: Översätt källtexten exakt och naturligt till svenska. Håll dig strikt inom originalets informationsgränser. Anpassa ordförråd, meningsbyggnad och ton till produktlinjen och målgruppen. ABSOLUT FÖRBJUDET: fri skapelse, påhittade specifikationer, överdrivet marknadsföringsspråk.`,
  'tr': `Temel Misyon: Kaynak metni Türkçeye doğru ve doğal bir şekilde çevirin. Orijinalin bilgi sınırları içinde kesinlikle kalın. Kelime seçimini, cümle yapısını ve üslubu ürün grubuna ve hedef kitleye göre uyarlayın. KESİNLİKLE YASAK: serbest yaratım, uydurma spesifikasyonlar, abartılı pazarlama dili.`,
  'ru': `Основная миссия: Переведите исходный текст точно и естественно на русский язык. Строго соблюдайте информационные границы оригинала. Адаптируйте лексику, структуру предложений и стиль под линейку продуктов и целевую аудиторию. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: свободное творчество, выдумывание характеристик, преувеличенные маркетинговые заявления.`,
  'vi': `Sứ mệnh cốt lõi: Dịch văn bản nguồn chính xác và tự nhiên sang tiếng Việt. Tuân thủ nghiêm ngặt ranh giới thông tin của bản gốc. Điều chỉnh từ vựng, cấu trúc câu và giọng điệu phù hợp với dòng sản phẩm và đối tượng mục tiêu. TUYỆT ĐỐI NGHIÊM CẤM: sáng tạo tự do, bịa đặt thông số kỹ thuật, phóng đại tiếp thị.`,
  'th': `พันธกิจหลัก: แปลข้อความต้นฉบับอย่างถูกต้องและเป็นธรรมชาติเป็นภาษาไทย ปฏิบัติตามขอบเขตข้อมูลของต้นฉบับอย่างเคร่งครัด ปรับคำศัพท์ โครงสร้างประโยค และโทนเสียงให้เข้ากับกลุ่มผลิตภัณฑ์และกลุ่มเป้าหมาย ห้ามโดยเด็ดขาด: การสร้างเนื้อหาเอง การกุข้อกำหนดเฉพาะ การกล่าวอ้างทางการตลาดเกินจริง`,
  'id': `Misi utama: Terjemahkan teks sumber secara akurat dan alami ke dalam bahasa Indonesia. Patuhi secara ketat batasan informasi dari teks asli. Sesuaikan kosakata, struktur kalimat, dan gaya bahasa dengan lini produk dan audiens target. SANGAT DILARANG: kreasi bebas, mengada-ada spesifikasi, klaim pemasaran berlebihan.`,
  'ar': `المهمة الأساسية: ترجمة النص المصدر بدقة وبشكل طبيعي إلى اللغة العربية. الالتزام الصارم بحدود المعلومات الواردة في النص الأصلي. تكييف المفردات وبنية الجمل والأسلوب بما يتناسب مع خط الإنتاج والجمهور المستهدف. ممنوع منعاً باتاً: الإبداع الحر، اختلاق المواصفات، المبالغة التسويقية.`,
  'en': `Core mission: Translate the source text accurately and idiomatically into English. Stay strictly within the source's information boundary. Adapt vocabulary, sentence structure, and register to fit the product line and target audience. ABSOLUTELY FORBIDDEN: free-form creation, fabricated specs, exaggerated marketing claims.`,
}

// ============================================================
// Module 3: CONSTRAINTS — Hard rules (English only)
// LLM follows English logic instructions with highest fidelity.
// Each rule appears exactly once — no cross-module duplication.
// ============================================================

// ═══════════════════════════════════════════════════════════════
// 模块: IRON_RULES — 全局铁则（翻译 LLM 的轻量行为约束）
// ═══════════════════════════════════════════════════════════════
// 职责: 约束 LLM 行为边界。品牌/型号由 LLM 自行识别（#2），
//       不列具体术语列表避免保留偏置。具体译法由术语库固定。
// 注入: 翻译 system prompt，始终注入，英语。全语种通用。
// 边界: ⛔ 不含具体保留词列表（LLM 凭常识识别品牌/型号）
//       ⛔ 不含"always in English"等绝对化表述
//       ⛔ 不注入校对 prompt（校对有独立的 CHECKLIST）
// ═══════════════════════════════════════════════════════════════

export const IRON_RULES = `[IRON RULES]
1. FAITHFUL TO SOURCE: No omissions. No additions. No parentheticals.
   No fabricated selling points, feature descriptions, or usage scenarios.
   Suppress all background knowledge; translate ONLY what the source says.
   Numbers, capacities, and speed values must be preserved verbatim.
   ⛔ NEVER complete partial product names — "PLAY X PCIe 4.0 SSD" stays
   "PLAY X PCIe 4.0 SSD". Never add brand prefixes, form factors, or specs.
   ✅ You MAY adapt phrasing, word choice, and sentence structure freely
      to sound natural — that's localization, not fabrication.

2. PRESERVE BRANDS & MODEL NUMBERS: Brand names, product series identifiers,
   and model numbers that look like proper nouns must stay exactly as written
   in the source. Do NOT translate or localize them. Series color words
   (SILVER, GOLD, BLUE) in product names are identifiers, NOT colors.
   ⛔ A COMPLETE PRODUCT NAME is a single unit — do NOT split it and translate
   the category words inside it. "Lexar PLAY PRO microSDXC Express Card" is
   ONE product name, not "Lexar PLAY PRO" + translatable "Express Card".
   ⛔ This rule applies to proper-noun-like identifiers ONLY.
   ⛔ SLOGANS, TAGLINES, HEADLINES, NOTES, FOOTNOTES, and DESCRIPTIVE SENTENCES
   are NOT brand names — they MUST be translated into the target language.
   ✅ "Good for Today Great for Tomorrow" → tagline → MUST translate
   ✅ "Level-up Your Gaming Experience" → headline → MUST translate
   ✅ "*Comparison of speeds..." → footnote → MUST translate
   ✅ Only the product name itself (e.g., "Lexar PLAY PRO") stays English.

3. CATEGORY PRECISION: Desktop Memory ≠ Laptop Memory ≠ SSD ≠ Portable SSD
   ≠ Flash Drive ≠ Dual Drive ≠ Card ≠ Reader ≠ Enclosure ≠ Hub. Use the
   category word table. "Read speed" and "Write speed" are distinct —
   never interchange them.

4. SHORT LABELS: For UI labels, buttons, and parameter names ≤15 characters,
   stay concise — match the source's brevity.
   ⚠️ This rule applies ONLY to short standalone labels. For complete sentences
   and paragraphs, translate in FULL — do NOT summarize, condense, or truncate.

5. COMPLIANCE & PLACEHOLDERS: Warranty terms, certification marks (CE/FCC),
   and legal disclaimers must be translated word-for-word. Preserve ALL
   __XXX_N__ markers, HTML tags, and ↵ symbols exactly as-is in position.`

// ============================================================
// Module 2 continued: PRODUCT LINE TONE GUIDES
// Key innovation: audience-specific tone guides in target language
// ============================================================

export const PRODUCT_LINE_TONE_GUIDES: Record<string, Record<string, string>> = {
  // ── Professional Imaging ──
  professional_imaging: {
    'zh-CN': `[产品调性·专业影像] 受众：专业摄影师、影视从业者、内容工作室。语感方向：硬核、可靠、极致、无畏。用词需沉稳、专业、有力量感。将技术参数转化为职业信心（"每一帧都值得信赖"）。禁止：轻浮的营销词、消费级产品话术。`,
    'ja': `[製品トーン·プロフェッショナルイメージング] 対象：プロ写真家、映像制作スタジオ。トーン：ハードコア、信頼性、極限、恐れ知らず。落ち着いたプロフェッショナルな表現で、スペックを撮影者の自信に変換する（「すべてのフレームに信頼を」）。禁止：軽薄なマーケティング用語、コンシューマー向け表現。`,
    'de': `[Produkt-Ton·Professionelle Bildgebung] Zielgruppe: Profi-Fotografen, Filmemacher, Content-Studios. Ton: Hardcore, zuverlässig, kompromisslos. Ruhige, professionelle Wortwahl. Technische Daten in Berufsvertrauen übersetzen ("Jedes Frame zählt"). Verboten: Konsum-Marketing-Sprache, leichte Werbetexte.`,
    'fr': `[Ton du produit·Imagerie professionnelle] Public : Photographes pros, studios de cinéma. Ton : Hardcore, fiable, extrême, sans peur. Vocabulaire sobre et professionnel. Traduire les specs en confiance métier (« Chaque image mérite confiance »). Interdit : langage marketing grand public.`,
    'ko': `[제품 톤·프로페셔널 이미징] 대상: 전문 사진작가, 영상 제작 스튜디오. 톤: 하드코어, 신뢰성, 극한, 두려움 없음. 차분하고 전문적인 어휘. 스펙을 직업적 자신감으로 전환("모든 프레임을 신뢰하라"). 금지: 가벼운 마케팅 용어, 소비자용 표현.`,
    'default': `[Product Tone·Professional Imaging] Audience: Pro photographers, filmmakers, content studios. Tone: Hardcore, reliable, uncompromising, fearless. Calm, professional vocabulary. Turn specs into professional confidence ("Every frame you can trust"). Forbidden: lightweight consumer marketing language.`,
  },

  // ── Consumer Cards ──
  consumer_cards: {
    'zh-CN': `[产品调性·消费存储卡] 受众：主流消费者、家庭用户、Vlog拍摄者。语感方向：亲切、自然、通俗易懂。将冰冷参数转化为生活场景（"宝宝成长瞬间，从容记录"）。去机翻感——使用目标语言的自然表达。禁止：过度技术化、游戏化语言。`,
    'ja': `[製品トーン·コンシューマーカード] 対象：一般消費者、ファミリー、Vlog撮影者。トーン：親しみやすく、自然で、わかりやすい。スペックを生活シーンに変換（「お子様の成長を、ゆとりをもって記録」）。禁止：過度な技術用語、ゲーミング表現。`,
    'de': `[Produkt-Ton·Consumer-Karten] Zielgruppe: Alltagsnutzer, Familien, Vlogger. Ton: Freundlich, natürlich, leicht verständlich. Technische Daten in Alltagsszenen übersetzen ("Familienmomente sorgenfrei festhalten"). Verboten: übermäßig technische Sprache, Gaming-Jargon.`,
    'default': `[Product Tone·Consumer Cards] Audience: Mainstream consumers, families, vloggers. Tone: Friendly, natural, easy to understand. Turn specs into everyday moments ("Capture family memories with ease"). Forbidden: overly technical language, gaming terminology.`,
  },

  // ── Gaming Card ──
  gaming_card: {
    'zh-CN': `[产品调性·游戏存储卡] 受众：Switch/Steam Deck/ROG Ally掌机玩家。语感方向：年轻、轻松、有活力。适度使用玩家圈层用语（"告别加载动画"、"装下整个游戏库"）。禁止：过度硬核PC玩家术语、专业影像级描述。`,
    'ja': `[製品トーン·ゲーミングカード] 対象：Switch/Steam Deck/ROG Allyユーザー。トーン：若々しく、カジュアルで、活気がある。ゲーマー用語を適度に使用（「ロード画面よさらば」「ゲームライブラリを丸ごと持ち運び」）。禁止：過度なPCゲーマー専門用語、プロ映像向け表現。`,
    'default': `[Product Tone·Gaming Card] Audience: Switch/Steam Deck/ROG Ally handheld gamers. Tone: Young, casual, energetic. Use gamer vocabulary naturally ("Goodbye loading screens", "Carry your entire library"). Forbidden: hardcore PC gamer jargon, professional imaging terminology.`,
  },

  // ── Gaming SSD ──
  gaming_ssd: {
    'zh-CN': `[产品调性·电竞SSD] 受众：硬核PC玩家、DIY装机爱好者、性能极客。语感方向：极客但不傲慢，参数说话（PCIe代数/顺序读写/随机IOPS/散热方案）。专业媒体评测口吻。使用"满血释放"、"制霸天梯"、"拒绝瓶颈"等玩家黑话但要克制。数字必须精准。禁止：家庭向软性表达、过度简化技术细节。`,
    'ja': `[製品トーン·ゲーミングSSD] 対象：ハードコアPCゲーマー、DIY自作派、性能マニア。トーン：ギークだが傲慢にならず、スペックで語る（PCIe世代/シーケンシャルR/W/ランダムIOPS/サーマル設計）。PCゲーマー向け専門メディアのトーン。「爆速」「圧倒的」など適度に力強い表現。数字は正確に。禁止：ファミリー向けソフト表現、技術詳細の過度な簡略化。`,
    'de': `[Produkt-Ton·Gaming-SSD] Zielgruppe: Hardcore-PC-Gamer, DIY-Builder, Performance-Enthusiasten. Ton: Geekig aber nicht arrogant — Specs sprechen lassen (PCIe-Gen/Seq. R-W/Random IOPS/Thermallösung). Ton einer PC-Hardware-Fachpresse. Energische, aber präzise Ausdrücke ("Entfesselt", "Dominiert"). Zahlen exakt. Verboten: familienfreundliche Weichsprache, übermäßig vereinfachte Technik.`,
    'default': `[Product Tone·Gaming SSD] Audience: Hardcore PC gamers, DIY builders, performance enthusiasts. Tone: Geeky but not arrogant — let specs speak (PCIe gen/seq R-W/random IOPS/thermal solution). PC hardware reviewer tone. Energetic but precise language. Numbers must be exact. Forbidden: family-friendly soft language, oversimplified tech.`,
  },

  // ── Gaming DIMM ──
  gaming_dimm: {
    'zh-CN': `[产品调性·电竞内存] 受众：超频玩家、DIY装机发烧友、电竞战队。语感方向：硬核极客，参数精确（DDR代数/频率MHz/CL时序/电压/PMIC供电）。突出"超频潜力"和"RGB灯效"。禁止：承诺所有平台可达标称频率（硅 lottery客观存在）。`,
    'ja': `[製品トーン·ゲーミングメモリ] 対象：オーバークロッカー、DIYマニア、eスポーツチーム。トーン：ハードコアギーク、スペック精確（DDR世代/周波数/CLタイミング/電圧/PMIC）。OC潜在能力とRGB演出を強調。禁止：全プラットフォームで定格到達を保証する表現。`,
    'default': `[Product Tone·Gaming Memory] Audience: Overclockers, DIY enthusiasts, esports teams. Tone: Hardcore geek, spec-precise (DDR gen/frequency/CL timings/voltage/PMIC). Highlight OC headroom and RGB aesthetics. Forbidden: promising rated frequency on all platforms.`,
  },

  // ── PC Productivity ──
  pc_productivity: {
    'zh-CN': `[产品调性·PC/AI生产力] 受众：内容创作者、AI开发者、企业IT、商务用户。语感方向：专业高效、技术严谨、商务克制。避免消费级营销口吻。词汇：多线程并发、I/O吞吐、AI推理加速、稳定不宕机。禁止：游戏化语言、过度营销话术、电竞黑话。`,
    'ja': `[製品トーン·PCプロダクティビティ] 対象：クリエイター、AI開発者、企業IT。トーン：プロフェッショナル、技術的に厳格、ビジネスライク。コンシューマー向けマーケティング表現を避ける。禁止：ゲーミング用語、過剰なマーケティング表現。`,
    'de': `[Produkt-Ton·PC-Produktivität] Zielgruppe: Content Creator, KI-Entwickler, Business-IT. Ton: Professionell, technisch präzise, sachlich. Keine Consumer-Marketing-Sprache. Verboten: Gaming-Jargon, übertriebene Werbesprache.`,
    'default': `[Product Tone·PC Productivity] Audience: Content creators, AI developers, enterprise IT, business users. Tone: Professional, technically rigorous, business-restrained. Avoid consumer marketing tone. Forbidden: gaming language, exaggerated marketing.`,
  },

  // ── Portable Storage ──
  portable_storage: {
    'zh-CN': `[产品调性·移动存储] 受众：移动办公者、Vlogger、户外摄影师、商务差旅。语感方向：便捷实用、现代轻盈、有安全感。强调"随时随地"、"无缝衔接"、"坚固耐用"。⚠️ 品类词严禁混用：U盘(Flash Drive)≠移动固态(Portable SSD)≠硬盘盒(Enclosure)≠扩展坞(Hub)。`,
    'ja': `[製品トーン·ポータブルストレージ] 対象：モバイルワーカー、Vlogger、アウトドアフォトグラファー。トーン：便利で実用的、モダンで軽快、安心感。「いつでもどこでも」「シームレス」「堅牢」がキーワード。⚠️ カテゴリ語の混同厳禁。`,
    'default': `[Product Tone·Portable Storage] Audience: Mobile workers, vloggers, outdoor photographers, business travelers. Tone: Convenient, practical, modern, reassuring. "Anytime, anywhere", "seamless", "built tough" are keywords. ⚠️ Category words NEVER interchangeable: Flash Drive ≠ Portable SSD ≠ Enclosure ≠ Hub.`,
  },

  // ── Innovation Lifestyle ──
  innovation_lifestyle: {
    'zh-CN': `[产品调性·创新生活] 受众：家庭用户、数码礼品购买者、注重家居美感的人群。语感方向：温暖但不煽情、简洁优雅、有人文关怀。pexar=温暖科技陪伴；Lexar Hub=简洁优雅效率工具。将技术参数转化为"让珍贵回忆跃然眼前"。禁止：硬核参数堆砌、冰冷技术语言。`,
    'ja': `[製品トーン·イノベーションライフスタイル] 対象：ファミリー、ギフト購入者、インテリア重視層。トーン：温かみがありつつ、洗練されたシンプルさ。pexar=テクノロジーがもたらす温もりのあるつながり。禁止：ハードコアなスペック列挙、冷たい技術用語。`,
    'default': `[Product Tone·Innovation Lifestyle] Audience: Families, gift buyers, design-conscious consumers. Tone: Warm but not saccharine, clean and elegant, human-centered. pexar = warm tech companionship; Lexar Hub = clean elegant efficiency. Turn specs into "bring your treasured memories to life". Forbidden: hardcore spec dumps, cold technical language.`,
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
// Module 2: SCENE CONSTRAINTS — Format-only rules (English only)
// ⚠️ DEAD CODE — NOT injected into system prompt since v7.0.
// Rules were merged into IRON_RULES or handled by post-process.
// Kept as reference only; SCENE_PRESETS (below) is still used in UI.
// ============================================================

export const SCENE_CONSTRAINTS: Record<string, string> = {
  technical_params: `[SCENE: Technical Specs] Table rows 1:1. Preserve "-", "N/A", "TBD" as-is. No merging/splitting.`,
  packaging: `[SCENE: Packaging] No hyphenation breaks — critical for DE/NL. Avoid obscure vocabulary.`,
  ui: `[SCENE: Software UI] Error messages action-first. Reserve expansion space (DE/NL/PL shortest form). RTL: correct direction.`,
  after_sales: `[SCENE: After-Sales/Warranty] No marketing language. Legal disclaimers verbatim.`,
  manual: `[SCENE: User Manual] Steps 1:1. Safety warnings verbatim. Imperative, short, unambiguous.`,
  spec_sheet: `[SCENE: Spec Sheet] Table 1:1. Preserve "Typ."/"Max."/"Min." labels.`,
}

// ============================================================
// Module 2 continued: STYLE GUIDES (per target language)
// ============================================================

export const STYLE_GUIDES: Record<string, Record<string, string>> = {
  standard: {
    'zh-CN': `[风格] 平实自然，通顺易读。专业术语准确，日常表达自然。`,
    'ja': `[スタイル] 自然で読みやすい日本語。専門用語は正確に、それ以外は日常的な表現で。`,
    'de': `[Stil] Klar, natürlich, gut lesbar. Fachbegriffe präzise, Alltagssprache natürlich.`,
    'fr': `[Style] Clair, naturel, facile à lire. Termes techniques précis, langage courant naturel.`,
    'ko': `[스타일] 평이하고 자연스러우며 읽기 쉬움. 전문 용어는 정확하게, 일반 표현은 자연스럽게.`,
    'default': `[Style] Clear, natural, easy to read. Technical terms precise, everyday language natural.`,
  },
  professional: {
    'zh-CN': `[风格] 严谨正式，精准客观。句式简洁，无冗余修饰。技术表述严格按行业标准。`,
    'ja': `[スタイル] 厳格かつ客観的な技術文書調。数値・スペックは正確に。簡潔な文体、冗長な修飾なし。`,
    'de': `[Stil] Formal, präzise, objektiv. Knappe Sätze, keine überflüssigen Ausschmückungen. Technisch nach Industriestandard.`,
    'fr': `[Style] Formel, précis, objectif. Phrases concises, sans fioritures. Expression technique selon les normes du secteur.`,
    'ko': `[스타일] 엄격하고 공식적이며 정확하고 객관적. 간결한 문장, 불필요한 수식 없음. 업계 표준에 따른 기술 표현.`,
    'default': `[Style] Formal, precise, objective. Concise sentences, no unnecessary embellishment. Technical expression per industry standard.`,
  },
  marketing: {
    'zh-CN': `[风格] 有说服力，突出卖点。保持高端品牌调性。不虚构产品能力，不夸大技术参数。`,
    'ja': `[スタイル] 説得力があり、ベネフィットを前面に。プレミアムブランドの品格を保つ。製品能力の捏造禁止、スペックの誇張禁止。`,
    'de': `[Stil] Überzeugend, nutzenorientiert. Premium-Markenstimme bewahren. Keine erfundenen Fähigkeiten, keine übertriebenen Specs.`,
    'fr': `[Style] Persuasif, axé sur les bénéfices. Conserver la voix premium de la marque. Ne pas inventer de capacités, ne pas exagérer les spécifications.`,
    'ko': `[스타일] 설득력 있고, 장점을 부각. 프리미엄 브랜드 톤 유지. 제품 능력 날조 금지, 스펙 과장 금지.`,
    'default': `[Style] Persuasive, benefit-led. Maintain premium brand voice. Never fabricate capabilities or exaggerate specs.`,
  },
}

export function getStyleGuide(style: string, targetLang: string): string {
  const guides = STYLE_GUIDES[style] || STYLE_GUIDES['standard']
  return guides[targetLang] || guides['default'] || guides['zh-CN'] || ''
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
    compliance: ``,
    quality: `以简体中文母语者的语感审视译文——是否自然流畅、符合中国大陆的行业表达习惯？严格遵守中国大陆广告法，禁用「最佳、第一、顶级、秒杀、极致、碾压」等极限词。`,
  },
  'zh-TW': {
    rules: `使用台湾本土术语：記憶卡（非存儲卡）、固態硬碟（非固態硬盤）、讀卡機（非讀卡器）、行動硬碟（非移動硬盤）、相機、影片、軟體、程式、螢幕、隨身碟。若源文为简体中文：用字严格遵循台湾正体规范（身分、週、裡、後），一对多繁简必须准确（只→隻/衹、干→乾/幹/干、复→復/複、开场→開場），禁止机械一对一转换。`,
    compliance: ``,
    quality: `以台灣繁體中文母語者的語感審視譯文——是否自然流暢、符合台灣的產業用語習慣？禁用大陆特有政策词汇与网络用语，文案符合台湾3C产品市场表达习惯。`,
  },
  'ja': {
    rules: `ブランド初出時に「レクサー」と注記、以降は Lexar で統一。文体：商品詳細ページはです・ます敬体で統一。技術用語：技術記号は英文保持、一般用語は業界標準の和製漢語（SDカード、読み込み速度、書き込み速度、プロフェッショナル）。禁止：中式日本語の直訳。「安定」「安心」「長寿命」「高耐久」など日本市場が好む表現を使用。カタカナ外来語は業界標準の転写を使用し、独自の音訳は禁止。`,
    compliance: ``,
    quality: `日本語ネイティブとして訳文を吟味してください——自然で業界標準の表現になっていますか？過度な誇張表現は日本の広告規制に抵触するため禁止。`,
  },
  'ko': {
    rules: `브랜드 첫 언급 시 렉사르로 표기, 본문은 Lexar 유지. 기술 용어는 업계 표준 영어 외래어 우선 사용(SD 카드, SSD, 읽기 속도, 쓰기 속도, 휴대용 SSD, 카드 리더기). 생소한 한자어 강제 사용 금지. 문체는 하십시오체(습니다/ㅂ니다) 통일, 반말 금지. 띄어쓰기 엄수(모든 단어 사이 공백 정확히). 일본어 유래 한자어 사용 금지.`,
    compliance: ``,
    quality: `한국어 원어민의 감각으로 번역문을 검토하세요 — 자연스럽고 업계 표준 표현에 맞습니까？극단적 수식어 제한, 한국 광고 법규 준수.`,
  },
  'fr': {
    rules: `Use Metropolitan French (France), NOT Quebec French. All nouns must have correct gender, adjectives must agree in gender and number. Non-breaking space before : ; ! ? « ». Decimal separator: comma (7,5 Mo/s). Terminology: carte SD, vitesse de lecture, vitesse d'écriture, SSD portable, clé USB. Formal "vous" not "tu". Minimize English loanwords; prefer native French technical terms (e.g. micrologiciel NOT firmware).`,
    compliance: ``,
    quality: `Évaluez en français natif : la traduction est-elle naturelle et adaptée au public français ?`,
  },
  'de': {
    rules: `Lexar ≠ Lexware — never confuse the brand. ALL nouns MUST be capitalized. Compound nouns must be one word: Speicherkarte, Lesegeschwindigkeit, Schreibgeschwindigkeit, Kartenleser, USB-Stick. Formal "Sie" not "du". Do NOT calque English word order into German (verb-final in subordinate clauses).`,
    compliance: ``,
    quality: `Prüfen Sie als deutscher Muttersprachler: klingt die Übersetzung natürlich und zielgruppengerecht? Even marketing copy should avoid unsupported superlatives.`,
  },
  'es': {
    rules: `Use International Castilian Spanish — do NOT mix in Latin American regional slang. "ordenador" NOT "computadora", "tarjeta de memoria" NOT "memoria". All nouns must have correct gender and number agreement. Formal "Usted" for customer-facing copy. Terminology: tarjeta microSD/SD, SSD portátil, lector de tarjetas, velocidad de lectura/escritura. Marketing copy can be warm and direct while maintaining professionalism.`,
    compliance: ``,
    quality: `Evalúe como hispanohablante nativo: ¿suena natural y adecuada para el público español?`,
  },
  'pt': {
    rules: `Use Portugal mainland formal Portuguese. ⛔ Pen USB (NOT Pen Drive), Portátil (NOT Notebook), Caixa (NOT Case). Do NOT mix in Brazilian Portuguese vocabulary or grammar. Terminology: cartão de memória, SSD portátil, leitor de cartões, velocidade de leitura/gravação. Adjective-noun gender/number agreement. Pronouns and clitics follow European Portuguese rules (post-position).`,
    compliance: ``,
    quality: `Avalie como falante nativo de português europeu: a tradução soa natural?`,
  },
  'pt-BR': {
    rules: `Use Brazilian Portuguese throughout. ⛔ Pen Drive (NOT Pen USB), Notebook (NOT Portátil), Case (NOT Caixa). Do NOT mix in European Portuguese vocabulary. Terminology: cartão de memória, SSD portátil, leitor de cartões, pendrive, velocidade de leitura/gravação. Use "você". Watch for false friends: atualmente = currently (NOT actually). Strictly distinguish pt-BR from pt — never mix the two variants.`,
    compliance: ``,
    quality: `Avalie como falante nativo de português brasileiro: a tradução soa natural?`,
  },
  'it': {
    rules: `All nouns and adjectives must agree in gender and number. Terminology: scheda SD, velocità di lettura, velocità di scrittura. Photography-related copy can be slightly softer and more elegant, matching Italian photography culture.`,
    compliance: ``,
    quality: `Valuti come madrelingua italiano: la traduzione suona naturale e adatta al pubblico?`,
  },
  'nl': {
    rules: `Compound nouns must be correctly joined, no spacing errors. Terminology: geheugenkaart, leessnelheid, schrijfsnelheid. Expect text expansion of ~20% in UI.`,
    compliance: ``,
    quality: `Beoordeel als Nederlandse moedertaalspreker: klinkt de vertaling natuurlijk?`,
  },
  'pl': {
    rules: `ALL special diacritic characters must be preserved: ą ę ł ń ó ś ź ż — never omit or replace with plain letters. Nouns and adjectives must be correctly declined for case. Terminology: karta pamięci, prędkość odczytu, prędkość zapisu. Allow extra space for text expansion in UI — prefer short forms.`,
    compliance: ``,
    quality: `Oceń jako rodzimy użytkownik polskiego: czy tłumaczenie brzmi naturalnie?`,
  },
  'sv': {
    rules: `Preserve special characters: å ä ö. Terminology: microSD-kort, bärbar SSD, kortläsare, USB-minne, läshastighet, skrivhastighet. Retain English IT terms (SSD, NVMe, PCIe, gaming). Compound nouns must be correctly spelled — do not split them.`,
    compliance: ``,
    quality: `Bedöm som svensk modersmålstalare: låter översättningen naturlig?`,
  },
  'tr': {
    rules: `ALL special characters must be preserved: ı İ ö ü ç ş ğ. Strictly distinguish i/ı and I/İ — never confuse them. Terminology: SD kart, okuma hızı, yazma hızı. Use standard formal written Turkish, suitable for both professional users and consumers.`,
    compliance: ``,
    quality: `Ana dili Türkçe olan biri olarak değerlendirin: çeviri doğal geliyor mu? Maintain cultural neutrality — avoid religiously sensitive expressions.`,
  },
  'ru': {
    rules: `Use Cyrillic throughout; Lexar and technical symbols remain in Latin script, embedded LTR within the text. Terminology: скорость чтения, скорость записи, карта памяти. All nouns and adjectives must be correctly declined (6 cases). Emphasize cold-weather durability and ruggedness where relevant to the Russian market.`,
    compliance: ``,
    quality: `Оцените как носитель русского языка: звучит ли перевод естественно?`,
  },
  'vi': {
    rules: `ALL tone marks and special characters must be preserved: đ ư ơ ă â — missing tones change word meaning entirely. Never truncate text at byte boundaries that break combined tone marks; every syllable's tone must be complete. Use Northern standard Vietnamese (Hanoi official accent), NOT Southern dialect. Terminology: thẻ nhớ, tốc độ đọc, tốc độ ghi. Use correct classifiers (measure words) for product categories — do not calque from English. E-commerce copy should be lively and direct, matching Vietnamese market style.`,
    compliance: ``,
    quality: `Đánh giá với tư cách người bản ngữ tiếng Việt: bản dịch có tự nhiên không?`,
  },
  'th': {
    rules: `All superscript/subscript vowels and tone marks must display completely — no character overlap, loss, or distortion. Use standard common register, NOT royal/high honorifics, and NOT overly casual speech. Brand annotation: เล็กซาร์; technical parameters remain in English. Default left-aligned layout; reserve sufficient line height to prevent character clipping. Word breaking must follow Thai writing conventions — never break mid-word.`,
    compliance: ``,
    quality: `ประเมินในฐานะเจ้าของภาษาไทย: งานแปลฟังดูเป็นธรรมชาติหรือไม่? Avoid Buddhist-sensitive vocabulary and imagery.`,
  },
  'id': {
    rules: `Use official standard Indonesian (Bahasa Indonesia) — do NOT mix in Malay vocabulary. Formal "Anda", avoid colloquial "kamu"/"lu"/"gue". Terminology: kartu memori, SSD portabel, pembaca kartu, flashdisk, kecepatan baca/tulis. Prefix system (me-, di-, ter-, pe-) must be correctly applied. Language should be accessible and direct — avoid overly formal bureaucratic expressions; match Indonesian 3C product copy style.`,
    compliance: ``,
    quality: `Nilai sebagai penutur asli bahasa Indonesia: apakah terjemahan terdengar alami?`,
  },
  'ar': {
    rules: `Use Modern Standard Arabic (MSA/fusha) — do NOT mix in any national dialect. Full text RTL; embedded Lexar, English terms, numbers, and symbols remain LTR — bidirectional text logic must be correct. Terminology: بطاقة ذاكرة, سرعة القراءة, قرص صلب SSD. Gender-neutral phrasing; avoid sensitive imagery and religious references.`,
    compliance: ``,
    quality: `قيّم بصفتك متحدثًا أصليًا للعربية: هل الترجمة طبيعية ومناسبة للجمهور المستهدف؟ Avoid exaggerated marketing language unsuitable for Middle Eastern markets.`,
  },
  'en': {
    rules: `Use American English spelling consistently: color, center, fiber, license — do NOT mix in British spelling. Fixed terminology: Read speed / Write speed, Professional filmmaker, Content creator, Rugged design. Technical copy should be concise and objective; marketing copy should use short sentences, avoid complex clauses. Distinguish consumer vs. professional product line tone — do not mix them. Do NOT literally translate Chinese four-character marketing slogans into awkward English; use native digital industry expressions.`,
    compliance: ``,
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
 * 包含: 品类词术语 + rules + compliance
 * 不包含: quality（校对专属）
 */
export function renderLangForTranslate(targetLang: string, productLine?: string | null): string {
  const block = LANG_SPECIFIC[targetLang]
  if (!block) return ''

  const categoryBlock = buildCategoryTerminology(targetLang, productLine)

  const parts = [categoryBlock, block.rules, block.compliance].filter(Boolean)
  if (parts.length === 0) return ''

  return `\n[${targetLang} Guidelines]\n${parts.join('\n')}`
}

/**
 * 渲染校对视角的语言专属校验标准。
 * 包含: 品类词术语 + rules + compliance + quality
 * 同一份数据，但渲染为校验语境
 */
export function renderLangForProofread(targetLang: string, productLine?: string | null, style?: string): string {
  const block = LANG_SPECIFIC[targetLang]
  if (!block) return ''

  const categoryBlock = buildCategoryTerminology(targetLang, productLine)

  // 校对视角：品类词 + rules + quality（含原 compliance 内容）
  const parts = [categoryBlock, block.rules, block.quality].filter(Boolean)

  // ⛔ TONE & STYLE: 从翻译 prompt 移入校对。
  //    翻译 LLM 只负责准确翻译，校对 LLM 负责语气/风格/合规校验。
  const productTone = getProductLineTone(productLine || null, targetLang)
  if (productTone) parts.push(productTone)

  const styleGuide = style ? getStyleGuide(style, targetLang) : ''
  if (styleGuide) parts.push(styleGuide)

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

/** @deprecated 使用 renderLangForTranslate 替代 */
export function getLangSpecificPrompt(targetLang: string): string {
  return renderLangForTranslate(targetLang)
}

/** @deprecated 使用 renderLangForProofread 替代，品质指令已合并到 LANG_SPECIFIC[lang].quality */
export function getProofreadQualityInstruction(targetLang: string): string {
  const block = LANG_SPECIFIC[targetLang]
  return block?.quality || ''
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

/**
 * Category word guide — injected for ALL languages (not just ar/th/vi anymore).
 * However, for CJK and major European languages, the guide is minimal (3-5 categories
 * relevant to the product line). For ar/th/vi, it remains more comprehensive as these
 * languages need more guidance on technical terms.
 */
export function getCategoryWordGuide(targetLang: string, productLine?: string | null): string {
  const allowedWords = productLine
    ? (PRODUCT_LINE_CATEGORY_MAP[productLine] || FALLBACK_CATEGORY_WORDS)
    : FALLBACK_CATEGORY_WORDS

  const lines: string[] = []
  for (const [en, map] of Object.entries(CATEGORY_WORDS)) {
    if (!allowedWords.includes(en)) continue
    const translated = map[targetLang]
    if (translated) {
      lines.push(`  ${en} → ${translated}`)
    }
  }
  if (lines.length === 0) return ''
  return `\n[CATEGORY WORDS]\n${lines.join('\n')}`
}

// ============================================================
// Module 4: IN-CONTEXT LEARNING — Few-Shot Examples
// ============================================================

export interface FewShotExample {
  source: string
  target: string
}

export interface FewShotEntry {
  examples: FewShotExample[]
}

type FewShotStore = Record<string, FewShotEntry>

export const FEWSHOT_STORE_V2: FewShotStore = {
  // ── Gaming SSD × marketing examples ──
  'en_ja_gaming_ssd_marketing': {
    examples: [
      { source: 'Unleash the ultimate power of PCIe Gen5. Dominate the leaderboard.',
        target: 'PCIe Gen5の究極のパワーを解き放て。リーダーボードを制覇せよ。' },
      { source: 'Load your favorite AAA titles in seconds, not minutes.',
        target: 'お気に入りのAAAタイトルを数秒でロード。数分の待ち時間とはおさらば。' },
    ],
  },
  'en_de_gaming_ssd_marketing': {
    examples: [
      { source: 'Unleash the ultimate power of PCIe Gen5. Dominate the leaderboard.',
        target: 'Entfessle die ultimative Power von PCIe Gen5. Dominiere die Rangliste.' },
      { source: 'Load your favorite AAA titles in seconds, not minutes.',
        target: 'Lade deine AAA-Lieblingstitel in Sekunden, nicht in Minuten.' },
    ],
  },

  // ── Gaming SSD × professional examples ──
  'en_ja_gaming_ssd_professional': {
    examples: [
      { source: 'Equipped with a high-performance heatsink to maintain stable speeds under sustained load.',
        target: '高負荷時でも安定した速度を維持する高性能ヒートシンクを搭載。' },
      { source: 'PCIe Gen5 x4 interface delivers sequential read speeds up to 14,000MB/s.',
        target: 'PCIe Gen5 x4インターフェースにより、最大14,000MB/sのシーケンシャル読み取り速度を実現。' },
    ],
  },

  // ── PC Productivity × professional ──
  'en_ja_pc_productivity_professional': {
    examples: [
      { source: 'Ideal for heavy multitasking and large media file workflows.',
        target: '高負荷なマルチタスクや大容量メディアファイルのワークフローに最適。' },
      { source: 'Accelerate local LLM inference with DRAM cache and high I/O throughput.',
        target: 'DRAMキャッシュと高いI/Oスループットにより、ローカルLLM推論を高速化。' },
    ],
  },
  'en_de_pc_productivity_professional': {
    examples: [
      { source: 'Ideal for heavy multitasking and large media file workflows.',
        target: 'Ideal für intensives Multitasking und umfangreiche Mediendatei-Workflows.' },
      { source: 'Accelerate local LLM inference with DRAM cache and high I/O throughput.',
        target: 'Beschleunigen Sie lokale LLM-Inferenz mit DRAM-Cache und hohem I/O-Durchsatz.' },
    ],
  },

  // ── Professional Imaging × professional ──
  'en_ja_professional_imaging_professional': {
    examples: [
      { source: 'Capture cinema-quality 8K RAW video without dropped frames.',
        target: 'コマ落ちのないシネマ品質の8K RAW動画をキャプチャ。' },
      { source: 'Built to withstand extreme temperatures, water, shock, and vibration.',
        target: '極端な温度、水、衝撃、振動に耐える設計。' },
    ],
  },
  'en_de_professional_imaging_professional': {
    examples: [
      { source: 'Capture cinema-quality 8K RAW video without dropped frames.',
        target: 'Nehmen Sie 8K-RAW-Videos in Kinoqualität ohne Bildausfälle auf.' },
      { source: 'Built to withstand extreme temperatures, water, shock, and vibration.',
        target: 'Konzipiert für extreme Temperaturen, Wasser, Stöße und Vibrationen.' },
    ],
  },

  // ── Consumer Cards × standard ──
  'en_ja_consumer_cards_standard': {
    examples: [
      { source: 'Reliable storage for your everyday photos, videos, and files.',
        target: '日常の写真、動画、ファイルのための信頼性の高いストレージ。' },
      { source: 'Plug-and-play — just insert and start capturing.',
        target: 'プラグアンドプレイ——挿入するだけですぐに撮影を開始。' },
    ],
  },

  // ── Portable Storage × standard ──
  'en_ja_portable_storage_standard': {
    examples: [
      { source: 'Pocket-sized design meets rugged durability. Take your data anywhere.',
        target: 'ポケットサイズのデザインと堅牢な耐久性を両立。データをどこへでも持ち運べます。' },
      { source: 'Transfer large video files directly from your smartphone.',
        target: '大容量の動画ファイルをスマートフォンから直接転送。' },
    ],
  },
  'en_de_portable_storage_standard': {
    examples: [
      { source: 'Pocket-sized design meets rugged durability. Take your data anywhere.',
        target: 'Taschenformat trifft auf robuste Haltbarkeit. Nehmen Sie Ihre Daten überallhin mit.' },
    ],
  },

  // ── Innovation Lifestyle × marketing ──
  'en_ja_innovation_lifestyle_marketing': {
    examples: [
      { source: 'pexar Smart Frame brings your memories to life. Share instantly with family anywhere.',
        target: 'pexarスマートフォトフレームが思い出に命を吹き込みます。離れて暮らす家族とも瞬間を共有。' },
    ],
  },

  // ── General fallback per language ──
  'en_ja_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: '要求の厳しいアプリケーションに高速パフォーマンスを。' },
      { source: 'Compatible with a wide range of devices.',
        target: '幅広いデバイスに対応。' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Lexar Professional CFexpress Type Aカードは、最大1300MB/sの持続書き込み速度を実現し、シネマ品質の8K RAWビデオを途切れることなく記録します。' },
    ],
  },
  'en_de_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Hochgeschwindigkeitsleistung für anspruchsvolle Anwendungen.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Kompatibel mit einer Vielzahl von Geräten.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Die Lexar Professional CFexpress Type A Karte liefert anhaltende Schreibgeschwindigkeiten von bis zu 1300 MB/s für unterbrechungsfreie 8K-RAW-Videoaufnahmen in Kinoqualität.' },
    ],
  },
  'en_fr_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Performances haute vitesse pour les applications exigeantes.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Compatible avec une large gamme d\'appareils.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'La carte Lexar Professional CFexpress Type A offre des vitesses d\'écriture soutenues jusqu\'à 1300 Mo/s pour un enregistrement vidéo 8K RAW ininterrompu de qualité cinéma.' },
    ],
  },
  'en_ko_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: '까다로운 애플리케이션을 위한 고속 성능.' },
      { source: 'Compatible with a wide range of devices.',
        target: '다양한 기기와 호환됩니다.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Lexar Professional CFexpress Type A 카드는 최대 1300MB/s의 지속 쓰기 속도를 제공하여 시네마급 8K RAW 영상을 끊김 없이 녹화합니다.' },
    ],
  },
  'en_ar_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'أداء عالي السرعة للتطبيقات المتطلبة.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'متوافق مع مجموعة واسعة من الأجهزة.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'توفر بطاقة Lexar Professional CFexpress Type A سرعات كتابة مستدامة تصل إلى 1300 ميجابايت/ثانية لتسجيل فيديو 8K RAW متواصل بجودة سينمائية.' },
    ],
  },
  'en_es_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Rendimiento de alta velocidad para aplicaciones exigentes.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Compatible con una amplia gama de dispositivos.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'La tarjeta Lexar Professional CFexpress Type A ofrece velocidades de escritura sostenidas de hasta 1300 MB/s para grabación ininterrumpida de video 8K RAW con calidad cinematográfica.' },
    ],
  },
  'en_it_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Prestazioni ad alta velocità per applicazioni impegnative.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Compatibile con un\'ampia gamma di dispositivi.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'La scheda Lexar Professional CFexpress Type A offre velocità di scrittura sostenute fino a 1300 MB/s per una registrazione video 8K RAW ininterrotta di qualità cinematografica.' },
    ],
  },
  'en_pt-BR_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Desempenho de alta velocidade para aplicações exigentes.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Compatível com uma ampla variedade de dispositivos.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'O cartão Lexar Professional CFexpress Type A oferece velocidades de gravação sustentadas de até 1300 MB/s para gravação de vídeo 8K RAW ininterrupta com qualidade cinematográfica.' },
    ],
  },
  'en_nl_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Hogesnelheidsprestaties voor veeleisende toepassingen.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Compatibel met een breed scala aan apparaten.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'De Lexar Professional CFexpress Type A kaart levert aanhoudende schrijfsnelheden tot 1300 MB/s voor ononderbroken 8K RAW-video-opnamen in cinema-kwaliteit.' },
    ],
  },
  'en_pl_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Wysoka wydajność do wymagających zastosowań.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Kompatybilny z szeroką gamą urządzeń.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Karta Lexar Professional CFexpress Type A zapewnia trwałe prędkości zapisu do 1300 MB/s dla nieprzerwanej kinowej jakości nagrywania wideo 8K RAW.' },
    ],
  },
  'en_sv_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Höghastighetsprestanda för krävande tillämpningar.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Kompatibel med ett brett utbud av enheter.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Lexar Professional CFexpress Type A-kortet levererar ihållande skrivhastigheter på upp till 1300 MB/s för oavbruten 8K RAW-videoinspelning i biokvalitet.' },
    ],
  },
  'en_ru_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Высокоскоростная производительность для ресурсоёмких приложений.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Совместимо с широким спектром устройств.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Карта Lexar Professional CFexpress Type A обеспечивает устойчивую скорость записи до 1300 МБ/с для непрерывной видеозаписи 8K RAW кинематографического качества.' },
    ],
  },
  'en_vi_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Hiệu suất tốc độ cao cho các ứng dụng yêu cầu cao.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Tương thích với nhiều loại thiết bị.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Thẻ Lexar Professional CFexpress Type A cung cấp tốc độ ghi liên tục lên đến 1300 MB/s để quay video 8K RAW chất lượng điện ảnh không bị gián đoạn.' },
    ],
  },
  'en_th_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'ประสิทธิภาพความเร็วสูงสำหรับแอปพลิเคชันที่มีความต้องการสูง' },
      { source: 'Compatible with a wide range of devices.',
        target: 'เข้ากันได้กับอุปกรณ์หลากหลายประเภท' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'การ์ด Lexar Professional CFexpress Type A มอบความเร็วในการเขียนต่อเนื่องสูงสุด 1300 MB/s สำหรับการบันทึกวิดีโอ 8K RAW คุณภาพระดับภาพยนตร์อย่างต่อเนื่อง' },
    ],
  },
  'en_id_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Performa kecepatan tinggi untuk aplikasi yang menuntut.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Kompatibel dengan berbagai perangkat.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Kartu Lexar Professional CFexpress Type A memberikan kecepatan tulis berkelanjutan hingga 1300 MB/s untuk perekaman video 8K RAW berkualitas sinema tanpa gangguan.' },
    ],
  },
  'en_tr_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: 'Zorlu uygulamalar için yüksek hızlı performans.' },
      { source: 'Compatible with a wide range of devices.',
        target: 'Çok çeşitli cihazlarla uyumludur.' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Lexar Professional CFexpress Type A Kart, sinema kalitesinde kesintisiz 8K RAW video kaydı için 1300 MB/s\'ye kadar sürekli yazma hızları sunar.' },
    ],
  },
  'en_zh-CN_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: '为高要求应用提供高速性能。' },
      { source: 'Compatible with a wide range of devices.',
        target: '兼容多种设备。' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Lexar Professional CFexpress Type A 存储卡提供高达 1300MB/s 的持续写入速度，实现影院级 8K RAW 视频不间断录制。' },
    ],
  },
  'en_zh-TW_general': {
    examples: [
      { source: 'High-speed performance for demanding applications.',
        target: '為高要求應用提供高速效能。' },
      { source: 'Compatible with a wide range of devices.',
        target: '相容多種裝置。' },
      { source: 'The Lexar Professional CFexpress Type A Card delivers sustained write speeds up to 1300MB/s for uninterrupted cinema-quality 8K RAW video recording.',
        target: 'Lexar Professional CFexpress Type A 記憶卡提供高達 1300MB/s 的持續寫入速度，實現影院級 8K RAW 影片不間斷錄製。' },
    ],
  },
}

function formatExamples(examples: FewShotExample[], sourceLang: string, targetLang: string): string {
  if (!examples || examples.length === 0) return ''
  const labels = (targetLang === 'zh-CN' || targetLang === 'zh-TW' || targetLang === 'ja' || targetLang === 'ko')
    ? { example: '示例', source: '原文', target: '译文' }
    : { example: 'Example', source: 'Source', target: 'Target' }
  return examples.map((ex, i) =>
    `\n${labels.example} ${i + 1}:\n${labels.source}: ${ex.source}\n${labels.target}: ${ex.target}`
  ).join('')
}

/**
 * Few-shot example retrieval with safe fallback chain.
 * NEVER falls back to zh→zh or zh-TW→zh-CN (prevents cross-language pollution).
 */
export function getFewShotExamplesV2(
  sourceLang: string,
  targetLang: string,
  productLine: string | null,
  style: string,
  maxExamples = 2,
): string {
  // Normalize source for lookup
  const src = sourceLang === 'zh-CN' ? 'zh' : sourceLang

  if (!targetLang) return ''

  // 1. Exact match: product line × style × language pair
  if (productLine) {
    const key = `${src}_${targetLang}_${productLine}_${style}`
    const entry = FEWSHOT_STORE_V2[key]
    if (entry && entry.examples.length > 0) {
      return formatExamples(entry.examples.slice(0, maxExamples), sourceLang, targetLang)
    }
  }

  // 2. Product line × language pair (style agnostic)
  if (productLine) {
    // Try professional as fallback style (most common)
    const keyProf = `${src}_${targetLang}_${productLine}_professional`
    const entryProf = FEWSHOT_STORE_V2[keyProf]
    if (entryProf && entryProf.examples.length > 0) {
      return formatExamples(entryProf.examples.slice(0, maxExamples), sourceLang, targetLang)
    }
    // Try standard
    const keyStd = `${src}_${targetLang}_${productLine}_standard`
    const entryStd = FEWSHOT_STORE_V2[keyStd]
    if (entryStd && entryStd.examples.length > 0) {
      return formatExamples(entryStd.examples.slice(0, maxExamples), sourceLang, targetLang)
    }
  }

  // 3. en → targetLang general fallback
  const keyEn = `en_${targetLang}_general`
  const entryEn = FEWSHOT_STORE_V2[keyEn]
  if (entryEn && entryEn.examples.length > 0) {
    return formatExamples(entryEn.examples.slice(0, maxExamples), sourceLang, targetLang)
  }

  // 4. Zero-shot — NEVER fall back to zh→zh or other mismatched language pairs
  return ''
}

// ============================================================
// Module 5: OUTPUT ANCHOR (English only, unified)
// ============================================================

export const OUTPUT_ANCHOR = `[OUTPUT]
Self-check before output (do NOT output the check process):
1. __XXX_N__ markers, HTML tags, and ↵ line break markers preserved
2. No fabricated specs, brand names, or claims not in the source
Check passed → output in format: "[N] translated text" — one line per item.
No markdown, no code blocks. Each [N] is ONE complete text.
→ Output translations now:`

// ═══════════════════════════════════════════════════════════════
// 模块: PROOFREAD_SYSTEM_PROMPT — AI 校对指令（校对 LLM 的 System Prompt）
// ═══════════════════════════════════════════════════════════════
//
// 职责: 校对 LLM 的检查清单（7 项）。聚焦代码做不到的事（语感/语序/完整性）。
// 校对后代码会再跑一轮 detectBrandInjection + detectExpansion + detectUntranslated。
//
// 输出要求: 始终输出完整译文。不限制输出长度、不做最小化修复。
//          校对后译文是最终用户看到的内容。
//
// 注入: 校对 system prompt（PROOFREAD_SYSTEM_PROMPT + glossaryHint + langBlock）
//       始终用英语，全语种通用
//
// 边界:
//   ⛔ 不注入 IRON_RULES — 校对用独立的 CHECKLIST，不和翻译共享规则
//   ⛔ 不检查代码已处理的问题 — 术语/占位符/品牌注入/单位格式由代码兜底
//   ⛔ 不含 "Do NOT re-translate" / "Keep fixes minimal" — 这些会导致漏翻场景输出残缺
//
// 校对闭环:
//   翻译 → 代码兜底 → AI 校对 → 代码兜底 → 用户
//   任何环节漏翻都至少有两层检测（detectUntranslatedText + 校对 CHECKLIST #1）
// ═══════════════════════════════════════════════════════════════

export const PROOFREAD_SYSTEM_PROMPT = `[ROLE]
You are a localization QA reviewer for Lexar (雷克沙). Review translations
against source texts. Identify issues and output the complete corrected translation.

[CHECKLIST — code handles glossary/placeholders/brand-injection/formatting;
your job is what code CANNOT do:]
1. UNTRANSLATED / INCOMPLETE:
   a) Is each item actually translated into the target language, not a verbatim
      copy of the source? Product names like "Lexar® PLAY SSD" may stay English
      across all languages, but category words and descriptive text MUST be
      localized.
      ⛔ SLOGANS, TAGLINES, HEADLINES, NOTES, FOOTNOTES, and DESCRIPTIVE
      SENTENCES are NOT product names. If they remain in the source language,
      they are UNTRANSLATED — this is a CRITICAL error. Fix them immediately.
      ✅ "Good for Today Great for Tomorrow" → tagline → MUST translate
      ✅ "Level-up Your Gaming Experience" → headline → MUST translate
      ✅ "*Comparison of speeds..." → footnote → MUST translate
   b) Is the translation COMPLETE? If the source is a paragraph with multiple
      sentences (3+ clauses) but the translation is only one word or phrase,
      the translation was TRUNCATED — re-translate the full source text.
      ⚠️ This is the #1 priority check. Do not pass truncated translations.
2. MEANING: Does the translation match the source's meaning exactly? No
   omissions, no additions, no meaning drift.
3. NATURALNESS: Does the translation read naturally to a native speaker? Flag
   awkward phrasing, translationese, or calqued syntax.
   ⛔ TECH LABEL EXEMPTION: If the source is a product name, hardware spec, or
   tech parameter chain (nouns only, no predicate), it is NOT a complete sentence.
   Short output for non-sentence source is EXPECTED and CORRECT — do NOT expand
   or "make it flow". Only flag naturalness for actual sentences with predicates.
4. CATEGORY: Is each category word used correctly per the reference table?
   Desktop Memory ≠ Laptop Memory; SSD ≠ Portable SSD; Card ≠ Reader; etc.
5. TONE: Does the style match the expected tone? Consider the source
   text's natural tone — gaming text may be energetic, professional text
   formal, consumer text friendly. Don't force all text into one tone.
6. SHORT LABEL: Labels under 15 characters must stay concise. If the source is
   a short label but the translation is a full sentence, shorten it.
7. CJK SPACING: For CJK text, are phrase-level spaces preserved correctly?
8. AMBIGUOUS TERMS: Are there any product names, brand names, tech terms, or
   phrases in the source that you found difficult to translate or were unsure
   about? These terms should be added to the glossary with fixed translations.
   List them in the "ambiguous" field even if the translation passes all checks.

[ACTION]
- For EVERY item, output the COMPLETE final translation.
- If the translation passes all checks, output it exactly as-is.
- If any check fails, output the FULLY corrected complete translation.
  ⛔ NEVER output partial text, a single keyword, or a summary.
  ALWAYS output the entire translated text — correct or corrected.

[OUTPUT]
JSON array: [{"i":1,"text":"corrected or original","reason":"short reason","ambiguous":["term1","term2"]}]
"reason" 用中文，最多20个字。通过的用"通过"。
"ambiguous" is an array of terms in the SOURCE language that should be added to the
glossary for consistent future translations. Include brand names, product names, or
ambiguous phrases that don't have a clear fixed translation. If none, use empty array [].`
