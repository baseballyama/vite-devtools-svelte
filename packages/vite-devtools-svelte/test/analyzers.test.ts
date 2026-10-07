import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Static analyzers over generated temp projects: assets, project info,
 * component relations, reactive declaration lines. (Routes, API endpoints,
 * OG, build and module graph have their own files.)
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'

import { analyzeAssets } from '../src/analyzers/assets.js'
import { analyzeComponents } from '../src/analyzers/components.js'
import { analyzeProject } from '../src/analyzers/project.js'
import { findReactiveLine } from '../src/analyzers/source.js'

const tmpRoots: string[] = []
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true })
})
afterEach(() => {
  vi.useRealTimers()
})

/** chmod 000 only locks a file for a non-root user on POSIX. */
const CAN_LOCK = process.platform !== 'win32' && process.getuid?.() !== 0

/** A temp directory holding `files` (relative path → content). */
function tree(files: Record<string, string | Buffer>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-an-'))
  tmpRoots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

// =====================================================================
// analyzeAssets
// =====================================================================

describe('analyzeAssets', () => {
  it.each([
    ['a.png', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.gif', 'image/gif'],
    ['a.svg', 'image/svg+xml'],
    ['a.webp', 'image/webp'],
    ['a.avif', 'image/avif'],
    ['a.ico', 'image/x-icon'],
    ['a.woff', 'font/woff'],
    ['a.woff2', 'font/woff2'],
    ['a.ttf', 'font/ttf'],
    ['a.eot', 'application/vnd.ms-fontobject'],
    ['a.otf', 'font/otf'],
    ['a.mp4', 'video/mp4'],
    ['a.webm', 'video/webm'],
    ['a.mp3', 'audio/mpeg'],
    ['a.wav', 'audio/wav'],
    ['a.ogg', 'audio/ogg'],
    ['a.json', 'application/json'],
    ['a.xml', 'application/xml'],
    ['a.pdf', 'application/pdf'],
    ['a.txt', 'text/plain'],
    ['a.css', 'text/css'],
    ['a.js', 'text/javascript'],
    ['a.html', 'text/html'],
    ['A.PNG', 'image/png'],
    ['a.tar.gz', 'application/octet-stream'],
    ['a.xyz', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s is served as %s', (name, type) => {
    const dir = tree({ [name]: 'x' })
    expect(analyzeAssets(dir).map(a => [a.name, a.type])).toEqual([[name, type]])
  })

  const dir = tree({
    'favicon.png': '12345678',
    '.hidden': 'h',
    'fonts/custom.woff2': 'w',
    'fonts/.DS_Store': 'x',
    '.well-known/security.txt': 's',
    'img/my logo.svg': '<svg/>',
    'img/日本.png': 'p',
  })
  fs.symlinkSync(path.join(dir, 'favicon.png'), path.join(dir, 'link.png'))
  fs.symlinkSync(path.join(dir, 'missing.png'), path.join(dir, 'dangling.png'))
  fs.symlinkSync(path.join(dir, 'fonts'), path.join(dir, 'fonts-link'))

  it('lists files recursively, sorted, skipping hidden files and non-file links', () => {
    expect(analyzeAssets(dir).map(a => a.relativePath)).toEqual(
      [
        '.well-known/security.txt',
        'favicon.png',
        'fonts/custom.woff2',
        'img/my logo.svg',
        'img/日本.png',
        'link.png',
      ]
        .map(p => p.split('/').join(path.sep))
        .toSorted((a, b) => a.localeCompare(b)),
    )
  })

  it('records absolute path, size and mtime', () => {
    const favicon = analyzeAssets(dir).find(a => a.name === 'favicon.png')!
    expect(favicon.path).toBe(path.join(dir, 'favicon.png'))
    expect(favicon.size).toBe(8)
    expect(favicon.mtime).toBe(fs.statSync(favicon.path).mtimeMs)
    // a symlinked file reports its target's size
    expect(analyzeAssets(dir).find(a => a.name === 'link.png')!.size).toBe(8)
  })

  it.each([
    ['/', '/img/my%20logo.svg'],
    ['/base', '/base/img/my%20logo.svg'],
    ['/base/', '/base/img/my%20logo.svg'],
    ['https://cdn.example/x/', 'https://cdn.example/x/img/my%20logo.svg'],
  ])('URL under public base %j is %s', (base, url) => {
    expect(analyzeAssets(dir, base).find(a => a.name === 'my logo.svg')!.url).toBe(url)
  })

  it('percent-encodes each path segment', () => {
    expect(analyzeAssets(dir).find(a => a.name === '日本.png')!.url).toBe(
      `/img/${encodeURIComponent('日本.png')}`,
    )
  })

  it('returns [] when the directory does not exist', () => {
    expect(analyzeAssets(path.join(dir, 'nope'))).toEqual([])
  })
})

// =====================================================================
// analyzeProject
// =====================================================================

describe('analyzeProject', () => {
  it('reads name, version and dependency maps from package.json', () => {
    const root = tree({
      'package.json': JSON.stringify({
        name: 'app',
        version: '1.2.3',
        dependencies: { svelte: '^5.0.0', '@sveltejs/kit': '^2.0.0', bad: 1 },
        devDependencies: { vite: '^8.0.0' },
      }),
    })
    expect(analyzeProject(root)).toEqual({
      name: 'app',
      version: '1.2.3',
      svelteVersion: '^5.0.0',
      sveltekitVersion: '^2.0.0',
      viteVersion: '^8.0.0',
      dependencies: { svelte: '^5.0.0', '@sveltejs/kit': '^2.0.0' },
      devDependencies: { vite: '^8.0.0' },
      routesDir: path.join(root, 'src', 'routes'),
      staticDir: path.join(root, 'static'),
    })
  })

  it.each<[label: string, files: Record<string, string>]>([
    ['missing package.json', {}],
    ['invalid JSON (mid-edit)', { 'package.json': '{ "name": "app", ' }],
    ['JSON array', { 'package.json': '[1, 2]' }],
    ['JSON null', { 'package.json': 'null' }],
    [
      'wrong field types',
      {
        'package.json': JSON.stringify({
          name: 5,
          version: '',
          dependencies: [1],
          devDependencies: 'x',
        }),
      },
    ],
  ])('%s falls back to defaults', (_label, files) => {
    const root = tree(files)
    expect(analyzeProject(root)).toMatchObject({
      name: path.basename(root),
      version: '0.0.0',
      svelteVersion: 'unknown',
      sveltekitVersion: 'unknown',
      viteVersion: 'unknown',
      dependencies: {},
      devDependencies: {},
    })
  })

  it('prefers installed versions, then dependencies, then devDependencies', () => {
    const root = tree({
      'package.json': JSON.stringify({
        dependencies: { svelte: '^5.0.0', vite: '' },
        devDependencies: { svelte: '^4.0.0', vite: '^8.0.0', '@sveltejs/kit': '^2.0.0' },
      }),
      'node_modules/svelte/package.json': JSON.stringify({ version: '5.1.0' }),
      'node_modules/@sveltejs/kit/package.json': '{ broken',
      'node_modules/vite/package.json': JSON.stringify({ version: 8 }),
    })
    expect(analyzeProject(root)).toMatchObject({
      svelteVersion: '5.1.0',
      sveltekitVersion: '^2.0.0', // unreadable installed manifest
      viteVersion: '^8.0.0', // non-string installed version; empty dependency entry skipped
    })
  })

  it.each<[label: string, dirs: string[], routes: string, statics: string]>([
    ['defaults when nothing exists', [], 'src/routes', 'static'],
    ['src/routes and static', ['src/routes', 'static'], 'src/routes', 'static'],
    ['src/pages and public', ['src/pages', 'public'], 'src/pages', 'public'],
    ['src/routes wins over src/pages', ['src/routes', 'src/pages'], 'src/routes', 'static'],
    ['static wins over public', ['public', 'static'], 'src/routes', 'static'],
  ])('directories: %s', (_label, dirs, routes, statics) => {
    const root = tree(Object.fromEntries(dirs.map(d => [`${d}/.keep`, ''])))
    const info = analyzeProject(root)
    expect(info.routesDir).toBe(path.join(root, ...routes.split('/')))
    expect(info.staticDir).toBe(path.join(root, statics))
  })

  it('caches per root for 5 seconds', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const root = tree({ 'package.json': JSON.stringify({ name: 'v1' }) })
    const first = analyzeProject(root)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'v2' }))
    vi.setSystemTime(1_000_000 + 4999)
    expect(analyzeProject(root)).toBe(first)
    vi.setSystemTime(1_000_000 + 5000)
    const second = analyzeProject(root)
    expect(second.name).toBe('v2')
    // another root is never served from the cache
    const other = tree({ 'package.json': JSON.stringify({ name: 'other' }) })
    expect(analyzeProject(other).name).toBe('other')
    expect(analyzeProject(root)).not.toBe(second) // the cache holds one root
  })
})

