/**
 * Capture-limit metadata: the server keeps bounded buffers (collector
 * `LIMITS`), so a huge app may be shown partially.
 * - Live components: `getLiveComponentsMeta()` (arch, parents-first capture),
 *   read together with the list in Components.svelte (it also carries the epoch).
 * - Other datasets: generic `getCaptureInfo()` as proposed in
 *   docs/ui-status.md U-A3 — not implemented server-side yet, so those
 *   notices stay hidden. Everything is feature-detected.
 */
import * as rpc from './rpc.js'
import { resource } from './resource.svelte.js'

export type CaptureKey =
  | 'liveComponents'
  | 'renderProfiles'
  | 'stateTimeline'
  | 'reactiveNodes'
  | 'reactiveEdges'
  | 'fpsSamples'
  | 'runtimeErrors'
  | 'loadProfiles'
  | 'compilerWarnings'

export interface CaptureInfo {
  /** Items held by the server (what the RPC returns). */
  captured: number
  /** Items the app reported before the cap (>= captured). */
  total: number
  truncated: boolean
  /** How the subset was chosen, e.g. 'tail' (newest) or 'roots-first'. */
  policy?: string
}

type CaptureMap = Partial<Record<CaptureKey, CaptureInfo>>

const api = rpc as unknown as {
  getCaptureInfo?: () => Promise<CaptureMap>
}

export const captureSupported = typeof api.getCaptureInfo === 'function'

/** Poll capture metadata alongside a panel's own resource. */
export function captureInfo(interval?: number, when?: () => boolean) {
  return resource<CaptureMap>(async () => (captureSupported ? await api.getCaptureInfo!() : {}), {
    initial: {},
    interval: captureSupported ? interval : undefined,
    when,
  })
}
