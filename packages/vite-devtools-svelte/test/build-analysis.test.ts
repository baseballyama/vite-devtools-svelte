import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Build output scan over generated temp roots (one per test: no shared state). */
import { describe, it, expect, afterAll, vi, afterEach } from 'vitest'

import { analyzeBuild } from '../src/analyzers/build.js'

const roots: string[] = []
afterAll(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true })
})
afterEach(() => {
  vi.useRealTimers()
})

function root(files: Record<string, string> = {}): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-build-'))
  roots.push(r)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(r, ...rel.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return r
}

/** chmod 000 only locks a directory for a non-root user on POSIX. */
const CAN_LOCK = process.platform !== 'win32' && process.getuid?.() !== 0

const summary = (r: string) =>
  analyzeBuild(r).chunks.map(c => [c.file.split(path.sep).join('/'), c.size, c.isEntry])

describe('analyzeBuild', () => {
  it('is empty without build output, stamped with the current time', () => {
    vi.useFakeTimers({ now: 1234 })
    expect(analyzeBuild(root())).toEqual({ chunks: [], totalSize: 0, timestamp: 1234 })
  })

  it('is empty for empty output directories', () => {
    const r = root()
    fs.mkdirSync(path.join(r, '.svelte-kit/output'), { recursive: true })
    fs.mkdirSync(path.join(r, 'build/client'), { recursive: true })
    expect(analyzeBuild(r).chunks).toEqual([])
  })

  it('lists .js/.css/.html from every output dir (nested), largest first', () => {
    const r = root({
      '.svelte-kit/output/client/_app/immutable/entry/start.abc.js': 'x'.repeat(30),
      '.svelte-kit/output/client/_app/immutable/assets/app.css': 'x'.repeat(20),
      '.svelte-kit/output/server/index.js': 'x'.repeat(40),
      '.svelte-kit/output/prerendered/pages/about.HTML': 'x'.repeat(10),
      '.svelte-kit/output/client/data.json': '{}',
      '.svelte-kit/output/client/a.js.map': '{}',
      '.svelte-kit/output/client/img.png': 'p',
      'build/chunk.js': 'x'.repeat(5),
    })
    expect(summary(r)).toEqual([
      ['.svelte-kit/output/server/index.js', 40, true],
      ['.svelte-kit/output/client/_app/immutable/entry/start.abc.js', 30, true],
      ['.svelte-kit/output/client/_app/immutable/assets/app.css', 20, false],
      ['.svelte-kit/output/prerendered/pages/about.HTML', 10, false],
      ['build/chunk.js', 5, false],
    ])
    expect(analyzeBuild(r).totalSize).toBe(105)
  })

  it('counts a file under build/client once (build is scanned too)', () => {
    const r = root({ 'build/client/app.js': '123456', 'build/index.js': '12' })
    expect(summary(r)).toEqual([
      ['build/client/app.js', 6, false],
      ['build/index.js', 2, true],
    ])
    expect(analyzeBuild(r).totalSize).toBe(8)
  })

  it('chunk entries carry name, relative file and empty modules', () => {
    const r = root({ '.svelte-kit/output/app.js': 'abc' })
    expect(analyzeBuild(r).chunks).toEqual([
      {
        name: 'app.js',
        file: path.join('.svelte-kit', 'output', 'app.js'),
        size: 3,
        modules: [],
        isEntry: false,
      },
    ])
  })

  it.skipIf(process.platform === 'win32')(
    'symlinks: a file link counts once with its target; dangling links and directory links are skipped',
    () => {
      const r = root({ 'build/real.js': '1234', 'elsewhere/deep.js': '12345678' })
      fs.symlinkSync(path.join(r, 'build/real.js'), path.join(r, 'build/alias.js'))
      fs.symlinkSync(path.join(r, 'build/nope.js'), path.join(r, 'build/dangling.js'))
      fs.symlinkSync(path.join(r, 'elsewhere'), path.join(r, 'build/linked-dir'))
      fs.symlinkSync(path.join(r, 'build'), path.join(r, 'build/loop.js'))
      const chunks = analyzeBuild(r).chunks
      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.size).toBe(4)
    },
  )

  it.skipIf(!CAN_LOCK)('an unreadable directory is skipped, the rest is still listed', () => {
    const r = root({ 'build/locked/a.js': '1', 'build/b.js': '22' })
    fs.chmodSync(path.join(r, 'build/locked'), 0o000)
    try {
      expect(summary(r)).toEqual([['build/b.js', 2, false]])
    } finally {
      fs.chmodSync(path.join(r, 'build/locked'), 0o755)
    }
  })
})
