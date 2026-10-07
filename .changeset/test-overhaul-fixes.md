---
'vite-devtools-svelte': patch
---

Fixes found by the new test suite:

- Routes: layout resets (`+page@.svelte`, `+page@(group).svelte`, `+layout@….svelte`) are listed instead of disappearing; parameter matchers (`[id=integer]`), partial segments (`foo-[id]`, `[a]-[b]`) and escapes (`[x+2e]`) are parsed correctly.
- API endpoints: methods are read from the module's exports (`export { handler as GET }`, `HEAD`, `OPTIONS`, `fallback`) instead of substrings, so `export const GETTER` or comments no longer count; requests and Social preview fetches time out after 30 s.
- Social preview: quoted values with apostrophes, `data-*` attributes, entities, declared charsets, relative `og:image` and first-tag-wins are handled.
- Build analysis no longer counts `build/client` twice; dangling symlinks no longer break asset/build scans; a `package.json` mid-edit no longer breaks every panel.
- Module graph marks every module in a cycle; MCP `end_session` with `keep: 'discard'` works; p95 uses nearest rank; omitted `effectMaxDeps` keeps the default.
- MCP endpoint: constant-time token check, and a 500 instead of a hanging request when the server cannot be built.
- Component tracking: components whose markup contains `$.push(` and file ids with `$&`-style sequences are tracked; load profiling no longer breaks `load` for non-serializable results; coloured compiler warnings keep their location; the dock tag is not injected into a `</body>` inside a comment or script.
- Reactivity graph build is no longer quadratic in the number of proxy sources.
- UI: Svelte highlighting with `>` inside tag expressions and multi-line comments/template literals, highlight offsets for characters like `İ`, component boxes for same-named files in different folders, byte sizes above MB, NaN/Infinity values, polled panels after a missing dataset counter, and stale responses after Clear.
