import { untrack } from 'svelte';

// Shared module state, tracked by the DevTools under this module rather than
// under a component instance.

export const shared = $state({ clicks: 0, tags: ['svelte', 'vite'] as string[] });

/** $state.raw: replaced, never deeply proxied (read through a getter, so the reassignment is seen). */
let logEntries = $state.raw<string[]>([]);
export const rawLog = {
  get entries(): string[] {
    return logEntries;
  },
};

export function log(entry: string): void {
  logEntries = [...logEntries.slice(-4), entry];
}

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

export const globalCounter = new Counter('global');

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
      void shared.clicks;
      void globalCounter.count;
      untrack(() => rootEffect.runs++);
    });
  });
  rootEffect.running = true;
}
