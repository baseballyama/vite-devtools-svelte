<script lang="ts">
  import { onMount } from 'svelte'
  import type { InspectResult } from '../lib/types.js'
  import { getSvelteFiles, inspectFile } from '../lib/rpc.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import SearchInput from '../components/SearchInput.svelte'

  let files = $state<{ file: string; name: string }[]>([])
  let search = $state('')
  let selectedFile = $state<string | null>(null)
  let result = $state<InspectResult | null>(null)
  let loading = $state(false)

  let compiledToSource = $state<Map<number, Set<number>>>(new Map())
  let sourceToCompiled = $state<Map<number, Set<number>>>(new Map())
  let highlightedSourceLines = $state<Set<number>>(new Set())
  let highlightedCompiledLines = $state<Set<number>>(new Set())
  let activePanel = $state<'source' | 'compiled' | null>(null)

  const LINE_HEIGHT = 17.6
  let sourceScrollEl = $state<HTMLElement | null>(null)
  let compiledScrollEl = $state<HTMLElement | null>(null)
  let gutterHeight = $state(600)
  let sourceScrollTop = $state(0)
  let compiledScrollTop = $state(0)

  const connectionLines = $derived.by(() => {
    if (highlightedSourceLines.size === 0 && highlightedCompiledLines.size === 0) return []
    if (activePanel === 'compiled') {
      const r: Array<{ sy: number; cy: number }> = []
      for (const cl of highlightedCompiledLines) {
        const mapped = compiledToSource.get(cl)
        if (!mapped) continue
        for (const sl of mapped) r.push({ sy: (sl - 0.5) * LINE_HEIGHT - sourceScrollTop, cy: (cl - 0.5) * LINE_HEIGHT - compiledScrollTop })
      }
      return r
    }
    const r: Array<{ sy: number; cy: number }> = []
    for (const sl of highlightedSourceLines) {
      const mapped = sourceToCompiled.get(sl)
      if (!mapped) continue
      for (const cl of mapped) r.push({ sy: (sl - 0.5) * LINE_HEIGHT - sourceScrollTop, cy: (cl - 0.5) * LINE_HEIGHT - compiledScrollTop })
    }
    return r
  })

  function onSourceScroll(e: Event) { sourceScrollTop = (e.target as HTMLElement).scrollTop }
  function onCompiledScroll(e: Event) { compiledScrollTop = (e.target as HTMLElement).scrollTop }
  function updateGutterHeight() { if (sourceScrollEl) gutterHeight = sourceScrollEl.clientHeight }

  const filtered = $derived(
    search ? files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()) || f.file.toLowerCase().includes(search.toLowerCase())) : files
  )

  // --- VLQ Source Map Decoder ---
  const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const charToInt = new Map<string, number>()
  for (let i = 0; i < VLQ_CHARS.length; i++) charToInt.set(VLQ_CHARS[i], i)

  function decodeVLQ(encoded: string): number[] {
    const out: number[] = []; let shift = 0, value = 0
    for (const c of encoded) {
      const digit = charToInt.get(c); if (digit === undefined) continue
      value += (digit & 31) << shift
      if (digit & 32) { shift += 5 } else { out.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0 }
    }
    return out
  }

  function parseMappings(mappings: string) {
    const c2s = new Map<number, Set<number>>(), s2c = new Map<number, Set<number>>()
    let sfi = 0, sl = 0, sc = 0, ni = 0
    for (let gl = 0; gl < mappings.split(';').length; gl++) {
      const line = mappings.split(';')[gl]; if (!line) continue; let gc = 0
      for (const seg of line.split(',')) {
        const d = decodeVLQ(seg); if (!d.length) continue; gc += d[0]
        if (d.length >= 4) { sfi += d[1]; sl += d[2]; sc += d[3]; if (d.length >= 5) ni += d[4]
          const g = gl + 1, s = sl + 1
          if (!c2s.has(g)) c2s.set(g, new Set()); c2s.get(g)!.add(s)
          if (!s2c.has(s)) s2c.set(s, new Set()); s2c.get(s)!.add(g)
        }
      }
    }
    return { c2s, s2c }
  }

  function shortPath(f: string) { return f.split('/').slice(-3).join('/') }

  async function select(file: string) {
    selectedFile = file; loading = true
    highlightedSourceLines = new Set(); highlightedCompiledLines = new Set(); activePanel = null
    try {
      result = await inspectFile(file)
      if (result?.mappings) { const { c2s, s2c } = parseMappings(result.mappings); compiledToSource = c2s; sourceToCompiled = s2c }
      else { compiledToSource = new Map(); sourceToCompiled = new Map() }
    } catch { result = null; compiledToSource = new Map(); sourceToCompiled = new Map() }
    loading = false
  }

  function handleSourceLineClick(ln: number) {
    activePanel = 'source'; highlightedSourceLines = new Set([ln])
    const m = sourceToCompiled.get(ln)
    if (m?.size) { highlightedCompiledLines = new Set(m); scrollToLine('compiled', Math.min(...m)) }
    else highlightedCompiledLines = new Set()
  }
  function handleCompiledLineClick(ln: number) {
    activePanel = 'compiled'; highlightedCompiledLines = new Set([ln])
    const m = compiledToSource.get(ln)
    if (m?.size) { highlightedSourceLines = new Set(m); scrollToLine('source', Math.min(...m)) }
    else highlightedSourceLines = new Set()
  }
  function scrollToLine(panel: string, ln: number) {
    document.querySelector(`.code-scroll.${panel} .line-${ln}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const sourceLines = $derived(result?.source.split('\n') ?? [])
  const compiledLines = $derived(result?.compiled.split('\n') ?? [])
  const hasMappings = $derived(compiledToSource.size > 0)

  // --- Token-based Syntax Highlighting ---
  function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
  type Tok = { t: string; c?: string }

  const JS_KW = new Set('const,let,var,function,return,if,else,for,while,do,switch,case,break,continue,new,this,typeof,instanceof,void,delete,throw,try,catch,finally,class,extends,super,import,export,from,default,async,await,yield,of,in'.split(','))
  const JS_LIT = new Set('true,false,null,undefined,NaN,Infinity'.split(','))

  function tokJS(code: string): Tok[] {
    const toks: Tok[] = []; let i = 0
    while (i < code.length) {
      if (/\s/.test(code[i])) { let j = i; while (j < code.length && /\s/.test(code[j])) j++; toks.push({ t: code.slice(i, j) }); i = j; continue }
      if (code[i] === '/' && code[i+1] === '/') { toks.push({ t: code.slice(i), c: 'hl-cm' }); break }
      if (code[i] === '`') { let j = i+1; while (j < code.length && code[j] !== '`') { if (code[j] === '\\') j++; j++ }; toks.push({ t: code.slice(i, j+1), c: 'hl-st' }); i = j+1; continue }
      if (code[i] === '"' || code[i] === "'") { const q = code[i]; let j = i+1; while (j < code.length && code[j] !== q) { if (code[j] === '\\') j++; j++ }; toks.push({ t: code.slice(i, j+1), c: 'hl-st' }); i = j+1; continue }
      if (/\d/.test(code[i]) && (i === 0 || !/\w/.test(code[i-1]))) { let j = i; while (j < code.length && /[\d.e]/.test(code[j])) j++; toks.push({ t: code.slice(i, j), c: 'hl-nm' }); i = j; continue }
      if (/[a-zA-Z_$]/.test(code[i])) {
        let j = i; while (j < code.length && /[\w$.]/.test(code[j])) j++
        const w = code.slice(i, j); let c: string | undefined
        if (w.startsWith('$.') || w === '$state' || w === '$derived' || w === '$effect' || w === '$props' || w === '$inspect') c = 'hl-sv'
        else if (JS_KW.has(w)) c = 'hl-kw'
        else if (JS_LIT.has(w)) c = 'hl-lt'
        else if (j < code.length && code[j] === '(') c = 'hl-fn'
        toks.push({ t: w, c }); i = j; continue
      }
      toks.push({ t: code[i] }); i++
    }
    return toks
  }

  function tokHTML(code: string): Tok[] {
    const toks: Tok[] = []; let i = 0
    while (i < code.length) {
      if (code[i] === '<') {
        let j = i; while (j < code.length && code[j] !== '>') j++
        const tag = code.slice(i, j+1)
        const m = tag.match(/^(<\/?\w[\w-]*)/)
        if (m) {
          toks.push({ t: m[1], c: 'hl-tg' })
          let rest = tag.slice(m[1].length)
          // Parse attributes simply
          while (rest.length > 0) {
            const am = rest.match(/^(\s+)([\w:-]+)(=)/)
            if (am) {
              toks.push({ t: am[1] }); toks.push({ t: am[2], c: 'hl-at' }); toks.push({ t: '=' })
              rest = rest.slice(am[0].length)
              if (rest[0] === '"' || rest[0] === "'") {
                const q = rest[0]; let k = 1; while (k < rest.length && rest[k] !== q) k++
                toks.push({ t: rest.slice(0, k+1), c: 'hl-st' }); rest = rest.slice(k+1)
              } else if (rest[0] === '{') {
                let k = 1, d = 1; while (k < rest.length && d > 0) { if (rest[k] === '{') d++; if (rest[k] === '}') d--; k++ }
                toks.push({ t: rest.slice(0, k), c: 'hl-ex' }); rest = rest.slice(k)
              }
            } else if (rest.match(/^(\s+)([\w:-]+)/)) {
              const bm = rest.match(/^(\s+)([\w:-]+)/)!
              toks.push({ t: bm[1] }); toks.push({ t: bm[2], c: 'hl-at' }); rest = rest.slice(bm[0].length)
            } else { toks.push({ t: rest[0] }); rest = rest.slice(1) }
          }
        } else { toks.push({ t: tag, c: 'hl-tg' }) }
        i = j+1; continue
      }
      if (code[i] === '{') {
        let j = i+1, d = 1; while (j < code.length && d > 0) { if (code[j] === '{') d++; if (code[j] === '}') d--; j++ }
        toks.push({ t: code.slice(i, j), c: 'hl-ex' }); i = j; continue
      }
      let j = i; while (j < code.length && code[j] !== '<' && code[j] !== '{') j++
      if (j > i) { toks.push({ t: code.slice(i, j) }); i = j } else { toks.push({ t: code[i] }); i++ }
    }
    return toks
  }

  function tokCSS(code: string): Tok[] {
    const tr = code.trimStart(), ind = code.slice(0, code.length - tr.length)
    const pm = tr.match(/^([\w-]+)(\s*:\s*)(.+?)(;?\s*)$/)
    if (pm) return [{ t: ind }, { t: pm[1], c: 'hl-cp' }, { t: pm[2] }, { t: pm[3], c: 'hl-cv' }, { t: pm[4] }]
    const sm = tr.match(/^([^{]+)(\s*\{)\s*$/)
    if (sm) return [{ t: ind }, { t: sm[1], c: 'hl-cs' }, { t: sm[2] }]
    return [{ t: code }]
  }

  function render(toks: Tok[]): string {
    return toks.map(t => { const e = esc(t.t); return t.c ? `<span class="${t.c}">${e}</span>` : e }).join('')
  }

  const highlightedSourceHtml = $derived.by(() => {
    let sec: 'template' | 'script' | 'style' = 'template'
    return sourceLines.map(line => {
      if (!line) return ' '
      const tr = line.trim()
      if (tr.startsWith('<script')) { sec = 'script'; return render(tokHTML(line)) }
      if (tr === '<' + '/script>') { const r = render(tokHTML(line)); sec = 'template'; return r }
      if (tr.startsWith('<style')) { sec = 'style'; return render(tokHTML(line)) }
      if (tr === '<' + '/style>') { const r = render(tokHTML(line)); sec = 'template'; return r }
      if (sec === 'script') return render(tokJS(line))
      if (sec === 'style') return render(tokCSS(line))
      return render(tokHTML(line))
    })
  })
  const highlightedCompiledHtml = $derived(compiledLines.map(l => l ? render(tokJS(l)) : ' '))

  onMount(async () => {
    try { files = await getSvelteFiles() } catch { /* ignore */ }
    const interval = setInterval(() => updateGutterHeight(), 500)
    return () => clearInterval(interval)
  })
</script>

<PanelContainer>
  <div class="header">
    <h2>Inspect</h2>
    <div class="header-right">
      {#if hasMappings}<span class="mapping-hint">Click a line to see its mapping</span>{/if}
      <SearchInput bind:value={search} placeholder="Search files..." />
    </div>
  </div>

  <div class="inspect-layout">
    <div class="file-list">
      <Card title="Svelte Files ({filtered.length})">
        <div class="file-scroll">
          {#each filtered as f}
            <button class="file-item" class:selected={selectedFile === f.file} onclick={() => select(f.file)}>
              <span class="file-name">{f.name}</span>
              <span class="file-path">{shortPath(f.file)}</span>
            </button>
          {/each}
        </div>
      </Card>
    </div>

    <div class="code-area">
      {#if loading}
        <Card><p class="loading">Loading...</p></Card>
      {:else if result}
        <div class="code-split">
          <div class="code-panel">
            <div class="code-title">Source (.svelte) <span class="line-count">{sourceLines.length} lines</span></div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="code-scroll source" bind:this={sourceScrollEl} onscroll={onSourceScroll}>
              {#each sourceLines as _, i}
                {@const ln = i + 1}
                <div class="code-line line-{ln}" class:highlighted={highlightedSourceLines.has(ln)} class:active-origin={highlightedSourceLines.has(ln) && activePanel === 'source'} onclick={() => handleSourceLineClick(ln)} role="button" tabindex="-1">
                  <span class="line-num">{ln}</span>
                  <span class="line-content">{@html highlightedSourceHtml[i]}</span>
                </div>
              {/each}
            </div>
          </div>
          <div class="gutter">
            <div class="gutter-title"></div>
            <svg class="gutter-svg" width="48" height={gutterHeight}>
              {#each connectionLines as c}
                {#if c.sy >= -20 && c.sy <= gutterHeight + 20 || c.cy >= -20 && c.cy <= gutterHeight + 20}
                  <path d="M 0 {c.sy} C 24 {c.sy}, 24 {c.cy}, 48 {c.cy}" fill="none" stroke="#ff3e00" stroke-width="1.5" opacity="0.6" />
                  <circle cx="0" cy={c.sy} r="3" fill="#ff3e00" opacity="0.8" />
                  <circle cx="48" cy={c.cy} r="3" fill="#ff3e00" opacity="0.8" />
                {/if}
              {/each}
            </svg>
          </div>
          <div class="code-panel">
            <div class="code-title">Compiled (JS) <span class="line-count">{compiledLines.length} lines</span></div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="code-scroll compiled" bind:this={compiledScrollEl} onscroll={onCompiledScroll}>
              {#each compiledLines as _, i}
                {@const ln = i + 1}
                <div class="code-line line-{ln}" class:highlighted={highlightedCompiledLines.has(ln)} class:active-origin={highlightedCompiledLines.has(ln) && activePanel === 'compiled'} onclick={() => handleCompiledLineClick(ln)} role="button" tabindex="-1">
                  <span class="line-num">{ln}</span>
                  <span class="line-content">{@html highlightedCompiledHtml[i]}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {:else}
        <Card><p class="empty">Select a .svelte file to view its source and compiled output.</p></Card>
      {/if}
    </div>
  </div>
</PanelContainer>

<style>
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
  .header-right { display: flex; align-items: center; gap: var(--space-3); }
  h2 { font-size: var(--text-lg); font-weight: 600; color: var(--color-text); margin: 0; }
  .empty, .loading { color: var(--color-text-muted); font-size: var(--text-sm); }
  .mapping-hint { font-size: var(--text-xs); color: var(--color-text-subtle); font-style: italic; }

  .inspect-layout { display: flex; gap: var(--space-3); height: calc(100vh - 120px); }
  .file-list { width: 220px; flex-shrink: 0; }
  .file-scroll { max-height: calc(100vh - 200px); overflow-y: auto; }
  .code-area { flex: 1; min-width: 0; }

  .file-item { display: block; width: 100%; text-align: left; padding: var(--space-1) var(--space-2); background: none; border: none; border-bottom: 1px dashed var(--color-border); cursor: pointer; font-family: var(--font-sans); transition: background var(--transition-fast); }
  .file-item:hover { background: var(--color-surface-active); }
  .file-item.selected { background: var(--color-surface-active); border-left: 2px solid var(--color-accent-500); }
  .file-name { display: block; font-size: var(--text-sm); color: var(--color-text); font-weight: 500; }
  .file-path { display: block; font-size: 10px; color: var(--color-text-subtle); font-family: var(--font-mono); }

  .code-split { display: grid; grid-template-columns: 1fr 48px 1fr; height: 100%; }
  .code-panel { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .code-title { display: flex; justify-content: space-between; align-items: center; padding: var(--space-1) var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border); border-bottom: none; border-radius: var(--radius-md) var(--radius-md) 0 0; font-size: var(--text-xs); font-weight: 600; color: var(--color-text-muted); }
  .line-count { font-weight: 400; color: var(--color-text-subtle); }
  .gutter { display: flex; flex-direction: column; flex-shrink: 0; }
  .gutter-title { height: 26px; }
  .gutter-svg { flex: 1; overflow: hidden; }

  .code-scroll { flex: 1; overflow: auto; background: var(--color-base); border: 1px solid var(--color-border); border-radius: 0 0 var(--radius-md) var(--radius-md); font-family: var(--font-mono); font-size: 11px; line-height: 1.6; }
  .code-line { display: flex; padding: 0 var(--space-2); cursor: pointer; transition: background 0.1s; min-height: 1.6em; }
  .code-line:hover { background: rgba(255, 255, 255, 0.03); }
  .code-line.highlighted { background: rgba(255, 62, 0, 0.12); }
  .code-line.active-origin { background: rgba(255, 62, 0, 0.22); border-left: 2px solid var(--color-accent-500); }
  .line-num { display: inline-block; width: 40px; flex-shrink: 0; text-align: right; padding-right: 12px; color: var(--color-text-subtle); user-select: none; opacity: 0.5; }
  .code-line.highlighted .line-num { color: var(--color-accent-400); opacity: 1; }
  .line-content { white-space: pre; tab-size: 2; color: #abb2bf; }

  /* One Dark syntax theme */
  .line-content :global(.hl-kw) { color: #c678dd; }
  .line-content :global(.hl-st) { color: #98c379; }
  .line-content :global(.hl-cm) { color: #5c6370; font-style: italic; }
  .line-content :global(.hl-nm) { color: #d19a66; }
  .line-content :global(.hl-lt) { color: #d19a66; }
  .line-content :global(.hl-fn) { color: #61afef; }
  .line-content :global(.hl-sv) { color: #e06c75; }
  .line-content :global(.hl-tg) { color: #e06c75; }
  .line-content :global(.hl-at) { color: #d19a66; }
  .line-content :global(.hl-ex) { color: #61afef; }
  .line-content :global(.hl-cp) { color: #56b6c2; }
  .line-content :global(.hl-cv) { color: #d19a66; }
  .line-content :global(.hl-cs) { color: #e06c75; }
</style>
