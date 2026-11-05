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
// This file is plain browser JavaScript with no imports: the plugin serves it
// verbatim from a dev-server middleware, so it must not need a bundler. The
// formatting helpers are exported for unit tests.

/** Id of the host element (also used to keep the toolbar out of picks). */
export const TOOLBAR_HOST_ID = '__svelte-devtools-prompt'

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
const MAX_SOURCE_LINES = 24
const MAX_PROMPT_CHARS = 60000

const DEFAULT_OPTIONS = {
  instructions: '',
  state: true,
  props: true,
  source: true,
  template: true,
}

// --- Formatting (pure) ---

/** `file` relative to the project root, with forward slashes. */
export function relPath(file, root) {
  if (!file) return ''
  let path = String(file).replaceAll('\\', '/')
  if (!root) return path
  const base = String(root).replaceAll('\\', '/').replace(/\/?$/, '/')
  // `/@fs/root/...` style and plain paths both start with the root here.
  if (path.startsWith(base)) path = path.slice(base.length)
  else if (path === base.slice(0, -1)) path = ''
  return path
}

/** `file:line:column`, root-relative. */
export function relLocation(loc, root) {
  if (!loc?.file) return ''
  const path = relPath(loc.file, root)
  if (loc.line === null || loc.line === undefined) return path
  return (
    path +
    ':' +
    loc.line +
    (loc.column === null || loc.column === undefined ? '' : ':' + loc.column)
  )
}

/** A `[:line, :line, …]** window of a source file, with a `>` on `selectedLine`. */
export function sourceWindow(text, selectedLine, radius = 8) {
  if (!text || !selectedLine) return null
  const lines = String(text).split(/\r?\n/)
  const from = Math.max(1, selectedLine - radius)
  const to = Math.min(lines.length, selectedLine + radius, from + MAX_SOURCE_LINES - 1)
  const width = String(to).length
  const out = []
  for (let n = from; n <= to; n++) {
    const marker = n === selectedLine ? '>' : ' '
    out.push(marker + ' ' + String(n).padStart(width, ' ') + ' | ' + lines[n - 1])
  }
  return out.join('\n')
}

/** The language a source window belongs to (for the markdown fence). */
export function fenceLanguage(file) {
  const path = String(file ?? '')
  if (path.endsWith('.svelte')) return 'svelte'
  if (path.endsWith('.ts')) return 'ts'
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'js'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.json')) return 'json'
  return ''
}

/** The element a pick started on: text nodes and comments resolve upwards. */
function elementOf(node) {
  let element = node
  while (element?.nodeType !== 1) {
    if (!element) return null
    element = element.parentElement ?? element.parentNode
  }
  return element
}

function inlineCode(value) {
  return '`' + String(value) + '`'
}

/** Attribute names good enough to find an element in its source text. */
const MATCH_ATTRS = ['href', 'type', 'name', 'aria-label', 'title', 'placeholder', 'value', 'src']

/** `class="a b"` for the authored classes (Svelte's `svelte-xxxx` hashes are runtime-only). */
function classNeedle(classes) {
  const authored = (classes ?? []).filter(name => !name.startsWith('svelte-'))
  return authored.length > 0 ? 'class="' + authored.join(' ') + '"' : null
}

/**
 * Svelte records a source location only for the elements it needs for error
 * attribution; a static `<p>` inside a big markup block often has none, so the
 * nearest recorded element is an ancestor. Find the element's own line in the
 * file instead, by matching its tag plus its most distinctive attribute.
 *
 * Returns `{ line, basis }` (`basis` is the attribute used) or `null`.
 */
