<script lang="ts">
  import Button from '../../components/Button.svelte';
  import Inspector from '../../components/Inspector.svelte';
  import StatList from '../../components/StatList.svelte';
  import { elementPick } from '../../lib/element-pick.svelte.js';
  import { formatMs, shortPath } from '../../lib/format.js';
  import { eventText, formatOffset, selfMs, severity, updateHints } from '../../lib/performance.js';
  import { reactiveScope } from '../../lib/reactive-selection.svelte.js';
  import { router } from '../../lib/router.svelte.js';
  import { openInEditor } from '../../lib/rpc.js';
  import type { PerfCost, PerfTrigger, PerfUpdate } from '../../lib/types.js';

  /** One recorded update: why it ran, where its time went, and rule-based hints. */
  let {
    update: u,
    epoch,
    onclose,
  }: { update: PerfUpdate; epoch: string | null; onclose: () => void } = $props();

  const subtitle = $derived(
    [
      eventText(u.event),
      u.droppedFrames ? `${u.droppedFrames} dropped frame${u.droppedFrames === 1 ? '' : 's'}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  const tone = $derived(severity(u.duration));
  const before = $derived(u.triggers.filter(t => !t.during));
  const during = $derived(u.triggers.filter(t => t.during));
  const maxSelf = $derived(u.costs.reduce((m, c) => Math.max(m, selfMs(c)), 0.0001));
  const hints = $derived(updateHints(u));

  function showInGraph(t: PerfTrigger) {
    if (epoch) {
      reactiveScope.scopeTo(t.scopeId, t.file, epoch, t.nodeId);
      router.go('reactive');
    }
  }

  function open(t: PerfTrigger) {
    openInEditor(t.loc?.file ?? t.file, t.loc?.line).catch(() => {});
  }

  function reveal(c: PerfCost) {
    if (epoch && c.componentId !== null) {
      elementPick.set({ epoch, componentId: c.componentId });
      router.go('components');
    }
  }

  const pct = (ms: number) => `${(ms / maxSelf) * 100}%`;
</script>

<Inspector title="Update at {formatOffset(u.start)}" {subtitle} {onclose}>
  <StatList
    variant="grid"
    items={[
      {
        label: 'Duration',
        value: formatMs(u.duration),
        tone: tone === 'bad' ? 'red' : tone === 'slow' ? 'yellow' : null,
      },
      { label: 'Components', value: u.components.toLocaleString() },
      {
        label: 'Wasted derived',
        value: u.wastedDeriveds.toLocaleString(),
        tone: u.wastedDeriveds > 0 ? 'yellow' : null,
      },
    ]}
  />

  <h3 class="section-title">Why it ran</h3>
  {#if u.triggers.length === 0}
    <p class="section-note">
      No tracked <code>$state</code> was written for this update (state declared in a library is not tracked).
    </p>
  {/if}
  {#each [...before, ...during] as t (t.nodeId)}
    <div class="cause">
      <div class="line">
        <span class="chip mono">{t.scope} · {t.name}</span>
        {#if t.during}<span class="faint">written by an $effect while this update ran</span>{/if}
        {#if t.loc}<span class="faint"
            >declared at <span class="mono">{shortPath(t.loc.file, 1)}:{t.loc.line}</span></span
          >{/if}
      </div>
      <div class="acts">
        <Button icon="reactive" disabled={!epoch} onclick={() => showInGraph(t)}
          >Show in Reactivity graph</Button
        >
        <Button icon="editor" onclick={() => open(t)}>Open in editor</Button>
      </div>
    </div>
  {/each}
  {#if u.triggersOmitted}<p class="section-note">and {u.triggersOmitted} more</p>{/if}

  <h3 class="section-title">Where the time went <span class="faint">(self time)</span></h3>
  {#if u.costs.length === 0}
    <p class="section-note">No effect or derived ran.</p>
  {:else}
    <ul class="costs" aria-label="Self time per component">
      {#each u.costs as c (`${c.kind}:${c.file}:${c.name}`)}
        <li>
          <button
            type="button"
            class="cname mono truncate"
            disabled={!epoch || c.componentId === null}
            title={c.componentId === null ? c.file : `Show <${c.name}> in Components`}
            onclick={() => reveal(c)}
            >{c.name}{#if c.instances > 1}<span class="faint">{` ×${c.instances}`}</span
              >{/if}</button
          >
          <span class="stack" aria-hidden="true">
            <span class="seg render" style:width={pct(c.renderMs)}></span>
            <span class="seg effect" style:width={pct(c.effectMs)}></span>
            <span class="seg derived" style:width={pct(c.derivedMs)}></span>
          </span>
          <span class="num ms">{formatMs(selfMs(c))}</span>
        </li>
      {/each}
    </ul>
    {#if u.costsOmitted}<p class="section-note">and {u.costsOmitted} more</p>{/if}
    <div class="legend">
      <span><i class="render"></i>DOM update</span>
      <span><i class="effect"></i>$effect</span>
      <span><i class="derived"></i>$derived</span>
    </div>
  {/if}

  {#if hints.length}
    <h3 class="section-title">Hints</h3>
    <ul class="hints">
      {#each hints as hint, i (i)}
        <li>
          {#each hint as part, j (j)}{#if 'code' in part}<code>{part.code}</code
              >{:else}{part.text}{/if}{/each}
        </li>
      {/each}
    </ul>
  {/if}
</Inspector>

<style>
  .cause {
    margin: 0 14px 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: var(--fs-sm);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .chip {
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--blue-bg);
    color: var(--blue);
    font-size: var(--fs-xs);
  }
  .costs {
    list-style: none;
    margin: 0;
    padding: 0 14px;
  }
  .costs li {
    display: grid;
    grid-template-columns: minmax(0, 150px) minmax(0, 1fr) 64px;
    align-items: center;
    gap: 8px;
    min-height: 24px;
  }
  .cname {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg);
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .cname:disabled {
    cursor: default;
  }
  .cname:not(:disabled):hover {
    text-decoration: underline;
  }
  .stack {
    display: flex;
    height: 10px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--bg-active);
  }
  .seg {
    display: block;
    height: 100%;
  }
  .ms {
    text-align: right;
    font-size: var(--fs-xs);
  }
  .render {
    background: var(--purple);
  }
  .effect {
    background: var(--red);
  }
  .derived {
    background: var(--green);
  }
  .legend {
    display: flex;
    gap: 12px;
    padding: 6px 14px 0;
    color: var(--fg-muted);
    font-size: var(--fs-2xs);
  }
  .legend i {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 2px;
  }
  .hints {
    margin: 0 14px;
    padding: 8px 10px 8px 26px;
    border: 1px solid var(--yellow);
    border-radius: var(--radius);
    background: var(--yellow-bg);
    color: var(--fg);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }
</style>
