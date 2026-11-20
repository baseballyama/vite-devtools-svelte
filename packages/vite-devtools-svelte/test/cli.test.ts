import { afterEach, describe, expect, it, vi } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { run } from '../src/cli/index.js';
import { createRelay } from '../src/mcp/relay.js';
import { serveStdio } from '../src/mcp/stdio.js';

const relay = { handle: vi.fn() };
vi.mock('../src/mcp/relay.js', () => ({ createRelay: vi.fn(() => relay) }));
vi.mock('../src/mcp/stdio.js', () => ({ serveStdio: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('cli', () => {
  it('serves MCP over stdio for `mcp`', () => {
    vi.stubEnv('VITE_DEVTOOLS_SVELTE_REGISTRY', '/registry');
    expect(run(['mcp'])).toBeNull();
    expect(createRelay).toHaveBeenCalledWith({
      cwd: process.cwd(),
      env: process.env,
      registry: '/registry',
      version: pkg.version,
      outdatedLocalVersion: undefined,
    });
    run(['mcp'], { outdatedLocalVersion: '0.8.0' });
    expect(createRelay).toHaveBeenLastCalledWith(
      expect.objectContaining({ outdatedLocalVersion: '0.8.0' }),
    );
    expect(serveStdio).toHaveBeenCalledWith(relay, process.stdin, process.stdout);
  });

  it.each([[[]], [['--help']], [['-h']]])('prints usage for %j', argv => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(run(argv)).toBe(0);
    expect(String(out.mock.calls[0]![0])).toContain('Usage: vite-devtools-svelte mcp');
  });

  it('fails on an unknown command', () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(run(['nope'])).toBe(1);
    expect(String(err.mock.calls[0]![0])).toContain('Usage:');
  });
});
