// Small runtime behaviours: component names and runtime-error reports.
import { describe, expect, it } from 'vitest'

import { createRuntime, type Harness } from './harness.js'

describe('component names', () => {
  it.each([
    ['/app/src/lib/Counter.svelte', 'Counter'],
    // only the `.svelte` extension goes, not a `.svelte` inside the name
    ['/app/src/lib/Item.sveltekit.svelte', 'Item.sveltekit'],
    ['/app/src/lib/a.svelte.svelte', 'a.svelte'],
    ['Unknown', 'Unknown'],
    ['/app/src/lib/.svelte', 'Unknown'],
  ])('%s → %s', (file, name) => {
    const h = createRuntime()
    const id = h.dt.register(file)
    expect(h.dt.getTree().find((c: { id: number }) => c.id === id).name).toBe(name)
  })
})

const errors = (h: Harness) =>
  h.sent.filter(s => s.event === 'svelte-devtools:runtime-error').map(s => s.data as any)

describe('runtime errors', () => {
  it('reports window errors with their location', () => {
    const h = createRuntime()
    h.dispatchWindow('error', {
      message: 'boom',
      filename: '/app/src/lib/A.svelte',
      lineno: 3,
      colno: 7,
      error: { stack: 'Error: boom\n  at A' },
    })
    expect(errors(h)).toEqual([
      expect.objectContaining({
        message: 'boom',
        file: '/app/src/lib/A.svelte',
        line: 3,
        column: 7,
        stack: 'Error: boom\n  at A',
      }),
    ])
  })

  it.each([
    ['an Error', new Error('nope'), 'nope'],
    ['a string', 'plain', 'plain'],
    ['an empty message', { message: '' }, '[object Object]'],
    ['undefined', undefined, 'undefined'],
    // String() throws for these: the report must not throw in the listener
    ['a null-prototype object', Object.create(null), '(unprintable value)'],
    [
      'a throwing toString',
      {
        toString() {
          throw new Error('no')
        },
      },
      '(unprintable value)',
    ],
  ])('reports an unhandled rejection with %s', (_, reason, message) => {
    const h = createRuntime()
    expect(() => h.dispatchWindow('unhandledrejection', { reason })).not.toThrow()
    expect(errors(h)).toEqual([expect.objectContaining({ message })])
  })
})
