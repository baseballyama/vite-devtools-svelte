# kit-ssg: every page prerendered (adapter-static)

A static site with `prerender = true` / `trailingSlash = 'always'` at the root. In dev the server loads run on every request; `vite build` writes every page and `+server.ts` to `build/`.

```bash
pnpm examples kit-ssg               # http://localhost:5210/
pnpm -C examples/kit-ssg build      # every page, feed.json and sitemap.xml in build/
```

| Route                        | Features used                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `/`                          | Root `+layout.server.ts` (server load) + `+page.ts` (universal load, `parent()`)               |
| `/blog/`                     | `+page.server.ts`                                                                              |
| `/blog/[slug]/`              | Dynamic route listed by `entries()`, both a server and a universal load, remount with `{#key}` |
| `/no-js/`                    | `csr = false` (no JS → the devtools runtime does not run either)                               |
| `/client-only/`              | `ssr = false` (an empty shell when prerendered, rendered only in the browser)                  |
| `/feed.json`, `/sitemap.xml` | Prerendered `+server.ts` (`trailingSlash = 'never'`)                                           |

## Checklist

- [ ] **Routes**: 7 routes (2 of them endpoints, `blog/[slug]` dynamic)
- [ ] **Load functions**: both server and universal loads are recorded on `/` and on `/blog/[slug]/`. The universal load of `/client-only/` runs in the browser and is recorded too
- [ ] **Components**: `/blog/[slug]/` shows `Likes`. Following the "Next" link below a post keeps the page and makes `Likes` a new instance through `{#key}`
- [ ] Opening `/no-js/` breaks neither the app nor the DevTools (no runtime, so Components is empty or keeps the previous page)
- [ ] **Social preview**: `/` shows with og:title / og:image. Routes with trailingSlash = 'always' (`/blog` and so on) redirect
- [ ] **API**: `GET /feed.json` and `GET /sitemap.xml` can be called
- [ ] **Assets**: `static/og.svg`
- [ ] `vite build` passes, and `build/` has no devtools code (`svelte-devtools` / `__devtools`)
