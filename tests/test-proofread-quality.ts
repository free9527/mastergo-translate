/**
 * 校对质量验证测试
 * 用 NM1090 PRO 15条×13语种数据，量化 AI 校对的净收益
 *
 * 测试流程（每个语种）：
 * 1. translateBatch(EN→目标语言) → 翻译结果
 * 2. proofreadBatch(EN + 翻译结果) → 校对结果（始终调用）
 * 3. 对比分析：翻译质量、校对修改、净收益
 *
 * 使用方法：
 *   npx tsx tests/test-proofread-quality.ts [lang]
 *   例如：npx tsx tests/test-proofread-quality.ts de
 */

// Node.js 环境需要 XMLHttpRequest polyfill
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

import { translateBatch, proofreadBatch, detectUntranslatedText, buildTaskGlossaryHint } from '../lib/llm-api'
import { LLMConfig } from '../messages/types'

// ============================================================
// 配置
// ============================================================

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
const MODEL = 'gpt-5.5'

const config: LLMConfig = {
  apiKey: API_KEY,
  apiUrl: API_URL,
  model: MODEL,
  translationStyle: 'standard',
  translationStyleCustom: '',
  scenePreset: 'ecommerce',
  manualProductLine: undefined,
  enableProofread: true,
  proofreadApiKey: API_KEY,
  proofreadApiUrl: API_URL,
  proofreadModel: MODEL,
}

// ============================================================
// NM1090 PRO 测试数据（15 条 EN 源文）
// ============================================================

const EN_TEXTS = [
  'Performance for the Next Level\nLexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
  'DRAM Cache SLC Dynamic Cache\n\n4K Random Read Up to 2100K IOPS\n\nGen5 SSD\nAccelerate Load Times by up to 200%\n\nUp to 4TB\n\nHeat-Defying 6nm Controller\n\nLexar DiskMaster Easy Drive Management\n\n5 Years Service\n\n',
  'Accelerate Load Times by up to 200%*\nExperience blistering read/write speeds up to 14,000/13,000MB/s* thanks to a combination of PCIe 5.0 technology and next-gen 232-layer 3D TLC NAND.\n\n\n*Speeds based on internal testing. Actual performance may vary.',
  'An Unmatched AMD Partner\nThe NM1090 PRO is the perfect match for AMD Ryzen 9000 series CPUs. It not only delivers extreme storage and computing performance but also ensures fast game loading and smooth operation. It is the ideal choice for users who seek a high-performance gaming experience.\n\n\n',
  'Heat-Defying 6nm Controller\n\nOffers advanced performance and simultaneously achieves better power management. The controller\'s temperature is reduced by 38%*, ensuring that the hard drive remains cool during high-load operation and provides a smoother performance experience.\n\n\nBIT Running for 30 Minutes Later\nTemperature Comparison with Other Gen 5 SSDs\n\nController Temperature Reduction\nS.M.A.R.T. Temperature Reduction\n\n* Based on internal testing. Actual performance may vary.',
  'Ultra-fast Response Blazing Speed\n4K Random Reads Up to 2100K IOPS*, significantly speeds up system response and application loading times, especially enhancing efficiency in multitasking and video editing, providing gamers with a smoother experience.\n\n* Speeds based on internal testing. Actual performance may vary.',
  'A State-of-the-Art Experience\nDRAM Cache and SLC Dynamic Cache greatly enhance data transfer speeds to reduce wait times and improve system responsiveness.\n\nDram Capacity',
  'Up to 4TB\n\nOffers 1TB/2TB/4TB storage options. Easily handles OS, large games, and UHD/8K media storage needs, meeting the high demand for SSD capacity in the AIPC era.\n\nHigh-quality chips ensure ample storage design, offering gamers more space\nActual usable capacity\nA non-full capacity 4TB SSD\nNM1090 PRO 4TB\n\n* Based on internal testing. Actual performance may vary.',
  'Compatible with Microsoft DirectStorage \nBuilt to leverage Microsoft DirectStorage3 and significantly boost game loads, minimize delays, conserve CPU power, and enrich the gaming experience.',
  'Unleashing ultimate performance\nPaired with the latest AMD and Intel CPUs and PCIe 5.0 motherboards, it achieves the perfect match for ultimate performance. It is also backward compatible with PCIe 3.0 and PCIe 4.0 systems to ensure extensive applicability.',
  'Lexar DiskMaster\nFirmware upgrades\nHealth monitoring\nPerformance optimization\nData security',
  'Unleash the Gaming Power\nSupport Microsoft DirectStorage technology significantly reduces game load time.',
  'New Creative Experience\nBoosts rendering speeds, turning ideas into reality instantly.',
  'Ultimate Performance for AIPC\nMeets AIPC\'s high-end demands with exceptional performance and vast capacity.',
  '5 Years Service\n',
]

