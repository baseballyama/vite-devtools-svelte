import type {
  CaptureInfo,
  DropReason,
  StateChange,
  StateTimelineDelta,
  StateTimelineEntry,
  TimelineBaseline,
} from '../types.js'
import { arrayOf, nonNegInt } from './payload.js'

/** Most entries the server-side state timeline keeps. */
export const STATE_TIMELINE_LIMIT = 500

/** Byte budget (JSON length, measured once at ingest) for the server-side state timeline. */
export const STATE_TIMELINE_BYTES = 4 * 1024 * 1024

/** Epoch for runtimes that send payloads without an epoch. */
export const LEGACY_EPOCH = '(legacy)'

// Timeline `seq` values (and dataset versions) come from one process-wide
// counter, seeded from the clock: a cursor issued by an earlier collector in
// this process (inline or config-file restart) is always below a newer
// collector's `resetAt`, and one from a previous process is too unless it
// issued more than 1 000 entries per millisecond of downtime (review D2).
let lastSeq = Date.now() * 1000
export const nextSeq = (): number => ++lastSeq

const DROP_REASONS: readonly DropReason[] = [
  'runtime-count',
  'runtime-bytes',
  'server-count',
  'server-bytes',
]

export function isBaseline(b: unknown): b is TimelineBaseline {
  const v = b as Partial<TimelineBaseline> | undefined
  return (
    !!v &&
    typeof v.complete === 'boolean' &&
    Number.isInteger(v.pendingNodes) &&
    (v.pendingNodes as number) >= 0
  )
}

interface Stored {
  entry: StateTimelineEntry
  /** JSON size, measured once at ingest. */
  size: number
  /** App page load the entry came from. */
  epoch: string
}

/** A runtime timeline push (docs/devframe-migration.md §6.4), untrusted. */
export interface TimelinePush {
  changes?: unknown
  epoch?: unknown
  reset?: unknown
  dropped?: unknown
  valueTooLarge?: unknown
  baseline?: unknown
}

/**
 * The server-side state timeline: entries of every tracked page load
 * (epoch), oldest first, capped by count and bytes, read through cursors.
 * Losses are counted per epoch and reason until the epoch is forgotten or
 * the timeline cleared (§6.7 B/C). `onChange` runs whenever what a reader
 * sees changes.
 */
export class StateTimeline {
  private stored: Stored[] = []
  private entriesCache: StateTimelineEntry[] | undefined
  private bytes = 0
  /** Newest seq issued (= the current cursor). */
  private seq = nextSeq()
  /** Cursor value at the last removal; older cursors must start over. */
  private resetAt = this.seq
  /** Seq of the newest entry trimmed by the caps; cursors below it missed entries. */
  private trimmedAt = this.seq
  private drops = new Map<string, Record<DropReason, number>>()
  private tooLarge = new Map<string, number>()
  /** Per epoch: whether the runtime has a first sample of every tracked $state yet. */
  private baselines = new Map<string, TimelineBaseline>()

  private readonly onChange: () => void
  constructor(onChange: () => void) {
    this.onChange = onChange
  }

  get entries(): StateTimelineEntry[] {
    return (this.entriesCache ??= this.stored.map(s => s.entry))
  }

  /**
   * Two payload shapes (§6.4):
   * - delta: `{ epoch, changes, reset? }` — `changes` are new since the
   *   previous push from that page load; `reset` replaces that epoch's
   *   entries. Entries are kept per epoch, so several app tabs (or a reload)
   *   interleave instead of wiping each other.
   * - legacy full snapshot: `{ changes }` — only the entries after the
   *   newest one already held are appended, so clients still get deltas.
   */
  ingest(data: TimelinePush | undefined): void {
    const incoming = arrayOf<StateChange>(data?.changes).slice(-STATE_TIMELINE_LIMIT)
    if (typeof data?.epoch !== 'string') {
      this.appendLegacy(incoming)
      return
    }
    const epoch = data.epoch
    this.countRuntimeLosses(epoch, data.dropped, data.valueTooLarge)
    if (data.reset === true) this.dropEpoch(epoch)
    this.append(incoming, epoch)
    if (isBaseline(data.baseline)) {
      const { complete, pendingNodes } = data.baseline
      this.baselines.set(epoch, { complete, pendingNodes })
    }
  }

  private appendLegacy(incoming: StateChange[]): void {
    const last = this.stored.findLast(s => s.epoch === LEGACY_EPOCH)?.entry
    const seen = last
      ? incoming.findLastIndex(c => c.timestamp === last.timestamp && c.id === last.id)
      : -1
    if (seen === -1) this.dropEpoch(LEGACY_EPOCH)
    this.append(incoming.slice(seen + 1), LEGACY_EPOCH)
  }

