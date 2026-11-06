import { buildPrompt, elementTitle, relLocation } from 'virtual:vite-devtools-svelte/prompt-format'

// Floating "inspect to prompt" toolbar, served by the dev server as a virtual
// module and injected into the app's own pages (never into a build).
//
// Inspect → click elements (the clicks never reach the app) → write the request
// → Copy prompt. What an element resolves to comes from the devtools runtime
// (`window.__SVELTE_DEVTOOLS__.inspectElement`); the markdown comes from
// `prompt-format.js`.

const HOST_ID = '__svelte-devtools-prompt'
const MAX_SELECTIONS = 10
// Shared with the DevTools UI (same origin): an explicit light/dark choice
// made there applies here too.
const THEME_KEY = 'svelte-devtools-theme'
const PICKING_CLASS = '__svelte-devtools-picking'

const config = globalThis.__SVELTE_DEVTOOLS_PROMPT_CONFIG__ ?? {}
const root = typeof config.root === 'string' ? config.root : ''
const tracking = config.tracking !== false

const STYLES = `
  :host { all: initial; }
  .ui {
    --bg: #0f1420; --surface: #161d2b; --border: #273246; --ink: #e6e9ef; --muted: #9aa4b5;
    --accent: #ff5d2a; --accent-ink: #ffffff; --link: #8cc4ff; --focus: #8cc4ff;
    --ok: #7ddc9b; --error: #ff9b8f; --shadow: rgb(0 0 0 / 45%);
    font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink);
  }
  @media (prefers-color-scheme: light) {
    .ui:not([data-theme="dark"]) {
      --bg: #ffffff; --surface: #f5f6f8; --border: #d9dde5; --ink: #1d2230; --muted: #5d6676;
      --accent: #e8461a; --link: #1b5fae; --focus: #1b5fae; --ok: #1d7a44; --error: #b3261e;
      --shadow: rgb(15 23 42 / 18%);
    }
  }
  .ui[data-theme="light"] {
    --bg: #ffffff; --surface: #f5f6f8; --border: #d9dde5; --ink: #1d2230; --muted: #5d6676;
    --accent: #e8461a; --link: #1b5fae; --focus: #1b5fae; --ok: #1d7a44; --error: #b3261e;
    --shadow: rgb(15 23 42 / 18%);
  }
  * { box-sizing: border-box; }
  button, textarea { font: inherit; color: inherit; }
  .panel { cursor: auto; }
  button { cursor: pointer; }
  textarea { cursor: text; }
  button:focus-visible, textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .dock {
    position: fixed; right: 16px; bottom: 16px; z-index: 3;
    display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  }
  .bar { display: flex; gap: 6px; pointer-events: auto; }
  .bar button {
    height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--bg); box-shadow: 0 6px 20px -8px var(--shadow);
    display: inline-flex; align-items: center; gap: 6px;
  }
  .bar .inspect[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .bar .inspect svg { width: 14px; height: 14px; }
  .bar .count[hidden] { display: none; }
  .panel {
    pointer-events: auto; width: min(380px, calc(100vw - 32px));
    max-height: min(60vh, 520px); overflow: auto;
    background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 18px 48px -18px var(--shadow);
  }
  .panel[hidden] { display: none; }
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .head h2 { margin: 0; flex: 1; font-size: 13px; font-weight: 600; }
  .body { display: grid; gap: 10px; padding: 12px; }
  .note, .empty { margin: 0; color: var(--muted); font-size: 12px; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  }
  li .num { color: var(--muted); font-variant-numeric: tabular-nums; }
  li .text { flex: 1; min-width: 0; display: grid; }
  li .name, li .where {
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  li .where { color: var(--link); font-size: 11px; }
  .icon {
    width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px;
    background: transparent; color: var(--muted); display: inline-grid; place-items: center;
  }
  .icon:hover { background: var(--surface); color: var(--ink); }
  textarea {
    width: 100%; min-height: 72px; resize: vertical; padding: 8px 10px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  }
  .actions { display: flex; align-items: center; gap: 8px; }
  .actions button {
    height: 30px; padding: 0 12px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--surface);
  }
  .actions .primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .status { flex: 1; text-align: right; font-size: 12px; color: var(--ok); }
  .status[data-tone="error"] { color: var(--error); }
  .box {
    position: fixed; z-index: 1; display: none; pointer-events: none;
    border: 2px solid #3b82f6; background: rgb(59 130 246 / 12%); border-radius: 3px;
  }
  .box.picked { border-color: #16a34a; background: rgb(22 163 74 / 12%); }
  .tip {
    position: fixed; z-index: 2; display: none; pointer-events: none; max-width: min(420px, calc(100vw - 16px));
    padding: 4px 8px; border-radius: 6px; background: #111827; color: #f3f4f6;
    font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
`

