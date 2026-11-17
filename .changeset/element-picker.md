---
'@sveltejs/vite-devtools-svelte': minor
---

Pick an element in the app to find its component instance: the plugin adds the Svelte Inspector to the app page (in place of vite-plugin-svelte's built-in one, whose `inspector` options still apply). Turn it on with Alt+X in the app or with **Pick element** in the Components panel; hovering shows the component instance and the element's location, a click selects that instance in the Components panel (also from another tab, or by opening the Svelte panel of the Vite DevTools dock), and Alt+click opens the element in your editor. The new `inspector` option sets the inspector's options, or `false` leaves it out. Requires a Svelte build that records the component on each element in development (`__svelte_meta.component`).
