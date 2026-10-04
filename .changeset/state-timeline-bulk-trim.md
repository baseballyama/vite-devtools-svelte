---
'vite-devtools-svelte': patch
---

Trim the state timeline ring in bulk instead of once per recorded change. With the DevTools open, an input that writes thousands of `$state` values no longer runs one `splice` per change; the ring is applied before every read (each push, the full snapshot, `getStateTimeline()` and `clearStateTimeline()`) and when more than 1000 entries or 4 MB are held. Reads still return the newest 500 entries within 4 MB, and unsent entries removed by the ring are still reported as dropped, now also when the timeline is cleared.
