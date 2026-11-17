import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Plugin } from 'vite'
import { afterAll, afterEach, describe, it, expect, vi } from 'vitest'

import { svelteDevtools } from '../src/plugin.js'
import { HOOKS_MODULE_ID } from '../src/runtime/ids.js'
import { injectModuleTracking, isSvelteModule } from '../src/runtime/transform.js'
import { LOAD_PROFILE_EVENT, parseLoadReport } from '../src/server/load-profile.js'
import { callHook, codeOf, resolvePlugins } from './helpers.js'

const HOOKS_IMPORT = `import '${HOOKS_MODULE_ID}';`

// =====================================================================
// injectModuleTracking (.svelte.js / .svelte.ts modules)
// =====================================================================

describe('injectModuleTracking', () => {
  it('imports the hooks before the module body', () => {
    expect(injectModuleTracking('export const cart = $.proxy([])')).toBe(
      `${HOOKS_IMPORT}export const cart = $.proxy([])`,
    )
  })

  it('keeps every original line at its line number', () => {
    const code = ['const a = 1', '', 'export const b = $state(a)', '// end'].join('\n')
    const lines = injectModuleTracking(code)!.split('\n')
    expect(lines[0]).toBe(HOOKS_IMPORT + code.split('\n')[0])
    expect(lines.slice(1)).toEqual(code.split('\n').slice(1))
  })

  it('returns null for server-compiled modules', () => {
    expect(
      injectModuleTracking("import * as $ from 'svelte/internal/server';\nexport const x = 1"),
    ).toBeNull()
  })
})

describe('isSvelteModule', () => {
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
    expect(isSvelteModule(file)).toBe(expected)
  })
})

// =====================================================================
// Tracking plugin (which modules get the hooks import)
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
  it('a client Svelte module (query stripped): hooks import, no sourcemap change', () => {
    const result = callHook(tracking().transform, MODULE_CODE, '/app/src/lib/cart.svelte.ts?v=1')
    expect(result).toEqual({ code: injectModuleTracking(MODULE_CODE), map: null })
  })

  it.each([
    ['server-side rendering', [MODULE_CODE, '/app/a.svelte.ts', { ssr: true }], {}, {}],
    ['node_modules', [MODULE_CODE, '/app/node_modules/lib/a.svelte.js'], {}, {}],
    // compiled for the server without the ssr flag (e.g. a custom environment)
    [
      'a server-compiled module',
      ["import * as $ from 'svelte/internal/server'", '/app/a.svelte.ts'],
      {},
      {},
    ],
    ['vite build', [MODULE_CODE, '/app/a.svelte.ts'], {}, { command: 'build' }],
    ['a plain module', ['export const x = 1', '/app/src/a.ts'], {}, {}],
    // components import the hooks through the compiler (experimental.devtools)
    ['a component', ['export default function A() {}', '/app/src/A.svelte'], {}, {}],
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
const UNIVERSAL = '/app/src/routes/+page.ts'

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

  it('in the browser (no recorder) sends the timing over the hot channel', async () => {
    const send = vi.fn()
    const hot = globalThis as { __fakeHot?: { send: typeof send } }
    hot.__fakeHot = { send }
    try {
      const result = callHook(
        loadProfile().transform,
        'export const load = () => ({ ok: 1 })',
        UNIVERSAL,
      )
      // a Node module has no `import.meta.hot`: stand in for Vite's
      const file = path.join(tmpDir, `m${moduleSeq++}.mjs`)
      fs.writeFileSync(file, codeOf(result).replace('import.meta.hot', 'globalThis.__fakeHot'))
      const mod = await import(/* @vite-ignore */ pathToFileURL(file).href)
      expect(await mod.load()).toEqual({ ok: 1 })
      expect(send).toHaveBeenCalledOnce()
      const [event, payload] = send.mock.calls[0]!
      expect(event).toBe(LOAD_PROFILE_EVENT)
      expect(parseLoadReport(payload)).toEqual({
        route: '/',
        file: UNIVERSAL,
        type: 'universal',
        duration: payload.duration,
        dataSize: JSON.stringify({ ok: 1 }).length,
      })
    } finally {
      delete hot.__fakeHot
    }
  })

  it.each([
    ['not an object', 'x'],
    ['an unknown type', { route: '/', file: 'f', type: 'other', duration: 1, dataSize: 1 }],
    [
      'a negative duration',
      { route: '/', file: 'f', type: 'universal', duration: -1, dataSize: 1 },
    ],
    ['a fractional size', { route: '/', file: 'f', type: 'universal', duration: 1, dataSize: 1.5 }],
    ['a missing route', { file: 'f', type: 'universal', duration: 1, dataSize: 1 }],
  ])('a browser report that is %s is dropped', (_, payload) => {
    expect(parseLoadReport(payload)).toBeNull()
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
