import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { connectDevframe } from 'devframe/client'
import type { DevframeRpcClient } from 'devframe/client'
import { getTempAuthCode } from 'devframe/node/auth'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
/**
 * Integration (review B1): live data must keep flowing after a dev-server
 * restart driven by a config-file change (Vite re-evaluates the config, so a
 * *new* plugin instance and Collector serve the restarted server).
 *
 * A simulated runtime speaks the real hot-channel protocol over Vite's HMR
 * WebSocket the way `runtime.ts` does (§6.3 / §6.5): `runtime-ready` on boot,
 * full snapshot on activation (components → profiles → timeline reset), then
 * deltas. A devframe client (browser globals shimmed) plays the DevTools tab.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

/** The plugin's RPC names are not in devframe's typed registry, so call them by name. */
type UntypedCall = (method: string, ...args: unknown[]) => Promise<unknown>
function rpc(client: DevframeRpcClient, method: string, ...args: unknown[]): Promise<unknown> {
  return (client as unknown as { call: UntypedCall }).call(method, ...args)
}

const PLUGIN = path.resolve(import.meta.dirname, '../src/plugin.ts')

const realHome = process.env.HOME
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-home-'))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-restart-'))

const store = new Map<string, string>()
function shimBrowser(url: string) {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(url) })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  })
}

async function waitFor<T>(
  read: () => T | Promise<T>,
  ok: (v: T) => boolean,
  ms = 5000,
): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await read()
    if (ok(v)) return v
    if (Date.now() > end)
      throw new Error(`timed out; last value: ${JSON.stringify(v)?.slice(0, 300)}`)
    await sleep(50)
  }
}

interface Comp {
  id: number
  file: string
  name: string
  parentId: number | null
  mounted: boolean
}

/** One page load of the app's runtime (a reload = a new instance with a new epoch). */
class FakeRuntime {
  readonly epoch = Math.random().toString(36).slice(2)
  readonly components = new Map<number, Comp>()
  active = false
  deltas = false
  ws!: WebSocket
  log: string[] = []
  private url: string

  constructor(url: string, ids: number[]) {
    this.url = url
    for (const id of ids) this.components.set(id, comp(id))
  }

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.url, 'vite-hmr')
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('hmr ws failed')))
    })
    this.ws.addEventListener('message', e => {
      const msg = JSON.parse(String(e.data))
      if (msg.type !== 'custom' || msg.event !== 'svelte-devtools:subscription') return
      this.log.push(JSON.stringify(msg.data))
      const wasActive = this.active
      this.active = !!msg.data?.active
      this.deltas = !!msg.data?.componentDeltas
      if (this.active && (!wasActive || msg.data?.resync)) this.sendFull()
    })
    this.send('svelte-devtools:runtime-ready', {})
  }

  send(event: string, data: unknown) {
    this.ws.send(JSON.stringify({ type: 'custom', event, data }))
  }

  sendFull() {
    this.send('svelte-devtools:components', {
      epoch: this.epoch,
      reset: true,
      components: [...this.components.values()],
    })
    this.send('svelte-devtools:profiles', { epoch: this.epoch, profiles: [] })
    this.send('svelte-devtools:state-timeline', { epoch: this.epoch, reset: true, changes: [] })
  }

  mount(id: number) {
    this.components.set(id, comp(id))
    if (!this.active) return
    if (this.deltas)
      this.send('svelte-devtools:components', { epoch: this.epoch, added: [comp(id)], removed: [] })
    else this.sendFull()
  }

  close() {
    this.closedByUs = true
    this.ws?.close()
  }

  closedByUs = false
  closedByServer = false
  /** Like runtime.ts: on HMR reconnect, ask again with `resync` semantics. */
  watchClose() {
    this.ws.addEventListener('close', () => {
      if (!this.closedByUs) this.closedByServer = true
    })
  }
}

const comp = (id: number): Comp => ({
  id,
  file: '/src/Row.svelte',
  name: 'Row',
  parentId: null,
  mounted: true,
})

function writeConfig(marker: string) {
  fs.writeFileSync(
    path.join(root, 'vite.config.mjs'),
    `// ${marker}\nimport { svelteDevtools } from ${JSON.stringify(PLUGIN)}\nexport default { plugins: [svelteDevtools()] }\n`,
  )
}

let server: ViteDevServer
let origin: string
let ui: DevframeRpcClient

async function connectUi(): Promise<DevframeRpcClient> {
  shimBrowser(`${origin}/.svelte-devtools/`)
  return connectDevframe({
    baseURL: `${origin}/.svelte-devtools/`,
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
  })
}

const liveIds = async () =>
  ((await rpc(ui, 'svelte-devtools:get-live-components')) as Comp[])
    .map(c => c.id)
    .toSorted((a, b) => a - b)

// The fake runtimes connect to Vite's HMR socket like a browser page, which needs
// the token Vite injects into its client; there is no public replacement.
// oxlint-disable-next-line typescript/no-deprecated -- emulating Vite's own HMR client requires its socket token
const hmrUrl = () => `${origin.replace('http', 'ws')}/?token=${server.config.webSocketToken}`

beforeAll(async () => {
  process.env.HOME = tmpHome
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><p>app</p>')
  writeConfig('v1')
  server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.mjs'),
    // The config imports the plugin's TypeScript sources, which inline the
    // browser runtime with `?raw`: load it through Vite's module runner.
    configLoader: 'runner',
    logLevel: 'silent',
    server: { port: 0, host: 'localhost' },
  })
  await server.listen()
  origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '')
  ui = await connectUi()
  await waitFor(
    () => ui.status,
    s => s === 'unauthorized',
  )
  if (!(await ui.requestTrustWithCode(getTempAuthCode())))
    throw new Error('DevTools tab could not be trusted')
  // flush the debounced token store before the restart test needs it
  await sleep(300)
}, 30_000)

