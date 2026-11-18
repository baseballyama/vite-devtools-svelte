import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { run } from '../src/cli/index.js';
import { createRelay } from '../src/mcp/relay.js';

const connect = vi.fn();
vi.mock('../src/mcp/relay.js', () => ({
  createRelay: vi.fn(() => Promise.resolve({ connect })),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('cli', () => {
  it('serves MCP over stdio for `mcp`', async () => {
    vi.stubEnv('VITE_DEVTOOLS_SVELTE_REGISTRY', '/registry');
    expect(await run(['mcp'])).toBeNull();
    expect(createRelay).toHaveBeenCalledWith({
      cwd: process.cwd(),
      env: process.env,
      registry: '/registry',
      version: pkg.version,
      outdatedLocal: undefined,
    });
    await run(['mcp'], { outdatedLocal: '0.8.0' });
    expect(createRelay).toHaveBeenLastCalledWith(
      expect.objectContaining({ outdatedLocal: '0.8.0' }),
    );
    expect(connect.mock.calls[0]![0]).toBeInstanceOf(StdioServerTransport);
  });

  it.each([[[]], [['--help']], [['-h']]])('prints usage for %j', async argv => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(await run(argv)).toBe(0);
    expect(String(out.mock.calls[0]![0])).toContain('Usage: vite-devtools-svelte mcp');
  });

  it('fails on an unknown command', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await run(['nope'])).toBe(1);
    expect(String(err.mock.calls[0]![0])).toContain('Usage:');
  });
});
