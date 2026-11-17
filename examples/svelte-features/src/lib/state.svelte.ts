import { untrack } from 'svelte';

// Shared module state, tracked by the DevTools under this module rather than
// under a component instance.

/** Module-level $state object. */
export const shared = $state({ clicks: 0, tags: ['svelte', 'vite'] as string[] });

/** $state.raw: replaced, never deeply proxied. */
export const rawLog = $state.raw({ entries: [] as string[] });

export function log(entry: string): void {
  rawLog.entries = [...rawLog.entries.slice(-4), entry];
}

/** A class with $state / $derived fields. */
export class Counter {
  count = $state(0);
  step = $state(1);
  doubled = $derived(this.count * 2);
  parity = $derived.by(() => (this.count % 2 === 0 ? 'even' : 'odd'));

  constructor(public name: string) {}

  increment = (): void => {
    this.count += this.step;
  };
}

/** An instance created outside any component. */
export const globalCounter = new Counter('global');

/** $state.snapshot of the shared state (a plain object, no proxies). */
export function snapshot(): { clicks: number; tags: string[] } {
  return $state.snapshot(shared);
}

// An $effect.root created outside a component: lives until stopped.
let stopRoot: (() => void) | null = null;
export const rootEffect = $state({ running: false, runs: 0 });

export function toggleRootEffect(): void {
  if (stopRoot) {
    stopRoot();
    stopRoot = null;
    rootEffect.running = false;
    return;
  }
  stopRoot = $effect.root(() => {
    $effect(() => {
      // Re-runs whenever shared.clicks or the global counter changes.
      void shared.clicks;
      void globalCounter.count;
      untrack(() => rootEffect.runs++);
    });
  });
  rootEffect.running = true;
}
