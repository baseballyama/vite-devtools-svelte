import { describe, expect, it } from 'vitest'

import { icons } from './icons.js'

// Icon markup is rendered with {@html} inside <svg viewBox="0 0 24 24">.
const ELEMENT = /<(path|circle|rect) ((?:[a-z-]+="[^"<>]*" ?)+)\/>/g
const ALLOWED_ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'width',
  'height',
  'rx',
  'transform',
])

describe('icons', () => {
  it.each(Object.entries(icons))('%s is self-closing path/circle/rect markup only', (_, markup) => {
    expect(markup.trim()).not.toBe('')
    expect(markup.replaceAll(ELEMENT, '')).toBe('')
    for (const [, , attrs] of markup.matchAll(ELEMENT)) {
      for (const [, name] of attrs!.matchAll(/([a-z-]+)="/g)) expect(ALLOWED_ATTRS).toContain(name)
    }
  })

  it.each(Object.entries(icons))('%s stays inside the 24×24 viewBox', (_, markup) => {
    for (const [, name, value] of markup.matchAll(/\b(cx|cy|x|y|width|height)="([^"]+)"/g)) {
      const v = Number(value)
      expect(v, `${name}=${value}`).toBeGreaterThanOrEqual(0)
      expect(v, `${name}=${value}`).toBeLessThanOrEqual(24)
    }
  })
})
