/**
 * Few-shot 翻译示例库
 * 每个内容类型提供高质量翻译示例，按语言对组织
 * 基于 Lexar 已有人工审校翻译文档提取和行业最佳实践
 */

// v8.2: 移除 'title' 类型 — 选择逻辑只使用 marketing/specification/description
export type ContentType = 'specification' | 'marketing' | 'description'

interface FewShotExample {
  source: string
  target: string
}

// 示例按: 源语言_target语言_内容类型 索引
// key: `${sourceLang}_${targetLang}_${contentType}`
const FEWSHOT_STORE: Record<string, FewShotExample[]> = {

  // ============================================================
  // 中文 → 英文 (zh-CN → en)
  // ============================================================
  'zh_en_specification': [
    { source: '顺序读取速度最高可达 7400MB/s，顺序写入速度最高可达 6500MB/s', target: 'Sequential read speed up to 7400MB/s, sequential write speed up to 6500MB/s' },
    { source: '采用 PCIe 4.0 x4 接口，NVMe 1.4 协议', target: 'PCIe 4.0 x4 interface, NVMe 1.4 protocol' },
    { source: '容量：1TB / 2TB / 4TB', target: 'Capacity: 1TB / 2TB / 4TB' },
  ],
  'zh_en_marketing': [
    { source: '极致性能，专为游戏玩家和专业创作者打造', target: 'Extreme performance, engineered for gamers and professional creators.' },
    { source: '释放你的创作潜能，疾速传输不等待', target: 'Unleash your creative potential with blazing-fast transfers — no more waiting.' },
    { source: '小巧机身，海量存储，随身携带你的数字世界', target: 'Compact body, massive storage — carry your digital world wherever you go.' },
  ],
  'zh_en_description': [
    { source: 'Lexar ARES RGB DDR5 台式机内存采用高品质颗粒和 PMIC 电源管理芯片，带来卓越性能和稳定表现。', target: 'Lexar ARES RGB DDR5 Desktop Memory features premium ICs and PMIC voltage control, delivering exceptional performance and rock-solid stability.' },
    { source: '随附 5 年有限质保和专业技术支持服务。', target: 'Backed by a 5-year limited warranty and professional technical support.' },
  ],

  // ============================================================
  // 英文 → 中文 (en → zh-CN)
  // ============================================================
  'en_zh_specification': [
    { source: 'Read speed up to 250MB/s, write speed up to 120MB/s', target: '读取速度最高 250MB/s，写入速度最高 120MB/s' },
    { source: 'Interface: PCIe 5.0 x4, NVMe 2.0', target: '接口：PCIe 5.0 x4，NVMe 2.0 协议' },
    { source: 'Capacities: 512GB / 1TB / 2TB', target: '容量：512GB / 1TB / 2TB' },
  ],
  'en_zh_marketing': [
    { source: 'Blazing-fast performance that leaves the competition behind.', target: '疾速性能，超越竞品，一骑绝尘。' },
    { source: 'Designed for those who demand the absolute best.', target: '为追求极致的你而生。' },
    { source: 'Dominate your game with next-gen speed.', target: '以新一代速度主宰你的游戏。' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'ARES DDR5 内存以突破性性能，带你进入次世代游戏新境界。' },
  ],
  'en_zh_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s, making it the perfect companion for content creators on the go.', target: 'Lexar SL500 移动固态硬盘兼具时尚设计与最高 2000MB/s 的疾速传输速度，是内容创作者外出工作的理想拍档。' },
    { source: 'Built with a unibody aluminum chassis for superior heat dissipation and durability.', target: '采用一体式铝合金机身，散热性能和耐用性出色。' },
  ],

  // ============================================================
  // 英文 → 德语 (en → de)
  // ============================================================
  'en_de_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Sequenzielle Lesegeschwindigkeit von bis zu 7.400 MB/s' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'Schnittstelle: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_de_marketing': [
    { source: 'Extreme performance, engineered for gamers and professional creators.', target: 'Extreme Leistung, entwickelt für Gamer und professionelle Kreative.' },
    { source: 'Unleash your creative potential with blazing-fast transfers.', target: 'Entfesseln Sie Ihr kreatives Potenzial mit blitzschnellen Übertragungen.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'ARES DDR5 Arbeitsspeicher liefert bahnbrechende Performance für Gaming auf höchstem Niveau.' },
  ],
  'en_de_description': [
    { source: 'Lexar ARES RGB DDR5 Desktop Memory features premium ICs and PMIC voltage control, delivering exceptional performance and rock-solid stability.', target: 'Der Lexar ARES RGB DDR5 Desktop-Speicher verfügt über Premium-ICs und PMIC-Spannungssteuerung und liefert außergewöhnliche Leistung und höchste Stabilität.' },
  ],

  // ============================================================
  // 英文 → 法语 (en → fr)
  // ============================================================
  'en_fr_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Vitesse de lecture séquentielle jusqu\'à 7 400 Mo/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Capacité : 1 To / 2 To / 4 To' },
  ],
  'en_fr_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Conçu pour ceux qui exigent le meilleur.' },
    { source: 'Blazing-fast performance that leaves the competition behind.', target: 'Des performances fulgurantes qui laissent la concurrence derrière.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'La mémoire RAM ARES DDR5 offre des performances révolutionnaires pour une expérience de jeu inégalée.' },
  ],
  'en_fr_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'Le SSD portable Lexar SL500 allie un design élégant à des vitesses de transfert fulgurantes pouvant atteindre 2 000 Mo/s.' },
  ],

  // ============================================================
  // 英文 → 日语 (en → ja)
  // ============================================================
  'en_ja_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'シーケンシャル読み取り速度 最大 7400MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: '容量: 1TB / 2TB / 4TB' },
  ],
  'en_ja_marketing': [
    { source: 'Extreme performance, engineered for gamers and professional creators.', target: 'ゲーマーとプロフェッショナルクリエイターのために設計された、究極のパフォーマンス。' },
    { source: 'Dominate your game with next-gen speed.', target: '次世代のスピードでゲームを制覇せよ。' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'ARES DDR5メモリは、次世代のゲーミング体験を実現する圧倒的なパフォーマンスを発揮します。' },
  ],
  'en_ja_description': [
    { source: 'Lexar ARES RGB DDR5 Desktop Memory features premium ICs and PMIC voltage control.', target: 'Lexar ARES RGB DDR5 デスクトップメモリは、高品質 IC と PMIC 電圧制御を搭載しています。' },
  ],

  // ============================================================
  // 英文 → 韩语 (en → ko)
  // ============================================================
  'en_ko_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: '순차 읽기 속도 최대 7400MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: '용량: 1TB / 2TB / 4TB' },
  ],
  'en_ko_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: '최고를 원하는 당신을 위해 설계되었습니다.' },
    { source: 'Blazing-fast performance that leaves the competition behind.', target: '경쟁 제품을 압도하는 초고속 성능.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'ARES DDR5 메모리는 극한의 퍼포먼스로 차원이 다른 게이밍 경험을 선사합니다.' },
  ],
  'en_ko_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'Lexar SL500 포터블 SSD는 세련된 디자인과 최대 2000MB/s의 초고속 전송 속도를 결합했습니다.' },
  ],

  // ============================================================
  // 英文 → 阿拉伯语 (en → ar)
  // ============================================================
  'en_ar_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'سرعة قراءة متتابعة تصل إلى 7400 ميجابايت/ثانية' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'السعة: 1 تيرابايت / 2 تيرابايت / 4 تيرابايت' },
  ],
  'en_ar_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'مُصمم لأولئك الذين يطلبون الأفضل على الإطلاق.' },
    { source: 'Unleash your creative potential.', target: 'أطلق العنان لإبداعك.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'توفر ذاكرة ARES DDR5 أداءً استثنائياً لتجربة ألعاب من المستوى التالي.' },
  ],
  'en_ar_description': [
    { source: 'Lexar ARES RGB DDR5 Desktop Memory features premium ICs and PMIC voltage control.', target: 'تتميز ذاكرة Lexar ARES RGB DDR5 المكتبية بشرائح IC متميزة وتحكم في الجهد PMIC.' },
  ],

  // ============================================================
  // 中文 → 繁体中文 (zh-CN → zh-TW)
  // ============================================================
  'zh_zh-TW_specification': [
    { source: '顺序读取速度最高可达 7400MB/s，顺序写入速度最高可达 6500MB/s', target: '循序讀取速度最高可達 7400MB/s，循序寫入速度最高可達 6500MB/s' },
    { source: '容量：1TB / 2TB / 4TB', target: '容量：1TB / 2TB / 4TB' },
    { source: '采用 PCIe 4.0 x4 接口，NVMe 1.4 协议', target: '採用 PCIe 4.0 x4 介面，NVMe 1.4 協定' },
  ],
  'zh_zh-TW_marketing': [
    { source: '极致性能，专为游戏玩家和专业创作者打造', target: '極致效能，專為遊戲玩家與專業創作者打造' },
    { source: '释放你的创作潜能，疾速传输不等待', target: '釋放你的創作潛能，極速傳輸不等待' },
  ],
  'zh_zh-TW_description': [
    { source: 'Lexar ARES RGB DDR5 台式机内存采用高品质颗粒和 PMIC 电源管理芯片，带来卓越性能和稳定表现。', target: 'Lexar ARES RGB DDR5 桌上型記憶體採用高品質顆粒與 PMIC 電源管理晶片，帶來卓越效能與穩定表現。' },
  ],

  // ============================================================
  // 英文 → 繁体中文 (en → zh-TW)
  // ============================================================
  'en_zh-TW_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: '循序讀取速度最高可達 7400MB/s' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: '介面：PCIe 4.0 x4，NVMe 1.4 協定' },
  ],
  'en_zh-TW_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: '為追求極致的你而生。' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'ARES DDR5 記憶體為次世代遊戲體驗帶來突破性效能。' },
  ],
  'en_zh-TW_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'Lexar SL500 可攜式固態硬碟兼具時尚設計與最高 2000MB/s 的極速傳輸速度。' },
  ],

  // ============================================================
  // 英文 → 葡萄牙语 (en → pt)
  // ============================================================
  'en_pt_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Velocidade de leitura sequencial até 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Capacidade: 1 TB / 2 TB / 4 TB' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'Interface: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_pt_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Projetado para quem exige o melhor absoluto.' },
    { source: 'Unleash your creative potential with blazing-fast transfers.', target: 'Liberte o seu potencial criativo com transferências ultrarrápidas.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'A memória RAM ARES DDR5 oferece um desempenho revolucionário para uma experiência de jogo de nível superior.' },
  ],
  'en_pt_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'O SSD Portátil Lexar SL500 combina um design elegante com velocidades de transferência ultrarrápidas de até 2000 MB/s.' },
  ],

  // ============================================================
  // 英文 → 巴西葡萄牙语 (en → pt-BR)
  // ============================================================
  'en_pt-BR_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Velocidade de leitura sequencial de até 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Capacidade: 1 TB / 2 TB / 4 TB' },
  ],
  'en_pt-BR_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Projetado para quem exige o melhor.' },
    { source: 'Blazing-fast performance that leaves the competition behind.', target: 'Desempenho ultrarrápido que deixa a concorrência para trás.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'A memória RAM ARES DDR5 oferece desempenho revolucionário para uma experiência de jogo de outro nível.' },
  ],
  'en_pt-BR_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'O SSD Portátil Lexar SL500 combina design elegante com velocidades de transferência ultrarrápidas de até 2000 MB/s.' },
  ],

  // ============================================================
  // 英文 → 俄语 (en → ru)
  // ============================================================
  'en_ru_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Скорость последовательного чтения до 7400 МБ/с' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Ёмкость: 1 ТБ / 2 ТБ / 4 ТБ' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'Интерфейс: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_ru_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Создан для тех, кто требует самого лучшего.' },
    { source: 'Unleash your creative potential with blazing-fast transfers.', target: 'Раскройте свой творческий потенциал с молниеносной скоростью передачи данных.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'Память ARES DDR5 обеспечивает революционную производительность для игр нового уровня.' },
  ],
  'en_ru_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'Портативный SSD-накопитель Lexar SL500 сочетает элегантный дизайн и молниеносную скорость передачи данных до 2000 МБ/с.' },
  ],

  // ============================================================
  // 英文 → 意大利语 (en → it)
  // ============================================================
  'en_it_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Velocità di lettura sequenziale fino a 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Capacità: 1 TB / 2 TB / 4 TB' },
    { source: 'Interface: PCIe 5.0 x4, NVMe 2.0', target: 'Interfaccia: PCIe 5.0 x4, NVMe 2.0' },
  ],
  'en_it_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Progettato per chi esige solo il meglio.' },
    { source: 'Blazing-fast performance that leaves the competition behind.', target: 'Prestazioni fulminee che lasciano la concorrenza indietro.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'La memoria RAM ARES DDR5 offre prestazioni estreme per un\'esperienza di gioco di livello superiore.' },
  ],
  'en_it_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'L\'SSD Portatile Lexar SL500 unisce un design elegante a velocità di trasferimento fulminee fino a 2000 MB/s.' },
  ],

  // ============================================================
  // 英文 → 越南语 (en → vi)
  // ============================================================
  'en_vi_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Tốc độ đọc tuần tự lên đến 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Dung lượng: 1TB / 2TB / 4TB' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'Giao diện: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_vi_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Được thiết kế cho những ai đòi hỏi điều tốt nhất.' },
    { source: 'Unleash your creative potential with blazing-fast transfers.', target: 'Giải phóng tiềm năng sáng tạo của bạn với tốc độ truyền tải vượt trội.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'RAM DDR5 ARES mang lại hiệu năng bứt phá, đưa trải nghiệm chiến game lên tầm cao mới.' },
  ],
  'en_vi_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'SSD Di Động Lexar SL500 kết hợp thiết kế tinh tế với tốc độ truyền tải vượt trội lên đến 2000 MB/s.' },
  ],

  // ============================================================
  // 英文 → 泰语 (en → th)
  // ============================================================
  'en_th_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'ความเร็วในการอ่านต่อเนื่องสูงสุด 7400MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'ความจุ: 1TB / 2TB / 4TB' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'อินเทอร์เฟซ: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_th_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'ออกแบบมาสำหรับผู้ที่ต้องการสิ่งที่ดีที่สุดเท่านั้น' },
    { source: 'Unleash your creative potential.', target: 'ปลดปล่อยศักยภาพความคิดสร้างสรรค์ของคุณ' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'แรม ARES DDR5 มอบประสิทธิภาพที่ก้าวล้ำเพื่อประสบการณ์การเล่นเกมขั้นสุด' },
  ],
  'en_th_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'Lexar SL500 พกพา SSD ผสมผสานการออกแบบที่ทันสมัยเข้ากับความเร็วในการถ่ายโอนที่รวดเร็วสูงสุด 2000MB/s' },
  ],

  // ============================================================
  // 英文 → 印尼语 (en → id)
  // ============================================================
  'en_id_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Kecepatan baca sekuensial hingga 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Kapasitas: 1TB / 2TB / 4TB' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'Antarmuka: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_id_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Dirancang untuk mereka yang menginginkan yang terbaik.' },
    { source: 'Blazing-fast performance that leaves the competition behind.', target: 'Performa sangat cepat yang meninggalkan pesaing di belakang.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'RAM ARES DDR5 memberikan performa terobosan untuk pengalaman gaming level berikutnya.' },
  ],
  'en_id_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'SSD Portabel Lexar SL500 menggabungkan desain ramping dengan kecepatan transfer sangat cepat hingga 2000 MB/s.' },
  ],

  // ============================================================
  // 英文 → 荷兰语 (en → nl)
  // ============================================================
  'en_nl_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Sequentiële leessnelheid tot 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Capaciteit: 1 TB / 2 TB / 4 TB' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'Interface: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_nl_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Ontworpen voor wie alleen het allerbeste eist.' },
    { source: 'Unleash your creative potential.', target: 'Ontketen uw creatieve potentieel.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'ARES DDR5 RAM-geheugen levert baanbrekende prestaties voor gamen op het hoogste niveau.' },
  ],
  'en_nl_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'De Lexar SL500 Draagbare SSD combineert een strak design met razendsnelle overdrachtssnelheden tot 2000 MB/s.' },
  ],

  // ============================================================
  // 英文 → 波兰语 (en → pl)
  // ============================================================
  'en_pl_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Sekwencyjna prędkość odczytu do 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Pojemność: 1 TB / 2 TB / 4 TB' },
    { source: 'Interface: PCIe 5.0 x4, NVMe 2.0', target: 'Interfejs: PCIe 5.0 x4, NVMe 2.0' },
  ],
  'en_pl_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Zaprojektowany dla tych, którzy wymagają absolutnie najlepszego.' },
    { source: 'Blazing-fast performance that leaves the competition behind.', target: 'Błyskawiczna wydajność, która zostawia konkurencję w tyle.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'Pamięć RAM ARES DDR5 zapewnia przełomową wydajność, wznosząc rozgrywkę na zupełnie nowy poziom.' },
  ],
  'en_pl_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'Przenośny dysk SSD Lexar SL500 łączy elegancki design z błyskawiczną prędkością przesyłu danych do 2000 MB/s.' },
  ],

  // ============================================================
  // 英文 → 瑞典语 (en → sv)
  // ============================================================
  'en_sv_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Sekventiell läshastighet upp till 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Kapacitet: 1 TB / 2 TB / 4 TB' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'Gränssnitt: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_sv_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Designad för dig som kräver det allra bästa.' },
    { source: 'Unleash your creative potential.', target: 'Släpp loss din kreativa potential.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'ARES DDR5 arbetsminne leverer banbrytande prestanda för gaming på nästa nivå.' },
  ],
  'en_sv_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'Den bärbara SSD-enheten Lexar SL500 kombinerar elegant design med blixtsnabba överföringshastigheter upp till 2000 MB/s.' },
  ],

  // ============================================================
  // 英文 → 土耳其语 (en → tr)
  // ============================================================
  'en_tr_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Sıralı okuma hızı 7400 MB/s\'ye kadar' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Kapasite: 1 TB / 2 TB / 4 TB' },
    { source: 'Interface: PCIe 4.0 x4, NVMe 1.4', target: 'Arayüz: PCIe 4.0 x4, NVMe 1.4' },
  ],
  'en_tr_marketing': [
    { source: 'Designed for those who demand the absolute best.', target: 'Yalnızca en iyisini talep edenler için tasarlandı.' },
    { source: 'Blazing-fast performance that leaves the competition behind.', target: 'Rakiplerini geride bırakan inanılmaz hızlı performans.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'ARES DDR5 RAM, yeni nesil oyun deneyimi için çığır açan performans sunar.' },
  ],
  'en_tr_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'Lexar SL500 Taşınabilir SSD, şık tasarımı 2000 MB/s\'ye varan inanılmaz aktarım hızlarıyla birleştirir.' },
  ],

  // ============================================================
  // 英文 → 西班牙语 (en → es)
  // ============================================================
  'en_es_specification': [
    { source: 'Sequential read speed up to 7400MB/s', target: 'Velocidad de lectura secuencial de hasta 7400 MB/s' },
    { source: 'Capacity: 1TB / 2TB / 4TB', target: 'Capacidad: 1 TB / 2 TB / 4 TB' },
  ],
  'en_es_marketing': [
    { source: 'Extreme performance, engineered for gamers and professional creators.', target: 'Rendimiento extremo, diseñado para jugadores y creadores profesionales.' },
    { source: 'Dominate your game with next-gen speed.', target: 'Domina tu juego con velocidad de nueva generación.' },
    { source: 'ARES DDR5 memory delivers breakthrough performance for next-level gaming.', target: 'La memoria RAM ARES DDR5 ofrece un rendimiento revolucionario para una experiencia de juego de otro nivel.' },
  ],
  'en_es_description': [
    { source: 'The Lexar SL500 Portable SSD combines sleek design with blazing-fast transfer speeds up to 2000MB/s.', target: 'El SSD Portátil Lexar SL500 combina un diseño elegante con velocidades de transferencia ultrarrápidas de hasta 2000 MB/s.' },
  ],
}

