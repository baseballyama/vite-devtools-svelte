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
    entries: Array<{ id: string; title: string }>;
    getStateById(id: string): { isActive: boolean } | undefined;
    setActionActive(id: string, active: boolean): Promise<boolean>;
    switchEntry(id: string): Promise<boolean>;
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

/**
 * `file` from `__svelte_meta`, made absolute: Svelte writes it relative to its `rootDir`
 * (process.cwd() by default), and Vite DevTools resolves relative paths elsewhere
 */
function absolute(file: string): string {
  const cwd = options.__internal.cwd;
  if (!cwd || isAbsolute(file)) return file;
  const base = cwd.endsWith('/') || cwd.endsWith('\\') ? cwd.slice(0, -1) : cwd;
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

const SVELTE_DOCK_ENTRIES = [
  ['svelte-devtools:overview', 'Overview'],
  ['svelte-devtools:problems', 'Problems'],
  ['svelte-devtools:inspect', 'Inspect'],
  ['svelte-devtools:profile', 'Profile'],
  ['svelte-devtools:project', 'Project'],
  ['svelte:inspector-settings', 'Settings'],
  ['svelte:inspector', 'Pick element'],
] as const;

function installDockAccent(ctx: DockContext): () => void {
  const observers: MutationObserver[] = [];
  const roots = new Set<Document | ShadowRoot>();
  const accented = new Map<HTMLElement, { value: string; priority: string }>();

  const sync = () => {
    for (const [button, color] of accented) {
      button.style.setProperty('color', color.value, color.priority);
    }
    accented.clear();
    for (const [id, title] of SVELTE_DOCK_ENTRIES) {
      if (!ctx.docks.getStateById(id)?.isActive) continue;
      if (
        ctx.docks.entries.some(
          entry =>
            entry.id !== id && entry.title === title && ctx.docks.getStateById(entry.id)?.isActive,
        )
      ) {
        continue;
      }
      for (const root of roots) {
        for (const button of root.querySelectorAll<HTMLElement>(
          `.devframes-dock-entry button[aria-label="${title}"].text-primary`,
        )) {
          accented.set(button, {
            value: button.style.getPropertyValue('color'),
            priority: button.style.getPropertyPriority('color'),
          });
          button.style.setProperty('color', '#ff3e00', 'important');
        }
      }
    }
  };

  function discover(node: Document | Element) {
    const docks = [
      ...(node instanceof Element &&
      node.matches('devframes-dock-embedded, devframes-dock-standalone')
        ? [node]
        : []),
      ...node.querySelectorAll('devframes-dock-embedded, devframes-dock-standalone'),
    ];
    for (const dock of docks) {
      if (dock.shadowRoot) observe(dock.shadowRoot);
    }
  }

  function observe(root: Document | ShadowRoot) {
    if (roots.has(root)) return;
    roots.add(root);
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) discover(node);
        }
      }
      sync();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      ...(root === document ? {} : { attributes: true, attributeFilter: ['class'] }),
    });
    observers.push(observer);
  }

  observe(document);
  discover(document);
  sync();

  return () => {
    for (const observer of observers) observer.disconnect();
    for (const [button, color] of accented) {
      button.style.setProperty('color', color.value, color.priority);
    }
  };
}

/** What the last run of `setup` mounted, torn down when the hub runs the script again */
let teardown: (() => void) | undefined;

export default function setup(ctx: DockContext): void {
  // e.g. a new RPC client after a reconnect: one inspector, wired to the latest context
  teardown?.();
  const removeDockAccent = installDockAccent(ctx);
  // the hub also runs eager scripts in its standalone page
  if (ctx.clientType !== 'embedded') {
    teardown = removeDockAccent;
    return;
  }
  const id = ctx.current.entryMeta.id;
  const { docks } = ctx;
  const openInspect = () => {
    docks.switchEntry('svelte-devtools:inspect').catch(report('open Inspect'));
  };
  window.addEventListener('svelte-inspector:pick', openInspect);

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
    window.removeEventListener('svelte-inspector:pick', openInspect);
    removeDockAccent();
    void unmount(inspector);
    target.remove();
  };
}
