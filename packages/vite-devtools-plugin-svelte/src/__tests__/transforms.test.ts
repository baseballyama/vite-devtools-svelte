import { describe, it, expect } from 'vite-plus/test'
import { svelteDevtools } from '../plugin.js'
import type { Plugin } from 'vite'

function getPlugins(options = {}) {
  const plugins = svelteDevtools(options)
  for (const plugin of plugins) {
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'serve',
        root: '/test',
        logger: { warn: () => {} },
      } as any)
    }
  }
  return plugins
}

function getBuildPlugins(options = {}) {
  const plugins = svelteDevtools(options)
  for (const plugin of plugins) {
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved({
        command: 'build',
        root: '/test',
        logger: { warn: () => {} },
      } as any)
    }
  }
  return plugins
}

function getTrackingPlugin(options = {}): Plugin {
  return getPlugins(options).find(p => p.name === 'vite-devtools-plugin-svelte:tracking')!
}

function getLoadProfilePlugin(options = {}): Plugin {
  return getPlugins(options).find(p => p.name === 'vite-devtools-plugin-svelte:load-profile')!
}

// =====================================================================
// Tracking Plugin (minimal file context injection)
// =====================================================================

describe('trackingPlugin transform', () => {
  it('should inject _pendingFile and runtime import into compiled Svelte code', () => {
    const plugin = getTrackingPlugin()
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  let count = $.state(0);
  $.pop();
}
`
    const result = (plugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    expect(result).not.toBeNull()
    const output = typeof result === 'string' ? result : result!.code
    // Should inject _pendingFile before $.push()
    expect(output).toContain('_pendingFile')
    expect(output).toContain('/test/src/lib/Counter.svelte')
    // Should import the runtime virtual module
    expect(output).toContain("import 'virtual:svelte-devtools-runtime'")
  })

  it('should NOT inject onMount/onDestroy imports (handled by wrapper)', () => {
    const plugin = getTrackingPlugin()
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  $.pop();
}
`
    const result = (plugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    const output = typeof result === 'string' ? result : result!.code
    expect(output).not.toContain('onMount')
    expect(output).not.toContain('onDestroy')
  })

  it('should NOT inject reactive tracking code (handled by wrapper)', () => {
    const plugin = getTrackingPlugin()
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  let count = $.state(0);
  let doubled = $.derived(() => count * 2);
  $.pop();
}
`
    const result = (plugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    const output = typeof result === 'string' ? result : result!.code
    expect(output).not.toContain('trackState')
    expect(output).not.toContain('trackDerived')
    expect(output).not.toContain('trackProxy')
    expect(output).not.toContain('trackEffect')
    expect(output).not.toContain('endInit')
    expect(output).not.toContain('registered')
  })

  it('should skip non-svelte files', () => {
    const plugin = getTrackingPlugin()
    const result = (plugin.transform as Function)!('const x = 1', '/test/src/lib/utils.ts')
    expect(result).toBeNull()
  })

  it('should skip node_modules files', () => {
    const plugin = getTrackingPlugin()
    const result = (plugin.transform as Function)!('$.push()', '/test/node_modules/svelte/Component.svelte')
    expect(result).toBeNull()
  })

  it('should skip when componentTracking is disabled', () => {
    const plugin = getTrackingPlugin({ componentTracking: false })
    const code = '$.push($$anchor, true); $.pop();'
    const result = (plugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    expect(result).toBeNull()
  })

  it('should skip files without $.push()', () => {
    const plugin = getTrackingPlugin()
    const code = `
import * as $ from 'svelte/internal/client';
export function something() {}
`
    const result = (plugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    expect(result).toBeNull()
  })

  it('should skip in build mode', () => {
    const plugins = getBuildPlugins()
    const plugin = plugins.find(p => p.name === 'vite-devtools-plugin-svelte:tracking')!
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  $.pop();
}
`
    const result = (plugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    expect(result).toBeNull()
  })

  it('should JSON-encode the file ID to prevent injection', () => {
    const plugin = getTrackingPlugin()
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  $.pop();
}
`
    const result = (plugin.transform as Function)!(code, '/test/src/lib/My"Component.svelte')
    const output = typeof result === 'string' ? result : result!.code
    expect(output).toContain('\\"')
    expect(output).toContain('_pendingFile')
  })

  it('should return code and null map', () => {
    const plugin = getTrackingPlugin()
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  $.pop();
}
`
    const result = (plugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    expect(result).toHaveProperty('code')
    expect(result).toHaveProperty('map', null)
  })

  it('should inject _pendingFile BEFORE $.push() call', () => {
    const plugin = getTrackingPlugin()
    const code = `
import * as $ from 'svelte/internal/client';
function Component($$anchor) {
  $.push($$anchor, true);
  $.pop();
}
`
    const result = (plugin.transform as Function)!(code, '/test/src/lib/Counter.svelte')
    const output = typeof result === 'string' ? result : result!.code
    const pendingIdx = output.indexOf('_pendingFile')
    const pushIdx = output.indexOf('$.push(')
    expect(pendingIdx).toBeLessThan(pushIdx)
  })
})

