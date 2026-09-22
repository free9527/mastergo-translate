/**
 * v12.24 说明书场景卡语体指令——改动方向快速验证（最小 API）
 *
 * 背景：es/ja 实机对照发现——插件敬体（usted/～してください），官方亲体/陈述体（tú/～します）。
 * 且现有场景卡 es 写「Manuals use Usted address」本身就是错误指引（官方是 tú）。
 * 本脚本用改动后的语体指令，对差异最大的条目重翻，验证是否贴近官方，再决定是否动生产代码。
 *
 * 用法：npx tsx tests/test-v1224-manual-register.ts
 */
import XMLHttpRequest from 'xhr2'
;(globalThis as any).XMLHttpRequest = XMLHttpRequest

const API_URL = 'https://aigo.lexar.com/v1/chat/completions'
const API_KEY = 'sk-LcscmmvLrVlwRbWtoPgF1jSNg6fzR7rgp2FX8pFaHreVYMyu'
const MODEL = 'gpt-5.5'

// ── 改动后的语体指令（候选）──
const ES_REGISTER = 'Spanish: Manuals use tú informal address (Conecta, Añade, Pulsa, prueba), NOT Usted (Conecte, Añada, Toque, pruebe) — consumer electronics manuals address the user informally.'
const JA_REGISTER = 'Japanese: Manuals use declarative ～します/～する form for steps and descriptions (電源アダプターを接続します); reserve 「～してください」 only for direct commands to the user.'

// ── 测试条目：es/ja 各选语体差异最大的 3 条 ──
const CASES: Array<{ lang: string; register: string; src: string; official: string }> = [
  // es（官方 tú 亲体）
  { lang: 'es', register: ES_REGISTER, src: 'Connect the power adapter.\nFollow the on-screen instructions to complete setup.\n\nThe frame turns on automatically when plugged in.', official: 'Conecta el adaptador de corriente.\nSigue las instrucciones en pantalla para completar la configuración.\n\nEl marco se enciende automáticamente al conectarlo.' },
  { lang: 'es', register: ES_REGISTER, src: '2. Add your frame', official: '2. Añadir el marco' },
  { lang: 'es', register: ES_REGISTER, src: '3. If your frame cannot connect to Wi-Fi, try the following:', official: '3. Si el marco no puede conectarse a Wi-Fi, prueba lo siguiente:' },
  // ja（官方陈述体为主）
  { lang: 'ja', register: JA_REGISTER, src: 'Connect the power adapter.\nFollow the on-screen instructions to complete setup.\n\nThe frame turns on automatically when plugged in.', official: '電源アダプターを接続します。\n画面の指示に従って設定を完了します。\n\n電源に接続すると、自動的に電源が入ります。' },
  { lang: 'ja', register: JA_REGISTER, src: 'Open the app and sign in or create an account.\nAdd your frame using the frame code.', official: 'アプリを開き、ログインするかアカウントを作成します。\nフレームコードを使用してフレームを追加します。' },
  { lang: 'ja', register: JA_REGISTER, src: 'You can send up to 10 photos at a time from the Frameo App.', official: 'Frameoアプリでは、一度に最大10枚の写真を送信できます。' },
]

function buildSystem(lang: string, register: string): string {
  const isZh = false
  const role = `[IDENTITY]\nYou translate Lexar product content. Your translations read as if originally written in the target language by a native speaker.`
  const principles = `[CORE PRINCIPLES]\n1. TRANSLATE ALL MEANING.\n2. FAITHFUL TO SOURCE — No additions, no omissions. Numbers/placeholders preserved.\n3. NATURAL EXPRESSION — Sound like a native speaker.`
  const scene = `\n[SCENE·operation_guide]\nSuccess: A first-time user completes each operation correctly without guessing or re-reading\nFormat: Operation steps must correspond 1:1 strictly, no merging or splitting\n${register}`
  const output = `\n[OUTPUT]\nOutput ONLY a valid JSON object: {"translations":[{"i":<1-based index>,"text":"<translation>"}]}\n⛔ The ↵ symbol is a LITERAL CHARACTER — output it as the characters "↵" inside text strings (do NOT convert to real newlines).\n→ Output translations now:`
  return `${role}\n\n${principles}\n\n[MISSION·${lang}]${scene}${output}`
}

async function callApi(system: string, user: string): Promise<string> {
  const body = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.1, response_format: { type: 'json_object' } }
  const resText = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', API_URL, true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${API_KEY}`)
    xhr.timeout = 60000
    xhr.onload = () => resolve(xhr.responseText)
    xhr.onerror = () => reject(new Error('network'))
    xhr.ontimeout = () => reject(new Error('timeout'))
    xhr.send(JSON.stringify(body))
  })
  const data = JSON.parse(resText)
  if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 200))
  const content = data.choices?.[0]?.message?.content || ''
  const m = content.match(/\{[\s\S]*"translations"[\s\S]*\}/)
  try {
    const obj = JSON.parse(m ? m[0] : content)
    return obj.translations?.[0]?.text || '(空)'
  } catch { return content.slice(0, 200) }
}

async function main() {
  console.log('=== v12.24 语体指令验证（改动后指令 → 是否贴官方）===\n')
  let pass = 0, total = 0
  for (const c of CASES) {
    total++
    const system = buildSystem(c.lang, c.register)
    const srcFlat = c.src.replace(/\n/g, ' ↵ ')
    const user = `[1] (en→${c.lang}) "${srcFlat}"`
    process.stdout.write(`[${c.lang}] "${c.src.split('\n')[0].slice(0, 40)}..." `)
    try {
      const out = (await callApi(system, user)).replace(/ ↵ /g, '\n').replace(/↵/g, '\n')
      console.log('✓')
      console.log(`  官方: ${c.official.replace(/\n/g, ' / ')}`)
      console.log(`  产出: ${out.replace(/\n/g, ' / ')}`)
      // 语体粗判
      const low = out.toLowerCase()
      let ok = true
      if (c.lang === 'es') {
        const hasUsted = /conecte\b|añada\b|siga\b|toque\b|pruebe\b|comparta\b|abra\b/.test(low)
        const hasTu = /conecta\b|añade\b|sigue\b|pulsa\b|prueba\b|abre\b|comparte\b/.test(low)
        ok = hasTu && !hasUsted
        console.log(`  语体判定: ${ok ? '✅ tú 亲体' : '❌ 仍含 usted 敬体'}`)
      } else {
        const hasKudasai = /してください/.test(out)
        const hasDeclarative = /します|する\b/.test(out)
        ok = !hasKudasai || hasDeclarative
        console.log(`  语体判定: ${!hasKudasai ? '✅ 无～してください(陈述体)' : hasDeclarative ? '◐ 混合' : '❌ 仍～してください'}`)
      }
      if (ok) pass++
      console.log()
    } catch (e) {
      console.log(`失败: ${e instanceof Error ? e.message : e}\n`)
    }
  }
  console.log(`=== 语体贴近判定: ${pass}/${total} ===`)
  console.log(pass >= total * 0.7 ? '✅ 语体指令方向正确，可动生产代码' : '⚠️ 指令措辞需再调整')
}
main().catch(e => { console.error('⛔', e); process.exit(1) })
