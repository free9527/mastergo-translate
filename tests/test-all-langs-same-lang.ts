/**
 * 全语种同语言扫描验证：源语言 == 目标语言时，漏翻检测是否误报？
 * 覆盖 20 个目标语言，每个语言用其母语典型文本
 */
import { detectSourceLanguage, detectUntranslatedText, detectSingleTextLanguage } from '../lib/llm-api'

// 20 个目标语言（从 lib/prompt-constants.ts LANG_SPECIFIC 键推断）
const SAMPLES: Record<string, string[]> = {
  'en':    ['High speed performance', 'Ideal for gaming and content creation', 'Durable and portable design'],
  'zh-CN': ['高速性能', '理想用于游戏和内容创作', '耐用便携设计'],
  'zh-TW': ['高速性能', '理想用於遊戲和內容創作', '耐用便攜設計'],
  'ja':    ['高速パフォーマンス', 'ゲームやコンテンツ作成に最適', '耐久性のあるポータブルデザイン'],
  'ko':    ['고속 성능', '게임 및 콘텐츠 제작에 이상적', '내구성이 뛰어난 휘터블 디자인'],
  'de':    ['Hohe Geschwindigkeit', 'Ideal für Gaming und Content-Erstellung', 'Robustes und tragbares Design'],
  'fr':    ['Haute performance', 'Idéal pour le jeu et la création de contenu', 'Design durable et portable'],
  'es':    ['Alto rendimiento', 'Ideal para juegos y creación de contenido', 'Diseño duradero y portátil'],
  'pt':    ['Alto desempenho', 'Ideal para jogos e criação de conteúdo', 'Design durável e portátil'],
  'pt-BR': ['Alto desempenho', 'Ideal para jogos e criação de conteúdo', 'Design durável e portátil'],
  'it':    ['Alte prestazioni', 'Ideale per gaming e creazione di contenuti', 'Design resistente e portatile'],
  'nl':    ['Hoge snelheid', 'Ideaal voor gaming en contentcreatie', 'Duurzaam en draagbaar ontwerp'],
  'pl':    ['Wysoka wydajność', 'Idealny do gier i tworzenia treści', 'Trwały i przenośny design'],
  'sv':    ['Hög hastighet', 'Idealisk för spel och innehållsskapande', 'Hållbar och bärbar design'],
  'tr':    ['Yüksek hız', 'Oyun ve içerik oluşturma için ideal', 'Dayanıklı ve taşınabilir tasarım'],
  'vi':    ['Hiệu suất cao', 'Lý tưởng cho chơi game và tạo nội dung', 'Thiết kế bền và di động'],
  'th':    ['ประสิทธิภาพสูง', 'เหมาะสำหรับเกมและการสร้างเนื้อหา', 'ดีไซน์ทนทานและพกพา'],
  'ar':    ['أداء عالي', 'مثالي للألعاب وإنشاء المحتوى', 'تصميم متين ومحمول'],
  'ru':    ['Высокая производительность', 'Идеально для игр и создания контента', 'Прочный и портативный дизайн'],
  'id':    ['Kinerja tinggi', 'Ideal untuk gaming dan pembuatan konten', 'Desain tahan lama dan portabel'],
}

console.log('语言      | 批次检测 | 逐条检测 | 误报漏翻 | 判定')
console.log('----------|----------|----------|----------|-----')

for (const [lang, texts] of Object.entries(SAMPLES)) {
  const batchLang = detectSourceLanguage([...texts])
  const perText = detectSingleTextLanguage(texts[0])
  const result = detectUntranslatedText([...texts], [...texts], lang, undefined, batchLang)
  const status = result.size > 0 ? '❌ 误报' : '✅ 通过'
  console.log(`${lang.padEnd(9)} | ${batchLang.padEnd(8)} | ${perText.padEnd(8)} | ${result.size}/${texts.length}      | ${status}`)
  if (result.size > 0) {
    for (const i of result) console.log(`           └─ [${i}] ${texts[i]}`)
  }
}
