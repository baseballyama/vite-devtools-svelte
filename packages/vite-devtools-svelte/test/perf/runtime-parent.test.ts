// Review B1b: a component created by a later block update ({#each} item added
// after mount) must get its real parent, in both the delta and the full form.
//
// The wrapper (wrapperCode) runs against a small model of the parts of
// svelte/internal/client 5.56.8 it relies on (checked in the installed
// source): push/pop maintain a component-context chain; pop() creates the
// deferred user effects while the component's own context is current
// (context.js); every effect records `ctx: component_context` at creation
// (reactivity/effects.js) and runs with active_effect = itself and
// component_context = its ctx restored (runtime.js update_reaction); the
// live `active_effect` binding is exported (internal/client/index.js).
import { describe, expect, it } from 'vitest'

import { wrapperCode } from '../../src/runtime/index.js'
import { createRuntime, type Harness } from './harness.js'

interface Effect {
  ctx: unknown
  fn: (() => unknown) | null
  branch: boolean
}

function svelteModel() {
  let componentContext: any = null
  const queue: Effect[] = []
  const ns: any = { active_effect: null }
  const create = (fn: Effect['fn'], branch = false): Effect => ({
    ctx: componentContext,
    fn,
    branch,
  })
  const run = <T>(effect: Effect, fn: () => T): T => {
    const prevEffect = ns.active_effect
    const prevCtx = componentContext
    ns.active_effect = effect
    componentContext = effect.ctx
    try {
      return fn()
    } finally {
      ns.active_effect = prevEffect
      componentContext = prevCtx
    }
  }
  ns.push = () => {
    componentContext = { p: componentContext, e: null, i: false }
  }
  ns.pop = () => {
    const ctx = componentContext
    for (const fn of ctx.e ?? []) queue.push(create(fn))
    ctx.e = null
    ctx.i = true
    componentContext = ctx.p
  }
  ns.user_effect = (fn: () => unknown) => {
    // top-level $effect during init is deferred until pop (mount)
    if (componentContext && !componentContext.i && ns.active_effect?.branch) {
      ;(componentContext.e ??= []).push(fn)
      return null
    }
    const effect = create(fn)
    queue.push(effect)
    return effect
  }
  ns.branch = (fn: () => void) => {
    const effect = create(fn, true)
    run(effect, fn)
    return effect
  }
  /** each(items, render): one block effect; `add()` = a later update adding an item */
  ns.each = (items: unknown[], render: (item: unknown) => void) => {
    const block = create(null)
    run(block, () => {
      for (const item of items) ns.branch(() => render(item))
    })
    return { add: (item: unknown) => run(block, () => ns.branch(() => render(item))) }
  }
  /** a block the wrapper does NOT wrap (e.g. snippet/svelte:element): only effect.ctx knows the owner */
  ns.block = (fn: () => void) => {
    const block = create(null)
    run(block, fn)
    return { rerun: (next: () => void) => run(block, () => ns.branch(next)) }
  }
  const flush = () => {
    while (queue.length > 0) {
      const effect = queue.shift()!
      run(effect, () => effect.fn?.())
    }
  }
  return { ns, flush, root: (fn: () => void) => ns.branch(fn) }
}

/** Every component added across delta messages. */
function addedIn(msgs: any[]): any[] {
  return msgs.flatMap(m => m.added ?? [])
}

function loadWrapper(ns: any, window: Record<string, any>) {
  // The module syntax as plain script: imports and re-exports dropped,
  // `export function` / `export const` declarations kept.
  const body = wrapperCode
    .split('\n')
    .filter(line => !line.startsWith('import ') && !line.startsWith('export *'))
    .filter(line => !line.startsWith('export {'))
    .map(line => (line.startsWith('export ') ? line.slice('export '.length) : line))
    .join('\n')
  // Evaluates the wrapper module's own source against the model namespace.
  // oxlint-disable-next-line typescript/no-implied-eval -- running the wrapper source under test is the point
  return new Function('__svelte_original', 'window', `${body}\nreturn { push, pop, each };`)(
    ns,
    window,
  ) as { push: () => void; pop: () => void; each: (...a: any[]) => any }
}

