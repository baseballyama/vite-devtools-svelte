import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectorPicker } from './inspector-dock.js';

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
