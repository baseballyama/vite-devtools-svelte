import { mount, unmount, flushSync, type Component } from 'svelte';
import { vi } from 'vitest';

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  componentId: number;
  componentFile: string;
  value?: unknown;
  untrackedDeps?: number;
}
export interface Graph {
  nodes: GraphNode[];
  edges: Array<{ from: string; to: string }>;
  [k: string]: unknown;
}

// The page's store, under the registry key hooks.js creates it at.
export const dt = (): any => (globalThis as any)[Symbol.for('vite-devtools-svelte')];

// The tests run under a DOM environment, but the package type-checks against Node's
// lib only: describe just the DOM surface the tests touch.
interface TestElement {
  append(...children: TestElement[]): void;
  remove(): void;
  querySelector(selector: string): { click(): void } | null;
}
const testDocument = () =>
  (
    globalThis as unknown as {
      document: { body: TestElement; createElement(tag: string): TestElement };
    }
  ).document;

export function render<P extends Record<string, any>>(Comp: Component<P>, props?: P) {
  const document = testDocument();
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(Comp, { target, props: (props ?? {}) as P });
  flushSync();
  return {
    target,
    app,
    destroy() {
      // Outros are not awaited: teardown is synchronous for these fixtures.
      void unmount(app);
      flushSync();
      target.remove();
    },
  };
}

/** Live component instances whose name (file basename) is `name`. */
export const instances = (name: string) =>
  dt()
    .getTree()
    .filter((c: { name: string }) => c.name === name) as Array<{
    id: number;
    name: string;
    file: string;
    parentId: number | null;
  }>;

/** The single live instance named `name` (throws when 0 or > 1). */
export function instance(name: string) {
  const list = instances(name);
  if (list.length !== 1) throw new Error(`expected 1 live ${name}, found ${list.length}`);
  return list[0]!;
}

export const graph = (componentId: number | null = null): Graph =>
  dt().getReactiveGraph(componentId);

export function node(g: Graph, componentId: number, name: string): GraphNode {
  const n = g.nodes.find(x => x.componentId === componentId && x.name === name);
  if (!n)
    throw new Error(`no node ${componentId}:${name} in [${g.nodes.map(x => x.id).join(', ')}]`);
  return n;
}

export const incoming = (g: Graph, id: string) => g.edges.filter(e => e.to === id).map(e => e.from);
export const outgoing = (g: Graph, id: string) => g.edges.filter(e => e.from === id).map(e => e.to);

/**
 * Runs the observation the runtime schedules after Svelte's flush (a task
 * later) now. The clock is frozen: its 2 ms serialization budget is
 * wall-clock, and on a loaded machine a GC pause would otherwise defer part
 * of the work to a later task.
 */
export function poll() {
  const d = dt();
  if (d._observeTimer !== null) {
    clearTimeout(d._observeTimer);
    d._observeTimer = null;
  }
  const now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
  try {
    d._observeStates();
  } finally {
    clock.mockRestore();
  }
}

export const timeline = (): Array<{
  id: string;
  name: string;
  oldValue: unknown;
  newValue: unknown;
}> => dt().getStateTimeline();

export { flushSync };
