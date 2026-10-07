import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import type { Plugin } from 'vite'

import { Collector } from '../src/server/collector.js'
import { createRpcFunctions, DEVFRAME_ID } from '../src/server/devframe.js'
import type { SvelteDevtoolsHost } from '../src/server/devframe.js'

export interface TestHost extends SvelteDevtoolsHost {
  opened: string[]
}

/** A `SvelteDevtoolsHost` without a dev server (overridable per test). */
export function createTestHost(
  root: string,
  overrides: Partial<SvelteDevtoolsHost> = {},
): TestHost {
  const opened: string[] = []
  return {
    collector: new Collector(),
    root: () => root,
    publicBase: () => '/',
    modules: () => [],
    serverOrigins: () => [],
    openInEditor: target => {
      opened.push(target)
    },
    opened,
    ...overrides,
  }
}

/** RPC handlers keyed by their wire id (`svelte-devtools:<name>`), invoked directly. */
export function rpcHandlers(host: SvelteDevtoolsHost): Map<string, (...args: any[]) => any> {
  const map = new Map<string, (...args: any[]) => any>()
  for (const fn of createRpcFunctions(host)) {
    map.set(`${DEVFRAME_ID}:${fn.name}`, (fn as { handler: (...args: any[]) => any }).handler)
  }
  return map
}

type AnyFn = (...args: any[]) => any

/** Invoke a Vite plugin hook directly, whether declared as a function or as `{ handler }`. */
export function callHook(hook: unknown, ...args: unknown[]): any {
  const fn = typeof hook === 'function' ? hook : (hook as { handler: unknown }).handler
  return (fn as AnyFn)(...args)
}

/** Run each plugin's `configResolved` with a minimal dev-server config (overridable). */
export function resolvePlugins(plugins: Plugin[], config: Record<string, unknown> = {}) {
  const resolved = {
    command: 'serve',
    root: '/test',
    base: '/',
    plugins: [],
    logger: { warn: () => {} },
    ...config,
  }
  for (const p of plugins) if (p.configResolved) callHook(p.configResolved, resolved)
  return resolved
}

/** The code of a transform hook result (`string` or `{ code }`). */
export function codeOf(result: unknown): string {
  return typeof result === 'string' ? result : (result as { code: string }).code
}

/**
 * Poll `read` until `ok(value)` holds (default: truthy) and return that value.
 * Integration tests wait on observable state, never for a fixed time.
 */
export async function waitFor<T>(
  read: () => T | Promise<T>,
  ok: (value: T) => boolean = Boolean,
  ms = 5000,
): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = await read()
    if (ok(value)) return value
    if (Date.now() > end)
      throw new Error(`timed out; last value: ${JSON.stringify(value)?.slice(0, 300)}`)
    await sleep(20)
  }
}

/**
 * Whether devframe has written a trusted client's auth token (as stored by
 * the shimmed `localStorage`) to its store under `home`. devframe persists
 * with a debounce; a restart before that would forget the client.
 */
export function authTokenPersisted(home: string, localStore: Map<string, string>): boolean {
  const tokens = [...localStore.values()].filter(v => v.length >= 16)
  if (tokens.length === 0) return false
  return fs
    .readdirSync(home, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile())
    .some(e => {
      const text = fs.readFileSync(path.join(e.parentPath, e.name), 'utf8')
      return tokens.some(t => text.includes(t))
    })
}
