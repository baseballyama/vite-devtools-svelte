import {
  buildPrompt,
  DEFAULT_OPTIONS,
  elementTitle,
  relLocation,
  resolveElementSource,
} from 'virtual:vite-devtools-svelte-prompt-format'

// Floating "inspect to prompt" toolbar, injected into the app's HTML by the
// dev server (never in a production build).
//
// Click the toolbar's Inspect button (draggable, no global shortcut), then
// click elements in the page: each pick is resolved to its Svelte source location,
// its component instance chain, and the live props/$state of those instances
// (all read from `window.__SVELTE_DEVTOOLS__`, which the plugin's runtime
// exposes). The user adds instructions in the panel and the result is copied
// to the clipboard as one markdown prompt.
//
// Only the browser layer lives here: the plugin serves this file as a Vite
// module (so it can import the typed, unit-tested helpers from
// `prompt-format.ts`), and it never reaches a production build.

/** Id of the host element (also used to keep the toolbar out of picks). */
export const TOOLBAR_HOST_ID = '__svelte-devtools-prompt'

/** The element a pick started on: text nodes and comments resolve upwards. */
function elementOf(node) {
  let element = node
  while (element?.nodeType !== 1) {
    if (!element) return null
    element = element.parentElement ?? element.parentNode
  }
  return element
}

const STORAGE_KEY = 'vite-devtools-svelte:prompt-toolbar'

// While picking, the page's own cursors (a pointer over links, a text caret
// over inputs, resize arrows over handles) promise an interaction that will not
// happen: a pick swallows the click. One cursor for the whole document says
// "you are picking an element" and nothing else. The rule lives in the light
// DOM so it reaches elements the toolbar never touches; it does not apply to
// the toolbar's own shadow tree, which keeps its own cursors.
const PICKING_CLASS = '__svelte-devtools-picking'
const PICKING_STYLE_ID = PICKING_CLASS + '-cursor'
const PICKING_CURSOR = 'crosshair'
const PICKING_CSS =
  'html.' +
  PICKING_CLASS +
  ', html.' +
  PICKING_CLASS +
  ' * { cursor: ' +
  PICKING_CURSOR +
  ' !important; }'
const MAX_SELECTIONS = 10

// --- Browser side ---

function devtoolsRuntime() {
  return typeof window === 'undefined' ? null : (window.__SVELTE_DEVTOOLS__ ?? null)
}

/**
 * Project root and Vite base, written into this script by the dev server (see
 * `promptToolbarModule`). The page's markup never carries them.
 */
function toolbarConfig() {
  const config = globalThis.__SVELTE_DEVTOOLS_PROMPT_CONFIG__
  if (config && typeof config === 'object') {
    return {
      root: typeof config.root === 'string' ? config.root : '',
      base: typeof config.base === 'string' ? config.base : '/',
    }
  }
  return { root: '', base: '/' }
}

function readStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return stored && typeof stored === 'object' ? stored : {}
  } catch {
    /* private mode / garbage: defaults */
    return {}
  }
}

function loadOptions(stored) {
  return {
    ...DEFAULT_OPTIONS,
    state: stored.state !== false,
    props: stored.props !== false,
    source: stored.source !== false,
    template: stored.template !== false,
  }
}

/** Merge what the toolbar remembers between reloads (options + position). */
function saveState(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStorage(), ...patch }))
  } catch {
    /* storage unavailable: the toolbar just does not persist */
  }
}

function saveOptions(options) {
  saveState({
    state: options.state,
    props: options.props,
    source: options.source,
    template: options.template,
  })
}