// =====================================================================
// Load Profile Plugin (SvelteKit load function wrapping)
// =====================================================================

describe('loadProfilePlugin transform', () => {
  it('should wrap export const load with profiling', () => {
    const plugin = getLoadProfilePlugin()
    const code = `export const load = async ({ params }) => { return { title: params.slug } }`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/blog/[slug]/+page.server.ts')
    expect(result).not.toBeNull()
    const output = typeof result === 'string' ? result : result!.code
    expect(output).toContain('__original_load')
    expect(output).toContain('performance.now()')
    expect(output).toContain('__svelte_devtools_record_load')
  })

  it('should wrap export function load with profiling', () => {
    const plugin = getLoadProfilePlugin()
    const code = `export function load({ params }) { return { title: params.slug } }`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/blog/[slug]/+page.server.ts')
    expect(result).not.toBeNull()
    const output = typeof result === 'string' ? result : result!.code
    expect(output).toContain('__original_load')
    expect(output).toContain('__load_impl')
  })

  it('should wrap export async function load with profiling', () => {
    const plugin = getLoadProfilePlugin()
    const code = `export async function load({ params }) { return { title: params.slug } }`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/blog/[slug]/+page.server.ts')
    expect(result).not.toBeNull()
    const output = typeof result === 'string' ? result : result!.code
    expect(output).toContain('__original_load')
    expect(output).toContain('async function __load_impl')
  })

  it('should skip non-load files', () => {
    const plugin = getLoadProfilePlugin()
    const result = (plugin.transform as Function)!('const x = 1', '/test/src/routes/+page.svelte')
    expect(result).toBeNull()
  })

  it('should extract route from file path', () => {
    const plugin = getLoadProfilePlugin()
    const code = `export const load = async () => ({ data: 1 })`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/blog/[slug]/+page.server.ts')
    const output = typeof result === 'string' ? result : result!.code
    expect(output).toContain('/blog/[slug]')
  })

  it('should handle +layout.server.ts files', () => {
    const plugin = getLoadProfilePlugin()
    const code = `export const load = async () => ({ user: {} })`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/dashboard/+layout.server.ts')
    expect(result).not.toBeNull()
    const output = typeof result === 'string' ? result : result!.code
    expect(output).toContain('"server"')
  })

  it('should handle +page.ts (universal load)', () => {
    const plugin = getLoadProfilePlugin()
    const code = `export const load = async () => ({ data: 1 })`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/dashboard/+page.ts')
    expect(result).not.toBeNull()
    const output = typeof result === 'string' ? result : result!.code
    expect(output).toContain('"universal"')
  })

  it('should skip node_modules files', () => {
    const plugin = getLoadProfilePlugin()
    const code = `export const load = async () => ({ data: 1 })`
    const result = (plugin.transform as Function)!(code, '/test/node_modules/@sveltejs/kit/src/routes/+page.server.ts')
    expect(result).toBeNull()
  })

  it('should skip files without export keyword', () => {
    const plugin = getLoadProfilePlugin()
    const code = `const load = async () => ({ data: 1 })`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/+page.server.ts')
    expect(result).toBeNull()
  })

  it('should skip in build mode', () => {
    const plugins = getBuildPlugins()
    const plugin = plugins.find(p => p.name === 'vite-devtools-plugin-svelte:load-profile')!
    const code = `export const load = async () => ({ data: 1 })`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/+page.server.ts')
    expect(result).toBeNull()
  })

  it('should return code and null map', () => {
    const plugin = getLoadProfilePlugin()
    const code = `export const load = async () => ({ data: 1 })`
    const result = (plugin.transform as Function)!(code, '/test/src/routes/+page.server.ts')
    expect(result).toHaveProperty('code')
    expect(result).toHaveProperty('map', null)
  })
})
