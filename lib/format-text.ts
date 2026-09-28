export function formatCJKSpace(text: string, lang: string): string {
  if (!text) return text
  if (lang !== 'zh-CN' && lang !== 'zh-TW' && lang !== 'ja' && lang !== 'ko') return text

  // CJK 统一表意文字 + 日文假名 + 韩文谚文
  const CJK = '[一-鿿㐀-䶿ぁ-ゖァ-ヶ가-힣ㄱ-ㅎㅏ-ㅣ]'
  let result = text

  // v12.37: 全角英数字 → 半角（ja 语言规则「英数字は半角、全角英数字厳禁」；
  //   LLM 偶发把 2000/Lexar 输出成全角 ２０００/Ｌｅｘａｒ，proofread 语义层接不住。
  //   纯形式信号零误判——全角英数字在 CJK 正式排版中本就该半角，无合法保留场景）。
  result = result.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  result = result.replace(/[Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))

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

  // v12.36: CJK 标点后的半角空格剥除（ja 实机事故——LLM 在句末/全角冒号/※ 后
  //   插入半角空格，ja 语言规则明确禁止「❌ 半角スペース」，proofread 语义层接不住
  //   这类纯形式问题，代码层零误判修复）。
  //   只剥「CJK 标点/记号之后紧跟的半角空格」，拉丁词间正常空格不碰（CJK 文本里
  //   拉丁词靠上面 CJK∥拉丁规则插空格，与标点无关，不受影响）。
  //   ① 句末终止标点（。！？…）后的半角空格
  result = result.replace(/([。！？…])[ ]+/g, '$1')
  //   ② 全角标点（：，、；）后的半角空格（如「対応デバイス：   iPhone」→「対応デバイス：iPhone」）
  result = result.replace(/([：，、；])[ ]+/g, '$1')
  //   ③ ※ 脚注记号后的半角空格（如「※ iCloud」→「※iCloud」）
  result = result.replace(/(※)[ ]+/g, '$1')

  return result
}
