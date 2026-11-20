# vite-devtools-svelte

Svelte DevTools for Vite. Inspect components, reactivity, renders, routes, `load` functions and more in Svelte 5 and SvelteKit apps. It runs standalone at `/.svelte-devtools/` on your dev server, or inside the [Vite DevTools](https://devtools.vite.dev/) dock.

> **Status:** Early development. APIs may change. Full documentation will move to [svelte.dev](https://svelte.dev/).

![Overview](https://raw.githubusercontent.com/sveltejs/vite-devtools-svelte/main/docs/images/ui-overview.png)

## Requirements

- Vite >= 8.3.5
- Svelte >= 5.46.4 (runes mode)
- SvelteKit >= 3.3.0 (optional; without it the Routes, Remote functions, Load functions, API and Build panels are hidden)
- [`@vitejs/devtools`](https://devtools.vite.dev/) >= 0.8.0 (optional, but recommended)

## Setup

```bash
npm install -D @sveltejs/vite-devtools-svelte @vitejs/devtools
```

Turn on Vite DevTools and add the plugin before `sveltekit()`:

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteDevtools } from '@sveltejs/vite-devtools-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  devtools: { apply: 'serve' },
  plugins: [svelteDevtools(), sveltekit()],
});
```

Run `npm run dev`, open your app, click the floating Vite DevTools handle and open **Svelte tools**. The first time, the browser asks for a one-time code that the dev server prints in the terminal.

Without `@vitejs/devtools`, the same panels run standalone at the `/.svelte-devtools/` URL the dev server prints. The plugin is development-only and adds nothing to `vite build`.

## AI agents (MCP)

The plugin serves an MCP endpoint, so AI agents can read the same data as the panels and measure before and after a change:

```bash
claude mcp add svelte-devtools -- npx @sveltejs/vite-devtools-svelte mcp
```

When the dev server runs in a container, on another machine, or in Vite middleware mode, pass its URL and token with the `VITE_DEVTOOLS_SVELTE_URL` and `VITE_DEVTOOLS_SVELTE_TOKEN` environment variables. The token is the `token` in `~/.cache/vite-devtools-svelte/servers/`, or `api.getDevtoolsToken()` on the plugin named `vite-devtools-svelte`. It changes on every dev-server start, so register again after a restart.

Agent skills for performance audits ship in `node_modules/@sveltejs/vite-devtools-svelte/skills/`. Copy them to `.claude/skills/` to use them.

## License

[MIT](https://github.com/sveltejs/vite-devtools-svelte/blob/main/LICENSE) © Yuichiro Yamashita
