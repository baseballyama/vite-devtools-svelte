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
    openInEditor: target => opened.push(target),
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
