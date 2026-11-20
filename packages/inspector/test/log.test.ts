import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../src/log.js';

// A `DEBUG` set in the shell would otherwise enable the output under test.
beforeEach(() => {
  vi.stubEnv('DEBUG', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('log', () => {
  it('prefixes warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('careful');
    log.warn('with payload', { id: 1 });
    expect(warn).toHaveBeenNthCalledWith(1, '[vite-devtools-svelte:inspector] careful');
    expect(warn).toHaveBeenNthCalledWith(2, '[vite-devtools-svelte:inspector] with payload', {
      id: 1,
    });
  });

  it('writes debug output to stderr only when DEBUG enables it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.debug('hidden');
    expect(error).not.toHaveBeenCalled();

    vi.stubEnv('DEBUG', 'vite:*,vite-devtools-svelte:*');
    log.debug('with payload', { a: 1 });
    log.debug('without payload');
    expect(error).toHaveBeenNthCalledWith(1, '[vite-devtools-svelte:inspector] with payload', {
      a: 1,
    });
    expect(error).toHaveBeenNthCalledWith(2, '[vite-devtools-svelte:inspector] without payload');
  });

  it.each([
    ['*', true],
    ['vite-devtools-svelte:inspector', true],
    ['vite-devtools-svelte*', true],
    ['vite:* vite-devtools-svelte:*', true],
    ['vite:*\tvite-devtools-svelte:inspector', true],
    ['vite:*\n  vite-devtools-svelte:inspector', true],
    ['*:inspector', true],
    ['vite-*-svelte:*', true],
    ['vite-devtools-svelte', false],
    ['vite:*', false],
    ['vite-*-svelte:x*', false],
    ['*,-vite-devtools-svelte:*', false],
    ['-vite-devtools-svelte:inspector,vite-devtools-svelte:*', false],
  ])('reads DEBUG=%j as the debug package does', (value, enabled) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('DEBUG', value);
    log.debug('message');
    expect(error.mock.calls).toHaveLength(Number(enabled));
  });
});
