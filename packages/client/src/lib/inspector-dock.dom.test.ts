import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectorPicker, showTerminals } from './inspector-dock.js';

const KEY = '__DEVFRAME_HUB_CLIENT_CONTEXT__';

describe('inspectorPicker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>)[KEY];
  });

  it('is null under a cross-origin parent, whose properties throw', () => {
    const parent = new Proxy(
      {},
      {
        get() {
          throw new DOMException('Blocked a frame', 'SecurityError');
        },
      },
    );
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as Window);
    expect(inspectorPicker()).toBeNull();
  });

  it('is null outside the Vite DevTools hub', () => {
    expect(inspectorPicker()).toBeNull();
  });

  it('is null in the standalone UI', () => {
    (window as unknown as Record<string, unknown>)[KEY] = {
      clientType: 'standalone',
      docks: { entries: [{ id: 'svelte:inspector' }], setActionActive: vi.fn() },
    };
    expect(inspectorPicker()).toBeNull();
  });

  it('is null when the dock has no inspector', () => {
    (window as unknown as Record<string, unknown>)[KEY] = {
      clientType: 'embedded',
      docks: { entries: [{ id: 'other' }], setActionActive: vi.fn() },
    };
    expect(inspectorPicker()).toBeNull();
  });

  it('sets the dock action on', async () => {
    const setActionActive = vi.fn(() => Promise.resolve(true));
    (window as unknown as Record<string, unknown>)[KEY] = {
      clientType: 'embedded',
      docks: { entries: [{ id: 'svelte:inspector' }], setActionActive },
    };
    await inspectorPicker()?.();
    expect(setActionActive).toHaveBeenCalledExactlyOnceWith('svelte:inspector', true);
  });
});

describe('showTerminals', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[KEY];
  });

  it('switches the dock to its Terminals like a click', async () => {
    const switchEntry = vi.fn(() => Promise.resolve(true));
    (window as unknown as Record<string, unknown>)[KEY] = {
      clientType: 'embedded',
      docks: { entries: [{ id: 'devframes_plugin_terminals' }], switchEntry },
    };
    await showTerminals();
    expect(switchEntry).toHaveBeenCalledExactlyOnceWith('devframes_plugin_terminals');
  });

  it('does nothing without a Terminals dock', async () => {
    const switchEntry = vi.fn();
    (window as unknown as Record<string, unknown>)[KEY] = {
      clientType: 'embedded',
      docks: { entries: [], switchEntry },
    };
    await showTerminals();
    expect(switchEntry).not.toHaveBeenCalled();
  });
});