export function matchSourceLine(text, element, hintLine) {
  if (!text || !element?.tag) return null
  const lines = String(text).split(/\r?\n/)
  const tag = String(element.tag).toLowerCase()
  const tagPattern = new RegExp('<' + tag + '(?=[\\s/>])')
  const needles = []
  const classes = classNeedle(element.classes)
  if (classes) needles.push(classes)
  if (element.id) needles.push('id="' + element.id + '"')
  for (const name of MATCH_ATTRS) {
    const value = element.attrs?.[name]
    if (typeof value === 'string' && value.length > 0 && value.length <= 80) {
      needles.push(name + '="' + value + '"')
    }
  }
  for (const needle of needles) {
    const hits = []
    lines.forEach((line, index) => {
      if (tagPattern.test(line) && line.includes(needle)) hits.push(index + 1)
    })
    if (hits.length > 0) {
      // Several identical elements: the one closest to the compiler's hint.
      const line = hintLine
        ? hits.reduce((a, b) => (Math.abs(b - hintLine) < Math.abs(a - hintLine) ? b : a))
        : hits[0]
      return { line, basis: needle }
    }
  }
  return null
}

/** Whether a source line plausibly opens this element (tag + one of its classes). */
function isElementLine(line, element) {
  if (!line || !element?.tag) return false
  const tagPattern = new RegExp('<' + String(element.tag).toLowerCase() + '(?=[\\s/>])')
  if (!tagPattern.test(line)) return false
  const authored = (element.classes ?? []).filter(name => !name.startsWith('svelte-'))
  if (authored.length === 0) return true
  return authored.some(name => line.includes(name))
}

/**
 * The location to report for an inspected element: the compiler's location
 * when it points at the element itself, otherwise the line found by matching
 * the element in the file. `compiledLine` keeps what Svelte recorded.
 */
export function resolveElementSource(payload, file, root) {
  const loc = payload?.source ?? null
  const filePath = loc?.file ?? payload?.components?.[0]?.file ?? null
  if (!filePath) return null
  const resolved = {
    file: filePath,
    line: loc?.line ?? null,
    column: loc?.column ?? null,
    compiledLine: loc?.line ?? null,
    matched: null,
  }
  const text = file && relPath(file.file, root) === relPath(filePath, root) ? file.text : null
  if (!text || !payload?.element) return resolved
  const lines = String(text).split(/\r?\n/)
  const hint = resolved.line
  if (hint && isElementLine(lines[hint - 1], payload.element)) return resolved
  const match = matchSourceLine(text, payload.element, hint)
  if (match) {
    resolved.line = match.line
    resolved.column = null
    resolved.matched = match.basis
  }
  return resolved
}

/**
 * One value from the runtime (already a JSON string) rendered for a prompt:
 * small values as-is, anything long summarised, so a page's `data` blob does
 * not bury the markup.
 */
export function summarizeValue(json) {
  if (json === null || json === undefined) return ''
  let value
  try {
    value = JSON.parse(json)
  } catch {
    return String(json).length > 120 ? String(json).slice(0, 120) + '…' : String(json)
  }
  return renderValue(value)
}

// Written with the values in them while they still fit: `{status: "ok",
// latencyMs: 12}` explains a component, a bare list of keys does not. Past the
// budget the structure alone is shown, so a page's `data` blob cannot flood
// the prompt.
const INLINE_BUDGET = 240
const INLINE_ITEMS = 6
const INLINE_DEPTH = 2
const INLINE_STRING = 40

/** `key: value`, with the quotes JSON would need only where they matter. */
function inlineKey(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

function inlineValue(value, depth) {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    const text = value.length > INLINE_STRING ? value.slice(0, INLINE_STRING) + '…' : value
    return JSON.stringify(text)
  }
  if (typeof value !== 'object') return String(value)
  if (depth >= INLINE_DEPTH) return Array.isArray(value) ? '[…]' : '{…}'
  if (Array.isArray(value)) {
    const shown = value.slice(0, INLINE_ITEMS).map(item => inlineValue(item, depth + 1))
    if (value.length > shown.length) shown.push('…' + (value.length - shown.length) + ' more')
    return '[' + shown.join(', ') + ']'
  }
  const entries = Object.entries(value)
  const shown = entries
    .slice(0, INLINE_ITEMS)
    .map(([name, item]) => inlineKey(name) + ': ' + inlineValue(item, depth + 1))
  if (entries.length > shown.length) shown.push('…' + (entries.length - shown.length) + ' more')
  return '{' + shown.join(', ') + '}'
}

