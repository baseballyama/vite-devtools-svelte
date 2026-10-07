---
'vite-devtools-svelte': patch
---

Static analysis reads code with a parser instead of regular expressions. Jump-to-declaration no longer lands on a `let` in a comment or string, finds destructured bindings, later declarators and `$state` class fields (`Counter.count`), and opens the N-th `$effect` for `effect_N`. The component graph ignores commented-out, string and markup look-alike imports and type-only imports, and now includes re-exports, side-effect imports and literal `import()`s. The OG preview ignores `<meta>` / `<title>` inside comments, scripts and SVG, takes the charset only from a `charset` / `http-equiv` meta tag, and no longer turns `&constructor;` into source text.
