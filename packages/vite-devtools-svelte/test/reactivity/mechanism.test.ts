import { flushSync } from 'svelte';
import { describe, it, expect, afterEach } from 'vitest';

import Classes from './fixtures/Classes.svelte';
import EachConst from './fixtures/EachConst.svelte';
import EachState from './fixtures/EachState.svelte';
import Effects from './fixtures/Effects.svelte';
import Tree from './fixtures/Tree.svelte';
import { render, instance, instances, graph, node, incoming, dt } from './harness.js';

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});
const effectNames = (id: number) =>
  graph(id)
    .nodes.filter(n => n.type === 'effect')
    .map(n => n.name)
    .toSorted();

function mountIt(C: any, props?: any) {
  const r = render(C, props);
  cleanup.push(() => r.destroy());
  return r;
}

describe('effects', () => {
  it('top-level $effect / $effect.pre / nested $effect have their dependencies', () => {
    mountIt(Effects);
    const c = instance('Effects');
    const g = graph(c.id);
    const effects = g.nodes.filter(n => n.type === 'effect');
    expect(effects.map(e => e.name).toSorted()).toEqual(
      ['effect_1', 'effect_2', 'effect_3', 'effect_pre_1'].toSorted(),
    );
    const a = node(g, c.id, 'a').id;
    const b = node(g, c.id, 'b').id;
    expect(incoming(g, node(g, c.id, 'effect_1').id)).toEqual([a]);
    expect(incoming(g, node(g, c.id, 'effect_pre_1').id)).toEqual([b]);
    // the nested effect is created while effect_2 runs, still owned by Effects
    expect(incoming(g, node(g, c.id, 'effect_3').id).toSorted()).toEqual([a, b].toSorted());
  });

  it('effect names are numbered per component (stable across instances)', () => {
    mountIt(Effects);
    mountIt(Effects);
    const [x, y] = instances('Effects');
    expect(effectNames(x!.id)).toEqual(effectNames(y!.id));
  });
});

describe('node identity', () => {
  it('{@const} in {#each} items: one node per item, no collision', () => {
    const r = mountIt(EachConst);
    const c = instance('EachConst');
    let g = graph(c.id);
    expect(g.nodes.filter(n => n.type === 'derived')).toHaveLength(3);
    (r.app as any).add();
    flushSync();
    g = graph(c.id);
    expect(g.nodes.filter(n => n.type === 'derived')).toHaveLength(4);
    const ids = g.nodes.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('two instances of a $state class in one component: separate nodes', () => {
    mountIt(Classes);
    const c = instance('Classes');
    const g = graph(c.id);
    expect(g.nodes.filter(n => n.name.startsWith('Counter.count'))).toHaveLength(2);
    expect(g.nodes.filter(n => n.name.startsWith('Counter.doubled'))).toHaveLength(2);
  });

  it('the overview node counts match the graph', () => {
    mountIt(EachConst);
    const c = instance('EachConst');
    const counts = dt()._nodeCounts.get(c.id);
    const g = graph(c.id);
    const own = g.nodes.filter(n => n.componentId === c.id).filter(n => n.type !== 'template');
    expect(counts.state + counts.derived + counts.effect).toBe(own.length);
  });
});

describe('component tree', () => {
  it('parents: direct, {#each} added later, {#if} toggled later, slotted', () => {
    const r = mountIt(Tree);
    const api = (r.app as any).api;
    api.addRow();
    api.toggle();
    flushSync();
    const tree = instance('Tree');
    const children = instances('Child');
    // direct, row1, row2, if, after-boundary + slotted
    expect(children).toHaveLength(6);
    // all but the slotted child are rendered by Tree's own markup; the
    // slotted one is created inside after-boundary's {@render children()}
    const parents = children.map(ch => ch.parentId);
    expect(parents.filter(p => p === tree.id)).toHaveLength(5);
    for (const p of parents) expect(dt()._instances.has(p)).toBe(true);
  });

  it('a component whose init throws inside <svelte:boundary> leaves no ghost and no stale owner', () => {
    const r = mountIt(Tree);
    const api = (r.app as any).api;
    const before = dt().getTree().length;
    api.break();
    flushSync();
    expect(instances('Thrower')).toHaveLength(0);
    expect(dt()._stack).toHaveLength(0);
    api.addRow();
    flushSync();
    const tree = instance('Tree');
    const rows = instances('Child').filter(c => c.parentId !== tree.id);
    // only the slotted child may have a non-Tree parent
    expect(rows.length).toBeLessThanOrEqual(1);
    expect(dt().getTree().length).toBe(before + 1);
  });

  it('unmount removes the subtree and its nodes', () => {
    const r = mountIt(Tree);
    const ids = dt()
      .getTree()
      .map((c: any) => c.id);
    r.destroy();
    cleanup = [];
    for (const id of ids) {
      expect(dt()._instances.has(id)).toBe(false);
      expect(dt()._nodesByComponent.has(id)).toBe(false);
    }
  });
});

describe('node lifetime', () => {
  it('nodes of removed {#each} items leave the graph and the counts', () => {
    const r = mountIt(EachConst);
    const c = instance('EachConst');
    (r.app as any).removeFirst();
    flushSync();
    expect(graph(c.id).nodes.filter(n => n.type === 'derived')).toHaveLength(2);
    (r.app as any).removeFirst();
    flushSync();
    // removed when Svelte destroys the item, without a poll or a graph request
    expect(dt()._nodeCounts.get(c.id).derived).toBe(1);
  });

  it("a destroyed {#each} item's states leave the store at once (effectDestroyed)", () => {
    const r = mountIt(EachState);
    const c = instance('EachState');
    const ids = (): string[] =>
      [...dt()._nodesByComponent.get(c.id)].toSorted((a: string, b: string) => a.localeCompare(b));
    const before = ids();
    // per item: the Counter's count ($state), doubled ($derived), the {@const}
    expect(dt()._nodeCounts.get(c.id)).toEqual({ state: 1 + 3, derived: 3 * 2, effect: 0 });
    (r.app as any).removeFirst();
    flushSync();
    expect(dt()._nodeCounts.get(c.id)).toEqual({ state: 1 + 2, derived: 2 * 2, effect: 0 });
    const gone = before.filter(id => !ids().includes(id));
    expect(gone).toHaveLength(3);
    for (const id of gone) {
      expect(dt()._reactiveNodes.has(id)).toBe(false);
      expect(dt()._unseeded.has(id)).toBe(false);
      expect(dt()._stateSnapshots.has(id)).toBe(false);
    }
    expect(graph(c.id).nodes.filter(n => n.name.startsWith('count'))).toHaveLength(2);
  });

  it('an effect re-created by its parent effect does not pile up', () => {
    const r = mountIt(Effects);
    const c = instance('Effects');
    for (let i = 0; i < 5; i++) {
      (r.app as any).bumpA();
      flushSync();
    }
    // effect_2 creates a nested effect per run; only the current one is live
    expect(graph(c.id).nodes.filter(n => n.type === 'effect')).toHaveLength(4);
    expect(dt()._nodeCounts.get(c.id).effect).toBe(4);
  });
});
