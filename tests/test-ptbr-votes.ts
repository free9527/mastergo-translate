/**
 * 逐条投票细节：为什么 "Compatível com USB 3.2 Gen 2" 判成 en？
 */
import { detectSourceLanguage } from '../lib/llm-api'

// 从 llm-api.ts 复制的词表（仅用于调试）
const LATIN_DISTINCTIVE_WORDS: Record<string, Set<string>> = {
  en: new Set(['the', 'of', 'and', 'to', 'in', 'is', 'are', 'for', 'with', 'on', 'at', 'by', 'be', 'has', 'have', 'it', 'its', 'not', 'can', 'will', 'from', 'this', 'that', 'your', 'you', 'an', 'or', 'as', 'up', 'our', 'we']),
  pt: new Set(['é', 'são', 'tem', 'têm', 'sem', 'até', 'não', 'muito', 'um', 'uma', 'ao', 'à', 'do', 'da', 'na', 'no', 'estão', 'isso', 'contra', 'baixas', 'resistente', 'proteção']),
  es: new Set(['el', 'la', 'los', 'las', 'es', 'son', 'está', 'están', 'y', 'pero', 'muy', 'tiene', 'tienen', 'al', 'del', 'un', 'una', 'con', 'sin', 'hasta', 'ñandú']),
  de: new Set(['und', 'oder', 'mit', 'für', 'von', 'zu', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'nicht', 'auch', 'auf', 'bei', 'nach', 'über', 'wird', 'werden', 'kann', 'sich']),
  fr: new Set(['et', 'ou', 'mais', 'que', 'qui', 'dans', 'sur', 'avec', 'sans', 'pour', 'par', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'est', 'sont', 'ne', 'pas', 'plus', 'ce', 'cette']),
  it: new Set(['che', 'per', 'con', 'da', 'fra', 'tra', 'senza', 'su', 'il', 'lo', 'gli', 'le', 'un', 'uno', 'è', 'sono', 'ha', 'hanno', 'di', 'del', 'della', 'nel', 'alla', 'anche', 'più']),
  nl: new Set(['en', 'of', 'maar', 'met', 'voor', 'van', 'tot', 'op', 'bij', 'het', 'een', 'zijn', 'heeft', 'niet', 'aan', 'uit', 'om', 'ook', 'deze', 'dit', 'dat', 'wordt', 'tegen']),
}

const texts = [
  'Leituras rápidas, transferências velozes',
  'Design compacto e portátil',
  'Ideal para câmeras e drones',
  'Compatível com USB 3.2 Gen 2',
  'Desempenho extremo para criadores',
  'Alta velocidade para gamers',
  'Resistente a baixas temperaturas',
  'Proteção contra água e poeira',
]

for (const text of texts) {
  const joined = text.toLowerCase()
  const words = joined.split(/[\s,.;:!?()\[\]{}\-\/"'"'""«»]+/).filter(w => w.length >= 2)
  const votes: Record<string, number> = {}
  const hits: Record<string, string[]> = {}
  for (const w of words) {
    for (const [lang, dict] of Object.entries(LATIN_DISTINCTIVE_WORDS)) {
      if (dict.has(w)) {
        votes[lang] = (votes[lang] || 0) + 1
        hits[lang] = hits[lang] || []
        hits[lang].push(w)
      }
    }
  }
  const det = detectSourceLanguage([text])
  console.log(`\n"${text}" → ${det}`)
  console.log(`  words: [${words.join(', ')}]`)
  for (const [l, ws] of Object.entries(hits)) {
    console.log(`  ${l}: ${ws.length} [${ws.join(', ')}]`)
  }
}
