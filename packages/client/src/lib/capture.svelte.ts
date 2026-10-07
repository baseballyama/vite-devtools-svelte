/**
 * Capture-limit metadata: the server keeps bounded buffers (collector
 * `LIMITS`), so a huge app may be shown partially.
 * - Live components: `getLiveComponentsMeta()` (arch, parents-first capture),
 *   read together with the list in Components.svelte (it also carries the epoch).
 * - Other datasets: `getCaptureInfo()` (docs/devframe-migration.md §6.7 B).
 */
import { resource } from './resource.svelte.js'
import { getCaptureInfo } from './rpc.js'
import type { CaptureInfoMap } from './types.js'

export type { CaptureInfo } from './types.js'

/** Poll capture metadata alongside a panel's own resource. */
export function captureInfo(interval?: number, when?: () => boolean) {
  return resource<CaptureInfoMap>(getCaptureInfo, { initial: {}, interval, when })
}
