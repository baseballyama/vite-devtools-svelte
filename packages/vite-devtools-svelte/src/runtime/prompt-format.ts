// Pure parts of the prompt toolbar: identifying an element, finding its line in
// the source, and formatting the markdown that gets copied. Nothing here
// touches the DOM, so it is unit-tested directly (test/prompt-toolbar.test.ts) —
// the served toolbar module keeps only the browser layer.

export interface TestSource {
  file: string
  text: string
}

export interface ElementLocation {
  file: string | null
  line?: number | null
  column?: number | null
  enclosing?: boolean
}

export interface ElementInfo {
  tag: string
  tagName?: string
  id: string
  classes: string[]
  attrs: Record<string, string>
  markup: string
  size: string
  selector: string
}

export interface TemplateFrame {
  type: string
  file: string | null
  line: number | null
  column: number | null
  componentTag: string | null
}

export interface StateNode {
  name: string
  type: string
  value: string
}

export interface ComponentInfo {
  id: number
  name: string
  file: string
  usage: {
    file: string | null
    line: number | null
    column: number | null
    componentTag: string | null
  } | null
  props: string | null
  state: StateNode[]
  renders: number
}

export interface PageInfo {
  url: string
  path: string
  title: string
  viewport: string
}

export interface Inspected {
  page?: PageInfo
  element: ElementInfo | null
  source: ElementLocation | null
  template: TemplateFrame[]
  components: ComponentInfo[]
  error?: string
}

export interface ToolbarOptions {
  instructions: string
  state: boolean
  props: boolean
  source: boolean
  template: boolean
}

export interface PromptSelection {
  payload: Inspected
  source: TestSource | null
}

export interface ResolvedLocation {
  file: string
  line: number | null
  column: number | null
  compiledLine: number | null
  /** The attribute the reported line was matched by, when the compiler's line was not the element's. */
  matched: string | null
  /** True when the reported line is the ancestor Svelte recorded, not the element itself. */
  enclosing: boolean
}

export const MAX_SOURCE_LINES = 24
export const MAX_PROMPT_CHARS = 60_000

export const DEFAULT_OPTIONS: ToolbarOptions = {
  instructions: '',
  state: true,
  props: true,
  source: true,
  template: true,
}

// --- Paths ---------------------------------------------------------------

/** `file` relative to the project root, with forward slashes. */
export function relPath(file: string | null | undefined, root: string): string {
  if (!file) return ''
  let path = file.replaceAll('\\', '/')
  if (!root) return path
  const base = withTrailingSlash(root.replaceAll('\\', '/'))
  // `/@fs/root/...` style and plain paths both start with the root here.
  if (path.startsWith(base)) path = path.slice(base.length)
  else if (path === base.slice(0, -1)) path = ''
  return path
}

/** `path/` for a directory-ish path, without a regex. */
function withTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : path + '/'
}

