// client script of the `svelte:inspector-settings` dock view
import { mount, unmount } from 'svelte';
import options from 'virtual:vite-devtools-svelte-inspector-options';
import SettingsView from 'virtual:vite-devtools-svelte-inspector-path:SettingsView.svelte';

import { RESET_SETTINGS, SAVE_SETTINGS } from './settings-shared.js';
import type { ActionResult } from './settings-shared.js';

/** the parts of `DockClientScriptContext` used here */
interface DockContext {
  current: {
    events: { on(event: 'dom:panel:mounted', listener: (panel: HTMLElement) => void): void };
    domElements?: { panel?: HTMLElement };
  };
  rpc: { call(name: string, ...args: unknown[]): Promise<unknown> };
}

/** the colour scheme root of the dock, its class is `light` or `dark` */
function dockThemeRoot() {
  const host = document.querySelector('devframes-dock-embedded');
  return host?.shadowRoot?.querySelector('.devframes-color-root') ?? null;
}

export default function setup(ctx: DockContext): void {
  let view: Record<string, unknown> | null = null;
  let observer: MutationObserver | null = null;

  const call = async (name: string, ...args: unknown[]) =>
    (await ctx.rpc.call(name, ...args)) as ActionResult;

  const render = (panel: HTMLElement) => {
    if (view) void unmount(view);
    observer?.disconnect();

    const target = document.createElement('div');
    target.style.height = '100%';
    panel.replaceChildren(target);

    // the light or dark setting of the dock, not only the os one
    const themeRoot = dockThemeRoot();
    const sync = () => {
      const dark = themeRoot
        ? themeRoot.classList.contains('dark')
        : matchMedia('(prefers-color-scheme: dark)').matches;
      const root = target.firstElementChild;
      if (root instanceof HTMLElement) root.dataset.theme = dark ? 'dark' : 'light';
    };
    if (themeRoot) {
      observer = new MutationObserver(sync);
      observer.observe(themeRoot, { attributes: true, attributeFilter: ['class'] });
    }

    const { __internal, ...current } = options;
    view = mount(SettingsView, {
      target,
      props: {
        current,
        defaults: __internal.defaults ?? current,
        save: (settings: unknown) => call(SAVE_SETTINGS, settings),
        reset: () => call(RESET_SETTINGS),
      },
    });
    sync();
  };

  // the dock may create the panel before this script loads
  ctx.current.events.on('dom:panel:mounted', render);
  const existing = ctx.current.domElements?.panel;
  if (existing) render(existing);
}
