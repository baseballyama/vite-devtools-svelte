// Dev-server plumbing shared by the e2e and screenshot scripts. Masking and
// error policy stay in each script: their outputs differ on purpose.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms);
  });

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export function viteBin(appDir) {
  const req = createRequire(path.join(appDir, 'package.json'));
  return path.join(path.dirname(req.resolve('vite/package.json')), 'bin/vite.js');
}

export const registryDir = home => path.join(home, 'registry');

/** Child env with every per-user directory inside `home`, so nothing touches the real one. */
export function isolatedEnv(home, extra = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    VITE_DEVTOOLS_SVELTE_REGISTRY: registryDir(home),
    BROWSER: 'none',
    ...extra,
  };
}

/** The MCP token the dev server on `port` wrote to its registry file, once there. */
export function registeredToken(registry, port) {
  try {
    const name = fs.readdirSync(registry).find(n => n.endsWith(`-${port}.json`));
    return name ? JSON.parse(fs.readFileSync(path.join(registry, name), 'utf8')).token : null;
  } catch {
    return null;
  }
}

/** Stops a child spawned with `detached`: Vite's own children share its process group. */
export async function stopProcessGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const kill = sig => {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      /* already gone */
    }
  };
  kill('SIGTERM');
  for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++)
    await sleep(100);
  if (child.exitCode === null && child.signalCode === null) kill('SIGKILL');
}

let rpcId = 0;
/**
 * One JSON-RPC request to the plugin's MCP endpoint. `msg` is the raw
 * JSON-RPC message (from JSON or the SSE `data:` line), only on HTTP 200.
 */
export async function mcpPost(base, method, params, { token, ms = 15_000 } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
  };
  if (token) headers['x-svelte-devtools-token'] = token;
  const r = await fetch(`${base}/__svelte-devtools/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params ?? {} }),
    signal: AbortSignal.timeout(ms),
  });
  const text = await r.text();
  if (r.status !== 200) return { status: r.status };
  const raw = text.trim().startsWith('{')
    ? text
    : text
        .split('\n')
        .find(l => l.startsWith('data:'))
        ?.slice(5);
  return { status: 200, msg: JSON.parse(raw) };
}

// The dock auto-minimizes (buttons get pointer-events: none) unless a
// mousemove reached it within inactiveTimeout (3 s) or a panel is open. A move
// to the same coordinates fires no event, so move across it in steps.
export async function nudgeDock(page) {
  const box = await page.locator('#devframes-dock').boundingBox();
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 3, cy, { steps: 5 });
  await page.mouse.move(cx + 3, cy, { steps: 5 });
}
