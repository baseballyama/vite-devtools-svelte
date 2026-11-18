import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import setup from '../../src/runtime/devtools-action.js';

type Listener = () => void;

/**
 * A stand-in for the devframe dock client script context. Like `@devframes/hub-ui`, turning a
 * toggle action on awaits its client script first, while turning it off is synchronous.
 */
function createDock(clientType: 'embedded' | 'standalone' = 'embedded') {
  const listeners = {
    'entry:activated': new Set<Listener>(),
    'entry:deactivated': new Set<Listener>(),
  };
  let active = false;
  const emit = (event: keyof typeof listeners) => {
    for (const listener of listeners[event]) listener();
  };
  const unregister = vi.fn();
  const ctx = {
    clientType,
    current: {
      entryMeta: { id: 'svelte:inspector' },
      get isActive() {
        return active;
      },
      events: {
        on(event: keyof typeof listeners, listener: Listener) {
          listeners[event].add(listener);
          return () => listeners[event].delete(listener);
        },
      },
    },
    docks: {
      async setActionActive(_id: string, on: boolean) {
        if (active === on) return false;
        if (on) {
          await Promise.resolve();
          active = true;
          emit('entry:activated');
        } else {
          active = false;
          emit('entry:deactivated');
        }
        return true;
      },
      toggleEntry(id: string) {
        return ctx.docks.setActionActive(id, !active);
      },
    },
    rpc: { call: vi.fn<(name: string, ...args: unknown[]) => Promise<unknown>>(async () => {}) },
    commands: { register: vi.fn(() => unregister) },
  };
  return { ctx, unregister };
}

/** Lets the dock's activation, and the inspector's deferred `enable()`, run. */
const settle = () =>
  new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });

const enabled = () => document.body.classList.contains('svelte-inspector-enabled');

/** An element rendered by a component, as Svelte marks it in dev mode */
function component(file = 'src/A.svelte') {
  const el = document.createElement('div');
  Object.assign(el, { __svelte_meta: { loc: { file, line: 3, column: 4 } } });
  document.body.append(el);
  return el;
}

/** The dock's own ui, rendered in the page like `<devframes-dock-embedded>` */
function dockUi() {
  const host = document.createElement('devframes-dock-embedded');
  const button = document.createElement('button');
  host.attachShadow({ mode: 'open' }).append(button);
  document.body.append(host);
  return button;
}

const docks: ReturnType<typeof createDock>[] = [];
const fetch = vi.fn(() => Promise.resolve(new Response()));

beforeEach(() => {
  vi.stubGlobal('fetch', fetch);
});

afterEach(async () => {
  for (const { ctx } of docks.splice(0)) await ctx.docks.setActionActive('svelte:inspector', false);
  document.querySelectorAll('#svelte-inspector-host').forEach(el => el.remove());
  document.body.replaceChildren();
  fetch.mockClear();
  vi.unstubAllGlobals();
});

function start(clientType?: 'embedded' | 'standalone') {
  const dock = createDock(clientType);
  docks.push(dock);
  setup(dock.ctx);
  return dock;
}

/** A pointer move to (`at`, `at`); happy-dom leaves out `x` / `y`, which the inspector reads */
function move(at: number) {
  const e = new MouseEvent('mousemove', {
    bubbles: true,
    composed: true,
    clientX: at,
    clientY: at,
  });
  return Object.defineProperties(e, { x: { value: at }, y: { value: at } });
}

async function pick(el: Element) {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle();
}

describe('the dock action', () => {
  it('turns the inspector on and off with the dock button', async () => {
    const { ctx } = start();
    await ctx.docks.toggleEntry('svelte:inspector');
    await settle();
    expect(enabled()).toBe(true);
    await ctx.docks.toggleEntry('svelte:inspector');
    await settle();
    expect(enabled()).toBe(false);
  });

  it('stays off when the dock turns it off before the deferred enable runs', async () => {
    const { ctx } = start();
    await ctx.docks.setActionActive('svelte:inspector', true);
    await ctx.docks.setActionActive('svelte:inspector', false);
    await settle();
    expect(enabled()).toBe(false);
  });

  it('opens the picked file through Vite DevTools, by its absolute path', async () => {
    const { ctx } = start();
    await ctx.docks.setActionActive('svelte:inspector', true);
    await settle();
    await pick(component());
    expect(ctx.rpc.call).toHaveBeenCalledWith(
      'vite:core:open-in-editor',
      '/project/src/A.svelte:3:5',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to Vite's own endpoint when Vite DevTools refuses the path", async () => {
    const { ctx } = start();
    // e.g. DTK0028 for a linked package outside the workspace root
    ctx.rpc.call.mockRejectedValueOnce(new Error('Path is outside the workspace root'));
    await ctx.docks.setActionActive('svelte:inspector', true);
    await settle();
    // Svelte keeps the absolute path of a file outside its rootDir
    await pick(component('/linked/B.svelte'));
    expect(fetch).toHaveBeenCalledWith(
      `/app/__open-in-editor?file=${encodeURIComponent('/linked/B.svelte:3:5')}`,
    );
  });

  it("leaves events from the dock's own ui to the dock", async () => {
    const { ctx } = start();
    await ctx.docks.setActionActive('svelte:inspector', true);
    await settle();
    const el = component();
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(move(10));
    flushSync();
    // `top` follows the pointer here (happy-dom lays nothing out, so `left` is pinned)
    const overlay = document.querySelector<HTMLElement>('#svelte-inspector-overlay')!;
    const top = overlay.style.top;

    const button = dockUi();
    button.dispatchEvent(move(400));
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
    flushSync();
    expect(overlay.style.top).toBe(top);
    expect(el.classList.contains('svelte-inspector-active-target')).toBe(true);
  });

  it('mounts once when the hub runs the script again, on the latest context', async () => {
    const first = start();
    const second = start();
    expect(document.querySelectorAll('#svelte-inspector-host')).toHaveLength(1);
    expect(first.unregister).toHaveBeenCalledOnce();

    await second.ctx.docks.setActionActive('svelte:inspector', true);
    await settle();
    await pick(component());
    expect(first.ctx.rpc.call).not.toHaveBeenCalled();
    expect(second.ctx.rpc.call).toHaveBeenCalledOnce();
  });

  it('does nothing in the standalone DevTools page', () => {
    const { ctx } = start('standalone');
    expect(document.querySelector('#svelte-inspector-host')).toBeNull();
    expect(ctx.commands.register).not.toHaveBeenCalled();
  });
});
