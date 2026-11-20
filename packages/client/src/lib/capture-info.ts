// The server keeps bounded buffers (collector `LIMITS`), so a huge app may be
// shown partially. Live components use `getLiveComponentsMeta()` instead of
// this poll, read together with the list in Components.svelte (it also
// carries the epoch).
import { resource } from './resource.svelte.js';
import { getCaptureInfo } from './rpc.js';
import type { CaptureInfoMap } from './types.js';

export function captureInfo(interval?: number, when?: () => boolean) {
  return resource<CaptureInfoMap>(getCaptureInfo, { initial: {}, interval, when });
}
