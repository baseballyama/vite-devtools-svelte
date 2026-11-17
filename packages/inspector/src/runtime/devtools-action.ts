// Client script of the `svelte:inspector` dock action
import { mount } from 'svelte';
import options from 'virtual:vite-devtools-svelte-inspector-options';
import Inspector from 'virtual:vite-devtools-svelte-inspector-path:Inspector.svelte';

interface Loc {
  file: string;
  line: number;
  column: number;
}

/** The parts of the devframe dock client script context (`DockClientScriptContext`) used here */
interface DockContext {
  current: {
    entryMeta: { id: string };
    isActive: boolean;
    events: { on(event: 'entry:activated' | 'entry:deactivated', listener: () => void): void };
  };
  docks?: DockActions;
  rpc: { call(name: string, ...args: unknown[]): Promise<unknown> };
  commands?: { register(command: Record<string, unknown>): void };
}

interface DockActions {
  setActionActive(id: string, active: boolean): void;
  toggleEntry(id: string): void;
}

/** `file` resolved against the vite root (Vite DevTools opens paths inside its workspace) */
function absolute(file: string): string {
  const root = options.__internal.root;
  if (!root || file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file)) return file;
  return `${root.replace(/[\\/]$/, '')}/${file}`;
}

export default function setup(ctx: DockContext): void {
  const id = ctx.current.entryMeta.id;
  const docks = ctx.docks ?? (ctx as unknown as DockActions);

  const target = document.createElement('div');
  target.setAttribute('id', 'svelte-inspector-host');
  document.documentElement.append(target);

  const host = {
    openInEditor(loc: Loc) {
      ctx.rpc
        .call('vite:core:open-in-editor', `${absolute(loc.file)}:${loc.line}:${loc.column + 1}`)
        .catch((error: unknown) => {
          // shown in the page console, like vite client errors
          console.error('[svelte-inspector] failed to open editor', error);
        });
    },
    ignore(e: Event) {
      // the dock is rendered in the page
      return e
        .composedPath()
        .some(node => node instanceof Element && node.tagName.startsWith('DEVFRAMES-'));
    },
    onenabledchange(enabled: boolean) {
      // sync the dock button when the inspector toggles itself
      if (ctx.current.isActive !== enabled) docks.setActionActive(id, enabled);
    },
  };
  const inspector = mount(Inspector, { target, props: { host } }) as unknown as {
    enable(): void;
    disable(): void;
  };

  // client-side so it toggles this tab only; no keybinding of its own, toggleKeyCombo already is one
  ctx.commands?.register({
    id: 'svelte:toggle-inspector',
    source: 'client',
    title: 'Toggle Svelte Inspector',
    icon: 'logos:svelte-icon',
    category: 'svelte',
    action: () => docks.toggleEntry(id),
  });

  // deferred, or the activating click reaches the inspector's window click handler and disables it
  ctx.current.events.on('entry:activated', () => {
    setTimeout(() => inspector.enable());
  });
  ctx.current.events.on('entry:deactivated', () => inspector.disable());
}
