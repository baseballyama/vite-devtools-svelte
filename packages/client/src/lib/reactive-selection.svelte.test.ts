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

  it('scopeTo labels the instance by its component file', () => {
    reactiveScope.scopeTo(7, 'src/lib/Row.svelte', 'e2')
    expect(reactiveScope.current).toEqual({
      componentId: 7,
      epoch: 'e2',
      label: '<Row>',
      file: 'src/lib/Row.svelte',
    })
    reactiveScope.set(null)
  })
})
