// The Vite DevTools hub publishes its client context on the app page under this key
// (`CLIENT_CONTEXT_KEY` of `@devframes/hub/client`); this UI is a same-origin iframe in it.
const CLIENT_CONTEXT_KEY = '__DEVFRAME_HUB_CLIENT_CONTEXT__';
// The dock action of packages/inspector, which mounts the inspector in the app page.
const INSPECTOR_DOCK_ID = 'svelte:inspector';
const TERMINALS_DOCK_ID = 'devframes_plugin_terminals';

interface HubContext {
  clientType: 'embedded' | 'standalone';
  docks: {
    entries: { id: string }[];
    setActionActive(id: string, active: boolean): Promise<boolean>;
    switchEntry(id: string | null): Promise<boolean>;
  };
}

function hubContext(): HubContext | undefined {
  try {
    return (window.parent as unknown as Record<string, HubContext | undefined>)[CLIENT_CONTEXT_KEY];
  } catch {
    // a cross-origin parent
    return undefined;
  }
}

/** Whether this UI is a dock of Vite DevTools, rather than the standalone page in any frame */
export function inDevtoolsDock(): boolean {
  return hubContext() !== undefined;
}

/**
 * Turns the Svelte Inspector on in the app page this UI is docked in, or null outside the
 * dock or without the inspector. Sets the dock action on (a no-op when it is on already),
 * so other app tabs are left alone and the dock button stays in sync.
 */
export function inspectorPicker(): (() => Promise<void>) | null {
  const ctx = hubContext();
  if (ctx?.clientType !== 'embedded') return null;
  if (!ctx.docks.entries.some(e => e.id === INSPECTOR_DOCK_ID)) return null;
  return async () => {
    await ctx.docks.setActionActive(INSPECTOR_DOCK_ID, true);
  };
}

/**
 * Shows the dock's Terminals, like a click on it. Not the server's `docks.activate`: the hub
 * then reloads the dock opened next on the Terminals URL, so the Add panel cannot come back.
 */
export async function showTerminals(): Promise<void> {
  const ctx = hubContext();
  if (!ctx?.docks.entries.some(e => e.id === TERMINALS_DOCK_ID)) return;
  await ctx.docks.switchEntry(TERMINALS_DOCK_ID);
}
