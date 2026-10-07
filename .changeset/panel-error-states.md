---
'vite-devtools-svelte': patch
---

Panels no longer mistake a failed load for "nothing recorded": Problems, Render, Load functions, Frame rate, Build, API and Compiled output now show the error. The selected problem or load call stays selected when new entries arrive or old ones are dropped, a kind filter (Modules, Assets) stays visible after its last item goes away, two app tabs reporting a frame drop in the same millisecond no longer break the Frame rate chart, and a Reactivity graph filtered to nothing says no signal matches.