// =====================================================================
// analyzeComponents
// =====================================================================

describe('analyzeComponents', () => {
  const root = tree({
    'package.json': '{}',
    'src/lib/Counter.svelte': '<p>c</p>',
    'src/lib/Nested/Deep.svelte': "<script>import Counter from '../Counter.svelte'</script>",
    'src/routes/+page.svelte': [
      '<script>',
      "  import Counter from '$lib/Counter.svelte'",
      '  import Deep from "#lib/Nested/Deep.svelte"',
      "  import { default as Again } from './../lib/Counter.svelte'",
      "  import * as $NS from './Local.svelte'",
      "  import Missing from './Missing.svelte'",
      "  import Pkg from 'some-pkg/Button.svelte'",
      "  import data from './data.js'",
      '</script>',
    ].join('\n'),
    'src/routes/Local.svelte': '',
    'src/node_modules/x/X.svelte': '',
    'src/.svelte-kit/generated/Root.svelte': '',
    // a nested package must not change where $lib resolves
    'src/routes/nested-pkg/package.json': '{}',
    'src/routes/nested-pkg/Uses.svelte': "<script>import C from '$lib/Counter.svelte'</script>",
    'src/notes.md': '',
  })

  const byFile = () => new Map(analyzeComponents(root).map(c => [c.file, c]))

  it('lists .svelte files under src (without node_modules / .svelte-kit)', () => {
    expect([...byFile().keys()].toSorted()).toEqual(
      [
        'src/lib/Counter.svelte',
        'src/lib/Nested/Deep.svelte',
        'src/routes/+page.svelte',
        'src/routes/Local.svelte',
        'src/routes/nested-pkg/Uses.svelte',
      ].map(p => p.split('/').join(path.sep)),
    )
  })

  it('names a component after its file', () => {
    expect(byFile().get(path.join('src', 'lib', 'Nested', 'Deep.svelte'))!.name).toBe('Deep')
  })

  it('resolves relative, $lib and #lib imports once each; skips unresolvable ones', () => {
    const page = byFile().get(path.join('src', 'routes', '+page.svelte'))!
    expect(page.imports.toSorted()).toEqual(
      [
        path.join('src', 'lib', 'Counter.svelte'),
        path.join('src', 'lib', 'Nested', 'Deep.svelte'),
        path.join('src', 'routes', 'Local.svelte'),
      ].toSorted(),
    )
    expect(byFile().get(path.join('src', 'lib', 'Nested', 'Deep.svelte'))!.imports).toEqual([
      path.join('src', 'lib', 'Counter.svelte'),
    ])
  })

  it('resolves $lib from the analysed root, not the nearest package.json', () => {
    const uses = byFile().get(path.join('src', 'routes', 'nested-pkg', 'Uses.svelte'))!
    expect(uses.imports).toEqual([path.join('src', 'lib', 'Counter.svelte')])
  })

  it('$lib to a missing file resolves to nothing', () => {
    const r = tree({ 'src/A.svelte': "<script>import X from '$lib/X.svelte'</script>" })
    expect(analyzeComponents(r)).toEqual([
      { file: path.join('src', 'A.svelte'), name: 'A', imports: [] },
    ])
  })

  it('returns [] without a src directory', () => {
    expect(analyzeComponents(tree({}))).toEqual([])
  })

  it.skipIf(!CAN_LOCK)('lists an unreadable component without imports instead of throwing', () => {
    const r = tree({ 'src/Secret.svelte': "<script>import X from './X.svelte'</script>" })
    fs.chmodSync(path.join(r, 'src', 'Secret.svelte'), 0o000)
    try {
      expect(analyzeComponents(r)).toEqual([
        { file: path.join('src', 'Secret.svelte'), name: 'Secret', imports: [] },
      ])
    } finally {
      fs.chmodSync(path.join(r, 'src', 'Secret.svelte'), 0o644)
    }
  })
})

