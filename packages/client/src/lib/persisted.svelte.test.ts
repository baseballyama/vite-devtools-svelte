import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { persisted } from './persisted.svelte.js'
import { track } from './testing.svelte.js'

/** In-memory Storage; `fail` makes a method throw (private mode, quota, sandbox). */
function memoryStorage(fail: { get?: boolean; set?: boolean } = {}) {
  const map = new Map<string, string>()
  return {
    map,
    getItem: vi.fn((k: string) => {
      if (fail.get) throw new DOMException('denied', 'SecurityError')
      return map.get(k) ?? null
    }),
    setItem: vi.fn((k: string, v: string) => {
      if (fail.set) throw new DOMException('full', 'QuotaExceededError')
      map.set(k, v)
    }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('persisted', () => {
  let storage: ReturnType<typeof memoryStorage>
  beforeEach(() => {
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
  })

  it('starts from the initial value when nothing is stored', () => {
    expect(persisted('k', 5).value).toBe(5)
    expect(storage.getItem).toHaveBeenCalledWith('svelte-devtools:k')
  })

  it('writes JSON under a namespaced key and reads it back in a new instance', () => {
    const p = persisted('nav', { collapsed: false, widths: [1, 2] })
    p.value = { collapsed: true, widths: [3] }
    expect(storage.map.get('svelte-devtools:nav')).toBe('{"collapsed":true,"widths":[3]}')
    expect(persisted('nav', { collapsed: false, widths: [] }).value).toEqual({
      collapsed: true,
      widths: [3],
    })
  })

  it.each(['', 'not json', '{"a":', 'undefined', "{'a':1}"])(
    'falls back to the initial value for corrupt JSON %j',
    raw => {
      storage.map.set('svelte-devtools:k', raw)
      expect(persisted('k', 'init').value).toBe('init')
    },
  )

  it('keeps a stored JSON null (a deliberate value), unlike a missing key', () => {
    storage.map.set('svelte-devtools:k', 'null')
    expect(persisted<string | null>('k', 'init').value).toBeNull()
  })

  it('is reactive', () => {
    const p = persisted('r', 1)
    const t = track(() => p.value)
    p.value = 2
    t.flush()
    p.value = 3
    t.flush()
    t.stop()
    expect(t.seen).toEqual([1, 2, 3])
  })
})

describe('persisted without working storage', () => {
  it('uses the initial value when reading throws', () => {
    vi.stubGlobal('localStorage', memoryStorage({ get: true }))
    expect(persisted('k', 'init').value).toBe('init')
  })

  it('keeps the value in memory when writing throws (quota / private mode)', () => {
    vi.stubGlobal('localStorage', memoryStorage({ set: true }))
    const p = persisted('k', 1)
    expect(() => (p.value = 2)).not.toThrow()
    expect(p.value).toBe(2)
  })

  it('works when localStorage itself is unavailable (sandboxed iframe)', () => {
    vi.stubGlobal('localStorage', null)
    const p = persisted('k', 'a')
    p.value = 'b'
    expect(p.value).toBe('b')
  })

  it('keeps the in-memory value for values JSON cannot store', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const p = persisted<unknown>('k', 0)
    p.value = 10n
    expect(p.value).toBe(10n)
    expect(storage.map.has('svelte-devtools:k')).toBe(false)
  })
})