/** `file:line:column`, root-relative. */
export function relLocation(loc: ElementLocation | null, root: string): string {
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

// --- Source windows ------------------------------------------------------

/** A `[:line, :line, …]` window of a source file, with a `>` on `selectedLine`. */
export function sourceWindow(text: string, selectedLine: number, radius = 8): string | null {
  if (!text || !selectedLine) return null
  const lines = text.split(/\r?\n/)
  const from = Math.max(1, selectedLine - radius)
  const to = Math.min(lines.length, selectedLine + radius, from + MAX_SOURCE_LINES - 1)
  const width = String(to).length
  const out: string[] = []
  for (let n = from; n <= to; n++) {
    const marker = n === selectedLine ? '>' : ' '
    out.push(marker + ' ' + String(n).padStart(width, ' ') + ' | ' + (lines[n - 1] ?? ''))
  }
  return out.join('\n')
}

/** The language a source window belongs to (for the markdown fence). */
export function fenceLanguage(file: string | null | undefined): string {
  const path = file ?? ''
  if (path.endsWith('.svelte')) return 'svelte'
  if (path.endsWith('.ts')) return 'ts'
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'js'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.json')) return 'json'
  return ''
}

// --- Element → source line ----------------------------------------------

function inlineCode(value: unknown): string {
  return '`' + String(value) + '`'
}

/** Attribute names good enough to find an element in its source text. */
const MATCH_ATTRS = ['href', 'type', 'name', 'aria-label', 'title', 'placeholder', 'value', 'src']

/**
 * Does `line` open `<tag`? Case-insensitive so SVG's camelCase names
 * (`foreignObject`) match their lowercase rendering, and with a boundary check
 * so `<a` does not match `<aside`. No regex: the tag comes from the page.
 */
function opensTag(line: string, tag: string): boolean {
  if (!tag) return false
  const needle = '<' + tag.toLowerCase()
  const lower = line.toLowerCase()
  let from = lower.indexOf(needle)
  while (from !== -1) {
    const next = lower.charAt(from + needle.length)
    if (next === '' || next === ' ' || next === '\t' || next === '>' || next === '/') return true
    from = lower.indexOf(needle, from + 1)
  }
  return false
}

/** `class="a b"` for the authored classes (Svelte's `svelte-xxxx` hashes are runtime-only). */
function classNeedle(classes: string[] | undefined): string | null {
  const authored = (classes ?? []).filter(name => !name.startsWith('svelte-'))
  return authored.length > 0 ? 'class="' + authored.join(' ') + '"' : null
}

/**
 * Svelte assigns a location to every element the compiler lists, but during
 * hydration its assignment walks the existing DOM by position, so markup that
 * comes from a child component can shift the mapping and leave an element with
 * its ancestor's (or no) location. Matching the element in its file by tag plus
 * a distinctive attribute is the fallback; a match is only reported when the
 * attribute is exact, so the answer is either right or absent.
 *
 * Returns `{ line, basis }` (`basis` is the attribute used) or `null`.
 */
export function matchSourceLine(
  text: string,
  element: {
    tag?: string
    tagName?: string
    id?: string
    classes?: string[]
    attrs?: Record<string, string>
  } | null,
  hintLine?: number | null,
): { line: number; basis: string } | null {
  const tag = element?.tagName ?? element?.tag
  if (!text || !tag) return null
  const lines = text.split(/\r?\n/)
  const needles: string[] = []
  const classes = classNeedle(element?.classes)
  if (classes) needles.push(classes)
  if (element?.id) needles.push('id="' + element.id + '"')
  for (const name of MATCH_ATTRS) {
    const value = element?.attrs?.[name]
    if (typeof value === 'string' && value.length > 0 && value.length <= 80) {
      needles.push(name + '="' + value + '"')
    }
  }
  const authored = classNeedle(element?.classes) !== null
  for (const needle of needles) {
    // A bare attribute is not identity for an element that also has classes:
    // several links can share `href`, one class list cannot.
    if (authored && !needle.startsWith('class="')) continue
    const hits: number[] = []
    lines.forEach((line, index) => {
      if (opensTag(line, tag) && line.includes(needle)) hits.push(index + 1)
    })
    if (hits.length > 0) {
      // Several identical elements: the one closest to the compiler's hint.
      const first = hits[0]!
      const line = hintLine
        ? hits.reduce((a, b) => (Math.abs(b - hintLine) < Math.abs(a - hintLine) ? b : a), first)
        : first
      return { line, basis: needle }
    }
  }
  return null
}

/** Whether a source line plausibly opens this element (tag + one of its classes). */
function isElementLine(line: string, element: ElementInfo): boolean {
  if (!line) return false
  if (!opensTag(line, element.tagName ?? element.tag)) return false
  const authored = (element.classes ?? []).filter(name => !name.startsWith('svelte-'))
  if (authored.length === 0) return true
  return authored.some(name => line.includes(name))
}

/**
 * The location to report for an inspected element: the compiler's location when
 * it points at the element itself, otherwise the line found by matching the
 * element in the file. `compiledLine` keeps what Svelte recorded.
 */
export function resolveElementSource(
  payload: Inspected | null | undefined,
  file: TestSource | null,
  root: string,
): ResolvedLocation | null {
  const loc = payload?.source ?? null
  const filePath = loc?.file ?? payload?.components?.[0]?.file ?? null
  if (!filePath) return null
  const resolved: ResolvedLocation = {
    file: filePath,
    line: loc?.line ?? null,
    column: loc?.column ?? null,
    compiledLine: loc?.line ?? null,
    matched: null,
    // A recorded line starts out as "possibly the ancestor": only a line that
    // is verified against the element's own markup counts as the element's.
    enclosing: Boolean(loc?.line),
  }
  const text = file && relPath(file.file, root) === relPath(filePath, root) ? file.text : null
  const element = payload?.element ?? null
  if (!text || !element) return resolved
  const lines = text.split(/\r?\n/)
  const hint = resolved.line
  if (hint && isElementLine(lines[hint - 1] ?? '', element)) {
    resolved.enclosing = false
    return resolved
  }
  const match = matchSourceLine(text, element, hint)
  if (match) {
    resolved.line = match.line
    resolved.column = null
    resolved.matched = match.basis
    resolved.enclosing = false
  } else if (resolved.enclosing) {
    // The column belongs to the ancestor, not to the element.
    resolved.column = null
  }
  return resolved
}

// --- Values --------------------------------------------------------------

// Written with the values in them while they still fit: `{status: "ok",
// latencyMs: 12}` explains a component, a bare list of keys does not. Past the
// budget the structure alone is shown, so a page's `data` blob cannot flood
// the prompt.
const INLINE_BUDGET = 240
const INLINE_ITEMS = 6
const INLINE_DEPTH = 2
const INLINE_STRING = 40

/** `key: value`, with the quotes JSON would need only where they matter. */
function inlineKey(name: string): string {
  let plain = name.length > 0
  for (let i = 0; i < name.length && plain; i++) {
    const ch = name[i] ?? ''
    plain =
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_' ||
      ch === '$' ||
      (i > 0 && ch >= '0' && ch <= '9')
  }
  return plain ? name : JSON.stringify(name)
}

function primitiveText(value: unknown): string {
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return '() => {…}'
  if (typeof value === 'bigint') return value.toString() + 'n'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return String(value)
  }
  return '{…}'
}