// =====================================================================
// findReactiveLine
// =====================================================================

describe('findReactiveLine', () => {
  const source = [
    '<script>', // 1
    '  let count = $state(0)', // 2
    '  const doubled = $derived(count * 2)', // 3
    '  var legacy = 1', // 4
    '  let countdown = 0', // 5
    '  $effect.pre(() => {})', // 6
    '  $effect(() => {})', // 7
    '  let $odd.name = 1', // 8
    '  let a, b = 1', // 9
    '  let a$ = 2', // 10
    '  let a$b = 3', // 11
    '  outlet zz', // 12
    '</script>',
  ].join('\n')

  it.each<[name: string, type: string, line: number]>([
    ['count', 'state', 2],
    ['doubled', 'derived', 3],
    ['legacy', 'state', 4],
    ['countdown', 'state', 5], // `count` must not match `countdown` and vice versa
    ['anything', 'effect', 6], // the first effect of either kind
    ['$odd.name', 'state', 8], // regex metacharacters are escaped
    ['missing', 'state', 0],
    ['b', 'state', 0], // only the first declarator of a statement
    ['', 'state', 0],
    ['a', 'state', 9],
    ['a$', 'state', 10], // a trailing `$` still ends the name
    ['a$b', 'state', 11],
    ['zz', 'state', 0], // `let` must start a word
  ])('%s (%s) → line %i', (name, type, line) => {
    expect(findReactiveLine(source, name, type)).toBe(line)
  })

  it('returns 0 for an effect when the source has none', () => {
    expect(findReactiveLine('let a = 1', 'a', 'effect')).toBe(0)
  })

  it('handles CRLF sources', () => {
    expect(findReactiveLine('<script>\r\n  let x = $state(1)\r\n', 'x', 'state')).toBe(2)
  })
})
