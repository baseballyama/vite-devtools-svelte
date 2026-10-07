/**
 * Tiny line-oriented syntax highlighter for Svelte source and compiled JS.
 * Output is escaped HTML with `hl-*` classes (styled in CodePane).
 */
type Tok = { t: string; c?: string }

const JS_KW = new Set(
  'const,let,var,function,return,if,else,for,while,do,switch,case,break,continue,new,this,typeof,instanceof,void,delete,throw,try,catch,finally,class,extends,super,import,export,from,default,async,await,yield,of,in'.split(
    ',',
  ),
)
const JS_LIT = new Set('true,false,null,undefined,NaN,Infinity'.split(','))
const RUNES = new Set(['$state', '$derived', '$effect', '$props', '$inspect', '$bindable', '$host'])

function esc(s: string) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * What an unterminated construct leaves open at the end of a line: block
 * comments and template literals continue on the next one (JSDoc blocks,
 * multi-line templates in compiled output).
 */
type JSState = 'code' | 'comment' | 'template'

/** Index after the closing backtick of a template literal, or -1 if it runs past the line. */
function templateEnd(code: string, from: number): number {
  for (let j = from; j < code.length; j++) {
    if (code[j] === '\\') j++
    else if (code[j] === '`') return j + 1
  }
  return -1
}

function tokJS(code: string, state: { s: JSState }): Tok[] {
  const toks: Tok[] = []
  let i = 0
  if (state.s === 'comment') {
    const end = code.indexOf('*/')
    if (end === -1) return [{ t: code, c: 'hl-cm' }]
    toks.push({ t: code.slice(0, end + 2), c: 'hl-cm' })
    i = end + 2
    state.s = 'code'
  } else if (state.s === 'template') {
    const end = templateEnd(code, 0)
    if (end === -1) return [{ t: code, c: 'hl-st' }]
    toks.push({ t: code.slice(0, end), c: 'hl-st' })
    i = end
    state.s = 'code'
  }
  while (i < code.length) {
    const ch = code.charAt(i)
    if (/\s/.test(ch)) {
      let j = i
      while (j < code.length && /\s/.test(code.charAt(j))) j++
      toks.push({ t: code.slice(i, j) })
      i = j
      continue
    }
    if (ch === '/' && code[i + 1] === '/') {
      toks.push({ t: code.slice(i), c: 'hl-cm' })
      break
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end === -1) {
        toks.push({ t: code.slice(i), c: 'hl-cm' })
        state.s = 'comment'
        break
      }
      toks.push({ t: code.slice(i, end + 2), c: 'hl-cm' })
      i = end + 2
      continue
    }
    if (ch === '`') {
      const end = templateEnd(code, i + 1)
      if (end === -1) {
        toks.push({ t: code.slice(i), c: 'hl-st' })
        state.s = 'template'
        break
      }
      toks.push({ t: code.slice(i, end), c: 'hl-st' })
      i = end
      continue
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < code.length && code[j] !== ch) {
        if (code[j] === '\\') j++
        j++
      }
      toks.push({ t: code.slice(i, j + 1), c: 'hl-st' })
      i = j + 1
      continue
    }
    if (/\d/.test(ch) && (i === 0 || !/\w/.test(code.charAt(i - 1)))) {
      let j = i
      while (j < code.length && /[\d.e_]/.test(code.charAt(j))) j++
      toks.push({ t: code.slice(i, j), c: 'hl-nm' })
      i = j
      continue
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i
      while (j < code.length && /[\w$.]/.test(code.charAt(j))) j++
      const w = code.slice(i, j)
      let c: string | undefined
      if (w.startsWith('$.') || RUNES.has(w.split('.')[0]!)) c = 'hl-sv'
      else if (JS_KW.has(w)) c = 'hl-kw'
      else if (JS_LIT.has(w)) c = 'hl-lt'
      else if (code[j] === '(') c = 'hl-fn'
      toks.push({ t: w, c })
      i = j
      continue
    }
    toks.push({ t: ch })
    i++
  }
  return toks
}

/**
 * Index of the `>` closing the tag that opens at `from` (or the line end).
 * A `>` inside a quoted value or a `{…}` expression does not close it:
 * `onclick={() => n++}` and `class:on={n > 0}` are one tag.
 */
function tagEnd(code: string, from: number): number {
  let depth = 0
  let quote = ''
  let j = from
  for (; j < code.length; j++) {
    const c = code[j]
    if (quote) {
      if (c === quote) quote = ''
    } else if (depth > 0) {
      if (c === '{') depth++
      else if (c === '}') depth--
    } else if (c === '{') depth++
    else if (c === '"' || c === "'") quote = c
    else if (c === '>') break
  }
  return j
}

