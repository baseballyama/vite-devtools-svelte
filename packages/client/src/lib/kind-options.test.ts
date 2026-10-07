import { describe, expect, it } from 'vitest'

import { kindOptions } from './kind-options.js'

const upper = (k: string) => k.toUpperCase()

describe('kindOptions', () => {
  it('lists All, then the kinds present in the given order', () => {
    const counts = new Map([
      ['css', 2],
      ['js', 3],
    ])
    expect(kindOptions(['js', 'ts', 'css'], counts, 'all', upper)).toEqual([
      { value: 'all', label: 'All', count: 5 },
      { value: 'js', label: 'JS', count: 3 },
      { value: 'css', label: 'CSS', count: 2 },
    ])
  })

  it('keeps the current kind even when it has no items', () => {
    expect(kindOptions(['js', 'ts'], new Map([['js', 1]]), 'ts', upper)).toEqual([
      { value: 'all', label: 'All', count: 1 },
      { value: 'js', label: 'JS', count: 1 },
      { value: 'ts', label: 'TS', count: 0 },
    ])
  })
})