function inlineValue(value: unknown, depth: number): string {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    const text = value.length > INLINE_STRING ? value.slice(0, INLINE_STRING) + '…' : value
    return JSON.stringify(text)
  }
  if (typeof value !== 'object') return primitiveText(value)
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

function renderValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    const text = value.length > 80 ? value.slice(0, 80) + '…' : value
    return JSON.stringify(text)
  }
  if (typeof value !== 'object') return primitiveText(value)
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

/** One value from the runtime (already a JSON string) rendered for a prompt. */
export function summarizeValue(json: string | null | undefined): string {
  if (json === null || json === undefined) return ''
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return json.length > 120 ? json.slice(0, 120) + '…' : json
  }
  return renderValue(value)
}

/** `key=value, key2=value2` for a props JSON string, bounded. */
export function summarizeProps(json: string | null): string {
  if (!json) return ''
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return summarizeValue(json)
  }
  if (value === null || typeof value !== 'object') return summarizeValue(json)
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([name]) => name !== '$$slots')
    .map(([name, item]) => name + '=' + renderValue(item))
  const text = entries.join(', ')
  return text.length > 400 ? text.slice(0, 400) + '…' : text
}

// --- Markdown ------------------------------------------------------------

// Tag, id and authored classes: the element is identified by where it lives
// and what it is, not by the copy the app happens to render inside it.
export function elementTitle(element: ElementInfo | null): string {
  if (!element) return 'element'
  const tag = element.tag ?? 'element'
  const id = element.id ? '#' + element.id : ''
  const classes = (element.classes ?? []).filter(name => !name.startsWith('svelte-'))
  return tag + id + (classes.length > 0 ? '.' + classes.join('.') : '')
}

function renderState(component: ComponentInfo, options: ToolbarOptions): string[] {
  const lines: string[] = []
  if (options.props && component.props) {
    const props = summarizeProps(component.props)
    if (props) lines.push('  - props: ' + props)
  }
  if (options.state && component.state.length > 0) {
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
 * The honest footnote under `- markup:`: either the line was matched in the
 * file (and Svelte only recorded an ancestor), or nothing in the file matched
 * and the reported line *is* the ancestor.
 */
function locationNote(located: ResolvedLocation | null, root: string): string {
  if (!located) return ''
  const reported = relLocation({ file: located.file, line: located.line, column: null }, root)
  const compilerLine =
    located.compiledLine && located.compiledLine !== located.line
      ? relLocation({ file: located.file, line: located.compiledLine, column: null }, root)
      : null
  if (located.matched && compilerLine) {
    return (
      '- location note: line matched by ' +
      inlineCode(located.matched) +
      '; Svelte recorded the enclosing element at ' +
      inlineCode(compilerLine)
    )
  }
  if (located.enclosing) {
    return (
      '- location note: ' +
      inlineCode(reported) +
      " is the enclosing element Svelte recorded; the element's own line was not found"
    )
  }
  return ''
}

/** Where the element is declared, how it is reachable in the DOM, its markup. */
function elementLines(
  element: ElementInfo | null,
  located: ResolvedLocation | null,
  root: string,
): string {
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
  const compilerNote = locationNote(located, root)
  const lines = [
    located?.file ? '- markup: ' + inlineCode(relLocation(located, root)) : '',
    compilerNote,
    element?.selector ? '- DOM path: ' + inlineCode(element.selector) : '',
    element?.size ? '- size: ' + element.size : '',
    attributeLine,
    element?.markup ? '```html\n' + element.markup + '\n```' : '',
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

const FRAME_LABELS: Record<string, (frame: TemplateFrame) => string> = {
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
function templateLines(template: TemplateFrame[] | null, root: string): string {
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
function isProjectFile(file: string | null, root: string): boolean {
  if (!file) return false
  const path = file.replaceAll('\\', '/')
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
function componentLines(
  chain: ComponentInfo[],
  options: ToolbarOptions,
  root: string,
  sourceFile: string | null,
): string {
  const project = chain.filter(component => isProjectFile(component.file, root))
  if (project.length === 0) return ''
  const sourcePath = sourceFile ? relPath(sourceFile, root) : null
  const ownerIndex = sourcePath
    ? project.findIndex(component => relPath(component.file, root) === sourcePath)
    : -1
  const note = (component: ComponentInfo): string => {
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
function sourceLines(
  source: TestSource | null,
  located: ResolvedLocation | null,
  root: string,
): string {
  if (!source?.text) return ''
  const window = sourceWindow(source.text, located?.line ?? 1)
  if (!window) return ''
  const file = relPath(source.file, root)
  return ['Source of ' + inlineCode(file) + ':', '```' + fenceLanguage(file), window, '```'].join(
    '\n',
  )
}

/**
 * Markdown for one inspected element (`payload` is what the runtime's
 * `inspectElement()` returns; `source` is the optional file text used for the
 * code window next to the selected node).
 */
export function formatSelection(
  payload: Inspected | null | undefined,
  source: TestSource | null,
  options: Partial<ToolbarOptions>,
  root: string,
): string {
  const opts: ToolbarOptions = { ...DEFAULT_OPTIONS, ...options }
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

/**
 * The text copied to the clipboard: page context, the user's request, then one
 * block per selected element.
 */
export function buildPrompt(
  selections: PromptSelection[],
  options: Partial<ToolbarOptions>,
  meta: { root?: string; plugin?: string } = {},
): string {
  const opts: ToolbarOptions = { ...DEFAULT_OPTIONS, ...options }
  const root = meta.root ?? ''
  const page = selections.find(selection => selection.payload?.page)?.payload?.page ?? null
  const context = [
    page ? 'Page: ' + inlineCode(page.url) + (page.title ? ' (' + page.title + ')' : '') : '',
    page?.viewport ? 'Viewport: ' + page.viewport : '',
    meta.plugin ? 'Collected with: ' + meta.plugin : '',
  ]
  const blocks = selections.map(selection =>
    formatSelection(selection.payload, selection.source, opts, root),
  )
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
