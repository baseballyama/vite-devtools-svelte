---
"vite-devtools-svelte": patch
---

Fix the Inspect panel leaking its gutter-height polling interval: `onMount` was async, so the returned cleanup was wrapped in a Promise and never ran on unmount. The mount callback is now synchronous and the interval is cleared when the panel is closed.
