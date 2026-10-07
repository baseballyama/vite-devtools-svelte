import { vi } from 'vitest'

import type { Resource } from '../lib/resource.svelte.js'

/** A reactive stand-in for `resource()` (which needs a component), with spy-able actions. */
export function fakeResource<T>(data: T, init: { updatedAt?: number | null; busy?: boolean } = {}) {
  let live = $state(true)
  let busy = $state(init.busy ?? false)
  const res = {
    data,
    error: null,
    loading: false,
    get busy() {
      return busy
    },
    set busy(v: boolean) {
      busy = v
    },
    updatedAt: init.updatedAt ?? null,
    get live() {
      return live
    },
    set live(v: boolean) {
      live = v
    },
    refresh: vi.fn(() => Promise.resolve()),
    set: vi.fn<(next: T) => void>(),
  } satisfies Resource<T> & { busy: boolean }
  return res
}
