// Vite plugin for the reactivity integration tests: the same module wiring
// the dev server gets from svelteDevtools() (svelte/internal/client ->
// wrapper, the runtime virtual module, the component-tracking transform),
// without a dev server, devframe or MCP.
import type { Plugin } from 'vite'
import {
  RUNTIME_MODULE_ID,
  RESOLVED_RUNTIME_ID,
  runtimeCode,
  WRAPPER_MODULE_ID,
  wrapperCode,
} from '../../runtime.js'
import { injectComponentTracking, injectModuleTracking, SVELTE_MODULE_RE } from '../../plugin.js'

export function reactivityHarnessPlugin(): Plugin[] {
  return [
    {
      name: 'reactivity-harness:modules',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === RUNTIME_MODULE_ID) return RESOLVED_RUNTIME_ID
        if (
          id === 'svelte/internal/client' &&
          importer &&
          !importer.includes('node_modules') &&
          !importer.startsWith('\0')
        ) {
          return WRAPPER_MODULE_ID
        }
        return undefined
      },
      load(id) {
        if (id === RESOLVED_RUNTIME_ID) return runtimeCode
        if (id === WRAPPER_MODULE_ID) return wrapperCode
        return undefined
      },
    },
    {
      name: 'reactivity-harness:tracking',
      enforce: 'post',
      transform(code, id, options) {
        if (id.includes('node_modules')) return null
        const file = id.split('?')[0]
        const modified = file.endsWith('.svelte')
          ? injectComponentTracking(code, id)
          : SVELTE_MODULE_RE.test(file) && !options?.ssr
            ? injectModuleTracking(code, file)
            : null
        return modified === null ? null : { code: modified, map: null }
      },
    },
  ]
}