  /** Changes after `since` (a previous `cursor`), or the whole buffer when the cursor is stale. */
  delta(since?: number): StateTimelineDelta {
    const cursor = this.seq
    if (since === undefined || since < this.resetAt || since < this.trimmedAt || since > cursor) {
      return { cursor, reset: true, changes: this.entries }
    }
    let i = this.stored.length
    while (i > 0 && this.stored[i - 1]!.entry.seq > since) i--
    return { cursor, reset: false, changes: this.stored.slice(i).map(s => s.entry) }
  }

  /** Remove `epoch`'s entries, invalidating every cursor issued so far. */
  dropEpoch(epoch: string): void {
    if (!this.stored.some(s => s.epoch === epoch)) return
    this.stored = this.stored.filter(s => s.epoch !== epoch)
    this.bytes = this.stored.reduce((sum, s) => sum + s.size, 0)
    this.markReset()
  }

  /** An evicted page load: its entries and every counter about it. */
  forget(epoch: string): void {
    this.dropEpoch(epoch)
    this.drops.delete(epoch)
    this.tooLarge.delete(epoch)
    this.baselines.delete(epoch)
  }

  clear(): void {
    this.stored = []
    this.bytes = 0
    this.drops.clear()
    this.tooLarge.clear()
    this.markReset()
  }

  /** Capture info (§6.7 B); the baseline is the served `epoch`'s. */
  captureInfo(epoch: string | undefined): CaptureInfo {
    const sums = { 'runtime-count': 0, 'runtime-bytes': 0, 'server-count': 0, 'server-bytes': 0 }
    for (const counts of this.drops.values()) {
      for (const reason of DROP_REASONS) sums[reason] += counts[reason]
    }
    const dropped = DROP_REASONS.filter(r => sums[r] > 0).map(reason => ({
      reason,
      count: sums[reason],
    }))
    let tooLarge = 0
    for (const n of this.tooLarge.values()) tooLarge += n
    const baseline = epoch === undefined ? undefined : this.baselines.get(epoch)
    return {
      captured: this.stored.length,
      total: null,
      truncated: dropped.length > 0,
      policy: 'sampled-200ms',
      ...(dropped.length > 0 && { dropped }),
      ...(tooLarge > 0 && { valueTooLarge: tooLarge }),
      ...(baseline && { baseline }),
    }
  }

  private markReset(): void {
    this.resetAt = this.seq = nextSeq()
    this.entriesCache = undefined
    this.onChange()
  }

  /**
   * Add the runtime's own losses (unsent entries it evicted, §6.7 C) and
   * too-large values to the epoch's counters. Only runtime reasons are
   * accepted from the runtime; server reasons are counted here.
   */
  private countRuntimeLosses(epoch: string, dropped: unknown, valueTooLarge: unknown): void {
    if (Array.isArray(dropped)) {
      for (const d of dropped as Array<{ reason?: unknown; count?: unknown }>) {
        if (d?.reason !== 'runtime-count' && d?.reason !== 'runtime-bytes') continue
        const count = nonNegInt(d.count)
        if (count > 0) this.addDrop(epoch, d.reason, count)
      }
    }
    const tooLarge = nonNegInt(valueTooLarge)
    if (tooLarge > 0) this.tooLarge.set(epoch, (this.tooLarge.get(epoch) ?? 0) + tooLarge)
  }

  private addDrop(epoch: string, reason: DropReason, count: number): void {
    let counts = this.drops.get(epoch)
    if (!counts) {
      counts = { 'runtime-count': 0, 'runtime-bytes': 0, 'server-count': 0, 'server-bytes': 0 }
      this.drops.set(epoch, counts)
    }
    counts[reason] += count
  }

  private append(changes: StateChange[], epoch: string): void {
    if (changes.length === 0) return
    for (const change of changes) {
      let size: number
      try {
        size = JSON.stringify(change).length
      } catch {
        continue // not serializable: never reaches a client anyway
      }
      this.stored.push({ entry: { ...change, seq: (this.seq = nextSeq()) }, size, epoch })
      this.bytes += size
    }
    // Trim the oldest entries over the count cap, then over the byte budget,
    // keeping at least the newest entry even if it alone exceeds the budget.
    let drop = Math.max(0, this.stored.length - STATE_TIMELINE_LIMIT)
    for (let i = 0; i < drop; i++) {
      this.bytes -= this.stored[i]!.size
      this.addDrop(this.stored[i]!.epoch, 'server-count', 1)
    }
    while (this.bytes > STATE_TIMELINE_BYTES && drop < this.stored.length - 1) {
      this.addDrop(this.stored[drop]!.epoch, 'server-bytes', 1)
      this.bytes -= this.stored[drop++]!.size
    }
    if (drop > 0) {
      this.trimmedAt = this.stored[drop - 1]!.entry.seq
      this.stored = this.stored.slice(drop)
    }
    this.entriesCache = undefined
    this.onChange()
  }
}
