import { describe, expect, it } from 'vitest'

import { reactiveScope } from './reactive-selection.svelte.js'
import { track } from './testing.svelte.js'

describe('reactiveScope', () => {
  it('starts unscoped, is settable and clearable, and is reactive', () => {
    expect(reactiveScope.current).toBeNull()
    const t = track(() => reactiveScope.current)
    const scope = { componentId: 4, epoch: 'e1', label: '<Row>', file: 'src/Row.svelte' }
    reactiveScope.set(scope)
    t.flush()
    expect(reactiveScope.current).toEqual(scope)
    reactiveScope.set(null)
    t.flush()
    t.stop()
    expect(t.seen).toEqual([null, scope, null])
  })
})
