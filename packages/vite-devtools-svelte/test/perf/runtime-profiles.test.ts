// Review P-1 Option A: profile pushes while DevTools is open. Contract in
// docs/performance-status.md "P-1 Option A" (R1 retained set = collector tail,
// R2 cumulative counters, R3 forced activation/resync, R4 gating, R5 cadence,
// R6 hard 2 s bound).
import { describe, expect, it } from 'vitest'

import { Collector, LIMITS } from '../../src/server/collector.js'
import { createRuntime, mountList, type Harness } from './harness.js'

const zeroClock = () => 0
/** The size-term interval the runtime picks for a payload estimate (R5). */
const intervalForBytes = (bytes: number) => (bytes > 1_000_000 ? 2000 : 1000)

const profileMsgs = (h: Harness) =>
  h.sent.filter(s => s.event === 'svelte-devtools:profiles').map(s => s.data as any)

describe('P-1 Option A: profiles push', () => {
  it('R1: sends exactly the collector tail (cap pinned to LIMITS.renderProfiles)', () => {
    expect(createRuntime().dt._profileCap).toBe(LIMITS.renderProfiles)
    const h = createRuntime()
    mountList(h, 6000, 0)
    h.flushTimers()
    h.sent.length = 0
    h.dt._sendProfileUpdate()
    const [msg] = profileMsgs(h)
    const all = [...h.dt._profiles.values()]
    expect(all.length).toBeGreaterThan(LIMITS.renderProfiles)
    expect(msg.profiles.map((p: any) => p.componentId)).toEqual(
      all.slice(-LIMITS.renderProfiles).map((p: any) => p.componentId),
    )

    // What the server stores is identical to what it stored from the full map.
    const fromFull = new Collector()
    fromFull.ingestProfiles({ epoch: msg.epoch, profiles: all })
    const fromCapped = new Collector()
    fromCapped.ingestProfiles(msg)
    expect(fromCapped.renderProfiles).toEqual(fromFull.renderProfiles)
  })

  it('R2: cumulative counters survive coalesced pushes', () => {
    const h = createRuntime()
    const list = mountList(h, 3, 0)
    h.flushTimers()
    h.sent.length = 0
    const id = list.ids[1]
    for (let i = 0; i < 5; i++) h.dt.recordRender(id)
    h.flushTimers()
    for (let i = 0; i < 2; i++) h.dt.recordRender(id)
    h.flushTimers()
    const msgs = profileMsgs(h)
    expect(msgs).toHaveLength(2) // one push per throttle window, not per render
    const last = msgs[1].profiles.find((p: any) => p.componentId === id)
    expect(last.renderCount).toBe(7)
  })

  it('R3: activation and resync send at once and cancel the pending push', () => {
    const h = createRuntime({ active: false })
    const list = mountList(h, 3, 0)
    expect(profileMsgs(h)).toHaveLength(0)

    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true })
    // immediate (no timer flushed), after the components snapshot
    expect(profileMsgs(h)).toHaveLength(1)
    const events = h.sent.map(s => s.event)
    expect(events.indexOf('svelte-devtools:components')).toBeLessThan(
      events.indexOf('svelte-devtools:profiles'),
    )
    expect(profileMsgs(h)[0].profiles).toHaveLength(3)

    h.flushTimers()
    h.sent.length = 0
    h.dt.recordRender(list.ids[0]) // arms a throttled push
    expect(h.dt._profileDebounceTimer).not.toBeNull()
    h.emit('svelte-devtools:subscription', { active: true, componentDeltas: true, resync: true })
    expect(profileMsgs(h)).toHaveLength(1)
    expect(h.dt._profileDebounceTimer).toBeNull()
    h.flushTimers()
    expect(profileMsgs(h)).toHaveLength(1) // no duplicate from the cancelled timer
  })

  it('R4: nothing is pushed while inactive', () => {
    const h = createRuntime({ active: false })
    const list = mountList(h, 3, 0)
    h.dt.recordRender(list.ids[0])
    h.flushTimers()
    h.dt._sendProfileUpdate()
    expect(profileMsgs(h)).toHaveLength(0)
  })

  it('R5: interval grows with the measured payload; small apps keep 500 ms', () => {
    const clock = zeroClock // serialization cost 0 ms → only the size term decides
    const small = createRuntime({ clock })
    const s = mountList(small, 3, 0)
    small.flushTimers()
    small.dt._sendProfileUpdate()
    small.dt.recordRender(s.ids[0])
    expect(small.pendingDelays()).toEqual([500])

    const big = createRuntime({ clock })
    const b = mountList(big, 6000, 0)
    big.flushTimers()
    big.sent.length = 0
    big.dt._sendProfileUpdate()
    const realBytes = JSON.stringify(profileMsgs(big)[0].profiles).length
    const est = big.dt._profilesCost.bytes
    // the sampled estimate tracks the real payload (the old 160 B/entry guess did not)
    expect(Math.abs(est - realBytes) / realBytes).toBeLessThan(0.3)
    expect(realBytes).toBeGreaterThan(250000)
    big.dt.recordRender(b.ids[0])
    const timer = big.dt._profileDebounceTimer
    big.dt.recordRender(b.ids[1]) // throttle, not debounce: the timer is kept
    expect(big.dt._profileDebounceTimer).toBe(timer)
    expect(big.pendingDelays()).toEqual([intervalForBytes(est)])
  })

  it('R6: slow serialization and high churn never push the interval past 2 s', () => {
    let now = 0
    // every send "costs" 300 ms of serialization → 20 × ms = 6 s unclamped
    const h = createRuntime({
      clock: () => now,
      onSend: () => {
        now += 300
      },
    })
    const list = mountList(h, 50, 0)
    h.flushTimers()
    h.sent.length = 0
    h.dt._sendProfileUpdate()
    expect(20 * h.dt._profilesCost.ms).toBeGreaterThan(2000) // the clamp is what bounds it
    // high churn: many renders while a push is pending
    h.dt.recordRender(list.ids[0])
    const timer = h.dt._profileDebounceTimer
    for (let i = 0; i < 200; i++) h.dt.recordRender(list.ids[i % 50])
    expect(h.dt._profileDebounceTimer).toBe(timer) // not extended/re-armed
    expect(h.pendingDelays()).toEqual([2000])
    h.flushTimers()
    const msgs = profileMsgs(h)
    expect(msgs).toHaveLength(2) // the forced send + exactly one coalesced push
    const total = msgs[1].profiles.reduce((sum: number, p: any) => sum + p.renderCount, 0)
    expect(total).toBe(201) // nothing lost in the coalesced push
  })
})
