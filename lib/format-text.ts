export function formatCJKSpace(text: string, lang: string): string {
  if (!text) return text
  if (lang !== 'zh-CN' && lang !== 'zh-TW' && lang !== 'ja' && lang !== 'ko') return text

  // CJK 统一表意文字 + 日文假名 + 韩文谚文
  const CJK = '[一-鿿㐀-䶿ぁ-ゖァ-ヶ가-힣ㄱ-ㅎㅏ-ㅣ]'
  let result = text

  const unitPatterns = /(\d+)(%|°[CF]?|℃|℉|[GMK]?B|k?g|m?m|cm|km|px|em|rem|元|万|亿|倍|个|次|秒)/g
  const protected1: string[] = []
  result = result.replace(unitPatterns, function (m) {
    protected1.push(m)
    return '\x00U' + (protected1.length - 1) + '\x00'
  })

  result = result.replace(new RegExp('(' + CJK + ')([a-zA-Z0-9])', 'g'), '$1 $2')
  result = result.replace(new RegExp('([a-zA-Z0-9])(' + CJK + ')', 'g'), '$1 $2')

  result = result.replace(/\x00U(\d+)\x00/g, function (_m, idx) {
    return protected1[parseInt(idx)]
  })

  result = result.replace(
    new RegExp('(' + CJK + ')[ ]*([,;:?!])[ ]*(' + CJK + ')', 'g'),
    function (_m: string, before: string, punct: string, after: string) {
      const map: Record<string, string> = { ',': '，', ';': '；', ':': '：', '?': '？', '!': '！' }
      return before + (map[punct] || punct) + after
    })
  result = result.replace(
    new RegExp('(' + CJK + ')[ ]*\\.(?![a-zA-Z])[ ]*(' + CJK + ')?', 'g'),
    function (_m: string, before: string, after: string | undefined) {
      return before + '。' + (after || '')
    })
  result = result.replace(
    new RegExp('(' + CJK + ')[ ]*([,;:?!])(\\s|$)', 'g'),
    function (_m: string, before: string, punct: string, after: string) {
      const map: Record<string, string> = { ',': '，', ';': '；', ':': '：', '?': '？', '!': '！' }
      return before + (map[punct] || punct) + after
    })
  result = result.replace(new RegExp('(' + CJK + ')\\.(\\s|$)', 'g'), '$1。$2')
  result = result.replace(new RegExp('(' + CJK + ')[ ]*\\(', 'g'), '$1（')
  result = result.replace(new RegExp('\\)[ ]*(' + CJK + ')', 'g'), '）$1')
  result = result.replace(/[ ]*([，．；：！？（）、。])[ ]*/g, '$1')
  result = result.replace(/([。！？，；：])\1+/g, '$1')

  return result
}