afterAll(async () => {
  ui?.close?.()
  await server?.close()
  process.env.HOME = realHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

describe('live data across a config-file restart (review B1)', () => {
  it('shows components mounted after the restart, and after a UI reload', async () => {
    const before = new FakeRuntime(hmrUrl(), [1, 2, 3, 4, 5])
    await before.connect()
    await rpc(ui, 'svelte-devtools:set-active', { client: 'tab', active: true })
    expect(await waitFor(liveIds, ids => ids.length === 5)).toEqual([1, 2, 3, 4, 5])

    // config change → Vite restarts with a new plugin instance; the app page
    // full-reloads (new runtime, new epoch) and the DevTools tab reconnects.
    writeConfig('v2')
    await server.restart()
    before.close()
    ui.close?.()
    ui = await connectUi()
    await waitFor(
      () => ui.status,
      s => s === 'connected',
    )
    await rpc(ui, 'svelte-devtools:set-active', { client: 'tab', active: true })
    const after = new FakeRuntime(hmrUrl(), [1, 2, 3, 4, 5])
    await after.connect()
    await waitFor(liveIds, ids => ids.length === 5).catch(e => {
      throw new Error(`${e.message}; runtime saw subscriptions ${after.log.join(' ')}`)
    })

    after.mount(6) // a change made after the restart must show
    expect(await waitFor(liveIds, ids => ids.includes(6))).toEqual([1, 2, 3, 4, 5, 6])

    // a fresh DevTools tab (SPA reload) sees the same data
    ui.close?.()
    ui = await connectUi()
    await waitFor(
      () => ui.status,
      s => s === 'connected',
    )
    expect(await liveIds()).toEqual([1, 2, 3, 4, 5, 6])
    after.close()
  }, 30_000)

  it('order B: the reloaded app connects before the DevTools tab reconnects', async () => {
    const before = new FakeRuntime(hmrUrl(), [1, 2])
    await before.connect()
    await rpc(ui, 'svelte-devtools:set-active', { client: 'tab', active: true })
    await waitFor(liveIds, ids => ids.length === 2)

    writeConfig('v3')
    await server.restart()
    before.close()
    const after = new FakeRuntime(hmrUrl(), [7, 8])
    await after.connect() // app first …
    await sleep(200)
    ui.close?.()
    ui = await connectUi() // … DevTools tab later (reconnect backoff)
    await waitFor(
      () => ui.status,
      s => s === 'connected',
    )
    await rpc(ui, 'svelte-devtools:set-active', { client: 'tab', active: true })
    await waitFor(liveIds, ids => ids.join() === '7,8').catch(e => {
      throw new Error(`${e.message}; runtime saw subscriptions ${after.log.join(' ')}`)
    })
    after.mount(9)
    expect(await waitFor(liveIds, ids => ids.includes(9))).toEqual([7, 8, 9])
    after.close()
  }, 30_000)

  it('variant M: two app tabs reload after the restart; a change in either tab shows', async () => {
    writeConfig('v5')
    await server.restart()
    ui.close?.()
    ui = await connectUi()
    await waitFor(
      () => ui.status,
      s => s === 'connected',
    )
    await rpc(ui, 'svelte-devtools:set-active', { client: 'tab', active: true })
    const tabA = new FakeRuntime(hmrUrl(), [31, 32])
    const tabB = new FakeRuntime(hmrUrl(), [41, 42])
    await tabA.connect()
    await tabB.connect()
    await waitFor(liveIds, ids => ids.join() === '41,42') // most recent full snapshot: tab B
    // tab B keeps pushing profiles/timeline (periodic), tab A gets a new row
    tabB.send('svelte-devtools:profiles', { epoch: tabB.epoch, profiles: [] })
    tabA.mount(33)
    tabB.send('svelte-devtools:state-timeline', { epoch: tabB.epoch, changes: [] })
    const shown = await waitFor(liveIds, ids => ids.length > 0)
    // whichever tab is served, it must be a complete tree — never an empty or partial one
    expect([['31', '32', '33'].join(), ['41', '42'].join()]).toContain(shown.join())
    tabA.mount(34)
    expect(await waitFor(liveIds, ids => ids.includes(34))).toEqual([31, 32, 33, 34])
    tabA.close()
    tabB.close()
  }, 30_000)

  it('an epoch known only from profiles/timeline (no component snapshot yet) is never served as an empty tree', async () => {
    const tab = new FakeRuntime(hmrUrl(), [51])
    await tab.connect()
    await rpc(ui, 'svelte-devtools:set-active', { client: 'tab', active: true })
    await waitFor(liveIds, ids => ids.includes(51))
    // a second page load whose component snapshot has not arrived yet
    const half = new FakeRuntime(hmrUrl(), [])
    half.ws = new WebSocket(hmrUrl(), 'vite-hmr')
    await new Promise<void>(resolve => {
      half.ws.addEventListener('open', () => resolve(), { once: true })
    })
    half.send('svelte-devtools:profiles', { epoch: half.epoch, profiles: [] })
    half.send('svelte-devtools:state-timeline', { epoch: half.epoch, changes: [] })
    await sleep(300)
    expect(await liveIds()).toContain(51)
    tab.close()
    half.close()
  }, 30_000)
})
