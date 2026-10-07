import { resource } from './resource.svelte.js'
/**
 * Capture-limit metadata: the server keeps bounded buffers (collector
 * `LIMITS`), so a huge app may be shown partially.
 * - Live components: `getLiveComponentsMeta()` (arch, parents-first capture),
 *   read together with the list in Components.svelte (it also carries the epoch).
 * - Other datasets: `getCaptureInfo()` (docs/devframe-migration.md §6.7 B).
 *   Feature-detected: against an older server the notices stay hidden.
 */
import * as rpc from './rpc.js'
import type { CaptureInfoMap } from './types.js'

// Shapes are the server's (§6.7 B); `total: null` means unknown.
export type { CaptureInfo } from './types.js'
type CaptureMap = CaptureInfoMap

const api = rpc as unknown as {
  getCaptureInfo?: () => Promise<CaptureMap>
}

const captureSupported = typeof api.getCaptureInfo === 'function'

/** Poll capture metadata alongside a panel's own resource. */
export function captureInfo(interval?: number, when?: () => boolean) {
  return resource<CaptureMap>(
    () => (captureSupported ? api.getCaptureInfo!() : Promise.resolve({})),
    {
      initial: {},
      interval: captureSupported ? interval : undefined,
      when,
    },
  )
}
