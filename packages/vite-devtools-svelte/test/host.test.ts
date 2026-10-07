import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { connectDevframe } from 'devframe/client'
import type { DevframeRpcClient } from 'devframe/client'
import { getTempAuthCode } from 'devframe/node/auth'
import { build, createServer } from 'vite'
import type { ViteDevServer } from 'vite'
/**
 * Integration: the real devframe stack on a real Vite dev server, driven by
 * devframe's public browser client (with the two browser globals it needs
 * shimmed). Covers the standalone host; the Vite DevTools host is covered
 * through the kit hook in plugin.test.ts and by browser verification.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'

/** The plugin's RPC names are not in devframe's typed registry, so call them by name. */
type UntypedCall = (method: string, ...args: unknown[]) => Promise<unknown>
function rpc(client: DevframeRpcClient, method: string, ...args: unknown[]): Promise<unknown> {
  return (client as unknown as { call: UntypedCall }).call(method, ...args)
}
import { svelteDevtools } from '../src/plugin.js'
import { authTokenPersisted, waitFor } from './helpers.js'

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')

// devframe persists auth tokens under the user's home; never touch the real one.
const realHome = process.env.HOME
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-home-'))

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

let server: ViteDevServer
let origin: string
const clients: DevframeRpcClient[] = []
// Terminal output: Vite logs via stdout, devframe's auth banner via console.log
// (which vitest intercepts before it reaches process.stdout), so capture both.
let stdout = ''
const writeStdout = process.stdout.write.bind(process.stdout)
const consoleLog = console.log

async function connect(): Promise<DevframeRpcClient> {
  shimBrowser(`${origin}/.svelte-devtools/`)
  const client = await connectDevframe({
    baseURL: `${origin}/.svelte-devtools/`,
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
  })
  clients.push(client)
  return client
}

function wsProbe(url: string, wsOrigin: string): Promise<'open' | 'rejected'> {
  return new Promise(resolve => {
    const ws = new WebSocket(url, { headers: { Origin: wsOrigin } })
    ws.addEventListener('open', () => {
      ws.close()
      resolve('open')
    })
    ws.addEventListener('error', () => resolve('rejected'))
  })
}

beforeAll(async () => {
  process.env.HOME = tmpHome
  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    stdout += String(chunk)
    return writeStdout(chunk, ...rest)
  }) as typeof process.stdout.write
  console.log = (...args: unknown[]) => {
    stdout += `${args.map(String).join(' ')}\n`
    consoleLog(...args)
  }
  server = await createServer({
    configFile: false,
    root: FIXTURES_DIR,
    logLevel: 'silent',
    server: { port: 0, host: 'localhost' },
    plugins: [svelteDevtools()],
  })
  await server.listen()
  origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '')
})

afterEach(() => {
  for (const c of clients.splice(0)) c.close?.()
})

afterAll(async () => {
  await server?.close()
  process.stdout.write = writeStdout
  console.log = consoleLog
  process.env.HOME = realHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe('standalone host (initDevframe on the Vite dev server)', () => {
  it('serves discovery under /.svelte-devtools/ with a same-server WebSocket', async () => {
    const meta = (await (await fetch(`${origin}/.svelte-devtools/__connection.json`)).json()) as {
      backend: string
      websocket: unknown
      mcp?: unknown
    }
    expect(meta.backend).toBe('websocket')
    expect(meta.websocket).toEqual({ path: '__ws' })
    expect(meta.mcp).toBeUndefined()
  })

  it('gates RPC behind auth; the magic link points at the SPA; a code exchange trusts the client', async () => {
    const client = await connect()
    await waitFor(() => client.status === 'unauthorized')
    await expect(rpc(client, 'svelte-devtools:get-project')).rejects.toThrow(
      /Not authorized by the devframe server/,
    )

    await client.requestAuthCode()
    await waitFor(() => /devframe_otp=\d{6}/.test(stdout))
    expect(stdout).toContain(`${origin}/.svelte-devtools/#devframe_otp=`)

    expect(await client.requestTrustWithCode(getTempAuthCode())).toBe(true)
    const project = (await rpc(client, 'svelte-devtools:get-project')) as { name: string }
    expect(project.name).toBeTruthy()
  })

  it('validates RPC arguments with the declared schemas', async () => {
    const client = await connect()
    await waitFor(() => client.status === 'connected')
    await expect(rpc(client, 'svelte-devtools:open-in-editor', { file: 42 })).rejects.toThrow(
      /invalid argument at position 0: file/,
    )
    await expect(
      rpc(client, 'svelte-devtools:inspect-file', { file: '/etc/passwd' }),
    ).resolves.toMatchObject({ source: '' })
  })

  it('accepts the page origin on the WebSocket and rejects foreign origins', async () => {
    const url = `${origin.replace('http', 'ws')}/.svelte-devtools/__ws`
    expect(await wsProbe(url, origin)).toBe('open')
    expect(await wsProbe(url, 'https://evil.example')).toBe('rejected')
  })

  it('survives a dev-server restart; a new client is re-trusted by its stored token', async () => {
    // devframe persists tokens with a debounce: the restart must come after.
    await waitFor(() => authTokenPersisted(tmpHome, store))
    const before = await connect()
    await waitFor(() => before.status === 'connected')
    await server.restart()
    // Vite destroys the old server's sockets, an abnormal closure (1006): devframe
    // reports `error` (a clean close would be `disconnected`). Either way the old
    // client is final — rpc.ts reconnects on both.
    await waitFor(() => ['error', 'disconnected'].includes(before.status))
    const after = await connect()
    await waitFor(() => after.status === 'connected')
    const routes = (await rpc(after, 'svelte-devtools:get-routes')) as unknown[]
    expect(routes.length).toBeGreaterThan(0)
    // several sequential steps (flush wait, connect, full Vite restart, reconnect),
    // each bounded by its own 5 s waitFor
  }, 20_000)
})

/** Every file under `dir`, keyed by its relative path. */
function readTree(dir: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => {
        const full = path.join(e.parentPath, e.name)
        return [path.relative(dir, full), fs.readFileSync(full, 'utf-8')]
      }),
  )
}

/** `vite build` of `root` into `outDir`, returning the emitted files. */
async function buildFiles(root: string, outDir: string, plugins: any[]) {
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins,
    build: { outDir, minify: false },
  })
  return readTree(outDir)
}

describe('production build', () => {
  it('produces byte-identical output with and without the plugin', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-build-'))
    fs.writeFileSync(
      path.join(root, 'index.html'),
      '<!doctype html><script type="module" src="/main.js"></script>',
    )
    fs.writeFileSync(path.join(root, 'main.js'), 'document.body.textContent = "hi"\n')
    const without = await buildFiles(root, path.join(root, 'out-a'), [])
    const withPlugin = await buildFiles(root, path.join(root, 'out-b'), [svelteDevtools()])
    expect(withPlugin).toEqual(without)
    expect(JSON.stringify(withPlugin)).not.toMatch(/svelte-devtools|devframe|__SVELTE_DEVTOOLS__/)
  })
})
