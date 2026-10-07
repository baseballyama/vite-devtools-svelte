---
'vite-devtools-svelte': patch
---

Overview: "Mounted components" no longer stays at 0 when the DevTools open before the app has reported its components. The count now updates while the overview is open, and is fetched again only when the components changed.