function setup() {
  const h = createRuntime()
  const svelte = svelteModel()
  const wrapped = loadWrapper(svelte.ns, h.window)
  // what compiled components call: wrapped push/pop/each, the rest original
  const $ = { ...svelte.ns, ...wrapped }
  const component = (file: string, template: () => void) => () => {
    h.window.__SVELTE_DEVTOOLS__._pendingFile = file
    $.push()
    template()
    $.pop()
  }
  return { h, svelte, $, component }
}

const byFile = (h: Harness, name: string) =>
  [...h.dt._instances.values()].filter((i: any) => i.file.endsWith(name)).map((i: any) => i)

const componentsSent = (h: Harness) =>
  h.sent.filter(s => s.event === 'svelte-devtools:components').map(s => s.data as any)

describe('B1b: parent of a component created by a later block update', () => {
  it('a Row added to {#each} after mount is a child of App (delta and full agree)', () => {
    const { h, svelte, $, component } = setup()
    let rows!: { add: (item: unknown) => void }
    const Cell = component('/src/Cell.svelte', () => {})
    const Row = component('/src/Row.svelte', () => Cell())
    const App = component('/src/App.svelte', () => {
      rows = $.each([0, 1], () => Row())
    })
    svelte.root(() => App())
    svelte.flush() // mount: deferred effects run
    h.flushTimers()
    const [app] = byFile(h, 'App.svelte')
    expect(byFile(h, 'Row.svelte').map(r => r.parentId)).toEqual([app.id, app.id])

    h.sent.length = 0
    rows.add(2) // later update: outside App's push..pop
    svelte.flush()
    const newRow = byFile(h, 'Row.svelte').at(-1)
    const newCell = byFile(h, 'Cell.svelte').at(-1)
    expect(newRow.parentId).toBe(app.id)
    expect(newCell.parentId).toBe(newRow.id)
    expect(app.children.has(newRow.id)).toBe(true)

    // delta form (what the hot channel carries)
    h.flushTimers()
    const added = addedIn(componentsSent(h))
    expect(added.map((c: any) => [c.name, c.parentId])).toEqual([
      ['Row', app.id],
      ['Cell', newRow.id],
    ])

    // full form agrees with the delta
    h.sent.length = 0
    h.dt._sendUpdate(true)
    const full = componentsSent(h)[0].components as any[]
    const parentOf = new Map(full.map(c => [c.id, c.parentId]))
    expect(parentOf.get(newRow.id)).toBe(app.id)
    expect(parentOf.get(newCell.id)).toBe(newRow.id)
    expect(full.filter(c => c.parentId === null).map(c => c.name)).toEqual(['App'])
  })

  it('a component re-created by a block the wrapper does not wrap still finds its owner via effect.ctx', () => {
    const { h, svelte, $, component } = setup()
    let slot!: { rerun: (fn: () => void) => void }
    const Leaf = component('/src/Leaf.svelte', () => {})
    const Panel = component('/src/Panel.svelte', () => {
      slot = $.block(() => Leaf())
    })
    const App = component('/src/App.svelte', () => Panel())
    svelte.root(() => App())
    svelte.flush()
    const [panel] = byFile(h, 'Panel.svelte')
    expect(byFile(h, 'Leaf.svelte')[0].parentId).toBe(panel.id)

    slot.rerun(() => Leaf()) // no wrapper stack entry here, only effect.ctx
    svelte.flush()
    expect(byFile(h, 'Leaf.svelte').at(-1).parentId).toBe(panel.id)
  })

  it('initial-render nesting is unchanged; later rows land under their nested owner', () => {
    const { h, svelte, $, component } = setup()
    let rows!: { add: (item: unknown) => void }
    const Row = component('/src/Row.svelte', () => {})
    const List = component('/src/List.svelte', () => {
      rows = $.each([0], () => Row())
    })
    const App = component('/src/App.svelte', () => List())
    svelte.root(() => App())
    const [app] = byFile(h, 'App.svelte')
    const [list] = byFile(h, 'List.svelte')
    // before any effect ran (nothing mapped yet) the init stack decides
    expect(list.parentId).toBe(app.id)
    expect(byFile(h, 'Row.svelte')[0].parentId).toBe(list.id)
    svelte.flush()
    rows.add(1)
    svelte.flush()
    expect(byFile(h, 'Row.svelte').at(-1).parentId).toBe(list.id)
  })
})