// 各语种参考译文（从 CSV 提取）
const REF_TRANSLATIONS: Record<string, string[]> = {
  'de': [
    'Leistung für das nächste Level\n Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    'DRAM Cache Dynamischer SLC Cache\n \n 4K Zufälliges Lesen bis zu 2100K IOPS\n \n Gen5 SSD\n \n Beschleunigung der Ladezeiten um bis zu 200%\n \n Bis zu 4 TB\n \n Wärmeabweisender 6nm Controller\n \n Lexar DiskMaster Einfache Laufwerksverwaltung\n \n 5 Jahre Service',
    'Beschleunigung der Ladezeiten um bis zu 200%*\n Erleben Sie atemberaubende Lese-/Schreibgeschwindigkeiten von bis zu 14.000/13.000 MB/s* dank einer Kombination aus PCIe 5.0 Technologie und 232-Layer 3D TLC NAND der nächsten Generation.\n \n \n *Die Geschwindigkeitsangaben basieren auf internen Tests. Die tatsächliche Geschwindigkeit kann variieren.',
    'Ein unübertroffener AMD Partner\n Die NM1090 PRO ist die perfekte Ergänzung für CPUs der AMD Ryzen 9000 Serie. Sie bietet nicht nur eine extreme Speicher- und Rechenleistung, sondern sorgt auch für das schnelle Laden von Spielen und einen reibungslosen Betrieb. Sie ist die ideale Wahl für Benutzer, die ein leistungsstarkes Gaming-Erlebnis suchen.',
    'Wärmeabweisender 6nm Controller\n \n Bietet erweiterte Leistung und erreicht gleichzeitig eine bessere Energieverwaltung. Die Temperatur des Controllers wird um 38%* gesenkt, wodurch sichergestellt wird, dass der Datenträger bei hoher Last kühl bleibt und eine bessere Leistung bietet.\n \n \n BIT nach 30 Minuten Ausführung\n Temperaturvergleich mit anderen SSDs der 5. Generation\n \n Temperaturreduzierung des Controllers\n S.M.A.R.T. Temperaturreduzierung\n \n * Basierend auf internen Tests. Die tatsächliche Geschwindigkeit kann variieren.',
    'Ultraschnelle Reaktionsgeschwindigkeit\n 4K Zufälliges Lesen bis zu 2100K IOPS* beschleunigt die Systemreaktion und die Ladezeiten von Anwendungen erheblich, verbessert insbesondere die Effizienz beim Multitasking und bei der Videobearbeitung und bietet Gamern ein reibungsloseres Erlebnis.\n \n * Die Geschwindigkeitsangaben basieren auf internen Tests. Die tatsächliche Geschwindigkeit kann variieren.',
    'Ein Erlebnis auf dem neuesten Stand der Technik\n DRAM Cache und SLC Dynamic Cache verbessern die Datenübertragungsgeschwindigkeit erheblich, um Wartezeiten zu verkürzen und die Reaktionsfähigkeit des Systems zu verbessern.\n \n DRAM Kapazität',
    'Bis zu 4 TB\n \n Bietet 1 TB/2 TB/4 TB Speicheroptionen. Bewältigt problemlos Betriebssysteme, große Spiele und UHD/8K Medienspeicheranforderungen und erfüllt damit die hohe Nachfrage nach SSD-Kapazität in der AIPC Ära.\n \n Hochwertige Chips sorgen für ein großzügiges Speicherdesign und bieten Gamern mehr Platz\n Tatsächlich nutzbare Kapazität\n Eine 4 TB SSD ohne volle Kapazität\n NM1090 PRO 4TB\n \n * Basierend auf internen Tests. Die tatsächliche Geschwindigkeit kann variieren.',
    'Kompatibel mit Microsoft DirectStorage \n Entwickelt, um Microsoft DirectStorage3 zu nutzen und das Laden von Spielen erheblich zu beschleunigen, Verzögerungen zu minimieren, CPU Leistung zu sparen und das Spielerlebnis zu bereichern.',
    'Ultimative Leistung entfesseln\n Zusammen mit den neuesten AMD und Intel CPUs und PCIe 5.0 Mainboards ist sie die perfekte Kombination für ultimative Leistung. Sie ist auch zu PCIe 3.0 und PCIe 4.0 Systemen abwärtskompatibel, um eine umfassende Anwendbarkeit zu gewährleisten.',
    'Lexar DiskMaster\n Firmware-Aktualisierungen\n Statusüberwachung\n Leistungsoptimierung\n Datensicherheit',
    'Entfesseln Sie die Gaming Leistung\n Die Unterstützung der Microsoft DirectStorage Technologie reduziert die Ladezeit von Spielen erheblich.',
    'Neues Kreativerlebnis\n Erhöht die Geschwindigkeit beim Rendern, sodass Ideen sofort in die Realität umgesetzt werden können.',
    'Ultimative Leistung für AIPC\n Erfüllt die High-End Anforderungen von AIPCs mit außergewöhnlicher Leistung und hoher Kapazität.',
    '5 Jahre Service',
  ],
  'fr': [
    'Performances pour le niveau supérieur\n SSD Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280',
    'Cache DRAM Cache dynamique SLC\n \n Lecture aléatoire 4K jusqu\'à 2100K IOPS\n \n SSD Gen5\n \n Accélération des temps de chargement jusqu\'à 200 %\n \n Jusqu\'à 4 To\n \n Contrôleur 6 nm résistant à la chaleur\n \n Gestion facile des lecteurs Lexar DiskMaster\n \n Service de 5 ans',
    'Accélérez les temps de chargement jusqu\'à 200 %*\n Découvrez des vitesses de lecture/écriture fulgurantes allant jusqu\'à 14 000/13 000 Mo/s* grâce à la combinaison de la technologie PCIe 5.0 et de la NAND 3D TLC 232 couches de nouvelle génération.\n \n \n *Vitesses basées sur des tests internes. Les performances réelles peuvent varier.',
    'Un partenaire AMD inégalé\n Le NM1090 PRO est le partenaire idéal des CPU AMD Ryzen série 9000. Il offre non seulement des performances de stockage et de calcul extrêmes, mais garantit également un chargement rapide des jeux et un fonctionnement fluide. C\'est le choix idéal pour les utilisateurs qui recherchent une expérience de jeu de haute performance.',
    'Contrôleur 6 nm résistant à la chaleur\n \n Offre des performances avancées tout en assurant une meilleure gestion de l\'énergie. La température du contrôleur est réduite de 38 %*, ce qui permet au disque dur de rester froid pendant les opérations à forte charge et d\'offrir une expérience de jeu plus fluide.\n \n \n BIT fonctionnant 30 minutes plus tard\n Comparaison de la température avec d\'autres SSD Gen 5\n \n Réduction de la température du contrôleur\n S.M.A.R.T. Réduction de la température\n \n * Basé sur des tests internes. Les performances réelles peuvent varier.',
    'Réponse ultra-rapide Vitesse fulgurante\n Lectures aléatoires 4K Jusqu\'à 2100K IOPS*, accélère considérablement la réponse du système et les temps de chargement des applications, améliorant particulièrement l\'efficacité du multitâche et de l\'édition vidéo, offrant aux joueurs une expérience plus fluide.\n \n * Vitesses basées sur des tests internes. Les performances réelles peuvent varier.',
    'Une expérience de pointe\n Le cache DRAM et le cache dynamique SLC améliorent considérablement les vitesses de transfert des données afin de réduire les temps d\'attente et d\'améliorer la réactivité du système.\n \n Capacité DRAM',
    'Jusqu\'à 4 To\n \n Offre des options de stockage de 1 To/2 To/4 To. Gère facilement les besoins de stockage du système d\'exploitation, des jeux volumineux et des médias UHD/8K, répondant ainsi à la forte demande de capacité SSD à l\'ère de l\'AIPC.\n \n Les puces de haute qualité garantissent une conception de stockage ample,\n offrant plus d\'espace aux joueurs\n Capacité utilisable réelle\n Un SSD de 4 To non pleine capacité\n NM1090 PRO 4 To\n \n * Basé sur des tests internes. Les performances réelles peuvent varier.',
    'Compatible avec\n Microsoft DirectStorage \n Conçu pour tirer parti de Microsoft DirectStorage3 et accélérer considérablement le chargement des jeux, minimiser les délais, économiser la puissance du CPU et enrichir l\'expérience de jeu.',
    'Des performances\n ultimes\n Associé aux derniers CPU AMD et Intel et aux cartes mères PCIe 5.0, il constitue la solution idéale pour des performances optimales. Il est également rétrocompatible avec les systèmes PCIe 3.0 et PCIe 4.0 pour garantir une applicabilité étendue.',
    'Lexar DiskMaster\n Mises à niveau du microprogramme\n Surveillance de la santé\n Optimisation des performances\n Sécurité des données',
    'Libérez\n la puissance de jeu\n La prise en charge de la technologie Microsoft DirectStorage réduit considérablement le temps de chargement des jeux.',
    'Nouvelle\n expérience créative\n Augmente les vitesses de rendu, transformant instantanément les idées en réalité.',
    'Performances ultimes\n pour l\'AIPC\n Répond aux exigences haut de gamme de l\'AIPC grâce à des performances exceptionnelles et une grande capacité.',
    'Service de 5 ans',
  ],
  'es': [
    'Rendimiento para el próximo nivel\n Unidad de estado sólido (SSD) Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280',
    'Caché dinámica SLC basada en DRAM\n \n Lectura aleatoria 4K hasta 2100K IOPS\n \n Gen5 SSD\n \n Acelera los tiempos de carga hasta en un 200 %\n \n Hasta 4 TB\n \n Controlador de 6 nm que desafía el calor\n \n Gestión sencilla de unidades Lexar DiskMaster\n \n 5 años de servicio',
    'Acelera los tiempos de carga hasta en un 200 %*\n Experimente increíbles velocidades de lectura/escritura de hasta 14 000/13 000 MB/s* gracias a una combinación de tecnología PCIe 5.0 y NAND 3D TLC de 232 capas de última generación.\n \n \n *Velocidades basadas en pruebas internas. El rendimiento real puede variar.',
    'Un socio inigualable de AMD\n El NM1090 PRO es la combinación perfecta para las CPU de la serie AMD Ryzen 9000. No solo ofrece un rendimiento extremo de almacenamiento y procesamiento, sino que también garantiza una carga rápida de juegos y un funcionamiento sin problemas. Es la opción ideal para los usuarios que buscan una experiencia de juego de alto rendimiento.',
    'Controlador de 6 nm que desafía el calor\n \n Ofrece un rendimiento avanzado y al mismo tiempo logra una mejor gestión de la energía. La temperatura del controlador se reduce en un 38 %*, lo que garantiza que el disco duro se mantenga frío durante el funcionamiento con alta carga y proporciona una experiencia de rendimiento más fluida.\n \n \n BIT se ejecuta más tarde durante 30 minutos\n Comparación de temperatura con otras SSD de quinta generación\n \n Reducción de la temperatura del controlador\n S.M.A.R.T. Reducción de temperatura\n \n * Basado en pruebas internas. El rendimiento real puede variar.',
    'Respuesta ultrarrápida a una velocidad increíble\n Lecturas aleatorias 4K de hasta 2100K IOPS*, acelera significativamente la respuesta del sistema y los tiempos de carga de las aplicaciones, mejorando especialmente la eficiencia en la multitarea y la edición de vídeo, brindando a los jugadores una experiencia más fluida.\n \n * Velocidades basadas en pruebas internas. El rendimiento real puede variar.',
    'Una experiencia de vanguardia\n La caché DRAM y la caché dinámica SLC mejoran enormemente las velocidades de transferencia de datos para reducir los tiempos de espera y mejorar la capacidad de respuesta del sistema.\n \n Capacidad Dram',
    'Hasta 4 TB\n \n Ofrece opciones de almacenamiento de 1 TB/2 TB/4 TB. Gestiona fácilmente sistemas operativos, juegos grandes y necesidades de almacenamiento de medios UHD/8K, satisfaciendo la alta demanda de capacidad de las SSD en la era AIPC.\n \n Los chips de alta calidad garantizan un amplio diseño de almacenamiento, ofreciendo a los jugadores más espacio.\n Capacidad utilizable real\n Una SSD de 4 TB con capacidad no completa\n NM1090 PRO 4 TB\n \n * Basado en pruebas internas. El rendimiento real puede variar.',
    'Compatible con Microsoft DirectStorage \n Diseñada para aprovechar Microsoft DirectStorage3 y aumentar significativamente las cargas de juegos, minimizar retrasos, conservar energía de la CPU y enriquecer la experiencia de juego.',
    'Liberar el máximo rendimiento\n Combinado con las últimas CPU AMD e Intel y placas base PCIe 5.0, logra la combinación perfecta para lograr el máximo rendimiento. También es compatible con versiones anteriores de sistemas PCIe 3.0 y PCIe 4.0 para garantizar una amplia aplicabilidad.',
    'Lexar DiskMaster\n Actualizaciones de firmware\n Monitoreo de salud\n Optimización del rendimiento\n Seguridad de los datos',
    'Libera el poder del juego\n La compatibilidad con la tecnología Microsoft DirectStorage reduce significativamente el tiempo de carga del juego.',
    'Nueva experiencia creativa\n Aumenta las velocidades de renderizado, convirtiendo las ideas en realidad al instante.',
    'Máximo rendimiento para AIPC\n Cumple con las demandas de alto nivel de AIPC con un rendimiento excepcional y una gran capacidad.',
    '5 años de servicio',
  ],
  'it': [
    'Prestazioni di livello superiore\n SSD Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280',
    'Cache Dinamica SLC Cache DRAM\n \n Lettura Random 4K fino a 2100K IOPS\n \n Gen5 SSD\n \n Accelera i tempi di caricamento fino al 200%\n \n Fino a 4 TB\n \n Controller anti-calore da 6 nm\n \n Facile gestione dell\'unità con Lexar DiskMaster\n \n 5 anni di assistenza',
    'Accelera i tempi di caricamento fino al 200%*\n Altissime velocità di lettura/scrittura fino a 14000/13000 MB/s* grazie a una combinazione di tecnologia PCIe 5.0 e TLC NAND 3D di nuova generazione a 232 livelli.\n \n \n *Valori di velocità basati su test interni. Le prestazioni effettive possono variare.',
    'Un partner AMD senza pari\n L\'NM1090 PRO è l\'abbinamento perfetto per le CPU AMD Ryzen serie 9000. Non solo offre grande capacità di archiviazione ed alte prestazioni, ma garantisce che i giochi si carichino velocemente e funzionino senza intoppi. È la scelta ideale per gli utenti che vogliono un\'esperienza di gioco ad alte prestazioni.',
    'Controller anti-calore da 6 nm\n \n Offre prestazioni avanzate e contemporaneamente gestisce meglio il consumo energetico. La temperatura del controller è ridotta del 38%*; questo garantisce che il disco rigido rimanga freddo durante le operazioni più intense, e offre un\'esperienza d\'uso più scorrevole.\n \n \n La BIT funziona per 30 minuti dopo\n Confronto di temperatura con altri SSD di quinta generazione\n \n Riduzione della temperatura del controller\n S.M.A.R.T. Riduzione della temperatura\n \n * Basato su verifiche interne. Le prestazioni effettive possono variare.',
    'Altissima velocità di risposta\n Lettura Random 4K fino a 2100K IOPS*, accelera di molto la risposta del sistema e i tempi di caricamento delle applicazioni, aumentando in particolare l\'efficienza nel multitasking e nell\'editing video; offre un\'esperienza di gioco più scorrevole.\n \n * Valori di velocità basati su test interni. Le prestazioni effettive possono variare.',
    'Un\'esperienza all\'avanguardia\n La Cache DRAM e la cache dinamica SLC aumenta notevolmente la velocità di trasferimento dei dati, riduce i tempi di attesa e migliora la responsività del sistema.\n \n Capacità Dram',
    'Fino a 4 TB\n \n Offre opzioni di capacità da 1TB/2TB/4TB. Gestisce con facilità sistemi operativi, giochi pesanti e archiviazione di media UHD/8K; risponde alle esigenze di capacità per gli SSD nell\'era AIPC.\n \n Chip di alta qualità garantiscono un design con grande capacità di archiviazione, e offrono più spazio per i giochi\n Capacità utilizzabile effettiva\n Un SSD da 4 TB a capacità non piena\n NM1090 PRO 4TB\n \n * Basato su verifiche interne. Le prestazioni effettive possono variare.',
    'Compatibile con Microsoft DirectStorage \n Costruito per sfruttare Microsoft DirectStorage3, migliora il caricamento dei giochi, minimizza i ritardi, conserva la potenza della CPU e arricchisce l\'esperienza di gioco.',
    'Scatena le massime prestazioni\n Se usato assieme alle più recenti CPU AMD e Intel e alle schede madri PCIe 5.0, è la combinazione perfetta per le massime prestazioni. È anche retrocompatibile con i sistemi PCIe 3.0 e PCIe 4.0, per una massima flessibilità d\'uso.',
    'Lexar DiskMaster\n Aggiornamenti del firmware\n Controllo dello stato di salute\n Ottimizzazione delle prestazioni\n Sicurezza dei dati',
    'Scatena la potenza di gioco\n Supporta la tecnologia Microsoft DirectStorage, e riduce di molto i tempi d\'attesa per caricare i giochi.',
    'Nuova esperienza di gioco\n Aumenta la velocità dei rendering, e trasforma in un istante le idee in realtà.',
    'Altissime prestazioni per AIPC\n Risponde alle alte esigenze dell\'AIPC con prestazioni eccezionali e una grande capacità.',
    '5 anni di assistenza',
  ],
  'ja': [
    '次のレベルを実現するパフォーマンス\n Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    'DRAMキャッシュSLCダイナミックキャッシュ\n \n 最大2100K IOPSの4Kランダムリード\n \n Gen5 SSD\n \n ロード時間を最大200%加速\n \n 最大4TB\n \n 熱に強い6nmコントローラー\n \n Lexar DiskMasterによる容易なドライブ管理\n \n 5年保証',
    'ロード時間を最大200%加速*\n PCIe 5.0テクノロジーと次世代の232層3D TLC NANDの組み合わせによって実現された、最大14,000/13,000MB/s*の高速リード/ライト速度を体験してください。\n \n \n *速度は社内テストに基づいています。実際のパフォーマンスは異なる場合があります。',
    '比類なきAMDのパートナー\n NM1090 PROは、AMD Ryzen 9000シリーズCPUに最適です。優れたストレージとコンピューティングのパフォーマンスを実現するだけでなく、ゲームの高速ロードとスムーズな動作を確約します。高パフォーマンスのゲーム体験を求めるユーザーに理想的な選択肢です。',
    '熱に強い6nmコントローラー\n \n 高度なパフォーマンスと同時に電力管理の改善を実現します。コントローラーの温度を38%低下させ*、高負荷の動作中もハードドライブをクールに保ち、よりスムーズなパフォーマンスを提供します。\n \n \n BIT実行30分後\n 他のGen 5 SSDとの温度比較\n \n コントローラーの温度低下\n S.M.A.R.T. の温度低下\n \n *社内テストに基づいています。実際のパフォーマンスは異なる場合があります。',
    '超高速の応答性\n 最大2100K IOPSの4Kランダムリード*により、システムの応答時間とアプリケーションのロード時間を大幅に高速化し、特にマルチタスキングや動画編集で効率を向上するとともに、ゲーマーによりスムーズな体験をもたらします。\n \n *速度は社内テストに基づいています。実際のパフォーマンスは異なる場合があります。',
    '最先端の体験\n DRAMキャッシュとSLCダイナミックキャッシュがデータ転送速度を大幅に強化し、待ち時間を短縮すると同時に、システムの応答性を向上させます。\n \n DRAM容量',
    '最大4TB\n \n 1TB/2TB/4TBのストレージオプションが用意されています。OS、大型ゲーム、UHD/8Kメディアストレージなどのニーズに簡単に対応し、AIPC時代のSSD容量に対する高い要求に応えます。\n \n 高品質なチップが十分なストレージの設計を確約し、ゲーマーにより多くの領域を提供します。\n 実際に使用できる容量\n 全容量ではない4TB SSD\n NM1090 PRO 4TB\n \n *社内テストに基づいています。実際のパフォーマンスは異なる場合があります。',
    'Microsoft DirectStorageに対応 \n Microsoft DirectStorage3の活用を念頭に構築されており、ゲームの読み込みを大幅に向上させ、遅延を最小限に抑え、CPUのパワーを節約することで、より豊富なゲーム体験を実現します。',
    '究極のパフォーマンスを解放\n 最新のAMDとインテルのCPU、PCIe 5.0マザーボードで、究極のパフォーマンスに最適な組み合わせを達成しています。PCIe 3.0およびPCIe 4.0システムとも下位互換性があり、幅広い適用性が確約されています。',
    'Lexar DiskMaster\n ファームウェアアップグレード\n 健全性モニタリング\n パフォーマンス最適化\n データセキュリティ',
    'ゲーミングパワーを解き放つ\n Microsoft DirectStorageテクノロジーのサポートによりゲームのロード時間を大幅に短縮します。',
    '新しいクリエイティブ体験\n レンダリング速度を向上し、アイデアを即座に現実に変えます。',
    'AIPCに適した究極のパフォーマンス\n 卓越したパフォーマンスと大容量で、AIPCのハイエンドな要求に応えます。',
    '5年保証',
  ],
  'ko': [
    '다음 레벨을 구현하는 성능\n Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    'DRAM 캐시 SLC 다이내믹 캐시\n \n 최대 2100K IOPS의 4K 랜덤 읽기\n \n Gen5 SSD\n \n 로드 시간 최대 200% 단축\n \n 최대 4TB\n \n 열에 강한 6nm 컨트롤러\n \n Lexar DiskMaster 간편한 드라이브 관리\n \n 5년 서비스',
    '로드 시간 최대 200% 단축*\n PCIe 5.0 기술과 차세대 232레이어 3D TLC NAND의 조합으로 최대 14,000/13,000MB/s*의 폭발적인 읽기/쓰기 속도를 경험하세요.\n \n \n *속도는 내부 테스트 기준입니다. 실제 성능은 다를 수 있습니다.',
    '비교할 수 없는 AMD 파트너\n NM1090 PRO는 AMD Ryzen 9000 시리즈 CPU에 완벽한 조합입니다. 극한의 스토리지 및 컴퓨팅 성능을 제공할 뿐만 아니라 빠른 게임 로딩과 원활한 작동을 보장합니다. 고성능 게이밍 경험을 원하는 사용자에게 이상적인 선택입니다.',
    '열에 강한 6nm 컨트롤러\n \n 고급 성능을 제공하면서 동시에 더 나은 전력 관리를 달성합니다. 컨트롤러 온도가 38%* 감소하여 고부하 작동 중에도 하드 드라이브가 시원하게 유지되고 더 원활한 성능 경험을 제공합니다.\n \n \n BIT 30분 실행 후\n 다른 Gen 5 SSD와의 온도 비교\n \n 컨트롤러 온도 감소\n S.M.A.R.T. 온도 감소\n \n *내부 테스트 기준입니다. 실제 성능은 다를 수 있습니다.',
    '초고속 응답 블레이징 스피드\n 최대 2100K IOPS*의 4K 랜덤 읽기로 시스템 응답 시간과 애플리케이션 로딩 시간을 크게 단축하고, 특히 멀티태스킹 및 비디오 편집 효율을 향상시켜 게이머에게 더 원활한 경험을 제공합니다.\n \n *속도는 내부 테스트 기준입니다. 실제 성능은 다를 수 있습니다.',
    '최첨단 경험\n DRAM 캐시와 SLC 다이내믹 캐시는 데이터 전송 속도를 크게 향상시켜 대기 시간을 줄이고 시스템 응답성을 개선합니다.\n \n DRAM 용량',
    '최대 4TB\n \n 1TB/2TB/4TB 스토리지 옵션을 제공합니다. OS, 대형 게임 및 UHD/8K 미디어 스토리지 요구를 쉽게 처리하여 AIPC 시대의 SSD 용리에 대한 높은 수요를 충족합니다.\n \n 고품질 칩은 충분한 스토리지 설계를 보장하여 게이머에게 더 많은 공간을 제공합니다.\n 실제 사용 가능 용량\n 비전체 용량 4TB SSD\n NM1090 PRO 4TB\n \n *내부 테스트 기준입니다. 실제 성능은 다를 수 있습니다.',
    'Microsoft DirectStorage 호환 \n Microsoft DirectStorage3를 활용하도록 구축되어 게임 로드를 크게 향상시키고, 지연을 최소화하며, CPU 전력을 절약하고 게이밍 경험을 풍부하게 합니다.',
    '궁극의 성능 해방\n 최신 AMD 및 Intel CPU와 PCIe 5.0 마더보드와 결합하여 궁극의 성능을 위한 완벽한 매치를 달성합니다. PCIe 3.0 및 PCIe 4.0 시스템과도 하위 호환되어 광범위한 적용성을 보장합니다.',
    'Lexar DiskMaster\n 펌웨어 업그레이드\n 상태 모니터링\n 성능 최적화\n 데이터 보안',
    '게이밍 파워 해방\n Microsoft DirectStorage 기술 지원으로 게임 로드 시간을 크게 단축합니다.',
    '새로운 크리에이티브 경험\n 렌더링 속도를 높여 아이디어를 즉시 현실로 전환합니다.',
    'AIPC를 위한 궁극의 성능\n 뛰어난 성능과 광대한 용량으로 AIPC의 하이엔드 요구를 충족합니다.',
    '5년 서비스',
  ],
  'pl': [
    'Wydajność na wyższym poziomie\n Dysk Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    'Pamięć podręczna DRAM Dynamiczna pamięć podręczna SLC\n \n Losowa prędkość odczytu 4K do 2,1 mln IOPS\n \n Gen5 SSD\n \n Przyspiesz czasy ładowania nawet o 200%\n \n Do 4 TB\n \n Kontroler 6nm odporny na ciepło\n \n Łatwe zarządzanie dyskiem z Lexar DiskMaster\n \n 5-letni serwis',
    'Przyspiesz czasy ładowania nawet o 200%*\n Doświadcz niesamowitych prędkości odczytu/zapisu nawet do 14 000 / 13 000 MB/s* dzięki połączeniu technologii PCIe 5.0 z 232-warstwowym układem 3D TLC NAND najnowszej generacji.\n \n \n *Prędkości uzyskane w testach wewnętrznych. Rzeczywiste osiągi mogą być inne.',
    'Niezrównany partner AMD\n NM1090 PRO doskonale nadaje się do użytku z procesorami AMD Ryzen serii 9000. Oprócz niesamowitej wydajności przechowywania i niezrównanych osiągów komputera zapewnia szybkie ładowanie gier i płynną pracę sprzętu. To idealny wybór dla użytkowników pragnących doświadczyć rozgrywek na pełnych obrotach.',
    'Kontroler 6nm odporny na ciepło\n \n Zapewnia zaawansowane osiągi, a przy tym lepsze zarządzanie energią. Temperatura kontrolera jest niższa o 38%*, aby dysk pozostawał chłodny nawet w trakcie intensywnej pracy, zapewniając płynniejszą wydajność.\n \n \n O 30 minut dłuższa praca wbudowanego narzędzia testującego\n Porównanie temperatury z innymi SSD 5. generacji\n \n Niższa temperatura kontrolera\n Niższa temperatura dzięki technologii S.M.A.R.T.\n \n * Na podstawie testów wewnętrznych. Rzeczywiste osiągi mogą być inne.',
    'Niesamowicie szybki czas reakcji\n Losowa prędkość odczytu 4K do 2,1 mln IOPS* znacznie przyspiesza czas reakcji systemu i czas ładowania aplikacji, co przekłada się przede wszystkim na poprawę efektywności podczas wykonywania wielu zadań naraz oraz edycji materiałów wideo, aby gracze mogli cieszyć się bardziej komfortowym doświadczeniem.\n \n * Prędkości uzyskane w testach wewnętrznych. Rzeczywiste osiągi mogą być inne.',
    'Supernowoczesne doświadczenie\n Pamięć podręczna DRAM i dynamiczna pamięć podręczna SLC znacznie przyspieszają tempo przesyłu danych, ograniczając czas oczekiwania i poprawiając szybkość reakcji systemu.\n \n Pojemność DRAM',
    'Do 4 TB\n \n Opcje pojemności 1 TB / 2 TB / 4 TB Łatwa obsługa systemów operacyjnych i dużych gier, możliwość przechowywania mediów w jakości UHD/8K, wychodząc naprzeciw wysokiemu zapotrzebowaniu na pojemność SSD w erze AIPC.\n \n Wysokiej jakości chipy zapewniają konstrukcję oferującą dużą pojemność, wychodząc naprzeciw potrzebom graczy\n Faktyczna pojemność użytkowa\n SSD o pojemności użytkowej sięgającej niespełna 4 TB\n NM1090 PRO 4TB\n \n * Na podstawie testów wewnętrznych. Rzeczywiste osiągi mogą być inne.',
    'Kompatybilny z Microsoft DirectStorage \n Stworzony w celu wykorzystania rozwiązania Microsoft DirectStorage3, aby znacząco przyspieszyć ładowanie gier, zminimalizować opóźnienia, oszczędzać moc procesora i zapewnić bogatsze doświadczenia podczas gier.',
    'Uwolnij potencjał maksymalnej wydajności\n W parze z najnowszymi procesorami AMD i Intel oraz płytami głównymi PCIe 5.0 zapewnia wszystko, co niezbędne, by cieszyć się maksymalną wydajnością. Umożliwia również kompatybilność wsteczną z systemami PCIe 3.0 i PCIe 4.0, zwiększając wachlarz możliwych zastosowań.',
    'Lexar DiskMaster\n Uaktualnianie oprogramowania sprzętowego\n Monitorowanie stanu\n Optymalizacja działania\n Bezpieczeństwo danych',
    'Uwolnij nowe moce w grach\n Obsługa technologii Microsoft DirectStorage znacząco skraca czas wczytywania gier.',
    'Nowe doświadczenie w kreatywności\n Przyspieszenie prędkości renderowania – pomysły natychmiast zmieniają się w rzeczywistość.',
    'Wyjątkowa wydajność dla AIPC\n Spełnione najwyższe wymagania dotyczące AIPC z wyjątkową wydajnością i oszczędnością pojemności.',
    '5-letni serwis',
  ],
  'vi': [
    'Hiệu Năng ở Tầm Cao Mới\n Ổ Cứng SSD Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280',
    'Bộ Nhớ Đệm Động SLC kết hợp Bộ Nhớ Đệm DRAM\n \n Tốc Độ Đọc Ngẫu Nhiên 4K Lên tới 2100K IOPS\n \n Ổ Cứng SSD Gen5\n \n Tăng Tốc Thời Gian Tải up tới 200%\n \n Lên tới 4TB\n \n Bộ Điều Khiển 6nm Chịu Nhiệt\n \n Quản Lý Ổ Cứng Dễ Dàng với Lexar DiskMaster\n \n Bảo Hành 5 Năm',
    'Tăng Tốc Thời Gian Tải lên tới 200%*\n Trải nghiệm tốc độ đọc/ghi thần tốc lên tới 14.000/13.000MB/giây* nhờ sự kết hợp giữa công nghệ PCIe 5.0 và NAND TLC 3D 232 lớp thế hệ tiếp theo.\n \n \n * Tốc độ dựa trên kết quả thử nghiệm. Hiệu năng thực tế có thể khác biệt.',
    'Đối Tác AMD Vượt Trội\n NM1090 PRO là mảnh ghép hoàn hảo dành cho các CPU dòng AMD Ryzen 9000. Sản phẩm không chỉ cung cấp hiệu suất lưu trữ và điện toán cực cao mà còn đảm bảo quá trình tải game nhanh chóng và vận hành trơn tru. Đây là lựa chọn lý tưởng cho những người dùng muốn tận hưởng trải nghiệm chơi game hiệu suất cao.',
    'Bộ Điều Khiển 6nm Chịu Nhiệt\n \n Cung cấp hiệu suất tiên tiến đồng thời nâng cao khả năng quản lý điện năng. Nhiệt độ của bộ điều khiển được giảm đi 38%*, giúp đảm bảo ổ cứng luôn mát ngay cả khi hoạt động với hiệu năng cao và cung cấp trải nghiệm hiệu suất mượt mà hơn.\n \n \n BIT Chạy 30 Phút Sau Đó\n So Sánh Nhiệt Độ với Các Ổ Cứng SSD Gen 5 Khác\n \n Giảm Nhiệt Độ Bộ Điều Khiển\n Giảm Nhiệt Độ S.M.A.R.T.\n \n * Dựa trên kết quả kiểm thử của chúng tôi. Hiệu năng thực tế có thể khác biệt.',
    'Tốc Độ Phản Hồi Chớp Nhoáng\n Tốc độ Đọc Ngẫu Nhiên 4K Lên tới 2100K IOPS*, giúp tăng tốc đáng kể thời gian phản hồi và tải ứng dụng của hệ thống, đặc biệt nâng cao hiệu quả khi thực hiện đa tác vụ và chỉnh sửa video, mang đến cho game thủ trải nghiệm mượt mà hơn.\n \n * Tốc độ dựa trên kết quả kiểm thử của chúng tôi. Hiệu năng thực tế có thể khác biệt.',
    'Trải Nghiệm Tối Tân\n Bộ Nhớ Đệm DRAM và Bộ Nhớ Đệm Động SLC tăng cường mạnh mẽ tốc độ truyền dữ liệu để giảm thời gian chờ và cải thiện phản hồi của hệ thống.\n \n Dung Lượng Dram',
    'Lên tới 4TB\n \n Cung cấp tùy chọn lưu trữ 1TB/2TB/4TB. Dễ dàng xử lý OS, những tựa game đồ sộ và nhu cầu lưu trữ phương tiện UHD/8K, giúp đáp ứng nhu cầu cao về dung lượng SSD trong kỷ nguyên AIPC.\n \n Chip chất lượng cao đảm bảo thiết kế lưu trữ rộng lớn, giúp game thủ có nhiều dung lượng hơn\n Dung lượng sử dụng thực tế\n Ổ cứng SSD 4TB không đầy dung lượng\n NM1090 PRO 4TB\n \n * Dựa trên kết quả kiểm thử của chúng tôi. Hiệu năng thực tế có thể khác biệt.',
    'Tương thích với Microsoft DirectStorage \n Được thiết kế để tận dụng Microsoft DirectStorage3 và cải thiện đáng kể tốc độ tải game, giảm thiểu độ trễ, tiết kiệm điện năng CPU và tăng cường trải nghiệm chơi game.',
    'Giải phóng hiệu suất tối ưu\n Kết hợp với các CPU AMD và Intel mới nhất cùng bo mạch chủ PCIe 5.0, sản phẩm này trở thành mảnh ghép hoàn hảo để giúp bạn đạt được hiệu suất tối ưu. Sản phẩm còn tương thích ngược với các hệ thống PCIe 3.0 và PCIe 4.0 để đảm bảo khả năng ứng dụng rộng rãi.',
    'Lexar DiskMaster\n Nâng cấp phần sụn\n Theo dõi sức khỏe\n Tối ưu hóa hiệu năng\n Bảo mật dữ liệu',
    'Giải Phóng Năng Lực Chơi Game\n Hỗ trợ công nghệ Microsoft DirectStorage giúp giảm đáng kể thời gian tải game.',
    'Khai Phá Trải Nghiệm Sáng Tạo Mới\n Tăng tốc độ kết xuất, chuyển đổi tức thì ý tưởng thành hiện thực.',
    'Hiệu Suất Tối Ưu cho AIPC\n Đáp ứng nhu cầu cao của AIPC với hiệu suất đặc biệt và dung lượng lớn.',
    'Bảo Hành 5 Năm',
  ],
  'nl': [
    'Prestaties op een ongekend niveau\n Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    'DRAM Cache SLC Dynamisch Cache\n \n 4K Random Read tot 2100K IOPS\n \n Gen5 SSD\n \n Versnelling van laadtijden tot 200%\n \n Tot 4 TB\n \n Hitte-bestendige 6 nm controller\n \n Lexar DiskMaster eenvoudig schijfbeheer\n \n 5 jaar service',
    'Versla de laadtijden tot 200%*\n Profiteer van ongekende lees-/schrijfsnelheden tot 14.000/13.000 MB/s* dankzij een combinatie van PCIe 5.0-technologie en next-gen 232-layer 3D TLC NAND.\n \n \n *Snelheden gebaseerd op interne tests. Daadwerkelijke prestaties kunnen variëren.',
    'Een ongeëvenaarde AMD-partner\n De NM1090 PRO is de perfecte match voor CPU\'s uit de AMD Ryzen 9000-serie. Hij levert niet alleen extreme opslag- en rekenprestaties, maar zorgt ook voor snel laden van games en een soepele werking. Het is de ideale keuze voor gebruikers die hoge eisen stellen aan hun game-ervaring.',
    'Hitte-bestendige 6 nm controller\n \n Het systeem levert geavanceerde prestaties en zorgt tegelijkertijd voor een beter energiebeheer. De temperatuur van de controller wordt met 38%* verlaagd, waardoor de harde schijf koel blijft tijdens intensief gebruik en soepelere prestaties levert.\n \n \n Ingebouwde test (BIT) loopt 30 minuten door\n Temperatuurvergelijking met andere Gen 5 SSD\'s\n \n Reductie temperatuur controller\n S.M.A.R.T. Temperatuurreductie\n \n * Gebaseerd op interne tests. Daadwerkelijke prestaties kunnen variëren.',
    'Ultrasnelle respons Ultrasnelheid\n 4K Random Reads tot 2100K IOPS*, versnelt de systeemrespons en laadtijden van applicaties aanzienlijk, verbetert met name de efficiëntie bij multitasking en videobewerking en biedt gamers een soepelere gebruikservaring.\n \n * Snelheden gebaseerd op interne tests. Daadwerkelijke prestaties kunnen variëren.',
    'Een state-of-the-art ervaring\n DRAM Cache en SLC Dynamic Cache verbeteren de gegevensoverdrachtsnelheden aanzienlijk om wachttijden te verminderen en de reactiesnelheid van het systeem te verbeteren.\n \n Dram-capaciteit',
    'Tot 4 TB\n \n Biedt opslagopties van 1 TB/2 TB/4 TB. Kan gemakkelijk omgaan met OS, grote games en UHD/8K media-opslagbehoeften, en voldoet aan de grote vraag naar SSD-capaciteit in het AIPC-tijdperk.\n \n Hoogwaardige chips zorgen voor een ruim opslagontwerp en bieden gamers meer ruimte\n Werkelijke bruikbare capaciteit\n Een SSD van 4 TB zonder volledige capaciteit\n NM1090 PRO 4TB\n \n * Gebaseerd op interne tests. Daadwerkelijke prestaties kunnen variëren.',
    'Compatibel met Microsoft DirectStorage \n Ontworpen om gebruik te maken van Microsoft DirectStorage3 en gamebelasting aanzienlijk te verhogen, vertragingen te minimaliseren, CPU-kracht te besparen en de game-ervaring te verrijken.',
    'Profiteer van ultieme prestaties\n Dit systeem, in combinatie met de nieuwste AMD en Intel CPU\'s en PCIe 5.0 moederborden, is de perfecte match voor ultieme prestaties. Het systeem is ook achterwaarts compatibel met PCIe 3.0 en PCIe 4.0 systemen om uitgebreide toepasbaarheid te garanderen.',
    'Lexar DiskMaster\n Firmware upgrades\n Health-monitoring\n Optimalisatie van prestaties\n Gegevensbeveiliging',
    'Ontketen de gaming power\n Ondersteuning voor Microsoft DirectStorage-technologie vermindert de laadtijd van games aanzienlijk.',
    'Nieuwe creatieve ervaring\n Verhoogt renderingsnelheden, waardoor ideeën direct werkelijkheid worden.',
    'Ultieme prestaties voor AIPC\n Voldoet aan de hoge eisen van AIPC met uitzonderlijke prestaties en een enorme capaciteit.',
    '5 jaar service',
  ],
  'sv': [
    'Prestanda för nästa nivå\n Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    'DRAM Cache SLC dynamisk cache\n \n 4K slumpmässig läsning upp till 2100K IOPS\n \n Gen5 SSD\n \n Påskynda laddningstiderna med upp till 200 %\n \n Upp till 4 TB\n \n Värmeavvisande 6 nm styrenhet\n \n Lexar DiskMaster Easy Drive Management\n \n 5 års service',
    'Påskynda laddningstiderna med upp till 200 %*\n Upplev supersnabba läs-/skrivhastigheter på upp till 14 000/13 000 Mb/s* tack vare en kombination av PCIe 5.0-teknik och nästa generations 232-lagers 3D TLC NAND.\n \n \n *Hastigheter baserade på interna tester. Faktisk prestanda kan variera.',
    'En oöverträffad AMD-partner\n NM1090 PRO är den perfekta partnern för AMD Ryzen 9000-seriens CPU:er. Den ger inte bara extrem lagring och datorprestanda utan garanterar även snabb spelinläsning och smidig drift. Det är det perfekta valet för användare som vill ha spelupplevelse med hög prestanda.',
    'Värmeavvisande 6 nm styrenhet\n \n Erbjuder avancerad prestanda och uppnår samtidigt bättre strömhantering. Styrenhetens temperatur sänks med 38 %*, vilket säkerställer att hårddisken förblir kall vid drift med hög belastning och ger en jämnare prestandaupplevelse.\n \n \n BIT körs i 30 minuter senare\n Temperaturjämförelse med andra Gen 5 SSD-enheter\n \n Temperatursänkning för styrenhet\n S.M.A.R.T. temperatursänkning\n \n * Baserat på interna tester. Faktisk prestanda kan variera.',
    'Ultrasnabb svarstid, blixtsnabb hastighet\n 4K slumpmässig läsning upp till 2100K IOPS*, påskyndar systemets svarstid och programladdningstider markant, förbättrar i synnerhet effektiviteten vid multitasking och videoredigering, och ger spelare en smidigare upplevelse.\n \n * Hastigheter baserade på interna tester. Faktisk prestanda kan variera.',
    'En toppmodern upplevelse\n DRAM cache och SLC dynamisk cache förbättrar dataöverföringshastigheterna avsevärt för att minska väntetiderna och förbättra systemets svarstider.\n \n DRAM-kapacitet',
    'Upp till 4 TB\n \n Erbjuder 1TB/2TB/4TB lagringsalternativ. Hanterar enkelt operativsystem, stora spel och UHD/8K-medialagringsbehov, vilket uppfyller den höga efterfrågan på SSD-kapacitet i AIPC-eran.\n \n Chips av hög kvalitet garanterar gott om lagringsdesign, vilket ger spelare mer utrymme\n Faktisk användbar kapacitet\n En icke-full kapacitet 4 TB SSD\n NM1090 PRO 4TB\n \n * Baserat på interna tester. Faktisk prestanda kan variera.',
    'Kompatibel med Microsoft DirectStorage \n Byggd för att använda Microsoft DirectStorage3 och avsevärt förbättra hämtningen av spel, minimera fördröjningar, spara CPU-kraft och berika spelupplevelsen.',
    'Frigör ultimat prestanda\n Tillsammans med de senaste AMD- och Intel-processorerna och PCIe 5.0-moderkort, är den den perfekta partnern för ultimat prestanda. Den är även bakåtkompatibel med PCIe 3.0- och PCIe 4.0-system för att säkerställa omfattande tillämpbarhet.',
    'Lexar DiskMaster\n Uppgraderingar av firmware\n Hälsokontroll\n Prestandaoptimering\n Datasäkerhet',
    'Släpp loss gamingkraften\n Stöd för Microsoft DirectStorage-teknik minskar spelets laddningstid avsevärt.',
    'Ny kreativ upplevelse\n Ökar återgivningshastigheten och förverkligar idéer direkt.',
    'Ultimat prestanda för AIPC\n Uppfyller AIPC:s avancerade krav med exceptionell prestanda och stor kapacitet.',
    '5 års service',
  ],
  'tr': [
    'Üst Seviye Performans\n Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    'DRAM Ön Bellek SLC Dinamik Ön Bellek\n \n 2100K IOPS\'e Varan 4K Rastgele Okuma\n \n Gen5 SSD\n \n Yükleme Sürelerini %200\'e Kadar Hızlandırın\n \n 4 TB\'ye varan kapasite\n \n Isıya Dayanıklı 6 nm Kontrolcü\n \n Lexar DiskMaster Kolay Sürücü Yönetimi\n \n 5 Yıl Servis',
    'Yükleme Sürelerini %200\'e Kadar Hızlandırın*\n PCIe 5.0 teknolojisi ve yeni nesil 232 katmanlı 3D TLC NAND\'ın bir araya gelmesi sayesinde yıldırım gibi 14.000 MB/s okuma ve 13.000 MB/s yazma hızlarını deneyimleyin.\n \n \n *Hızlar dâhili testlere göredir. Gerçek performans değişiklik gösterebilir.',
    'Benzersiz Bir AMD Ortağı\n NM1090 PRO, AMD Ryzen 9000 serisi işlemciler için biçilmiş kaftandır. Sadece üst düzey depolama ve programlama performansı sunmakla kalmaz, aynı zamanda hızlı oyun yükleme ve sorunsuz çalışma sağlar. Yüksek performanslı oyun deneyimi arayan kullanıcılar için ideal seçimdir.',
    'Isıya Dayanıklı 6 nm Kontrolcü\n \n İleri düzey performans sunarken daha iyi güç yönetimi de yapar. Kontrolcünün sıcaklığı %38* azalarak ağır yüklü çalışma sırasında sabit diski serin tutar ve daha sorunsuz bir performans deneyimi yaşatır.\n \n \n 30 Dakika Sonra BIT Çalışması\n Diğer Gen 5 SSD\'lere Göre Sıcaklık Karşılaştırması\n \n Kontrolcü Sıcaklığı Azalması\n S.M.A.R.T. Sıcaklık Azalması\n \n * Dâhili test sonuçlarına göre. Gerçek performans değişiklik gösterebilir.',
    'Ultra Hızlı Tepkiyle Baş Döndürücü Hız\n 2100K IOPS\'e* Varan 4K Rastgele Okumayla sistem tepkisi ve uygulama yükleme süreleri ciddi oranda hızlanır. Özellikle çoklu görevlerde ve video düzenlemede verimliliği geliştirir, oyunculara da daha sorunsuz deneyim sunar.\n \n * Hızlar dâhili testlere göredir. Gerçek performans değişiklik gösterebilir.',
    'Son Teknoloji Deneyim\n DRAM Ön Bellek ve SLC Dinamik Ön Bellek veri aktarma hızlarını büyük oranda artırarak bekleme sürelerini azaltır ve sistemin tepkisini iyileştirir.\n \n Dram Kapasitesi',
    '4 TB\'ye varan kapasite\n \n 1TB/2TB/4TB depolama seçenekleri sunar. İşletim sistemini, büyük boyutlu oyunları ve UHD/8K ortam dosyalarını kolayca saklayarak AIPC çağında SSD kapasitesine olan yüksek talebi karşılar.\n \n Yüksek kaliteli çipler, oyunculara daha fazla alan sunan geniş depolama tasarımı sağlar\n Gerçek kullanım kapasitesi\n Tam kapasite olmayan 4TB SSD\n NM1090 PRO 4TB\n \n * Dâhili test sonuçlarına göre. Gerçek performans değişiklik gösterebilir.',
    'Microsoft DirectStorage Uyumlu \n Microsoft DirectStorage3\'ten yararlanmak, oyun yüklemelerini hızlandırmak, gecikmeleri en aza indirmek, işlemci gücünü korumak ve oyun deneyimini zenginleştirmek için üretildi.',
    'Nihai performansı açığa çıkarın\n En yeni AMD ve Intel işlemciler ve PCIe 5.0 anakartlar ile birlikte kullanıldığında nihai performansı yaşamak için biçilmiş kaftan olur. Ayrıca geniş uygulanabilirliği sürdürmek için PCIe 3.0 ve PCIe 4.0 sistemlerle geriye dönük uyumludur.',
    'Lexar DiskMaster\n Bellenim güncellemeleri\n Sağlık takibi\n Performans optimizasyonu\n Veri güvenliği',
    'Oyun Gücünü Açığa Çıkarın\n Microsoft DirectStorage teknolojisi desteğiyle oyun yükleme sürelerini ciddi miktarda azaltır.',
    'Yeni Yaratıcı Deneyim\n Render hızlarını yükselterek fikirlerinizi anında gerçeğe çevirin.',
    'AIPC için Nihai Performans\n Sıra dışı performans ve geniş kapasiteyle AIPC\'in yüksek taleplerini karşılar.',
    '5 Yıl Servis',
  ],
  'ar': [
    'أداء يتجاوز التوقعات للوصول إلى المستوى التالي\n محرك الأقراص ذو الحالة الصلبة Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280',
    'ذاكرة التخزين المؤقت الديناميكي DRAM وSLC\n \n أداء عالي في القراءة العشوائية بدقة 4K: يصل إلى 2100 ألف عملية إدخال/إخراج في الثانية\n \n محرك الأقراص ذو الحالة الصلبة بتقنية الجيل الخامس\n \n تسريع أوقات التحميل بنسبة تصل إلى 200%\n \n حتى 4 تيرابايت\n \n تحكم حراري متطور بتقنية 6 نانومتر: يحافظ على الأداء حتى في الظروف القاسية\n \n برنامج Lexar DiskMaster: إدارة سهلة ومتكاملة لمحركات الأقراص\n \n خدمة لمدة 5 سنوات',
    'تسريع أوقات التحميل بنسبة تصل إلى 200%*\n استمتع بسرعات قراءة تصل إلى 14,000 ميجابايت/ثانية وسرعات كتابة تصل إلى 13,000 ميجابايت/ثانية*، وذلك بفضل دمج تقنية PCIe 5.0 مع تقنية 3D TLC NAND متعددة الطبقات (232 طبقة) من الجيل الجديد.\n \n \n *السرعات المذكورة تم اختبارها داخليًا من الشركة المُصنّعة. الأداء الفعلي قد يختلف عن الأداء المذكور أو المقارن به.',
    'الحل الأمثل لمعالجات AMD بلا منافس\n يُعد حل NM1090 PRO الخيار الأمثل لوحدات المعالجة المركزية من سلسلة AMD Ryzen 9000. لا يقدم أداءً فائقًا فحسب في التخزين والحوسبة، بل يضمن أيضًا تحميلًا سريعًا للألعاب وتشغيلًا سلسًا. إنه الخيار المثالي للمستخدمين الذين يبحثون عن تجربة ألعاب عالية الأداء.',
    'تحكم حراري متطور بتقنية 6 نانومتر: يحافظ على الأداء حتى في الظروف القاسية\n \n تقدم البطاقة أداءً متطورًا مع تحقيق إدارة طاقة أفضل في نفس الوقت. تم تخفيض درجة حرارة وحدة التحكم بنسبة 38%*، مما يضمن بقاء محرك الأقراص باردًا أثناء التشغيل تحت الأحمال العالية ويوفر تجربة أداء أكثر سلاسة.\n \n \n تشغيل BIT لمدة 30 دقيقة لاحقًا\n مقارنة درجات الحرارة مع محركات الأقراص ذات الحالة الصلبة من الجيل الخامس الأخرى\n \n تقليل درجة حرارة وحدة التحكم\n تقنية S.M.A.R.T (التقنية الذاتية للمراقبة والتحليل والإبلاغ) تقليل درجة الحرارة: أداء حراري محسّن\n \n *بناءً على الاختبارات الداخلية. الأداء الفعلي قد يختلف عن الأداء المذكور أو المقارن به.',
    'سرعة فائقة واستجابة خارقة\n قراءة عشوائية بدقة 4K تصل إلى 2100 ألف عملية إدخال/إخراج في الثانية*: تُسرع بشكل كبير من استجابة النظام وأوقات تحميل التطبيقات، مما يعزز الكفاءة في المهام المتعددة وتحرير الفيديو، وكذلك توفير تجربة ألعاب أكثر سلاسة.\n \n *السرعات المذكورة تم اختبارها داخليًا من الشركة المُصنّعة. الأداء الفعلي قد يختلف عن الأداء المذكور أو المقارن به.',
    'تجربة حديثة من الطراز الأول\n ذاكرة DRAM وذاكرة SLC الديناميكية: تعزز بشكل كبير سرعة نقل البيانات، مما يقلل أوقات الانتظار ويحسّن استجابة النظام.\n \n سعة ذاكرة الوصول العشوائي الديناميكية DRAM',
    'حتى 4 تيرابايت\n \n خيارات تخزين متنوعة: 1 تيرابايت / 2 تيرابايت / 4 تيرابايت. قدرة فائقة على التعامل مع: أنظمة التشغيل، والألعاب الكبيرة، وتخزين الوسائط بدقة UHD/8K، مما يلبي الطلب المتزايد على سعة محرك الأقراص ذو الحالة الصلبة في عصر تطبيقات الذكاء الاصطناعي والحوسبة عالية الأداء.\n \n شرائح عالية الجودة: تضمن تصميمًا سعويًا واسعًا، مما يوفر للاعبين مساحة تخزين أكبر\n السعة الفعلية القابلة للاستخدام\n محرك الأقراص ذو الحالة الصلبة 4 تيرابايت غير مكتمل السعة\n بطاقة ذاكرة NM1090 PRO سعة 4 تيرابايت\n \n *بناءً على الاختبارات الداخلية. الأداء الفعلي قد يختلف عن الأداء المذكور أو المقارن به.',
    'متوافقة مع تقنية Microsoft DirectStorage \n مصممة للاستفادة الكاملة من تقنية Microsoft DirectStorage3، مما يعزز بشكل كبير سرعة تحميل الألعاب، ويقلل من التأخير، ويحافظ على طاقة وحدة المعالجة المركزية، ويثري تجربة الألعاب بشكل عام.',
    'إطلاق العنان للأداء الأقصى\n عند استخدامها مع أحدث وحدات المعالجة المركزية من AMD وIntel واللوحات الأم التي تدعم تقنية PCIe 5.0، يحقق هذا المنتج التوافق المثالي للحصول على الأداء الفائق. كما أنها متوافقة مع أنظمة PCIe 3.0 وPCIe 4.0 لضمان شمولية التطبيق.',
    'Lexar DiskMaster\n ترقيات البرمجيات الثابتة\n مراقبة الصحة\n تحسين الأداء\n أمن البيانات',
    'أطلق العنان لقوة الألعاب\n تدعم تقنية Microsoft DirectStorage التي تقلل بشكل كبير من وقت تحميل الألعاب.',
    'تجربة إبداعية جديدة\n تعزز سرعات العرض، وتحول الأفكار إلى واقع على الفور.',
    'أداء فائق لتطبيقات الذكاء الاصطناعي والحوسبة عالية الأداء\n تلبي متطلبات تطبيقات الذكاء الاصطناعي والحوسبة عالية الأداء الراقية بأداء استثنائي وسعة تخزين هائلة.',
    'خدمة لمدة 5 سنوات',
  ],
  'zh-TW': [
    '效能再升級\n Lexar Professional NM1090 PRO PCIe 5.0 NVMe M.2 2280 SSD',
    'DRAM Cache SLC 動態快取\n \n 4K 隨機讀取速度高達 2100K IOPS\n \n 第五代 SSD\n \n 載入速度提升最多 200%\n \n 高達 4TB\n \n 耐熱 6 奈米控制器\n \n Lexar DiskMaster 輕鬆管理磁碟機\n \n 5 年保固',
    '載入速度提升最多 200%*\n 結合使用 PCIe 5.0 技術與新一代 232 層 3D TLC NAND，體驗高達 14,000/13,000MB/s* 的極快讀/寫速度。\n \n \n *速度係依據內部測試的結果。實際效能可能有所不同。',
    '無與倫比的 AMD 夥伴\n NM1090 PRO 能完美搭配 AMD Ryzen 9000 系列 CPU。不僅提供極致的儲存和運算效能，更確保快速載入遊戲和流暢運作。對追求高效能遊戲體驗的使用者來說，是最理想的選擇。',
    '耐熱 6 奈米控制器\n \n 提供進階效能，同時實現更高效的電源管理。控制器溫度降低 38%*，確保硬碟在高負載運轉時保持低溫，提供更流暢的效能體驗。\n \n \n BIT 延時運轉 30 分鐘\n 與其他第五代 SSD 的溫度比較\n \n 控制器降溫\n S.M.A.R.T. 降溫技術\n \n * 資料來源為 Lexar 品質實驗室，實際效能可能有所不同。',
    '超快回應速度\n 4K 隨機讀取高達 2100K IOPS*，大幅加快系統回應和應用程式載入速度，尤其提升多工和影片編輯的效率，為遊戲玩家提供更流暢的體驗。\n \n * 速度係依據內部測試的結果。實際效能可能有所不同。',
    '最先進的體驗\n DRAM 快取和 SLC 動態快取大幅提升資料傳輸速度，可縮短等待時間並改善系統回應能力。\n \n 動態容量',
    '高達 4TB\n \n 提供 1TB/2TB/4TB 儲存選項。輕鬆應對 OS、大型遊戲和 UHD/8K 媒體儲存需求，滿足 AI 電腦時代對 SSD 容量的高需求。\n \n 採用高品質晶片，確保大儲存容量設計，為遊戲玩家提供更多空間\n 實際可用容量\n 非全容量 4TB SSD\n NM1090 PRO 4TB\n \n * 資料來源為 Lexar 品質實驗室，實際效能可能有所不同。',
    '與 Microsoft DirectStorage 相容 \n 專門打造能運用 Microsoft DirectStorage3 並大幅提高遊戲負載、將延遲時間縮到最短，節省 CPU 功率，並提供豐富的遊戲體驗。',
    '釋放極致效能\n 搭配最新的 AMD 和 Intel CPU 及 PCIe 5.0 主機板，實現完美組合，達到極致效能。亦向下相容於 PCIe 3.0 和 PCIe 4.0 系統，確保廣泛的適用性。',
    'Lexar DiskMaster\n 韌體升級\n 健全度監控\n 效能最佳化\n 資料安全性',
    '釋放遊戲力量\n 支援 Microsoft DirectStorage 技術，可大幅縮短遊戲載入時間。',
    '全新創作體驗\n 大幅加快渲染速度，立即將想法化為真實。',
    '實現極致 AI 電腦效能\n 卓越效能和龐大容量，滿足 AI 電腦的高階需求。',
    '5 年保固',
  ],
}

