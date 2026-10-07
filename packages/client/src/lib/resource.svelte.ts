/**
 * Polling-aware data loader shared by every panel.
 *
 * - Data is held in `$state.raw` so large RPC payloads (tens of thousands of
 *   rows) are never deep-proxied; consumers derive indexes from it instead.
 * - Polling only runs while the owning panel is visible (see `PANEL_ACTIVE`)
 *   and the document is not hidden, and never overlaps an in-flight request.
 * - With a `version` getter (server change counters, `getVersions`), a tick
 *   whose version did not move skips the fetch entirely; otherwise identical
 *   payloads are dropped after one serialisation pass, so an idle app never
 *   re-derives indexes or re-renders.
 */
import { getContext, untrack } from 'svelte'

export const PANEL_ACTIVE = Symbol('panel-active')

type PanelActive = () => boolean

export interface ResourceOptions<T> {
  initial: T
  /** Poll interval in ms. Omit for load-once resources. */
  interval?: number
  /** Start with polling paused (user can resume via `live = true`). */
  paused?: boolean
  /** Extra gate (reactive): only load/poll while this returns true. */
  when?: () => boolean
  /**
   * Cheap change token checked before each *polled* fetch; when it equals the
   * token of the last successful fetch, the fetch is skipped. Manual
   * `refresh()` always fetches. `undefined` token = unknown → fetch.
   */
  version?: () => Promise<string | undefined>
  /**
   * Change check for a new payload. Defaults to comparing serialised content
   * (one O(payload) pass); pass e.g. `(a, b) => a === b` when the fetcher
   * already returns the same reference for "no change".
   */
  equals?: (prev: T, next: T) => boolean
}

export interface Resource<T> {
  readonly data: T
  readonly error: string | null
  /** True until the first request settles. */
  readonly loading: boolean
  /** True while any request is in flight. */
  readonly busy: boolean
  readonly updatedAt: number | null
  /** Whether interval polling is enabled (user-togglable). */
  live: boolean
  /** Fetch now (bypasses the version check). */
  refresh(): Promise<void>
  /** Replace data locally (e.g. after a clear action). */
  set(next: T): void
}

/** Cheap content key for change detection; `null` when not serialisable. */
function contentKey(v: unknown): string | null {
  try {
    return JSON.stringify(v) ?? null
  } catch {
    return null
  }
}

export function resource<T>(fetcher: () => Promise<T>, opts: ResourceOptions<T>): Resource<T> {
  const isActive = getContext<PanelActive | undefined>(PANEL_ACTIVE) ?? (() => true)
  let data = $state.raw<T>(opts.initial)
  let error = $state<string | null>(null)
  let loading = $state(true)
  let busy = $state(false)
  let updatedAt = $state<number | null>(null)
  let live = $state(!opts.paused)
  let inflight: Promise<void> | null = null
  // Serialised form of the current data, kept so each tick costs a single
  // O(payload) pass (the new payload) instead of re-serialising both sides.
  let lastKey: string | null = null
  let lastVersion: string | undefined

  function refresh(): Promise<void> {
    return load(true)
  }

  function load(force: boolean): Promise<void> {
    if (inflight) return inflight
    busy = true
    inflight = (async () => {
      try {
        const version = opts.version ? await opts.version() : undefined
        if (!force && version !== undefined && version === lastVersion) return
        const next = await fetcher()
        lastVersion = version
        if (opts.equals) {
          if (
            !opts.equals(
              untrack(() => data),
              next,
            )
          )
            data = next
        } else {
          const key = contentKey(next)
          if (key === null || key !== lastKey) {
            lastKey = key
            data = next
          }
        }
        error = null
        updatedAt = Date.now()
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      } finally {
        loading = false
        busy = false
        inflight = null
      }
    })()
    return inflight
  }

  /** Background poll: skipped while the document is hidden. Never rejects. */
  function poll(): void {
    if (!document.hidden) void load(false)
  }

  function startPolling(interval: number): () => void {
    const id = setInterval(poll, interval)
    document.addEventListener('visibilitychange', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
    }
  }

  $effect(() => {
    let stop: (() => void) | undefined
    if (isActive() && (!opts.when || opts.when())) {
      // `load` settles every failure into `error`, so it never rejects.
      untrack(() => void load(false))
      if (opts.interval && live) stop = startPolling(opts.interval)
    }
    return () => stop?.()
  })

  return {
    get data() {
      return data
    },
    get error() {
      return error
    },
    get loading() {
      return loading
    },
    get busy() {
      return busy
    },
    get updatedAt() {
      return updatedAt
    },
    get live() {
      return live
    },
    set live(v: boolean) {
      live = v
    },
    refresh,
    set(next: T) {
      lastKey = null
      lastVersion = undefined
      data = next
    },
  }
}
