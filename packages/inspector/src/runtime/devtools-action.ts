// Client script of the `svelte:inspector` dock action
import { mount } from 'svelte';
import options from 'virtual:vite-devtools-svelte-inspector-options';
import Inspector from 'virtual:vite-devtools-svelte-inspector-path:Inspector.svelte';

// devtools leave this component, what it renders and its state out of their panels
(Inspector as unknown as Record<symbol, boolean>)[Symbol.for('svelte.devtools.ignore')] = true;

interface Loc {
  file: string;
  line: number;
  column: number;
}

/** The parts of the devframe dock client script context (`DockClientScriptContext`) used here */
interface DockContext {
  /** 'standalone' is the DevTools page of its own, with no app to inspect */
  clientType: 'embedded' | 'standalone';
  current: {
    entryMeta: { id: string };
    isActive: boolean;
    events: { on(event: 'entry:activated' | 'entry:deactivated', listener: () => void): void };
  };
  docks: {
    setActionActive(id: string, active: boolean): Promise<boolean>;
    toggleEntry(id: string): Promise<boolean>;
  };
  rpc: { call(name: string, ...args: unknown[]): Promise<unknown> };
  commands: { register(command: Record<string, unknown>): void };
}

/** shown in the page console, like vite client errors */
function report(what: string) {
  return (error: unknown) => {
    console.error(`[svelte-inspector] failed to ${what}`, error);
  };
}

/** `file` resolved against the vite root (Vite DevTools opens paths inside its workspace) */
function absolute(file: string): string {
  const root = options.__internal.root;
  if (!root || file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file)) return file;
  return `${root.replace(/[\\/]$/, '')}/${file}`;
}

export default function setup(ctx: DockContext): void {
  // the hub also runs eager scripts in its standalone page
  if (ctx.clientType !== 'embedded') return;
  const id = ctx.current.entryMeta.id;
  const { docks } = ctx;

  const target = document.createElement('div');
  target.setAttribute('id', 'svelte-inspector-host');
  document.documentElement.append(target);

  const props = {
    openInEditor(loc: Loc) {
      ctx.rpc
        .call('vite:core:open-in-editor', `${absolute(loc.file)}:${loc.line}:${loc.column + 1}`)
        .catch(report('open editor'));
    },
    ignore(e: Event) {
      // the dock is rendered in the page
      return e
        .composedPath()
        .some(node => node instanceof Element && node.tagName.startsWith('DEVFRAMES-'));
    },
    onenabledchange(enabled: boolean) {
      // sync the dock button when the inspector toggles itself
      if (ctx.current.isActive !== enabled) {
        docks.setActionActive(id, enabled).catch(report('sync the dock button'));
      }
    },
  };
  const inspector = mount(Inspector, { target, props }) as unknown as {
    enable(): void;
    disable(): void;
  };

  // client-side so it toggles this tab only; no keybinding of its own, toggleKeyCombo already is one
  ctx.commands.register({
    id: 'svelte:toggle-inspector',
    source: 'client',
    title: 'Toggle Svelte Inspector',
    icon: 'logos:svelte-icon',
    category: 'svelte',
    action: () => docks.toggleEntry(id).catch(report('toggle the inspector')),
  });

  // deferred, or the activating click reaches the inspector's window click handler and disables it
  ctx.current.events.on('entry:activated', () => {
    setTimeout(() => inspector.enable());
  });
  ctx.current.events.on('entry:deactivated', () => inspector.disable());
}
