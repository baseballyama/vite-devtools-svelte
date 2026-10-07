/**
 * Test helpers for rune modules (not shipped: only tests import this).
 *
 * Tests that re-import a module after `vi.resetModules()` get a fresh Svelte
 * runtime with it; signals of one runtime are invisible to effects of
 * another. Importing these helpers the same way (after the reset) keeps the
 * module under test and the effects observing it on one runtime.
 */
import { flushSync } from 'svelte'

/** Run `setup` inside an effect root (so it may create `$effect`s); `stop` tears it down. */
export function withRoot<T>(setup: () => T): { value: T; stop: () => void; flush: () => void } {
  let value!: T
  const stop = $effect.root(() => {
    value = setup()
  })
  flushSync()
  return { value, stop, flush: () => flushSync() }
}

/** Every value `read()` takes, recorded by an `$effect` (so only real changes count). */
export function track<T>(read: () => T): { seen: T[]; stop: () => void; flush: () => void } {
  const seen: T[] = []
  const { stop, flush } = withRoot(() => {
    $effect(() => {
      seen.push(read())
    })
  })
  return { seen, stop, flush }
}