// `/@fs/<abs>?raw` is Vite's raw-module URL: it returns the file text, which
// is exactly the Svelte source behind the compiled component. Svelte's
// locations are usually root-relative, Vite's `/@fs/` needs an absolute path.
async function fetchSource(file, root, base) {
  if (!file) return null
  const absolute = file.startsWith('/') ? file : String(root).replace(/\/?$/, '') + '/' + file
  try {
    // `/@fs` is served under the configured base: with `base: '/app/'` a bare
    // `/@fs/...` request 404s in Vite's base middleware.
    const response = await fetch(base + '@fs' + absolute + '?raw')
    if (!response.ok) return null
    // Vite's `?raw` module is `export default "<json string>"`: strip the
    // wrapper and parse the literal (no regex over file contents).
    const text = (await response.text()).trim()
    const prefix = 'export default '
    if (!text.startsWith(prefix)) return null
    let literal = text.slice(prefix.length).trim()
    if (literal.endsWith(';')) literal = literal.slice(0, -1).trimEnd()
    return JSON.parse(literal)
  } catch {
    return null
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API needs a secure context (or a permission): fall back to
    // the old selection trick, which works everywhere a click is trusted.
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0'
      document.body.append(area)
      area.select()
      // oxlint-disable-next-line typescript/no-deprecated -- deliberate fallback for insecure contexts
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

const STYLES = `
  :host {
    all: initial;
    /* Dark by default; the light palette follows the OS like the rest of the
       devtools UI. */
    --border: #1f2a3d;
    --bg: #0b1220;
    --surface: #0f172a;
    --control: #111827;
    --control-hover: #16233a;
    --ink: #e5e7eb;
    --ink-strong: #f3f4f6;
    --ink-soft: #e2e8f0;
    --muted: #94a3b8;
    --link: #7dd3fc;
    --accent: #2563eb;
    --accent-strong: #1d4ed8;
    --ok: #86efac;
    --error: #fca5a5;
    --fab: #111827;
    --fab-ink: #f9fafb;
    --shadow: rgb(0 0 0 / 45%);
  }
  @media (prefers-color-scheme: light) {
    :host {
      --border: #d7dce5;
      --bg: #ffffff;
      --surface: #f6f7f9;
      --control: #ffffff;
      --control-hover: #eef1f6;
      --ink: #1f2430;
      --ink-strong: #11141a;
      --ink-soft: #2b3140;
      --muted: #5b6472;
      --link: #1d5fa8;
      --accent: #2563eb;
      --accent-strong: #1d4ed8;
      --ok: #1c7a46;
      --error: #a3312a;
      --fab: #1f2430;
      --fab-ink: #ffffff;
      --shadow: rgb(15 23 42 / 22%);
    }
  }
  * { box-sizing: border-box; font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  /* The dock + panel move together: the shell is anchored where the user
     dragged the button, and the panel grows upwards from it. */
  .shell {
    position: fixed; z-index: 3; display: flex; flex-direction: column;
    gap: 8px; align-items: flex-end; pointer-events: none;
  }
  .shell[data-side="left"] { align-items: flex-start; }
  .dock {
    display: flex; align-items: center; gap: 8px;
    cursor: grab; touch-action: none;
  }
  .dock[data-dragging="true"] { cursor: grabbing; }
  .count {
    height: 28px; padding: 0 10px; border-radius: 999px; pointer-events: auto;
    border: 1px solid var(--border); background: var(--bg); color: var(--ink);
    font-size: 12px; cursor: pointer;
  }
  .count[hidden] { display: none; }
  .count:hover { color: var(--ink-strong); border-color: var(--muted); }
  .fab {
    /* the host covers the page with pointer-events: none (inherited) */
    pointer-events: auto;
    display: flex; align-items: center; gap: 6px;
    height: 36px; padding: 0 12px; border: 0; border-radius: 999px;
    background: var(--fab); color: var(--fab-ink); cursor: pointer;
    box-shadow: 0 6px 24px -8px var(--shadow), 0 1px 0 rgb(255 255 255 / 8%) inset;
    opacity: 0.92;
  }
  .fab:hover { opacity: 1; }
  .fab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; opacity: 1; }
  .fab[aria-pressed="true"] { background: var(--accent); }
  .fab .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
  .fab[aria-pressed="true"] .dot { background: #fde047; }
  .panel {
    pointer-events: auto;
    width: min(420px, calc(100vw - 36px));
    max-height: min(70vh, 620px); overflow-y: auto; overflow-x: hidden;
    background: var(--bg); color: var(--ink);
    border: 1px solid var(--border); border-radius: 14px;
    box-shadow: 0 24px 60px -24px var(--shadow);
  }
  .panel[hidden] { display: none; }
  .head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px; border-bottom: 1px solid var(--border);
    font-weight: 600; color: var(--ink-strong);
  }
  .head .hint { font-weight: 400; color: var(--muted); font-size: 11px; }
  .body { padding: 12px; display: grid; gap: 10px; }
  .empty { color: var(--muted); font-size: 12px; }
  .chip {
    display: flex; align-items: start; gap: 8px;
    padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
  }
  .chip .text { flex: 1; min-width: 0; }
  .chip .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip .where { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--link); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  textarea {
    width: 100%; min-height: 84px; resize: vertical; padding: 8px 10px;
    border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--ink);
    font: 13px/1.5 ui-sans-serif, system-ui, sans-serif;
  }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .options { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--ink); font-size: 12px; }
  .options label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  button {
    height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--control); color: var(--ink); cursor: pointer;
  }
  button:hover { background: var(--control-hover); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #ffffff; font-weight: 600; }
  button.primary:hover { background: var(--accent-strong); }
  button.ghost { border-color: transparent; background: transparent; color: var(--muted); }
  button.icon { height: 22px; padding: 0 6px; font-size: 12px; color: var(--muted); }
  .status { color: var(--ok); font-size: 12px; }
  .status[data-tone="error"] { color: var(--error); }
  /* A picked element keeps a numbered outline: the prompt lists the same
     numbers, and the page keeps showing what is in it. */
  .mark {
    position: fixed; z-index: 1; pointer-events: none;
    border: 2px solid #22c55e; background: rgb(34 197 94 / 12%); border-radius: 3px;
  }
  .mark[hidden] { display: none; }
  .mark .badge {
    position: absolute; left: -2px; top: -18px;
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
    background: #16a34a; color: #ffffff; text-align: center;
    font: 600 11px/18px ui-sans-serif, system-ui, sans-serif;
    box-shadow: 0 1px 4px rgb(0 0 0 / 30%);
  }
  .highlight {
    position: fixed; z-index: 2; pointer-events: none; display: none;
    border: 2px solid #3b82f6; background: rgb(59 130 246 / 14%); border-radius: 3px;
  }
  .tip {
    position: fixed; z-index: 2; pointer-events: none; display: none;
    max-width: 340px; padding: 4px 8px; border-radius: 6px;
    background: var(--fab); color: var(--fab-ink); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    box-shadow: 0 8px 20px -10px var(--shadow);
  }
  /* The picking cursor is inherited from the host: the toolbar is still
     interactive, so its own controls keep their usual cursors. */
  .panel, .panel * { cursor: auto; }
  .panel textarea { cursor: text; }
  .panel button { cursor: pointer; }
`

/**
 * The element's box clipped by every scrollable ancestor, so an outline never
 * spills over unrelated content when the element is scrolled out of view.
 */
function visibleRect(element) {
  const box = element.getBoundingClientRect()
  let left = box.left
  let top = box.top
  let right = box.right
  let bottom = box.bottom
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const overflow = style.overflow + ' ' + style.overflowX + ' ' + style.overflowY
    const scrolls =
      overflow.includes('auto') ||
      overflow.includes('scroll') ||
      overflow.includes('hidden') ||
      overflow.includes('clip')
    if (!scrolls) continue
    const frame = parent.getBoundingClientRect()
    left = Math.max(left, frame.left)
    top = Math.max(top, frame.top)
    right = Math.min(right, frame.right)
    bottom = Math.min(bottom, frame.bottom)
  }
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

class PromptToolbar {
  constructor(host, config) {
    this.host = host
    this.config = config
    const stored = readStorage()
    this.options = loadOptions(stored)
    this.position = {
      x: typeof stored.x === 'number' ? stored.x : null,
      y: typeof stored.y === 'number' ? stored.y : null,
    }
    this.selections = []
    this.marks = new Map()
    // Where the shell is on screen; `position` holds the user's drag (null =
    // default corner). `rect` is filled by applyPosition().
    this.rect = { x: 0, y: 0, width: 0, height: 0 }
    this.suppressClick = false
    this.picking = false
    this.panelOpen = false
    this.tipFrame = null
    this.markFrame = null
    this.root = host.attachShadow({ mode: 'open' })
    this.render()
    // Marks follow the page: scrolling (also of a scrollable ancestor), a
    // resize, the app re-rendering around the picked elements, and those
    // elements changing size.
    window.addEventListener('scroll', () => this.scheduleMarks(), { capture: true, passive: true })
    window.addEventListener('resize', () => {
      this.applyPosition()
      this.scheduleMarks()
    })
    this.pageObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => this.scheduleMarks())
        : null
    this.resizeObserver =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.scheduleMarks()) : null
  }

  render() {
    const style = document.createElement('style')
    style.textContent = STYLES

    const marks = document.createElement('div')
    marks.className = 'marks'
    const highlight = document.createElement('div')
    highlight.className = 'highlight'
    const tip = document.createElement('div')
    tip.className = 'tip'
    const dock = document.createElement('div')
    dock.className = 'dock'
    const fab = document.createElement('button')
    fab.className = 'fab'
    fab.type = 'button'
    fab.title = 'Inspect an element and build a prompt — drag to move, double-click to reset'
    fab.setAttribute('aria-label', 'Inspect an element')
    fab.setAttribute('aria-pressed', 'false')
    fab.innerHTML = '<span class="dot"></span><span>Inspect</span>'
    // Drag anywhere on the dock; a press that does not move is a click.
    dock.addEventListener('pointerdown', event => this.startDrag(event))
    fab.addEventListener('click', event => {
      event.stopPropagation()
      if (this.suppressClick) {
        // The press was a drag: the pointer moved the button, it did not ask
        // for picking.
        this.suppressClick = false
        return
      }
      this.togglePicking()
    })
    fab.addEventListener('dblclick', event => {
      event.stopPropagation()
      this.position = { x: null, y: null }
      this.applyPosition()
      this.savePosition()
    })
    const count = document.createElement('button')
    count.className = 'count'
    count.type = 'button'
    count.hidden = true
    count.addEventListener('click', event => {
      event.stopPropagation()
      this.setPanelOpen(!this.panelOpen)
    })
    count.setAttribute('aria-expanded', 'false')
    dock.append(fab, count)
    const panel = document.createElement('section')
    panel.className = 'panel'
    panel.hidden = true
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Build a prompt')
    const shell = document.createElement('div')
    shell.className = 'shell'
    // Panel first: the dock stays at the anchored spot, the panel above it.
    shell.append(panel, dock)

    this.marksLayer = marks
    this.highlight = highlight
    this.tip = tip
    this.dock = dock
    this.fab = fab
    this.count = count
    this.panel = panel
    this.shell = shell
    this.root.append(style, marks, highlight, tip, shell)

    this.renderPanel()
    this.applyPosition()
  }

  renderPanel() {
    const panel = this.panel
    panel.replaceChildren()
    const head = document.createElement('div')
    head.className = 'head'
    const title = document.createElement('span')
    title.textContent = 'Build a prompt'
    const hint = document.createElement('span')
    hint.className = 'hint'
    hint.textContent = this.picking ? 'click elements — Esc to stop' : 'drag the button to move it'
    head.append(title, hint)

    const close = document.createElement('button')
    close.className = 'icon'
    close.type = 'button'
    close.textContent = '✕'
    close.title = 'Close'
    close.setAttribute('aria-label', 'Close the prompt panel')
    close.addEventListener('click', () => this.setPanelOpen(false))
    head.append(close)

    const body = document.createElement('div')
    body.className = 'body'

    if (this.selections.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'empty'
      empty.textContent = 'Click “Inspect”, then click an element in the page.'
      body.append(empty)
    } else {
      for (const [index, selection] of this.selections.entries()) {
        body.append(this.renderChip(selection, index))
      }
    }

    const textarea = document.createElement('textarea')
    textarea.placeholder = 'What should change? (optional)'
    textarea.value = this.options.instructions
    textarea.addEventListener('input', () => {
      this.options.instructions = textarea.value
    })
    textarea.addEventListener('keydown', event => {
      // Keep typing in the panel: the page's own shortcuts must not fire.
      event.stopPropagation()
    })
    body.append(textarea)

    body.append(this.renderOptions())

    const actions = document.createElement('div')
    actions.className = 'actions'
    const copy = document.createElement('button')
    copy.className = 'primary'
    copy.type = 'button'
    copy.textContent = 'Copy prompt'
    copy.addEventListener('click', () => void this.copy())
    const clear = document.createElement('button')
    clear.className = 'ghost'
    clear.type = 'button'
    clear.textContent = 'Clear'
    clear.addEventListener('click', () => this.clearSelections())
    const status = document.createElement('span')
    status.className = 'status'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    this.status = status
    actions.append(copy, clear, status)
    body.append(actions)

    panel.append(head, body)
    this.renderDock()
    this.scheduleMarks()
  }

  /** The picked count next to the inspect button, and its open/closed state. */
  renderDock() {
    if (!this.count) return
    this.count.hidden = this.selections.length === 0
    this.count.textContent = this.selections.length + ' picked'
    this.count.title = this.panelOpen ? 'Hide the prompt panel' : 'Open the prompt panel'
    this.applyPosition()
  }

  renderChip(selection, index) {
    const chip = document.createElement('div')
    chip.className = 'chip'
    const text = document.createElement('div')
    text.className = 'text'
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = index + 1 + '. ' + elementTitle(selection.payload?.element)
    const where = document.createElement('div')
    where.className = 'where'
    // Same resolution as the prompt (and the same `~` for a line Svelte only
    // recorded for an enclosing element), so the two never disagree.
    where.textContent = selection.location?.file
      ? (selection.location.matched ? '~' : '') + relLocation(selection.location, this.config.root)
      : '(no Svelte source location)'
    text.append(name, where)
    const remove = document.createElement('button')
    remove.className = 'icon'
    remove.type = 'button'
    remove.textContent = '✕'
    remove.title = 'Remove'
    remove.setAttribute('aria-label', 'Remove this selection')
    remove.addEventListener('click', event => {
      event.stopPropagation()
      this.selections.splice(index, 1)
      this.renderPanel()
      this.hideHighlight()
    })
    chip.append(text, remove)
    return chip
  }

  renderOptions() {
    const options = document.createElement('div')
    options.className = 'options'
    const entries = [
      ['state', '$state'],
      ['props', 'props'],
      ['source', 'source'],
      ['template', 'template'],
    ]
    for (const [key, label] of entries) {
      const wrapper = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = !!this.options[key]
      input.addEventListener('change', () => {
        this.options[key] = input.checked
        saveOptions(this.options)
      })
      const span = document.createElement('span')
      span.textContent = label
      wrapper.append(input, span)
      options.append(wrapper)
    }
    return options
  }

  setPanelOpen(open) {
    this.panelOpen = open
    this.panel.hidden = !open
    if (this.count) this.count.setAttribute('aria-expanded', String(open))
    if (open) {
      this.renderPanel()
      this.fitPanel()
    }
  }

  /** Coalesce mark updates into one frame (scroll and mutation bursts). */
  scheduleMarks() {
    if (this.markFrame !== null) return
    this.markFrame = requestAnimationFrame(() => {
      this.markFrame = null
      this.syncMarks()
    })
  }

  /** One numbered outline per selection, positioned over the element. */
  syncMarks() {
    if (!this.marksLayer) return
    for (const [selection, mark] of this.marks) {
      if (this.selections.includes(selection)) continue
      mark.remove()
      this.marks.delete(selection)
      this.resizeObserver?.unobserve(selection.element)
    }
    if (this.selections.length === 0) {
      this.pageObserver?.disconnect()
      return
    }
    this.pageObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    })
    this.selections.forEach((selection, index) => {
      let mark = this.marks.get(selection)
      if (!mark) {
        mark = this.createMark()
        this.marks.set(selection, mark)
        this.resizeObserver?.observe(selection.element)
      }
      const badge = mark.firstElementChild
      if (badge) badge.textContent = String(index + 1)
      const element = selection.element
      // Clipped by the viewport *and* by every scrollable ancestor: an element
      // scrolled out of an `overflow` container is not where it looks.
      const rect = element?.isConnected ? visibleRect(element) : null
      const onScreen =
        rect !== null &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth
      mark.hidden = !onScreen
      if (!onScreen) return
      mark.style.left = rect.left + 'px'
      mark.style.top = rect.top + 'px'
      mark.style.width = rect.width + 'px'
      mark.style.height = rect.height + 'px'
      // The badge sits above the box, unless that would leave the viewport.
      if (badge) badge.style.top = rect.top < 22 ? '0px' : '-18px'
    })
  }

  createMark() {
    const mark = document.createElement('div')
    mark.className = 'mark'
    const badge = document.createElement('span')
    badge.className = 'badge'
    mark.append(badge)
    this.marksLayer.append(mark)
    return mark
  }

  /** One cursor for the whole page while picking; the page keeps its own otherwise. */
  setPickingCursor(picking) {
    const html = document.documentElement
    const existing = document.querySelector('#' + PICKING_STYLE_ID)
    if (!picking) {
      html.classList.remove(PICKING_CLASS)
      existing?.remove()
      return
    }
    if (existing) return
    const style = document.createElement('style')
    style.id = PICKING_STYLE_ID
    style.textContent = PICKING_CSS
    document.head.append(style)
    html.classList.add(PICKING_CLASS)
  }

  togglePicking() {
    this.setPicking(!this.picking)
  }

  setPicking(picking) {
    if (this.picking === picking) return
    this.picking = picking
    this.host.dataset.picking = String(picking)
    this.fab.dataset.active = String(picking)
    this.fab.setAttribute('aria-pressed', String(picking))
    this.setPickingCursor(picking)
    const capture = true
    if (picking) {
      document.addEventListener('pointermove', this.onPointerMove, capture)
      document.addEventListener('pointerdown', this.onPointerDown, capture)
      // A pick must not also activate the element: SvelteKit navigates from
      // the `click` event, and `preventDefault()` on pointerdown alone does
      // not stop it.
      document.addEventListener('click', this.onClick, capture)
      document.addEventListener('auxclick', this.onClick, capture)
      document.addEventListener('mousedown', this.onSwallowedEvent, capture)
      document.addEventListener('mouseup', this.onSwallowedEvent, capture)
      document.addEventListener('pointerup', this.onSwallowedEvent, capture)
      document.addEventListener('dblclick', this.onSwallowedEvent, capture)
      document.addEventListener('keydown', this.onKeyDown, capture)
    } else {
      document.removeEventListener('pointermove', this.onPointerMove, capture)
      document.removeEventListener('pointerdown', this.onPointerDown, capture)
      document.removeEventListener('click', this.onClick, capture)
      document.removeEventListener('auxclick', this.onClick, capture)
      document.removeEventListener('mousedown', this.onSwallowedEvent, capture)
      document.removeEventListener('mouseup', this.onSwallowedEvent, capture)
      document.removeEventListener('pointerup', this.onSwallowedEvent, capture)
      document.removeEventListener('dblclick', this.onSwallowedEvent, capture)
      document.removeEventListener('keydown', this.onKeyDown, capture)
      this.hideHighlight()
    }
    if (this.panelOpen) this.renderPanel()
  }

  onKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.setPicking(false)
      this.setPanelOpen(false)
    }
  }

  /**
   * A primary-button pick must not reach the app: no click, no focus, no
   * navigation. Other buttons are left alone (a right click still opens the
   * app's context menu).
   */
  onPointerDown = event => {
    if (event.button !== 0) return
    if (this.isOwnEvent(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const element = event.composedPath?.()[0] ?? event.target
    void this.addSelection(element)
  }

  onClick = event => {
    if (event.button !== undefined && event.button !== 0) return
    if (this.isOwnEvent(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  /** The rest of a primary-button press: nothing about it belongs to the page. */
  onSwallowedEvent = event => {
    if (event.button !== undefined && event.button !== 0) return
    if (this.isOwnEvent(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  onPointerMove = event => {
    if (this.isOwnEvent(event)) {
      this.hideHighlight()
      return
    }
    if (this.tipFrame) cancelAnimationFrame(this.tipFrame)
    this.tipFrame = requestAnimationFrame(() => {
      this.tipFrame = null
      this.showHighlight(event.composedPath?.()[0] ?? event.target, event.clientX, event.clientY)
    })
  }

  /**
   * Place the shell where the user dragged the button, clamped to the viewport.
   * `position` keeps the user's choice (null = the default corner), so the
   * default follows a resized window instead of freezing at its first value.
   */
  applyPosition() {
    if (!this.shell) return
    const margin = 8
    const rect = this.dock.getBoundingClientRect()
    const width = rect.width || 140
    const height = rect.height || 36
    const maxX = Math.max(margin, window.innerWidth - width - margin)
    const maxY = Math.max(margin, window.innerHeight - height - margin)
    const x = this.clamp(this.position.x ?? window.innerWidth - width - 18, margin, maxX)
    const y = this.clamp(this.position.y ?? window.innerHeight - height - 18, margin, maxY)
    // What is on screen right now; `position` below is what the user chose.
    this.rect = { x, y, width, height }
    // The panel opens where there is room: above the button in the lower half
    // of the viewport, below it in the upper half.
    const placement = y + height / 2 > window.innerHeight / 2 ? 'above' : 'below'
    if (placement !== this.placement) {
      this.placement = placement
      // Reordering blurs a focused textarea, so it only happens on a flip.
      if (placement === 'above') this.shell.append(this.panel, this.dock)
      else this.shell.append(this.dock, this.panel)
    }
    this.shell.dataset.placement = placement
    // The panel is wider than the button: anchor the shell by the edge it
    // should share with the button, so the button lands at (x, y) and the
    // panel stays on the side with room.
    const side = x + width / 2 < window.innerWidth / 2 ? 'left' : 'right'
    this.shell.dataset.side = side
    if (side === 'left') {
      this.shell.style.left = x + 'px'
      this.shell.style.right = ''
    } else {
      this.shell.style.left = ''
      this.shell.style.right = window.innerWidth - x - width + 'px'
    }
    if (placement === 'above') {
      // Anchored by its bottom edge, so an opening panel grows upwards.
      this.shell.style.top = ''
      this.shell.style.bottom = window.innerHeight - y - height + 'px'
    } else {
      this.shell.style.bottom = ''
      this.shell.style.top = y + 'px'
    }
    if (!this.panel.hidden) this.fitPanel()
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
  }

  /** Keep the panel inside the viewport, on the side of the button with room. */
  fitPanel() {
    const height = this.rect.height
    const gap = 8
    const room =
      this.placement === 'above'
        ? this.rect.y - gap - 8
        : window.innerHeight - this.rect.y - height - gap - 8
    this.panel.style.maxHeight = Math.max(140, Math.min(window.innerHeight * 0.7, room)) + 'px'
  }

  savePosition() {
    saveState({ x: this.position.x, y: this.position.y })
  }

  /** Drag the dock with the pointer; a press that never moves is a click. */
  startDrag(event) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    // `preventDefault()` above keeps the press from doing anything else, which
    // also means no focus: take it explicitly so the button stays
    // keyboard-operable (Enter/Space arrive as a click).
    if (event.composedPath?.().includes(this.fab)) this.fab.focus({ preventScroll: true })
    const startX = event.clientX
    const startY = event.clientY
    const from = { x: this.rect.x, y: this.rect.y }
    let moved = false
    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
      if (!moved) {
        moved = true
        this.dock.dataset.dragging = 'true'
        this.setPicking(false)
      }
      this.position = { x: from.x + dx, y: from.y + dy }
      this.applyPosition()
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      this.dock.dataset.dragging = 'false'
      if (!moved) return
      // The press moved the button: swallow the click it will produce, so
      // dragging never toggles picking (the keyboard uses that same click).
      this.suppressClick = true
      this.savePosition()
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }

  isOwnEvent(event) {
    const path = event.composedPath?.() ?? []
    return path.some(node => node === this.host || node === this.root)
  }

  showHighlight(target, x, y) {
    const element = target?.nodeType === 1 ? target : null
    if (!element?.getBoundingClientRect) {
      this.hideHighlight()
      return
    }
    if (this.selections.some(selection => selection.element === element)) {
      // Already outlined by its mark: a second box would only add noise.
      this.hideHighlight()
      return
    }
    const rect = element.getBoundingClientRect()
    this.highlight.style.display = 'block'
    this.highlight.style.left = rect.left + 'px'
    this.highlight.style.top = rect.top + 'px'
    this.highlight.style.width = rect.width + 'px'
    this.highlight.style.height = rect.height + 'px'
    const info = devtoolsRuntime()?.locateElement?.(element)
    // `~` marks a line Svelte only recorded for an enclosing element: the exact
    // line is resolved from the file when the element is picked.
    const source = info?.source
      ? (info.source.enclosing ? '~' : '') + relLocation(info.source, this.config.root)
      : ''
    this.tip.style.display = 'block'
    this.tip.textContent =
      '<' + element.tagName.toLowerCase() + '>' + (source ? '  ' + source : '  (no source)')
    const nearRight = x + 300 > window.innerWidth
    this.tip.style.left = (nearRight ? Math.max(4, x - 300) : x + 14) + 'px'
    this.tip.style.top = Math.min(window.innerHeight - 28, y + 18) + 'px'
  }

  hideHighlight() {
    if (this.tipFrame) {
      cancelAnimationFrame(this.tipFrame)
      this.tipFrame = null
    }
    this.highlight.style.display = 'none'
    this.tip.style.display = 'none'
  }

  async addSelection(node) {
    const runtime = devtoolsRuntime()
    if (!runtime?.inspectElement) {
      this.showStatus('The Svelte devtools runtime is not loaded on this page.', 'error')
      return
    }
    const payload = runtime.inspectElement(node)
    if (payload?.error) {
      this.showStatus(payload.error, 'error')
      return
    }
    const element = elementOf(node)
    // The numbered outline replaces the hover box: the element is picked now.
    this.hideHighlight()
    // Picking the same element again un-picks it: the outline is the feedback
    // either way.
    const existing = this.selections.findIndex(selection => selection.element === element)
    if (existing !== -1) {
      this.selections.splice(existing, 1)
      this.setPanelOpen(true)
      this.renderPanel()
      this.showStatus('Removed ' + (payload.element?.tag ?? 'element'))
      return
    }
    if (this.selections.length >= MAX_SELECTIONS) {
      this.setPanelOpen(true)
      this.showStatus('At most ' + MAX_SELECTIONS + ' elements per prompt.', 'error')
      return
    }
    const source = this.options.source ? await this.loadSource(payload) : null
    const location = resolveElementSource(payload, source, this.config.root)
    this.selections.push({ payload, source, element, location })
    this.setPanelOpen(true)
    this.renderPanel()
    if (payload.components.length === 0) {
      // The runtime is there but nothing is tracked: the wrapper was served
      // without component tracking, so there is no chain or state to report.
      this.showStatus('Component tracking is off: no component or state in the prompt.', 'error')
      return
    }
    this.showStatus('Added ' + (payload.element?.tag ?? 'element'))
  }

  /**
   * The element's file, fetched once per pick. The line is resolved when the
   * prompt is formatted: Svelte's own location may point at an enclosing
   * element, and dropping the text here would lose that fallback.
   */
  async loadSource(payload) {
    const file = payload?.source?.file ?? payload?.components?.[0]?.file ?? null
    if (!file) return null
    const text = await fetchSource(file, this.config.root, this.config.base)
    return text ? { file, text } : null
  }

  /** Clear resets the whole form: picked elements and the instructions. */
  clearSelections() {
    this.selections = []
    this.options.instructions = ''
    this.renderPanel()
    this.hideHighlight()
    this.showStatus('Cleared')
  }

  async copy() {
    if (this.selections.length === 0) {
      this.showStatus('Pick at least one element first.', 'error')
      return
    }
    // The source window is loaded at pick time when the option was on; when
    // the option is toggled on afterwards, fill it in now.
    if (this.options.source) {
      await Promise.all(
        this.selections.map(async selection => {
          selection.source ??= await this.loadSource(selection.payload)
        }),
      )
    }
    const text = buildPrompt(this.selections, this.options, {
      root: this.config.root,
      plugin: 'vite-devtools-svelte prompt toolbar',
    })
    const ok = await copyText(text)
    if (ok) {
      this.setPicking(false)
      this.showStatus('Copied ' + text.length + ' chars')
    } else {
      this.showStatus('Could not write to the clipboard.', 'error')
    }
  }

  showStatus(message, tone) {
    if (!this.status) return
    this.status.textContent = message
    this.status.dataset.tone = tone ?? 'info'
    clearTimeout(this.statusTimer)
    this.statusTimer = setTimeout(() => {
      if (this.status) this.status.textContent = ''
    }, 4000)
  }
}

/** Mount the toolbar once per document. Safe to call more than once. */
export function mountToolbar(config = toolbarConfig()) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  if (!document.body) return null
  const existing = document.querySelector('#' + TOOLBAR_HOST_ID)
  if (existing) return existing
  const host = document.createElement('div')
  host.id = TOOLBAR_HOST_ID
  // The host covers the page (for the fixed highlights) but must not take
  // pointer events: everything interactive lives inside the shadow root.
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none'
  document.body.append(host)
  const toolbar = new PromptToolbar(host, config)
  window.__SVELTE_DEVTOOLS_PROMPT__ = toolbar
  return host
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.body) mountToolbar()
  else {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        mountToolbar()
      },
      { once: true },
    )
  }
}