function tokHTML(code: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < code.length) {
    if (code[i] === '<') {
      const j = tagEnd(code, i)
      const tag = code.slice(i, j + 1)
      const m = tag.match(/^(<\/?[\w:-]+)/)
      if (!m) {
        toks.push({ t: tag, c: 'hl-tg' })
        i = j + 1
        continue
      }
      const head = m[1]!
      toks.push({ t: head, c: 'hl-tg' })
      let rest = tag.slice(head.length)
      while (rest.length > 0) {
        const am = rest.match(/^(\s+)([\w:|-]+)(=)/)
        if (am) {
          toks.push({ t: am[1]! }, { t: am[2]!, c: 'hl-at' }, { t: '=' })
          rest = rest.slice(am[0].length)
          if (rest[0] === '"' || rest[0] === "'") {
            const q = rest[0]
            let k = 1
            while (k < rest.length && rest[k] !== q) k++
            toks.push({ t: rest.slice(0, k + 1), c: 'hl-st' })
            rest = rest.slice(k + 1)
          } else if (rest[0] === '{') {
            let k = 1
            let d = 1
            while (k < rest.length && d > 0) {
              if (rest[k] === '{') d++
              if (rest[k] === '}') d--
              k++
            }
            toks.push({ t: rest.slice(0, k), c: 'hl-ex' })
            rest = rest.slice(k)
          }
          continue
        }
        const bm = rest.match(/^(\s+)([\w:|-]+)/)
        if (bm) {
          toks.push({ t: bm[1]! }, { t: bm[2]!, c: 'hl-at' })
          rest = rest.slice(bm[0].length)
        } else {
          toks.push({
            t: rest.charAt(0),
            c: rest[0] === '>' || rest[0] === '/' ? 'hl-tg' : undefined,
          })
          rest = rest.slice(1)
        }
      }
      i = j + 1
      continue
    }
    if (code[i] === '{') {
      let j = i + 1
      let d = 1
      while (j < code.length && d > 0) {
        if (code[j] === '{') d++
        if (code[j] === '}') d--
        j++
      }
      toks.push({ t: code.slice(i, j), c: 'hl-ex' })
      i = j
      continue
    }
    let j = i
    while (j < code.length && code[j] !== '<' && code[j] !== '{') j++
    toks.push({ t: code.slice(i, Math.max(j, i + 1)) })
    i = Math.max(j, i + 1)
  }
  return toks
}

function tokCSS(code: string): Tok[] {
  const tr = code.trimStart()
  const ind = code.slice(0, code.length - tr.length)
  const pm = tr.match(/^([\w-]+)(\s*:\s*)(.+?)(;?\s*)$/)
  if (pm)
    return [
      { t: ind },
      { t: pm[1]!, c: 'hl-cp' },
      { t: pm[2]! },
      { t: pm[3]!, c: 'hl-cv' },
      { t: pm[4]! },
    ]
  // Trailing whitespace stays in the `{` token: dropping it lost source text.
  const sm = tr.match(/^([^{]+?)(\s*\{\s*)$/)
  if (sm) return [{ t: ind }, { t: sm[1]!, c: 'hl-cs' }, { t: sm[2]! }]
  return [{ t: code }]
}

function render(toks: Tok[]): string {
  let out = ''
  for (const t of toks) out += t.c ? `<span class="${t.c}">${esc(t.t)}</span>` : esc(t.t)
  return out
}

/** Highlight a .svelte file line by line, tracking <script>/<style> blocks. */
export function highlightSvelte(lines: string[]): string[] {
  let sec: 'template' | 'script' | 'style' = 'template'
  const js = { s: 'code' as JSState }
  return lines.map(line => {
    const tr = line.trim()
    if (tr.startsWith('<script')) {
      if (!tr.includes('</script>')) sec = 'script'
      js.s = 'code'
      return render(tokHTML(line))
    }
    if (tr.startsWith('</script')) {
      sec = 'template'
      return render(tokHTML(line))
    }
    if (tr.startsWith('<style')) {
      if (!tr.includes('</style>')) sec = 'style'
      return render(tokHTML(line))
    }
    if (tr.startsWith('</style')) {
      sec = 'template'
      return render(tokHTML(line))
    }
    if (sec === 'script') return render(tokJS(line, js))
    if (sec === 'style') return render(tokCSS(line))
    return render(tokHTML(line))
  })
}

export function highlightJS(lines: string[]): string[] {
  const js = { s: 'code' as JSState }
  return lines.map(l => render(tokJS(l, js)))
}