function renderValue(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    const text = value.length > 80 ? value.slice(0, 80) + '…' : value
    return JSON.stringify(text)
  }
  if (typeof value !== 'object') return String(value)
  const inline = inlineValue(value, 0)
  if (inline.length <= INLINE_BUDGET) return inline
  if (Array.isArray(value)) return '[' + value.length + ' items]'
  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  const shown = keys.slice(0, INLINE_ITEMS).join(', ')
  return (
    '{' +
    shown +
    (keys.length > INLINE_ITEMS ? ', …' + (keys.length - INLINE_ITEMS) + ' more' : '') +
    '}'
  )
}

/** `key=value, key2=value2` for a props JSON string, bounded. */
export function summarizeProps(json) {
  if (!json) return ''
  let value
  try {
    value = JSON.parse(json)
  } catch {
    return summarizeValue(json)
  }
  if (value === null || typeof value !== 'object') return summarizeValue(json)
  const entries = Object.entries(value)
    .filter(([name]) => name !== '$$slots')
    .map(([name, item]) => name + '=' + renderValue(item))
  const text = entries.join(', ')
  return text.length > 400 ? text.slice(0, 400) + '…' : text
}

// Tag, id and authored classes: the element is identified by where it lives
// and what it is, not by the copy the app happens to render inside it.
function elementTitle(element) {
  if (!element) return 'element'
  const tag = element.tag ?? 'element'
  const id = element.id ? '#' + element.id : ''
  const classes = (element.classes ?? []).filter(name => !name.startsWith('svelte-'))
  return tag + id + (classes.length > 0 ? '.' + classes.join('.') : '')
}

function renderState(component, options) {
  const lines = []
  if (options.props && component.props) {
    const props = summarizeProps(component.props)
    if (props) lines.push('  - props (at mount): ' + props)
  }
  if (options.state && component.state && component.state.length > 0) {
    for (const node of component.state) {
      lines.push(
        '  - ' +
          (node.type === 'derived' ? '$derived ' : '$state ') +
          node.name +
          ' = ' +
          summarizeValue(node.value),
      )
    }
  }
  return lines
}

/**
 * Markdown for one inspected element (`payload` is what the runtime's
 * `inspectElement()` returns; `source` is the optional file text used for the
 * code window next to the selected node).
 */
export function formatSelection(payload, source, options, root) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const element = payload?.element ?? null
  const located = resolveElementSource(payload, source, root)
  const sections = [
    '### Selected element ' + elementTitle(element),
    elementLines(element, located, root),
    opts.template ? templateLines(payload?.template ?? null, root) : '',
    componentLines(payload?.components ?? [], opts, root, located?.file ?? null),
    opts.source ? sourceLines(source, located, root) : '',
  ]
  return sections.filter(section => section.length > 0).join('\n\n')
}

