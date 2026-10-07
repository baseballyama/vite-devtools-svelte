// Collector paths not reached by the scenario tests in collector.test.ts:
// malformed runtime payloads, served-epoch eviction, pull cache bounds, the
// state timeline pull, and reply/request mismatches.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import {
  Collector,
  HOT_EVENTS,
  MAX_EPOCHS,
  PULL_FRESHNESS,
  RUNTIME_REQUEST_TIMEOUT,
} from '../src/server/collector.js'
import type { HotChannel, HotClient } from '../src/server/collector.js'

function attached() {
  const listeners = new Map<string, (payload: unknown, client: HotClient) => void>()
  const sent: Array<{ event: string; payload: any }> = []
  const hot: HotChannel = {
    send: (event, payload) => {
      sent.push({ event, payload })
    },
    on: (event, listener) => {
      listeners.set(event, listener)
    },
    off: event => {
      listeners.delete(event)
    },
  }
  const c = new Collector()
  c.attach(hot)
  const emit = (event: string, payload: unknown) =>
    listeners.get(event)!(payload, { send: () => {} })
  const requests = (event: string) => sent.filter(s => s.event === event).map(s => s.payload)
  return { c, emit, requests }
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('malformed runtime payloads are ignored', () => {
  it.each([null, undefined, 42, 'x', [], {}, { fps: 60 }, { timestamp: 1, fps: '60' }])(
    'fps %j',
    payload => {
      const { c, emit } = attached()
      emit(HOT_EVENTS.fps, payload)
      expect(c.fpsSamples).toEqual([])
    },
  )

  it.each([null, 'boom', [], {}, { message: 42 }])('runtime error %j', payload => {
    const { c, emit } = attached()
    emit(HOT_EVENTS.runtimeError, payload)
    expect(c.runtimeErrors).toEqual([])
  })

  it.each([null, 'x', [1, 2]])('components / profiles / timeline %j', payload => {
    const { c, emit } = attached()
    emit(HOT_EVENTS.components, payload)
    emit(HOT_EVENTS.profiles, payload)
    emit(HOT_EVENTS.stateTimeline, payload)
    expect(c.liveComponents).toEqual([])
    expect(c.renderProfiles).toEqual([])
    expect(c.stateTimeline).toEqual([])
  })
})

describe('served page load (epoch) eviction', () => {
  it('a page load with a tree is served again as soon as it pushes anything', () => {
    const c = new Collector()
    c.ingestComponents({ epoch: 'a', components: [{ id: 1 }] })
    c.ingestComponents({ epoch: 'b', components: [{ id: 2 }] })
    expect(c.liveSnapshot.epoch).toBe('b')
    c.ingestProfiles({ epoch: 'a', profiles: [] })
    expect(c.liveSnapshot).toMatchObject({ epoch: 'a', components: [{ id: 1 }] })
    // profile-only page loads push b out of the LRU; a stays served
    for (const e of ['c', 'd', 'e']) c.ingestProfiles({ epoch: e })
    expect(c.epochInfo.epochs).toBe(MAX_EPOCHS)
    expect(c.liveSnapshot).toMatchObject({ epoch: 'a', components: [{ id: 1 }] })
  })

  it('without any epoch holding a tree, nothing is served as a tree', () => {
    const c = new Collector()
    c.ingestComponents({ epoch: 'a', components: [{ id: 1 }] })
    for (const e of ['b', 'c', 'd', 'e']) c.ingestProfiles({ epoch: e, profiles: [{ id: e }] })
    expect(c.liveSnapshot).toEqual({ epoch: null, total: 0, components: [] })
    // the newest pusher's profiles are still shown
    expect(c.renderProfiles).toEqual([{ id: 'e' }])
  })

  it('a repeated id within one snapshot keeps one entry (last wins)', () => {
    const c = new Collector()
    c.ingestComponents({
      epoch: 'a',
      components: [
        { id: 1, name: 'old' },
        { id: 1, name: 'new' },
      ],
    })
    expect(c.liveComponents).toEqual([{ id: 1, name: 'new' }])
    expect(c.liveComponentsTotal).toBe(1)
  })
})

describe('reactive pulls: replies that do not match', () => {
  it('a graph reply without requestId (older runtime) answers graph pulls only', async () => {
    const { c, emit } = attached()
    const graph = c.requestReactiveGraph()
    let summaryDone = false
    const summary = c.requestReactiveSummary().then(s => {
      summaryDone = true
      return s
    })
    emit(HOT_EVENTS.reactiveGraph, { nodes: [{ id: 'x' }], edges: [] })
    expect((await graph).nodes).toEqual([{ id: 'x' }])
    await Promise.resolve()
    expect(summaryDone).toBe(false)
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT)
    expect((await summary).staleReason).toBe('timeout')
  })

  it('a summary reply carrying a graph requestId, or another epoch, is ignored', async () => {
    const { c, emit, requests } = attached()
    c.ingestComponents({ epoch: 'e1', components: [{ id: 1 }] })
    const graph = c.requestReactiveGraph()
    const summary = c.requestReactiveSummary()
    const graphId = requests(HOT_EVENTS.requestReactiveGraph)[0].requestId
    const summaryId = requests(HOT_EVENTS.requestReactiveSummary)[0].requestId
    emit(HOT_EVENTS.reactiveSummary, { requestId: graphId, rows: [] })
    emit(HOT_EVENTS.reactiveSummary, { requestId: summaryId, epoch: 'other', rows: [] })
    emit(HOT_EVENTS.reactiveSummary, { requestId: summaryId, epoch: 'e1', rows: [{ file: 'a' }] })
    expect((await summary).rows).toHaveLength(1)
    emit(HOT_EVENTS.reactiveGraph, { requestId: graphId, epoch: 'e1', nodes: [], edges: [] })
    expect((await graph).stale).toBeUndefined()
  })

  it('summary rows are normalized from untrusted values', async () => {
    const { c, emit, requests } = attached()
    const summary = c.requestReactiveSummary()
    const { requestId } = requests(HOT_EVENTS.requestReactiveSummary)[0]
    emit(HOT_EVENTS.reactiveSummary, {
      requestId,
      rows: [
        {
          componentId: -3,
          file: 42,
          nodes: { state: 2.7, derived: 'x', effect: Infinity },
          changes: Number.NaN,
          renders: 5,
          renderMs: -1,
          kind: 'module',
        },
        'garbage',
      ],
    })
    expect((await summary).rows).toEqual([
      {
        componentId: 0,
        file: '',
        nodes: { state: 2, derived: 0, effect: 0 },
        changes: 0,
        renders: 5,
        renderMs: 0,
        kind: 'module',
      },
      {
        componentId: 0,
        file: '',
        nodes: { state: 0, derived: 0, effect: 0 },
        changes: 0,
        renders: 0,
        renderMs: 0,
      },
    ])
  })
})

