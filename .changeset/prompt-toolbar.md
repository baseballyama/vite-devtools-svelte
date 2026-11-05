---
'vite-devtools-svelte': minor
---

Add an opt-in prompt toolbar: pick elements in your own pages and copy a markdown prompt with their source location, component chain, props and `$state`.

Enable it with `svelteDevtools({ promptToolbar: true })`. The dev server then injects a draggable floating button into the app's HTML (dev only — it is served by a dev middleware and never reaches a build). Picking an element suppresses the click, so the app does not navigate or submit; the panel collects instructions and **Copy prompt** puts one document on the clipboard with the page, your request, and per selection: `file:line:column`, DOM path and markup, the Svelte template frames, the component instance chain with props and live `$state`/`$derived` values, and a numbered source window around the selected line.

Details worth knowing:

- Picked elements keep a numbered outline that follows the page as it scrolls or re-renders; clicking one again un-picks it.
- An element is identified by its tag, id and authored classes plus its location and markup; the text the app renders inside it is never copied, so the panel and the prompt stay about the element, not its content.
- Svelte records a source location only for the elements it needs for error attribution, so a static element deep in a markup block inherits its ancestor's location. The toolbar matches the element against its file (tag plus authored classes/attributes) and reports that line, with a note naming the match and the line Svelte recorded; the hover tooltip prefixes `~` for inherited locations.
- Values are bounded before they reach the clipboard, and large props/state are summarised (`{id, name}`, `[12 items]`) instead of dumping page `data` blobs.
- Frames from `node_modules` are filtered out, and when markup is rendered by one component but written in another (`{@render children()}`), the chain labels which one defines it.
- No global keyboard shortcut is registered (it would fight browser shortcuts); the button is dragged, and its position is remembered.
- While picking, the page's own cursors (pointer over links, text caret over inputs) are replaced by one picking cursor: a pick does not activate the element, so it should not promise that it will. The toolbar's own controls keep their cursors.