/** Where the element is declared, how it is reachable in the DOM, its markup. */
function elementLines(element, located, root) {
  const attrs = element?.attrs ? Object.entries(element.attrs) : []
  const interesting = attrs.filter(([name]) => name !== 'class' && name !== 'style')
  const attributeLine =
    interesting.length === 0
      ? ''
      : '- attributes: ' +
        interesting
          .slice(0, 12)
          .map(([name, value]) => (value === '' ? name : name + '="' + value + '"'))
          .join(' ')
  const compilerNote =
    located?.matched && located.compiledLine && located.compiledLine !== located.line
      ? '- location note: line matched by ' +
        inlineCode(located.matched) +
        '; Svelte recorded the enclosing element at ' +
        inlineCode(
          relLocation({ file: located.file, line: located.compiledLine, column: null }, root),
        )
      : ''
  const lines = [
    located?.file ? '- markup: ' + inlineCode(relLocation(located, root)) : '',
    compilerNote,
    element?.selector ? '- DOM path: ' + inlineCode(element.selector) : '',
    element?.size ? '- size: ' + element.size : '',
    attributeLine,
    element?.outerHTML ? '```html\n' + element.outerHTML + '\n```' : '',
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

const FRAME_LABELS = {
  component: frame => '<' + (frame.componentTag ?? 'component') + ' />',
  render: () => '{@render}',
  snippet: () => '{#snippet}',
  if: () => '{#if}',
  each: () => '{#each}',
  await: () => '{#await}',
  key: () => '{#key}',
  boundary: () => '<svelte:boundary>',
}

/** Svelte's dev stack: the component tags and blocks the element sits in. */
function templateLines(template, root) {
  const frames = (template ?? []).filter(frame => isProjectFile(frame.file, root)).slice(0, 8)
  if (frames.length === 0) return ''
  const lines = frames.map(frame => {
    const where = relLocation({ file: frame.file, line: frame.line, column: frame.column }, root)
    const label = FRAME_LABELS[frame.type]
    const what = label ? label(frame) : '{#' + frame.type + '}'
    return '- ' + what + ' at ' + inlineCode(where)
  })
  return ['Template context (innermost first):', ...lines].join('\n')
}

/** Frames and instances from installed packages (SvelteKit internals) are noise. */
function isProjectFile(file, root) {
  if (!file) return false
  const path = String(file).replaceAll('\\', '/')
  if (path.includes('/node_modules/')) return false
  const relative = relPath(path, root)
  return relative.length > 0 && !relative.startsWith('..')
}

/**
 * The picked instance and its ancestors, with props and live $state.
 *
 * When markup is passed to another component as a snippet (`{@render
 * children()}`), Svelte's metadata attributes the DOM to the component that
 * renders it, so the instance at the head of the chain may not be the one whose
 * file the element is written in. That instance is labelled instead of
 * reordering the tree.
 */
function componentLines(chain, options, root, sourceFile) {
  const project = chain.filter(component => isProjectFile(component.file, root))
  if (project.length === 0) return ''
  const sourcePath = sourceFile ? relPath(sourceFile, root) : null
  const ownerIndex = sourcePath
    ? project.findIndex(component => relPath(component.file, root) === sourcePath)
    : -1
  const note = component => {
    if (ownerIndex === 0) return ''
    if (component === project[0]) return ' — renders the markup'
    if (component === project[ownerIndex]) return ' — defines the markup'
    return ''
  }
  const lines = ['Component chain (innermost first):']
  project.forEach((component, index) => {
    lines.push(
      index +
        1 +
        '. ' +
        component.name +
        ' — ' +
        inlineCode(relPath(component.file, root)) +
        note(component),
    )
    if (component.usage) {
      lines.push('  - rendered by ' + inlineCode(relLocation(component.usage, root)))
    }
    if (component.renders) lines.push('  - renders: ' + component.renders)
    lines.push(...renderState(component, options))
  })
  return lines.join('\n')
}

/** A numbered window of the file around the selected line. */
function sourceLines(source, located, root) {
  if (!source?.text) return ''
  const window = sourceWindow(source.text, located?.line ?? source.line)
  if (!window) return ''
  const file = relPath(source.file, root)
  return ['Source of ' + inlineCode(file) + ':', '```' + fenceLanguage(file), window, '```'].join(
    '\n',
  )
}

/**
 * The text copied to the clipboard: page context, the user's request, then one
 * block per selected element.
 */
export function buildPrompt(selections, options, meta = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const root = meta.root ?? ''
  const page = selections.find(selection => selection.payload?.page)?.payload?.page ?? null
  const context = [
    page ? 'Page: ' + inlineCode(page.url) + (page.title ? ' (' + page.title + ')' : '') : '',
    page?.viewport ? 'Viewport: ' + page.viewport : '',
    meta.plugin ? 'Collected with: ' + meta.plugin : '',
  ]
  const blocks = selections
    .slice(0, MAX_SELECTIONS)
    .map(selection => formatSelection(selection.payload, selection.source, opts, root))
  if (selections.length > MAX_SELECTIONS) {
    blocks.push('(' + (selections.length - MAX_SELECTIONS) + ' further selections were dropped)')
  }
  const instructions = opts.instructions.trim()
  const text = [
    '# UI context from the running app',
    context.filter(line => line.length > 0).join('\n'),
    '## What I need',
    instructions.length > 0 ? instructions : '(no instructions added — describe the change here)',
    '## Selection',
    blocks.join('\n\n---\n\n'),
  ]
    .filter(section => section.length > 0)
    .join('\n\n')
  if (text.length > MAX_PROMPT_CHARS) {
    return text.slice(0, MAX_PROMPT_CHARS) + '\n\n(prompt truncated: ' + text.length + ' chars)'
  }
  return text
}

// --- Browser side ---

function devtoolsRuntime() {
  return typeof window === 'undefined' ? null : (window.__SVELTE_DEVTOOLS__ ?? null)
}

/** Project root and version, handed over by the dev server in the script URL. */
function toolbarConfig() {
  try {
    const url = new URL(import.meta.url)
    return {
      root: url.searchParams.get('root') ?? '',
      version: url.searchParams.get('version') ?? '',
    }
  } catch {
    return { root: '', version: '' }
  }
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
async function fetchSource(file, root) {
  if (!file) return null
  const absolute = file.startsWith('/') ? file : String(root).replace(/\/?$/, '') + '/' + file
  try {
    const response = await fetch('/@fs' + absolute + '?raw')
    if (!response.ok) return null
    const text = await response.text()
    const match = /export default (".*")\s*;?\s*$/s.exec(text)
    if (!match) return null
    return JSON.parse(match[1])
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
  :host { all: initial; }
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
    border: 1px solid #1f2a3d; background: #0b1220; color: #cbd5e1;
    font-size: 12px; cursor: pointer;
  }
  .count[hidden] { display: none; }
  .count:hover { color: #f3f4f6; border-color: #334155; }
  .fab {
    /* the host covers the page with pointer-events: none (inherited) */
    pointer-events: auto;
    display: flex; align-items: center; gap: 6px;
    height: 36px; padding: 0 12px; border: 0; border-radius: 999px;
    background: #111827; color: #f9fafb; cursor: pointer;
    box-shadow: 0 6px 24px -8px rgb(0 0 0 / 45%), 0 1px 0 rgb(255 255 255 / 8%) inset;
    opacity: 0.92;
  }
  .fab:hover { opacity: 1; }
  .fab[data-active="true"] { background: #1d4ed8; }
  .fab .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
  .fab[data-active="true"] .dot { background: #fde047; }
  .panel {
    pointer-events: auto;
    width: min(420px, calc(100vw - 36px));
    max-height: min(70vh, 620px); overflow-y: auto; overflow-x: hidden;
    background: #0b1220; color: #e5e7eb;
    border: 1px solid #1f2a3d; border-radius: 14px;
    box-shadow: 0 24px 60px -24px rgb(0 0 0 / 70%);
  }
  .panel[hidden] { display: none; }
  .head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px; border-bottom: 1px solid #1f2a3d;
    font-weight: 600; color: #f3f4f6;
  }
  .head .hint { font-weight: 400; color: #94a3b8; font-size: 11px; }
  .body { padding: 12px; display: grid; gap: 10px; }
  .empty { color: #94a3b8; font-size: 12px; }
  .chip {
    display: flex; align-items: start; gap: 8px;
    padding: 8px 10px; border: 1px solid #1f2a3d; border-radius: 10px; background: #0f172a;
  }
  .chip .text { flex: 1; min-width: 0; }
  .chip .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip .where { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #7dd3fc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  textarea {
    width: 100%; min-height: 84px; resize: vertical; padding: 8px 10px;
    border: 1px solid #1f2a3d; border-radius: 10px; background: #0f172a; color: #e5e7eb;
    font: 13px/1.5 ui-sans-serif, system-ui, sans-serif;
  }
  textarea:focus { outline: 2px solid #2563eb; outline-offset: -1px; }
  .options { display: flex; flex-wrap: wrap; gap: 4px 12px; color: #cbd5e1; font-size: 12px; }
  .options label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  button {
    height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid #1f2a3d;
    background: #111827; color: #e5e7eb; cursor: pointer;
  }
  button:hover { background: #16233a; }
  button.primary { background: #2563eb; border-color: #2563eb; color: white; font-weight: 600; }
  button.primary:hover { background: #1d4ed8; }
  button.ghost { border-color: transparent; background: transparent; color: #94a3b8; }
  button.icon { height: 22px; padding: 0 6px; font-size: 12px; color: #94a3b8; }
  .status { color: #86efac; font-size: 12px; }
  .status[data-tone="error"] { color: #fca5a5; }
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
    background: #16a34a; color: #fff; text-align: center;
    font: 600 11px/18px ui-sans-serif, system-ui, sans-serif;
    box-shadow: 0 1px 4px rgb(0 0 0 / 30%);
  }
  .highlight {
    position: fixed; z-index: 2; pointer-events: none; display: none;
    border: 2px solid #3b82f6; background: rgb(59 130 246 / 14%); border-radius: 3px;
  }
  .tip {
    position: fixed; z-index: 1; pointer-events: none; display: none;
    max-width: 340px; padding: 4px 8px; border-radius: 6px;
    background: #111827; color: #e5e7eb; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    box-shadow: 0 8px 20px -10px rgb(0 0 0 / 60%);
  }
  /* The picking cursor is inherited from the host: the toolbar is still
     interactive, so its own controls keep their usual cursors. */
  .panel, .panel * { cursor: auto; }
  .panel textarea { cursor: text; }
  .panel button { cursor: pointer; }
`

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
    fab.innerHTML = '<span class="dot"></span><span>Inspect</span>'
    // Drag anywhere on the dock; a press that does not move is a click.
    dock.addEventListener('pointerdown', event => this.startDrag(event))
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
    dock.append(fab, count)
    const panel = document.createElement('section')
    panel.className = 'panel'
    panel.hidden = true
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
    where.textContent = selection.payload?.source
      ? relLocation(selection.payload.source, this.config.root)
      : '(no Svelte source location)'
    text.append(name, where)
    const remove = document.createElement('button')
    remove.className = 'icon'
    remove.type = 'button'
    remove.textContent = '✕'
    remove.title = 'Remove'
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
      const rect = element?.isConnected ? element.getBoundingClientRect() : null
      const onScreen =
        rect !== null &&
        (rect.width > 0 || rect.height > 0) &&
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
      document.addEventListener('keydown', this.onKeyDown, capture)
    } else {
      document.removeEventListener('pointermove', this.onPointerMove, capture)
      document.removeEventListener('pointerdown', this.onPointerDown, capture)
      document.removeEventListener('click', this.onClick, capture)
      document.removeEventListener('auxclick', this.onClick, capture)
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

  /** Picks must never reach the app: no click, no focus, no navigation. */
  onPointerDown = event => {
    if (this.isOwnEvent(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const element = event.composedPath?.()[0] ?? event.target
    void this.addSelection(element)
  }

  onClick = event => {
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

  /** Place the shell where the user dragged the button, clamped to the viewport. */
  applyPosition() {
    if (!this.shell) return
    const margin = 8
    const rect = this.dock.getBoundingClientRect()
    const width = rect.width || 140
    const height = rect.height || 36
    const maxX = Math.max(margin, window.innerWidth - width - margin)
    const maxY = Math.max(margin, window.innerHeight - height - margin)
    const x = Math.min(Math.max(this.position.x ?? window.innerWidth - width - 18, margin), maxX)
    const y = Math.min(Math.max(this.position.y ?? window.innerHeight - height - 18, margin), maxY)
    this.position = { x, y }
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

  /** Keep the panel inside the viewport, on the side of the button with room. */
  fitPanel() {
    const height = this.dock.getBoundingClientRect().height || 36
    const gap = 8
    const room =
      this.placement === 'above'
        ? this.position.y - gap - 8
        : window.innerHeight - this.position.y - height - gap - 8
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
    const startX = event.clientX
    const startY = event.clientY
    const from = { x: this.position.x, y: this.position.y }
    // Only the Inspect button toggles picking on a press without movement;
    // the count chip has its own click handler (open/close the panel).
    const onButton = event.composedPath?.().includes(this.fab) ?? false
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
      if (moved) {
        this.savePosition()
        return
      }
      // Picking only: the panel would cover the page the user is about to pick.
      if (onButton) this.togglePicking()
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
    const source = this.options.source ? await this.loadSource(payload) : null
    this.selections.push({ payload, source, element })
    this.setPanelOpen(true)
    this.renderPanel()
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
    const text = await fetchSource(file, this.config.root)
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