/**
 * 获取用于翻译 prompt 的 few-shot 示例。
 * 返回格式化的示例文本，可直接注入 system prompt。
 *
 * @param sourceLang 源语言代码
 * @param targetLang 目标语言代码
 * @param maxExamples 最多返回示例数
 * @param scenePreset 场景预设（用于选择示例类型：ecommerce→marketing, technical→specification, 默认→description）
 * @param style 翻译风格（marketing 风格优先使用 marketing 示例）
 */
export function getFewShotExamples(
  sourceLang: string,
  targetLang: string,
  maxExamples = 3,
  scenePreset?: string,
  style?: string,
): string {
  // 标准化语言代码
  const src = sourceLang.startsWith('zh') ? 'zh' : 'en'
  const tgt = targetLang === 'zh-CN' ? 'zh' : targetLang

  // 根据场景和风格动态选择示例类型
  // ecommerce + marketing → marketing 示例（提供营销语气参照）
  // technical_doc/spec_sheet → specification 示例（提供技术参数格式参照）
  // 默认 → description 示例（通用描述性文本）
  let contentType: ContentType = 'description'
  if (style === 'marketing' || scenePreset === 'ecommerce') {
    contentType = 'marketing'
  } else if (scenePreset === 'technical_doc' || scenePreset === 'spec_sheet') {
    contentType = 'specification'
  }

  // 优先按选定类型查找，无匹配则回退到 description
  let key = `${src}_${tgt}_${contentType}`
  let examples = FEWSHOT_STORE[key]

  // 回退链：选定类型 → description → zh-CN description → en description
  if ((!examples || examples.length === 0) && contentType !== 'description') {
    key = `${src}_${tgt}_description`
    examples = FEWSHOT_STORE[key]
  }

  // zh-TW 没有示例时，回退到 zh (zh-CN)
  if ((!examples || examples.length === 0) && tgt === 'zh-TW') {
    key = `${src}_zh_${contentType}`
    examples = FEWSHOT_STORE[key]
    if (!examples || examples.length === 0) {
      key = `${src}_zh_description`
      examples = FEWSHOT_STORE[key]
    }
  }

  // 如果目标语言没有，回退到 en description 示例
  if ((!examples || examples.length === 0) && src === 'zh') {
    key = 'zh_en_description'
    examples = FEWSHOT_STORE[key]
  }

  if (!examples || examples.length === 0) {
    return ''
  }

  const selected = examples.slice(0, maxExamples)
  // v8.1: 标签语言随目标语言 — CJK 用中文，非 CJK 用英文
  const isCJK = ['zh-CN', 'zh-TW', 'ja', 'ko'].includes(tgt)
  const labelExample = isCJK ? '示例' : 'Example'
  const labelSource = isCJK ? '原文' : 'Source'
  const labelTranslation = isCJK ? '译文' : 'Translation'
  const sectionTitle = isCJK ? '【高质量翻译参考示例】' : '[REFERENCE EXAMPLES]'
  const lines = selected.map((ex, i) =>
    `${labelExample} ${i + 1}:\n${labelSource}: ${ex.source}\n${labelTranslation}: ${ex.target}`
  )
  return `\n${sectionTitle}\n${lines.join('\n\n')}\n`
}
