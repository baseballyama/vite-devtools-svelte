import { disable, enable } from 'obug';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../src/utils/log.js';

// A `DEBUG` set in the shell would otherwise enable the namespaces under test.
beforeEach(() => {
  disable();
});

afterEach(() => {
  disable();
  vi.restoreAllMocks();
});

describe('log', () => {
  it('prefixes warnings, with the namespace when given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('careful', null, 'inspector');
    log.warn('with payload', { id: 1 });
    expect(warn).toHaveBeenNthCalledWith(1, '[vite-devtools-svelte:inspector] careful');
    expect(warn).toHaveBeenNthCalledWith(2, '[vite-devtools-svelte] with payload', { id: 1 });
  });

  it('writes debug output only for enabled namespaces', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    log.debug('hidden', null, 'inspector');
    expect(write).not.toHaveBeenCalled();

    enable('vite-devtools-svelte,vite-devtools-svelte:*');
    log.debug('with payload', { a: 1 }, 'inspector');
    log.debug('without namespace');
    const output = write.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('vite-devtools-svelte:inspector');
    expect(output).toContain('with payload');
    expect(output).toContain('without namespace');
  });
});
