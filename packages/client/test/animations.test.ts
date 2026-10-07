// The DevTools UI runs inside the Vite DevTools dock, an iframe that shares
// the app's main thread. A never-ending animation of a property the
// compositor cannot run alone (box-shadow, background-position, ...) costs a
// style recalc + paint every frame and lowers the frame rate the Frame rate
// panel reports (it measured ~8 fps instead of 60 with a box-shadow pulse).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const COMPOSITED = new Set(['transform', 'opacity', 'offset'])

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return files(p)
    return /\.(svelte|css)$/.test(e.name) ? [p] : []
  })
}

describe('UI animations', () => {
  it('infinite animations only animate compositor properties (transform / opacity)', () => {
    const offenders: string[] = []
    for (const file of files(src)) {
      const css = fs.readFileSync(file, 'utf-8')
      for (const m of css.matchAll(/animation:\s*([\w-]+)[^;]*\binfinite\b/g)) {
        const body = css.match(new RegExp(`@keyframes\\s+${m[1]}\\s*\\{([\\s\\S]*?)\\n  \\}`))?.[1]
        if (!body) {
          offenders.push(`${path.relative(src, file)}: @keyframes ${m[1]} not found`)
          continue
        }
        for (const prop of body.matchAll(/([\w-]+)\s*:/g)) {
          if (!COMPOSITED.has(prop[1]))
            offenders.push(`${path.relative(src, file)}: ${m[1]} animates ${prop[1]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
