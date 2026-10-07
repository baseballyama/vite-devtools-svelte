import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createServer } from 'vite'
import type { Plugin, PluginOption, ViteDevServer } from 'vite'
/**
 * Integration (review P-HMR): the SvelteKit template injector follows the real
 * Vite lifecycle. Standalone (no `@vitejs/devtools`) has no resolver for the
 * hub's dock bootstrap, so the served page must not reference it; with the
 * hub present the tag points at the bootstrap the hub actually serves.
 */
import { describe, it, expect, afterAll } from 'vitest'

import { svelteDevtools } from '../src/plugin.js'
import { sveltekitTemplateInjector } from '../src/server/template-injector.js'

const INJECT_URL = '/__devtools/embedded.js'
/** Removed from `@vitejs/devtools` 0.7.6; requesting it 500s (review H-INJ). */
const REMOVED_INJECT_URL = '/@id/@vitejs/devtools/client/inject'
const INTERNAL = '/.svelte-kit/generated/server/internal.js'

const realHome = process.env.HOME
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-home-'))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-kit-inject-'))
fs.mkdirSync(path.join(root, '.svelte-kit/generated/server'), { recursive: true })
fs.writeFileSync(
  path.join(root, INTERNAL),
  `export const options = {
  templates: {
    app: ({ head, body }) => "<!doctype html><html><head>" + head + "</head><body>" + body + "</body></html>",
  },
};
`,
)

/** The real hub, as installed for the example apps (not a dependency of this package). */
async function realHub(): Promise<Plugin[]> {
  const req = createRequire(
    path.resolve(import.meta.dirname, '../../../examples/sample-app/package.json'),
  )
  const mod = await import(pathToFileURL(req.resolve('@vitejs/devtools')).href)
  return [mod.DevTools()].flat()
}

/** Stand-in for `@vitejs/devtools`: detection is by plugin name only. */
const hubStandIn: Plugin = { name: 'vite:devtools' }

const servers: ViteDevServer[] = []
let lastOrigin = ''
async function transformedInternal(plugins: PluginOption[]): Promise<string> {
  process.env.HOME = tmpHome
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    server: { port: 0, host: 'localhost' },
    plugins,
  })
  servers.push(server)
  await server.listen()
  lastOrigin = server.resolvedUrls!.local[0]!.replace(/\/$/, '')
  const result = await server.environments.ssr.transformRequest(INTERNAL)
  expect(result).not.toBeNull()
  return result!.code
}

afterAll(async () => {
  for (const s of servers) await s.close()
  process.env.HOME = realHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

describe('SvelteKit template injection follows the host', () => {
  it('standalone: the generated template never references the hub inject script', async () => {
    const code = await transformedInternal([svelteDevtools()])
    expect(code).toContain('</body>')
    expect(code).not.toContain(INJECT_URL)
    expect(code).not.toContain(REMOVED_INJECT_URL)
  }, 20_000)

  it('inside Vite DevTools: the inject script is added before </body>', async () => {
    const code = await transformedInternal([hubStandIn, svelteDevtools()])
    expect(code).toContain(`${INJECT_URL}\\"></script></body>`)
    expect(code).not.toContain(REMOVED_INJECT_URL)
  }, 20_000)

  // The real hub with the injector alone: the full plugin run from source has
  // no built client to mount in the hub (dist/client), and hub detection is
  // covered by the stand-in cases above.
  it('with the real Vite DevTools hub: the injected script URL is served (review H-INJ)', async () => {
    const code = await transformedInternal([
      ...(await realHub()),
      sveltekitTemplateInjector(() => true),
    ])
    const src = /<script type=\\"module\\" src=\\"([^"\\]+)\\"><\/script><\/body>/.exec(code)?.[1]
    expect(src).toBeDefined()
    // what the browser does with the tag: the URL must be served by the hub
    const res = await fetch(`${lastOrigin}${src}`)
    expect({ src, status: res.status }).toEqual({ src, status: 200 })
    expect(res.headers.get('content-type')).toMatch(/javascript/)
    expect((await res.text()).length).toBeGreaterThan(0)
    expect(src).toBe(INJECT_URL)
  }, 30_000)
})