const CROSSHAIR =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>'
const CLOSE =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
  '<path d="M4 4l8 8M12 4l-8 8"/></svg>'

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'html') node.innerHTML = value
    else node.setAttribute(key, value)
  }
  node.append(...children)
  return node
}

/**
 * A constructed stylesheet: unlike a `<style>` element it is not subject to the
 * page's Content-Security-Policy (`style-src` without 'unsafe-inline').
 */
function sheet(css) {
  const stylesheet = new CSSStyleSheet()
  stylesheet.replaceSync(css)
  return stylesheet
}

function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Insecure context (dev server reached over a LAN address): the old
    // selection trick still works from a click.
    const area = el('textarea', { readonly: '' })
    area.value = text
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.append(area)
    area.select()
    let ok = false
    try {
      // oxlint-disable-next-line typescript/no-deprecated -- fallback for insecure contexts
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

class PromptToolbar {
  constructor(host) {
    this.host = host
    this.shadow = host.attachShadow({ mode: 'open' })
    /** @type {{ element: Element, payload: any }[]} */
    this.selections = []
    this.instructions = ''
    this.picking = false
    this.frame = 0
  }

  build() {
    const ui = el('div', { class: 'ui' })
    const theme = storedTheme()
    if (theme) ui.dataset.theme = theme

    this.box = el('div', { class: 'box' })
    this.tip = el('div', { class: 'tip' })

    this.inspectButton = el('button', {
      type: 'button',
      class: 'inspect',
      'aria-pressed': 'false',
      title: 'Pick elements in the page to describe them in a prompt',
      html: CROSSHAIR + '<span>Inspect</span>',
    })
    this.inspectButton.addEventListener('click', () => this.setPicking(!this.picking))
    this.countButton = el('button', { type: 'button', class: 'count', 'aria-expanded': 'false' })
    this.countButton.hidden = true
    this.countButton.addEventListener('click', () => this.setPanelOpen(this.panel.hidden))

    this.list = el('ol')
    this.empty = el('p', {
      class: 'empty',
      text: 'Click Inspect, then click elements in the page.',
    })
    this.textarea = el('textarea', {
      placeholder: 'What should change?',
      'aria-label': 'Request for the coding agent',
    })
    this.textarea.addEventListener('input', () => {
      this.instructions = this.textarea.value
    })
    // Typing here must not trigger the app's own keyboard shortcuts.
    this.textarea.addEventListener('keydown', event => {
      if (event.key !== 'Escape') event.stopPropagation()
    })
    this.status = el('span', { class: 'status', role: 'status', 'aria-live': 'polite' })
    const copy = el('button', { type: 'button', class: 'primary', text: 'Copy prompt' })
    copy.addEventListener('click', () => void this.copy())
    const clear = el('button', { type: 'button', text: 'Clear' })
    clear.addEventListener('click', () => this.clear())
    const close = el('button', {
      type: 'button',
      class: 'icon',
      'aria-label': 'Close the prompt panel',
      html: CLOSE,
    })
    close.addEventListener('click', () => this.setPanelOpen(false, true))

    const body = el('div', { class: 'body' }, [this.empty, this.list, this.textarea])
    if (!tracking) {
      body.prepend(
        el('p', {
          class: 'note',
          text: 'Component tracking is off (componentTracking: false): only source locations are reported.',
        }),
      )
    }
    body.append(el('div', { class: 'actions' }, [copy, clear, this.status]))
    this.panel = el('section', { class: 'panel', 'aria-label': 'Prompt builder' }, [
      el('div', { class: 'head' }, [el('h2', { text: 'Prompt' }), close]),
      body,
    ])
    this.panel.hidden = true
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        this.setPanelOpen(false, true)
      }
    })

    const bar = el('div', { class: 'bar' }, [this.countButton, this.inspectButton])
    this.dock = el('div', { class: 'dock' }, [this.panel, bar])
    ui.append(this.box, this.tip, this.dock)
    this.shadow.adoptedStyleSheets = [sheet(STYLES)]
    this.shadow.append(ui)
    this.renderList()
    this.placeDock()
    window.visualViewport?.addEventListener('resize', () => this.placeDock())
    window.visualViewport?.addEventListener('scroll', () => this.placeDock())
  }

  /**
   * Bottom-right of what is actually on screen. A page wider than a phone's
   * screen widens the layout viewport that `position: fixed` is relative to,
   * which would put the button off screen; the visual viewport says where the
   * screen is.
   */
  placeDock() {
    const view = window.visualViewport
    const right = view ? window.innerWidth - view.offsetLeft - view.width : 0
    const bottom = view ? window.innerHeight - view.offsetTop - view.height : 0
    this.dock.style.right = Math.max(0, right) + 16 + 'px'
    this.dock.style.bottom = Math.max(0, bottom) + 16 + 'px'
    this.panel.style.width = 'min(380px, ' + ((view?.width ?? window.innerWidth) - 32) + 'px)'
  }

  // --- Panel ---

  setPanelOpen(open, returnFocus = false) {
    this.panel.hidden = !open
    this.countButton.setAttribute('aria-expanded', String(open))
    if (!open) {
      this.hideBox()
      if (returnFocus) this.inspectButton.focus()
    }
  }

  renderList() {
    const items = this.selections.map((selection, index) => {
      const { payload } = selection
      const where = payload.source?.file
        ? (payload.source.enclosing ? 'inside ' : '') + relLocation(payload.source, root)
        : 'no Svelte location'
      const remove = el('button', {
        type: 'button',
        class: 'icon',
        'aria-label': 'Remove ' + elementTitle(payload.element),
        html: CLOSE,
      })
      remove.addEventListener('click', () => {
        this.selections.splice(index, 1)
        this.renderList()
        this.hideBox()
      })
      const item = el('li', {}, [
        el('span', { class: 'num', text: String(index + 1) }),
        el('span', { class: 'text' }, [
          el('span', { class: 'name', text: elementTitle(payload.element) }),
          el('span', { class: 'where', text: where }),
        ]),
        remove,
      ])
      // Hovering an entry shows which element it is.
      item.addEventListener('pointerenter', () => {
        this.hoveredEntry = true
        this.showBox(selection.element, true)
      })
      item.addEventListener('pointerleave', () => {
        this.hoveredEntry = false
        this.hideBox()
      })
      return item
    })
    this.list.replaceChildren(...items)
    this.list.hidden = items.length === 0
    this.empty.hidden = items.length > 0
    this.countButton.hidden = items.length === 0
    this.countButton.textContent = items.length + ' picked'
  }

  showStatus(message, tone = 'ok') {
    this.status.textContent = message
    this.status.dataset.tone = tone
    clearTimeout(this.statusTimer)
    this.statusTimer = setTimeout(() => {
      this.status.textContent = ''
    }, 4000)
  }

  clear() {
    this.selections = []
    this.instructions = ''
    this.textarea.value = ''
    this.renderList()
    this.showStatus('Cleared')
  }

  async copy() {
    if (this.selections.length === 0) {
      this.showStatus('Pick at least one element first.', 'error')
      return
    }
    const text = buildPrompt(
      this.selections.map(selection => selection.payload),
      this.instructions,
      root,
    )
    if (await copyText(text)) {
      this.setPicking(false)
      this.showStatus('Copied')
    } else {
      this.showStatus('Could not write to the clipboard.', 'error')
    }
  }

  // --- Picking ---

  setPicking(picking) {
    if (this.picking === picking) return
    this.picking = picking
    this.inspectButton.setAttribute('aria-pressed', String(picking))
    document.documentElement.classList.toggle(PICKING_CLASS, picking)
    const method = picking ? 'addEventListener' : 'removeEventListener'
    // On `window`, capturing: ahead of every listener the app registers.
    const options = { capture: true, passive: false }
    for (const type of SWALLOWED) window[method](type, this.swallow, options)
    window[method]('click', this.pick, options)
    window[method]('pointermove', this.hover, options)
    window[method]('keydown', this.keydown, options)
    if (!picking) this.hideBox()
  }

  /**
   * Events on the toolbar itself, or on the Vite DevTools dock (a
   * `<devframes-*>` custom element): those are not picks, and the dock stays
   * usable while picking.
   */
  isOwn(event) {
    return event
      .composedPath()
      .some(node => node === this.host || node.localName?.startsWith('devframes-'))
  }

  /**
   * The click that picks never reaches the app (no navigation, no submit). It
   * is the click, not the press, so that a touch that turns into a scroll does
   * not pick anything.
   */
  pick = event => {
    if (this.isOwn(event) || event.button !== 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const element = pickable(event.composedPath()[0])
    if (element) this.toggleSelection(element)
  }

  /** The rest of a picking press: no focus, no text selection, no app handler. */
  swallow = event => {
    if (this.isOwn(event)) return
    if ('button' in event && event.button !== 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  keydown = event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.setPicking(false)
    this.inspectButton.focus()
  }

  hover = event => {
    if (this.isOwn(event)) {
      // Over the toolbar: no tooltip, and the box only for a hovered entry.
      this.tip.style.display = 'none'
      if (!this.hoveredEntry) this.hideBox()
      return
    }
    const target = event.composedPath()[0]
    const x = event.clientX
    const y = event.clientY
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.showHover(target, x, y))
  }

  showHover(target, x, y) {
    const element = pickable(target)
    if (!element) {
      this.hideBox()
      return
    }
    const index = this.selections.findIndex(selection => selection.element === element)
    this.showBox(element, index !== -1)
    const info = window.__SVELTE_DEVTOOLS__?.locateElement?.(element)
    const where = info?.source?.file
      ? (info.source.enclosing ? 'inside ' : '') + relLocation(info.source, root)
      : 'no Svelte location'
    const component = info?.component ? '  ' + info.component.name : ''
    const picked = index === -1 ? '' : '  (picked #' + (index + 1) + ', click to remove)'
    this.tip.textContent = '<' + element.localName + '>  ' + where + component + picked
    this.tip.style.display = 'block'
    // Next to the pointer, kept inside the viewport.
    const tip = this.tip.getBoundingClientRect()
    const left = Math.min(x + 12, window.innerWidth - tip.width - 8)
    const top = y + 18 + tip.height > window.innerHeight ? y - tip.height - 10 : y + 18
    this.tip.style.left = Math.max(8, left) + 'px'
    this.tip.style.top = Math.max(8, top) + 'px'
  }

  showBox(element, picked) {
    if (!element?.isConnected) {
      this.hideBox()
      return
    }
    const rect = element.getBoundingClientRect()
    Object.assign(this.box.style, {
      display: 'block',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    })
    this.box.classList.toggle('picked', picked)
  }

  hideBox() {
    cancelAnimationFrame(this.frame)
    this.box.style.display = 'none'
    this.tip.style.display = 'none'
  }

  toggleSelection(element) {
    const existing = this.selections.findIndex(selection => selection.element === element)
    if (existing !== -1) {
      this.selections.splice(existing, 1)
      this.renderList()
      this.showStatus('Removed ' + element.localName)
      return
    }
    if (this.selections.length >= MAX_SELECTIONS) {
      this.showStatus('At most ' + MAX_SELECTIONS + ' elements per prompt.', 'error')
      return
    }
    const runtime = window.__SVELTE_DEVTOOLS__
    const payload = runtime?.inspectElement?.(element)
    if (!payload || payload.error) {
      this.showStatus(payload?.error ?? 'The Svelte devtools runtime is not loaded.', 'error')
      return
    }
    this.selections.push({ element, payload })
    this.renderList()
    this.setPanelOpen(true)
    this.showBox(element, true)
    this.showStatus(
      tracking && payload.components.length === 0
        ? 'Added ' + element.localName + ' (no Svelte component renders it)'
        : 'Added ' + element.localName,
    )
  }
}

/** The element under the pointer, unless it is the page itself (`html`, `body`). */
function pickable(target) {
  const element = target instanceof Element ? target : (target?.parentElement ?? null)
  if (!element || element === document.documentElement || element === document.body) return null
  return element
}

// The press and release around a picking click. Touch events are left alone so
// that the page still scrolls while picking; the click a tap produces is
// swallowed like any other.
const SWALLOWED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick']

function mount() {
  if (document.querySelector('#' + HOST_ID)) return
  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none'
  document.body.append(host)
  // The page's own cursors (a link's pointer, an input's caret) would promise
  // an interaction that a pick swallows: one cursor while picking.
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets,
    sheet(`html.${PICKING_CLASS}, html.${PICKING_CLASS} * { cursor: crosshair !important; }`),
  ]
  new PromptToolbar(host).build()
}

if (document.body) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })
