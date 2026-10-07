import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { compile } from 'svelte/compiler'
import type { Plugin } from 'vite'
import { afterAll, afterEach, describe, it, expect, vi } from 'vitest'

import { svelteDevtools } from '../src/plugin.js'
import { RUNTIME_MODULE_ID } from '../src/runtime/ids.js'
import {
  injectComponentTracking,
  injectModuleTracking,
  SVELTE_MODULE_RE,
} from '../src/runtime/transform.js'
import { callHook, codeOf, resolvePlugins } from './helpers.js'

const RUNTIME_IMPORT = `import '${RUNTIME_MODULE_ID}';`

/** Real dev-mode client output of the Svelte compiler for `source`. */
function compileClient(source: string, filename = '/app/src/lib/Counter.svelte'): string {
  return compile(source, { generate: 'client', dev: true, filename }).js.code
}

const COUNTER = compileClient(
  '<script>let { step = 1 } = $props(); let count = $state(0)</script>' +
    '<button onclick={() => (count += step)}>{count}</button>',
)

/** A fake browser window whose devtools hook records what injected code does. */
function fakeWindow() {
  const calls: unknown[][] = []
  const dt = {
    _pendingFile: undefined as unknown,
    _enterModule: (id: string) => calls.push(['enter', id]),
    _leaveModule: () => calls.push(['leave']),
  }
  return { window: { __SVELTE_DEVTOOLS__: dt, calls }, dt, calls }
}

/** The text `injectComponentTracking` inserted into `code` (besides the import). */
function insertedHint(code: string, out: string): string {
  expect(out.startsWith(RUNTIME_IMPORT)).toBe(true)
  const body = out.slice(RUNTIME_IMPORT.length)
  let i = 0
  while (i < code.length && body[i] === code[i]) i++
  const hint = body.slice(i, i + body.length - code.length)
  // everything else is the original, byte for byte
  expect(body.slice(0, i) + body.slice(i + hint.length)).toBe(code)
  return hint
}

/** Compile generated code into a function of `window` (executing it is the point). */
function asFunction(code: string): (window?: unknown) => void {
  // oxlint-disable-next-line typescript/no-implied-eval -- running the generated code under test
  return new Function('window', code) as (window?: unknown) => void
}

// Ids that must survive being embedded in generated JS (JSON-encoded): quotes,
// backslashes, line terminators, and `String#replace` substitution patterns.
const AWKWARD_IDS = [
  '/app/src/lib/Counter.svelte',
  '/app/src/lib/My"Quote.svelte',
  "/app/src/lib/It's.svelte",
  String.raw`C:\app\src\lib\Win.svelte`,
  '/app/src/lib/new\nline.svelte',
  '/app/src/lib/sep\u2028ar.svelte',
  "/app/src/routes/[$'x]/+page.svelte",
  '/app/src/routes/$&/+page.svelte',
  '/app/src/routes/$1$$/+page.svelte',
  '/app/src/lib/</script>.svelte',
  '/app/src/lib/`${tpl}`.svelte',
]

// =====================================================================
// injectComponentTracking (compiled client components)
// =====================================================================

describe('injectComponentTracking', () => {
  it.each(AWKWARD_IDS)('names the component file %j exactly, as JSON-safe JS', id => {
    const hint = insertedHint(COUNTER, injectComponentTracking(COUNTER, id)!)
    const { window, dt } = fakeWindow()
    asFunction(hint)(window)
    expect(dt._pendingFile).toBe(id)
  })

  it('is inert without a browser window or before the runtime installed itself', () => {
    const run = asFunction(insertedHint(COUNTER, injectComponentTracking(COUNTER, '/a.svelte')!))
    expect(() => run()).not.toThrow()
    expect(() => run({})).not.toThrow()
  })

  it('names the file right before the component pushes its context, on the same line', () => {
    const out = injectComponentTracking(COUNTER, '/a.svelte')!
    const hint = insertedHint(COUNTER, out)
    const pushLine = out.split('\n').find(l => l.includes('$.push($$props'))!
    expect(pushLine.trim().startsWith(hint.trim())).toBe(true)
    // no line inserted: every original line keeps its number (map: null)
    expect(out.split('\n')).toHaveLength(COUNTER.split('\n').length)
  })

  it('ignores `$.push(` in the markup (hoisted template strings) and tags the real call', () => {
    const code = compileClient(
      '<script>let n = $state(0)</script><pre>$.push($$props, true);</pre><p>$.push(x)</p>{n}',
    )
    const templateLine = code.split('\n').find(l => l.includes('from_html('))!
    expect(templateLine).toContain('$.push(')
    const out = injectComponentTracking(code, '/a.svelte')!
    insertedHint(code, out)
    // the markup template is untouched
    expect(out.split('\n')).toContain(templateLine)
    const pushLine = out.split('\n').find(l => /^\s*if \(typeof window/.test(l))!
    expect(pushLine).toMatch(/_pendingFile = "\/a\.svelte"; \} \$\.push\(\$\$props/)
  })

  it('ignores a markup line that starts with `$.push($$props` (multi-line template string)', () => {
    const code = compileClient(
      '<script>let n = $state(0)</script><pre>\n$.push($$props, true);</pre>{n}',
    )
    const markupLine = code.split('\n').find(l => l.startsWith('$.push($$props'))!
    expect(markupLine).toBeDefined()
    const out = injectComponentTracking(code, '/a.svelte')!
    insertedHint(code, out)
    expect(out.split('\n')).toContain(markupLine)
    const tagged = out.split('\n').find(l => l.includes('_pendingFile'))!
    // the component's own statement, not the markup line
    expect(tagged.trimStart().startsWith('if (typeof window')).toBe(true)
    expect(tagged).toContain('; } $.push($$props, true, ')
  })

  it('finds the call at the very start of the module', () => {
    const out = injectComponentTracking('$.push($$props)', '/a.svelte')!
    expect(out.endsWith('} $.push($$props)')).toBe(true)
  })

  it('returns null for ambiguous unparsable code', () => {
    const code = '$.push($$props, true);\n$.push($$props, true); ('
    expect(injectComponentTracking(code, '/a.svelte')).toBeNull()
  })

  it('tags only the first component context push of a module', () => {
    const twice = `${COUNTER}\nfunction Other($$anchor, $$props) {\n\t$.push($$props, true);\n\treturn $.pop();\n}`
    const out = injectComponentTracking(twice, '/a.svelte')!
    expect(out.split('_pendingFile').length - 1).toBe(1)
  })

  it.each([
    [
      'a module without a component',
      "import * as $ from 'svelte/internal/client';\nexport const x = 1",
    ],
    [
      'server output',
      compile('<script>let { a } = $props()</script>{a}', { generate: 'server', dev: true }).js
        .code,
    ],
    ['`$.push(` only inside a string', 'const s = "$.push($$props, true)"'],
    ['another identifier', '\t$.push($$propsX, true)'],
    [
      'several `$.push($$props` texts but no such call',
      'const a = `\n$.push($$props)`, b = `\n$.push($$props)`\n$.push()\n$.pop($$props)\n$[push]($$props)',
    ],
  ])('returns null for %s', (_, code) => {
    expect(injectComponentTracking(code, '/a.svelte')).toBeNull()
  })
})

// =====================================================================
// injectModuleTracking (.svelte.js / .svelte.ts modules)
// =====================================================================

/** Run a transformed (import-free) module body against a fake window. */
function runModule(out: string, window?: unknown) {
  expect(out.startsWith(RUNTIME_IMPORT)).toBe(true)
  asFunction(out.slice(RUNTIME_IMPORT.length))(window)
}

describe('injectModuleTracking', () => {
  it.each(AWKWARD_IDS)('brackets the module body with enter(%j) / leave', id => {
    const { window, calls } = fakeWindow()
    runModule(injectModuleTracking("window.calls.push(['body'])", id)!, window)
    expect(calls).toEqual([['enter', id], ['body'], ['leave']])
  })

  it('still leaves the scope when the body ends in a line comment without a newline', () => {
    const { window, calls } = fakeWindow()
    runModule(
      injectModuleTracking("window.calls.push(['body']) // trailing", '/m.svelte.js')!,
      window,
    )
    expect(calls).toEqual([['enter', '/m.svelte.js'], ['body'], ['leave']])
  })

  it('is inert without a browser window', () => {
    const out = injectModuleTracking('const x = 1', '/m.svelte.js')!
    expect(() => runModule(out)).not.toThrow()
  })

  it('keeps every original line at its line number', () => {
    const code = ['const a = 1', '', 'export const b = $state(a)', '// end'].join('\n')
    const lines = injectModuleTracking(code, '/m.svelte.ts')!.split('\n')
    expect(lines[0]!.endsWith(code.split('\n')[0]!)).toBe(true)
    expect(lines.slice(1, 4)).toEqual(code.split('\n').slice(1))
  })

  it('returns null for server-compiled modules', () => {
    expect(
      injectModuleTracking(
        "import * as $ from 'svelte/internal/server';\nexport const x = 1",
        '/m',
      ),
    ).toBeNull()
  })
})

describe('SVELTE_MODULE_RE', () => {
  it.each([
    ['/a/store.svelte.js', true],
    ['/a/store.svelte.ts', true],
    ['/a/store.svelte.mjs', true],
    ['/a/store.svelte.mts', true],
    ['/a/store.svelte.cjs', true],
    ['/a/store.svelte.cts', true],
    ['/a/Component.svelte', false],
    ['/a/store.svelte.d.ts', false],
    ['/a/store.js', false],
    ['/a/store.svelte.json', false],
    ['/a/store.svelte.jsx', false],
    ['/a/store.svelte.ts?v=123', false], // callers strip the query first
    ['/a/store.svelte.ts.bak', false],
  ])('%s → %s', (file, expected) => {
    expect(SVELTE_MODULE_RE.test(file)).toBe(expected)
  })
})

// =====================================================================
// Tracking plugin (which modules get which transform)
// =====================================================================

function plugin(name: string, options = {}, config: Record<string, unknown> = {}): Plugin {
  const plugins = svelteDevtools(options)
  resolvePlugins(plugins, config)
  return plugins.find(p => p.name === name)!
}
const tracking = (options = {}, config = {}) =>
  plugin('vite-devtools-svelte:tracking', options, config)

const MODULE_CODE = 'export const cart = $state([])'

describe('trackingPlugin transform', () => {
  it('a client component: runtime import + file hint, no sourcemap change', () => {
    const result = callHook(tracking().transform, COUNTER, '/app/src/lib/Counter.svelte')
    expect(result).toEqual({
      code: injectComponentTracking(COUNTER, '/app/src/lib/Counter.svelte'),
      map: null,
    })
  })

  it('a client Svelte module: scope bracket named after the file (query stripped)', () => {
    const result = callHook(tracking().transform, MODULE_CODE, '/app/src/lib/cart.svelte.ts?v=1')
    expect(result).toEqual({
      code: injectModuleTracking(MODULE_CODE, '/app/src/lib/cart.svelte.ts'),
      map: null,
    })
  })

  it('names a component by its file, without the query string', () => {
    const out = codeOf(
      callHook(tracking().transform, COUNTER, '/app/src/lib/Counter.svelte?direct'),
    )
    expect(out).toBe(injectComponentTracking(COUNTER, '/app/src/lib/Counter.svelte'))
  })

  it.each([
    ['server-side rendering (component)', [COUNTER, '/app/src/A.svelte', { ssr: true }], {}, {}],
    ['server-side rendering (module)', [MODULE_CODE, '/app/a.svelte.ts', { ssr: true }], {}, {}],
    ['node_modules', [COUNTER, '/app/node_modules/lib/A.svelte'], {}, {}],
    ['componentTracking: false', [COUNTER, '/app/src/A.svelte'], { componentTracking: false }, {}],
    ['vite build', [COUNTER, '/app/src/A.svelte'], {}, { command: 'build' }],
    ['a plain module', ['export const x = 1', '/app/src/a.ts'], {}, {}],
    ['a component without a context push', ['export {}', '/app/src/A.svelte'], {}, {}],
  ])('leaves %s alone', (_, args, options, config) => {
    expect(callHook(tracking(options, config).transform, ...args)).toBeNull()
  })
})

// =====================================================================
// Load profiling (SvelteKit load functions): executed, not grepped
// =====================================================================

const loadProfile = (config = {}) => plugin('vite-devtools-svelte:load-profile', {}, config)

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-load-'))
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
let moduleSeq = 0

interface LoadModule {
  load: (event?: unknown) => Promise<any>
  [name: string]: unknown
}

/** Transform `code` as `id` and import the result as a real ES module. */
async function loadModule(code: string, id: string): Promise<LoadModule> {
  const result = callHook(loadProfile().transform, code, id)
  expect(result).not.toBeNull()
  expect(result.map).toBeNull()
  const file = path.join(tmpDir, `m${moduleSeq++}.mjs`)
  fs.writeFileSync(file, codeOf(result))
  return import(/* @vite-ignore */ pathToFileURL(file).href)
}

type Recorder = (route: string, file: string, type: string, ms: number, size: number) => void
const g = globalThis as { __svelte_devtools_record_load?: Recorder }
function installRecorder(impl?: Recorder) {
  const rec = vi.fn<Recorder>(impl)
  g.__svelte_devtools_record_load = rec
  return rec
}
afterEach(() => {
  delete g.__svelte_devtools_record_load
})

const PAGE = '/app/src/routes/blog/[slug]/+page.server.ts'

describe('loadProfilePlugin: profiled load functions', () => {
  // `result` is a module-level object so its identity can be checked
  it.each([
    ['export const … = async arrow', 'export const load = async (event) => result'],
    ['export const … = arrow', 'export const load = (event) => result'],
    ['export const … = function', 'export const load=function (event) { return result }'],
    ['export function', 'export function load(event) { return result }'],
    ['export async function', 'export async function load(event) { return result }'],
    ['export let', 'export let load = async (event) => result'],
    ['export var', 'export var load = (event) => result'],
  ])('%s: returns the original result and records one timing', async (_, decl) => {
    const rec = installRecorder()
    const mod = await loadModule(`export const result = { title: 'x', n: [1, 2] }\n${decl}`, PAGE)
    const value = await mod.load({ params: { slug: 'x' } })
    expect(value).toBe(mod.result)
    expect(rec).toHaveBeenCalledOnce()
    const [route, file, type, duration, dataSize] = rec.mock.calls[0]!
    expect({ route, file, type, dataSize }).toEqual({
      route: '/blog/[slug]',
      file: PAGE,
      type: 'server',
      dataSize: JSON.stringify(value).length,
    })
    expect(duration).toBeGreaterThanOrEqual(0)
  })

  it('passes the event through unchanged', async () => {
    installRecorder()
    const mod = await loadModule('export const load = event => ({ got: event })', PAGE)
    const event = { params: { slug: 'y' } }
    expect((await mod.load(event)).got).toBe(event)
  })

  it('rethrows a failing load unchanged (redirect/error) and records nothing', async () => {
    const rec = installRecorder()
    const mod = await loadModule(
      "export const boom = new Error('redirect')\nexport async function load() { throw boom }",
      PAGE,
    )
    await expect(mod.load()).rejects.toBe(mod.boom)
    expect(rec).not.toHaveBeenCalled()
  })

  it.each([
    ['a BigInt', 'export const load = () => ({ big: 1n })'],
    ['a cycle', 'export const load = () => { const o = {}; o.self = o; return o }'],
    ['a function', 'export const load = () => () => 1'],
  ])('a result JSON cannot encode (%s) still loads, recorded with size 0', async (_, decl) => {
    const rec = installRecorder()
    const mod = await loadModule(decl, PAGE)
    await expect(mod.load()).resolves.toBeDefined()
    expect(rec.mock.calls[0]![4]).toBe(0)
  })

  it('an empty result is recorded as {}', async () => {
    const rec = installRecorder()
    const mod = await loadModule('export function load() {}', PAGE)
    expect(await mod.load()).toBeUndefined()
    expect(rec.mock.calls[0]![4]).toBe(2)
  })

  it('a failing recorder never fails the load', async () => {
    installRecorder(() => {
      throw new Error('collector down')
    })
    const mod = await loadModule("export const load = () => ({ ok: 'yes' })", PAGE)
    expect(await mod.load()).toEqual({ ok: 'yes' })
  })

  it('runs without a recorder (browser side of a universal load)', async () => {
    const mod = await loadModule(
      'export const load = () => ({ ok: 1 })',
      '/app/src/routes/+page.ts',
    )
    expect(await mod.load()).toEqual({ ok: 1 })
  })

  it('keeps the original line numbers of the module', () => {
    const code =
      'import x from "./x"\n\nexport const load = async () => x\nexport const ssr = false'
    const lines = codeOf(callHook(loadProfile().transform, code, PAGE)).split('\n')
    expect(lines.slice(0, 4)).toEqual([
      'import x from "./x"',
      '',
      'const load = async () => x',
      'export const ssr = false',
    ])
  })

  it('ignores `export const load` in comments and strings', async () => {
    const rec = installRecorder()
    const mod = await loadModule(
      [
        '// was: export const load = () => null',
        'export const note = "export function load() {}"',
        'export const load = () => ({ ok: 1 })',
      ].join('\n'),
      PAGE,
    )
    expect(await mod.load()).toEqual({ ok: 1 })
    expect(mod.note).toBe('export function load() {}')
    expect(rec).toHaveBeenCalledOnce()
  })

  it('keeps the other names of a shared `export const` declaration exported', async () => {
    installRecorder()
    const mod = await loadModule(
      'export const ssr = false, load = () => ({ ok: 1 }), csr = true',
      PAGE,
    )
    expect({ ssr: mod.ssr, csr: mod.csr }).toEqual({ ssr: false, csr: true })
    expect(await mod.load()).toEqual({ ok: 1 })
  })

  it('the module keeps calling its own load, unwrapped', async () => {
    const rec = installRecorder()
    const mod = await loadModule(
      'export function load() { return { n: 1 } }\nexport const twice = () => [load(), load()]',
      PAGE,
    )
    expect((mod.twice as () => unknown)()).toEqual([{ n: 1 }, { n: 1 }])
    expect(rec).not.toHaveBeenCalled()
  })

  it('takes the route from <root>/src/routes, not from the first "routes" in the path', async () => {
    const rec = installRecorder()
    const id = '/home/routes/app/src/routes/blog/+page.ts'
    const result = callHook(
      loadProfile({ root: '/home/routes/app' }).transform,
      'export const load = () => ({})',
      id,
    )
    const file = path.join(tmpDir, `m${moduleSeq++}.mjs`)
    fs.writeFileSync(file, codeOf(result))
    const mod: LoadModule = await import(/* @vite-ignore */ pathToFileURL(file).href)
    await mod.load()
    expect(rec.mock.calls[0]![0]).toBe('/blog')
  })

  it.each([
    ['/app/src/routes/+page.ts', '/', 'universal'],
    ['/app/src/routes/+layout.ts', '/', 'universal'],
    ['/app/src/routes/+page.server.ts', '/', 'server'],
    ['/app/src/routes/+layout.server.js', '/', 'server'],
    ['/app/src/routes/blog/+page.js', '/blog', 'universal'],
    ['/app/src/routes/(app)/admin/[id]/+layout.server.ts', '/(app)/admin/[id]', 'server'],
    // a load file outside a routes directory (custom layout): root route
    ['/app/+page.ts', '/', 'universal'],
    // a "routes" substring that is not a directory of its own
    ['/srv/routes-app/src/routes/blog/+page.ts', '/blog', 'universal'],
  ])('%s → route %s, %s load', async (id, route, type) => {
    const rec = installRecorder()
    const mod = await loadModule('export const load = () => ({})', id)
    await mod.load()
    expect(rec.mock.calls[0]!.slice(0, 3)).toEqual([route, id, type])
  })

  it.each([
    ['a component', '/app/src/routes/+page.svelte', 'export const load = () => ({})', {}],
    ['an API endpoint', '/app/src/routes/api/+server.ts', 'export const load = () => ({})', {}],
    ['node_modules', '/app/node_modules/kit/src/routes/+page.ts', 'export const load = 1', {}],
    ['a non-exported load', '/app/src/routes/+page.ts', 'const load = () => ({})', {}],
    ['a file merely ending in +page.ts', '/app/src/lib/x+page.ts', 'export const load = 1', {}],
    ['a syntax error', '/app/src/routes/+page.ts', 'export const load = (', {}],
    ['a load-free route module', '/app/src/routes/+page.ts', 'export const ssr = false', {}],
    [
      '`export { load }` (not supported)',
      '/app/src/routes/+page.ts',
      'const load = () => 1\nexport { load }',
      {},
    ],
    [
      'vite build',
      '/app/src/routes/+page.ts',
      'export const load = () => ({})',
      { command: 'build' },
    ],
  ])('leaves %s alone', (_, id, code, config) => {
    expect(callHook(loadProfile(config).transform, code, id)).toBeNull()
  })
})
