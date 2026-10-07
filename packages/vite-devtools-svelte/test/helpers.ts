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