// ============================================================
// 测试结果接口
// ============================================================

interface TestResult {
  lang: string
  success: boolean
  error?: string

  // 翻译层指标
  untranslatedAfterTranslation: number
  translationTimeMs: number

  // 校对层指标
  proofreadModifiedCount: number
  proofreadReasonDistribution: Record<string, number>
  proofreadTimeMs: number

  // 代码层回退
  scriptMismatchRollbacks: number
  crossPollutionRollbacks: number
  untranslatedRollbacks: number

  // 最终结果
  untranslatedAfterProofread: number
  finalTranslations: string[]
}

// ============================================================
// 测试函数
// ============================================================

async function testLanguage(lang: string): Promise<TestResult> {
  const glossaryMap = new Map<string, string>()
  const startTime = Date.now()

  try {
    console.log(`\n[${lang}] 开始测试...`)

    // 阶段1：翻译
    const translateStart = Date.now()
    const taskGlossaryHint = buildTaskGlossaryHint(glossaryMap, config.scenePreset, EN_TEXTS)
    const translatedResults = await translateBatch(
      EN_TEXTS,
      lang,
      glossaryMap,
      config,
      'en',
      undefined,
      undefined,
      undefined,
      taskGlossaryHint,
      false,
      false,
    )
    const translationTimeMs = Date.now() - translateStart

    // 阶段2：翻译后漏翻检测
    const untranslatedAfterTranslation = detectUntranslatedText(EN_TEXTS, translatedResults, lang, glossaryMap)

    console.log(`[${lang}] 翻译完成 (${translationTimeMs}ms), 漏翻: ${untranslatedAfterTranslation.size}/${EN_TEXTS.length}`)

    // 阶段3：校对（始终调用，不论是否有漏翻）
    const proofreadStart = Date.now()
    const proofreadItems = EN_TEXTS.map((sourceText, i) => ({
      sourceText,
      translatedText: translatedResults[i],
    }))

    const proofreadResults = await proofreadBatch(
      proofreadItems,
      lang,
      glossaryMap,
      config,
      undefined,
      undefined,
      taskGlossaryHint,
    )
    const proofreadTimeMs = Date.now() - proofreadStart

    // 统计校对修改
    let proofreadModifiedCount = 0
    const proofreadReasonDistribution: Record<string, number> = {}
    const finalTranslations = [...translatedResults]

    proofreadResults.forEach((result, i) => {
      if (result.text && result.text !== 'OK' && result.text !== translatedResults[i]) {
        proofreadModifiedCount++
        const reason = result.reason || 'unknown'
        proofreadReasonDistribution[reason] = (proofreadReasonDistribution[reason] || 0) + 1
        finalTranslations[i] = result.text
      }
    })

    console.log(`[${lang}] 校对完成 (${proofreadTimeMs}ms), 修改: ${proofreadModifiedCount}/${EN_TEXTS.length}`)
    if (proofreadModifiedCount > 0) {
      console.log(`[${lang}] 修改原因: ${JSON.stringify(proofreadReasonDistribution)}`)
    }

    // 阶段4：校对后漏翻检测
    const untranslatedAfterProofread = detectUntranslatedText(EN_TEXTS, finalTranslations, lang, glossaryMap)

    console.log(`[${lang}] 校对后漏翻: ${untranslatedAfterProofread.size}/${EN_TEXTS.length}`)

    return {
      lang,
      success: true,
      untranslatedAfterTranslation: untranslatedAfterTranslation.size,
      translationTimeMs,
      proofreadModifiedCount,
      proofreadReasonDistribution,
      proofreadTimeMs,
      scriptMismatchRollbacks: 0, // 这些需要从 proofreadBatch 内部日志获取
      crossPollutionRollbacks: 0,
      untranslatedRollbacks: 0,
      untranslatedAfterProofread: untranslatedAfterProofread.size,
      finalTranslations,
    }
  } catch (error) {
    return {
      lang,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      untranslatedAfterTranslation: 0,
      translationTimeMs: 0,
      proofreadModifiedCount: 0,
      proofreadReasonDistribution: {},
      proofreadTimeMs: 0,
      scriptMismatchRollbacks: 0,
      crossPollutionRollbacks: 0,
      untranslatedRollbacks: 0,
      untranslatedAfterProofread: 0,
      finalTranslations: [],
    }
  }
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  const args = process.argv.slice(2)
  const targetLang = args[0]

  const languages = targetLang ? [targetLang] : Object.keys(REF_TRANSLATIONS)

  console.log('═'.repeat(70))
  console.log('校对质量验证测试')
  console.log('═'.repeat(70))
  console.log(`测试语种: ${languages.join(', ')} (${languages.length} 种)`)
  console.log(`每种语种 ${EN_TEXTS.length} 条文本`)
  console.log('')

  const results: TestResult[] = []

  for (const lang of languages) {
    const result = await testLanguage(lang)
    results.push(result)

    // 延迟避免 API 限流
    if (lang !== languages[languages.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // 汇总报告
  console.log('\n' + '═'.repeat(70))
  console.log('汇总报告')
  console.log('═'.repeat(70))
  console.log('')

  console.log('| 语言 | 翻译漏翻 | 翻译耗时 | 校对修改 | 校对耗时 | 校对后漏翻 | 原因分布 |')
  console.log('|------|----------|----------|----------|----------|------------|----------|')

  let totalTranslationUntranslated = 0
  let totalProofreadModified = 0
  let totalProofreadAfterUntranslated = 0
  const allReasons: Record<string, number> = {}

  for (const r of results) {
    if (!r.success) {
      console.log(`| ${r.lang.padEnd(4)} | ❌ 失败: ${r.error?.slice(0, 30)} |`)
      continue
    }

    const reasons = Object.entries(r.proofreadReasonDistribution)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ') || '-'

    console.log(
      `| ${r.lang.padEnd(4)} | ${String(r.untranslatedAfterTranslation).padStart(8)} | ${String(r.translationTimeMs).padStart(8)}ms | ${String(r.proofreadModifiedCount).padStart(8)} | ${String(r.proofreadTimeMs).padStart(8)}ms | ${String(r.untranslatedAfterProofread).padStart(10)} | ${reasons} |`
    )

    totalTranslationUntranslated += r.untranslatedAfterTranslation
    totalProofreadModified += r.proofreadModifiedCount
    totalProofreadAfterUntranslated += r.untranslatedAfterProofread

    for (const [reason, count] of Object.entries(r.proofreadReasonDistribution)) {
      allReasons[reason] = (allReasons[reason] || 0) + count
    }
  }

  console.log('')
  console.log('═'.repeat(70))
  console.log('总计')
  console.log('═'.repeat(70))
  console.log(`翻译层漏翻总数: ${totalTranslationUntranslated}/${results.length * EN_TEXTS.length}`)
  console.log(`校对修改总数: ${totalProofreadModified}/${results.length * EN_TEXTS.length}`)
  console.log(`校对后漏翻总数: ${totalProofreadAfterUntranslated}/${results.length * EN_TEXTS.length}`)
  console.log('')
  console.log('校对原因分布:')
  for (const [reason, count] of Object.entries(allReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`)
  }

  // 计算校对净收益（简化版：校对后漏翻减少 = 正收益）
  const netBenefit = totalTranslationUntranslated - totalProofreadAfterUntranslated
  console.log('')
  console.log(`校对净收益（漏翻减少）: ${netBenefit}`)

  if (netBenefit > 0) {
    console.log('✅ 校对有效减少了漏翻')
  } else if (netBenefit === 0) {
    console.log('⚠️ 校对未改变漏翻数量')
  } else {
    console.log('❌ 校对反而增加了漏翻（可能是误改）')
  }
}

main().catch(console.error)
