import { afterEach, describe, expect, it, vi } from 'vitest';

/** Fresh module (its state is module-level) over a fake RPC layer. */
async function load(rpc: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('./rpc.js', () => rpc);
  const mod = await import('./connection.svelte.js');
  // Same Svelte runtime as the fresh module.
  const { track } = await import('../test/runes.svelte.js');
  return { ...mod, track };
}

afterEach(() => {
  vi.doUnmock('./rpc.js');
});

/** A fake RPC layer with the connection-state API; `emit` pushes a state. */
function fakeRpc() {
  let listener: ((s: unknown) => void) | undefined;
  return {
    emit: (s: unknown) => listener!(s),
    rpc: {
      getConnectionState: () => ({ status: 'connecting', host: 'unknown' }),
      onConnectionState: vi.fn((cb: (s: unknown) => void) => {
        listener = cb;
        return () => {};
      }),
    },
  };
}

describe('connection', () => {
  it('starts from the current state and follows updates reactively', async () => {
    const f = fakeRpc();
    const { connection, track } = await load(f.rpc);
    expect(f.rpc.onConnectionState).toHaveBeenCalledTimes(1);
    const t = track(() => connection.state.status);
    f.emit({ status: 'unauthorized', host: 'standalone' });
    t.flush();
    f.emit({ status: 'connected', host: 'standalone' });
    t.flush();
    t.stop();
    expect(t.seen).toEqual(['connecting', 'unauthorized', 'connected']);
    expect(connection.state.host).toBe('standalone');
  });
});
