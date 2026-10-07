---
'vite-devtools-svelte': patch
---

Frame rate panel no longer lowers the frame rate it measures. In the Vite DevTools dock the panel shares the app's main thread, and the "Live" indicator's never-ending box-shadow pulse forced a style recalculation and repaint every frame (about 8 fps instead of 60 on slower machines). The indicator is now static, and the loading animations run on the compositor (transform / opacity only).
