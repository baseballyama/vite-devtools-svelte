// A custom Node server that runs Vite in middleware mode: Vite has no
// httpServer of its own, so the DevTools use their SSE transport, and the
// HMR WebSocket shares this server. Every request for a page is rendered
// with `svelte/server` and hydrated in the browser.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { createServer } from 'vite';

const root = import.meta.dirname;
const port = Number(process.env.PORT ?? 5205);

const httpServer = http.createServer();
const vite = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: httpServer } },
});

httpServer.on('request', (req, res) => {
  vite.middlewares(req, res, async () => {
    const url = req.url ?? '/';
    if (req.method !== 'GET' || !(req.headers.accept ?? '').includes('text/html')) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    try {
      const template = await vite.transformIndexHtml(
        url,
        fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
      );
      const { render } = await vite.ssrLoadModule('/src/entry-server.ts');
      const { head, body, props } = await render(url);
      const html = template
        // Function replacers: `$&` etc. in the rendered output (e.g. from the
        // URL) must not be read as replacement patterns.
        .replace('<!--ssr-head-->', () => head)
        .replace('<!--ssr-body-->', () => body)
        // `<` escaped so a value can never close the script tag.
        .replace('/*ssr-props*/ null', () => JSON.stringify(props).replaceAll('<', '\\u003c'));
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html);
    } catch (error) {
      vite.ssrFixStacktrace(/** @type {Error} */ (error));
      console.error(error);
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(String(/** @type {Error} */ (error).stack ?? error));
    }
  });
});

// (console.warn: the repo's lint allows only warn/error.)
// In middleware mode Vite has no httpServer, so the plugin cannot print its
// `claude mcp add` line on `listening`: print it here from the plugin's API.
const devtools = vite.config.plugins.find(p => p.name === 'vite-devtools-svelte');
const mcpToken = devtools?.api?.getDevtoolsToken?.();

// localhost only, like `vite dev` (the runner turns the one-time code off).
httpServer.listen(port, 'localhost', () => {
  console.warn(`  svelte-middleware: http://localhost:${port}/`);
  console.warn(`  Svelte DevTools:   http://localhost:${port}/.svelte-devtools/`);
  if (mcpToken) {
    console.warn(
      `  MCP: claude mcp add --transport http svelte http://localhost:${port}/__svelte-devtools/mcp --header x-svelte-devtools-token:${mcpToken}`,
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void vite.close().finally(() => {
      httpServer.close();
      process.exit(0);
    });
  });
}
