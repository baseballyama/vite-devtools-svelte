// Client script of the `svelte:inspector` dock action
import { mount, unmount } from 'svelte';
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
    events: {
      on(event: 'entry:activated' | 'entry:deactivated', listener: () => void): () => void;
    };
  };
  docks: {
    setActionActive(id: string, active: boolean): Promise<boolean>;
    toggleEntry(id: string): Promise<boolean>;
  };
  rpc: { call(name: string, ...args: unknown[]): Promise<unknown> };
  commands: { register(command: Record<string, unknown>): () => void };
}

/** shown in the page console, like vite client errors */
function report(what: string) {
  return (error: unknown) => {
    console.error(`[svelte-inspector] failed to ${what}`, error);
  };
}

/** Whether `file` is absolute, POSIX (`/a`) or Windows (`C:/a`, `C:\a`) */
function isAbsolute(file: string): boolean {
  if (file.startsWith('/')) return true;
  const letter = file.charAt(0).toLowerCase();
  const separator = file.charAt(2);
  return (
    letter >= 'a' &&
    letter <= 'z' &&
    file.charAt(1) === ':' &&
    (separator === '/' || separator === '\\')
  );
}

/** `file` resolved against the vite root (Vite DevTools opens paths inside its workspace) */
function absolute(file: string): string {
  const root = options.__internal.root;
  if (!root || isAbsolute(file)) return file;
  const base = root.endsWith('/') || root.endsWith('\\') ? root.slice(0, -1) : root;
  return `${base}/${file}`;
}

/** Vite's own endpoint, which upstream uses; it opens files outside the workspace too */
function openWithVite(file: string) {
  fetch(`${options.__internal.base}/__open-in-editor?file=${encodeURIComponent(file)}`).catch(
    report('open editor'),
  );
}

/** Whether `e` comes from the dock, which devframe renders in the page as `<devframes-*>` elements */
function fromDock(e: Event): boolean {
  return e
    .composedPath()
    .some(node => node instanceof Element && node.tagName.startsWith('DEVFRAMES-'));
}

/** What the last run of `setup` mounted, torn down when the hub runs the script again */
let teardown: (() => void) | undefined;

export default function setup(ctx: DockContext): void {
  // the hub also runs eager scripts in its standalone page
  if (ctx.clientType !== 'embedded') return;
  // e.g. a new RPC client after a reconnect: one inspector, wired to the latest context
  teardown?.();
  const id = ctx.current.entryMeta.id;
  const { docks } = ctx;

  const target = document.createElement('div');
  target.setAttribute('id', 'svelte-inspector-host');
  document.documentElement.append(target);

  const props = {
    openInEditor(loc: Loc) {
      const file = `${absolute(loc.file)}:${loc.line}:${loc.column + 1}`;
      // Vite DevTools refuses paths outside its workspace root, e.g. linked packages
      ctx.rpc.call('vite:core:open-in-editor', file).catch(() => openWithVite(file));
    },
    ignore: fromDock,
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
  const unregister = ctx.commands.register({
    id: 'svelte:toggle-inspector',
    source: 'client',
    title: 'Toggle Svelte Inspector',
    icon: 'logos:svelte-icon',
    category: 'svelte',
    action: () => docks.toggleEntry(id).catch(report('toggle the inspector')),
  });

  // deferred, or the activating click reaches the inspector's window click handler and disables
  // it; skipped when the entry was turned off again in the meantime
  const offActivated = ctx.current.events.on('entry:activated', () => {
    setTimeout(() => {
      if (ctx.current.isActive) inspector.enable();
    });
  });
  const offDeactivated = ctx.current.events.on('entry:deactivated', () => inspector.disable());

  teardown = () => {
    offActivated();
    offDeactivated();
    unregister();
    void unmount(inspector);
    target.remove();
  };
}