describe('pull result cache', () => {
  it('keeps the 32 most recent keys: an evicted scope falls back to empty, a kept one to its result', async () => {
    const { c, emit, requests } = attached()
    c.ingestComponents({ epoch: 'e1', components: [{ id: 0 }] })
    for (let id = 1; id <= 33; id++) {
      const p = c.requestReactiveGraph({ componentId: id })
      emit(HOT_EVENTS.reactiveGraph, {
        requestId: requests(HOT_EVENTS.requestReactiveGraph).at(-1).requestId,
        epoch: 'e1',
        nodes: [{ id: `${id}:a`, componentId: id }],
        edges: [],
      })
      await p
    }
    vi.advanceTimersByTime(PULL_FRESHNESS)
    // no reply this time: both answered from cache on timeout
    const evicted = c.requestReactiveGraph({ componentId: 1 })
    const kept = c.requestReactiveGraph({ componentId: 33 })
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT)
    expect(await evicted).toMatchObject({ nodes: [], stale: true, staleReason: 'timeout' })
    expect(await kept).toMatchObject({ nodes: [{ id: '33:a' }], stale: true })
  })
})

const change = (i: number) => ({
  id: `n${i}`,
  name: 'n',
  componentFile: '/A.svelte',
  oldValue: i - 1,
  newValue: i,
  timestamp: i,
})

describe('state timeline pull (requestStateTimeline)', () => {
  it('without a runtime, answers the server buffer at once', async () => {
    const c = new Collector()
    c.ingestStateTimeline({ epoch: 'a', changes: [change(1)] })
    expect((await c.requestStateTimeline()).map(e => e.id)).toEqual(['n1'])
  })

  it('asks the runtime once for concurrent callers and resolves all with its push', async () => {
    const { c, emit, requests } = attached()
    vi.advanceTimersByTime(PULL_FRESHNESS)
    const p1 = c.requestStateTimeline()
    const p2 = c.requestStateTimeline()
    expect(requests(HOT_EVENTS.requestStateTimeline)).toHaveLength(1)
    emit(HOT_EVENTS.stateTimeline, { epoch: 'a', changes: [change(1)] })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.map(e => e.id)).toEqual(['n1'])
    expect(r2).toBe(r1)
    // fresh: answered from the buffer without asking again
    await c.requestStateTimeline()
    expect(requests(HOT_EVENTS.requestStateTimeline)).toHaveLength(1)
  })

  it('times out to the buffer, and detach answers pending callers', async () => {
    const { c } = attached()
    vi.advanceTimersByTime(PULL_FRESHNESS)
    const timedOut = c.requestStateTimeline()
    vi.advanceTimersByTime(RUNTIME_REQUEST_TIMEOUT)
    expect(await timedOut).toEqual([])
    const pending = c.requestStateTimeline()
    c.detach()
    expect(await pending).toEqual([])
  })
})
