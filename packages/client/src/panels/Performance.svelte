<script lang="ts">
  import Button from '../components/Button.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Panel from '../components/Panel.svelte';
  import ResourceEmpty from '../components/ResourceEmpty.svelte';
  import Segmented from '../components/Segmented.svelte';
  import SplitView from '../components/SplitView.svelte';
  import type { Column, SortState, TableRowState } from '../components/types.js';
  import { errorMessage, formatMs, shortPath } from '../lib/format.js';
  import {
    causes,
    formatElapsed,
    formatOffset,
    selfMs,
    severity,
    SLOW_UPDATE_MS,
  } from '../lib/performance.js';
  import { resource } from '../lib/resource.svelte.js';
  import {
    getPerformanceRecording,
    openInEditor,
    startPerformanceRecording,
    stopPerformanceRecording,
  } from '../lib/rpc.js';
  import type { PerfComponentTotal, PerfUpdate, PerformanceRecording } from '../lib/types.js';
  import { datasetVersion } from '../lib/versions.js';
  import Timeline from './performance/Timeline.svelte';
  import UpdateDetail from './performance/UpdateDetail.svelte';

  const IDLE: PerformanceRecording = {
    state: 'idle',
    recordingId: null,
    startedAt: null,
    stoppedAt: null,
    epoch: null,
    updates: [],
    droppedUpdates: 0,
    components: [],
    componentsOmitted: false,
  };
  /** While recording the list follows the app; once stopped it changes only on Record. */
  const POLL_MS = 1000;

  const rec = resource<PerformanceRecording>(getPerformanceRecording, {
    initial: IDLE,
    interval: POLL_MS,
    version: datasetVersion('performance'),
  });

  let view = $state<'updates' | 'components'>('updates');
  let selected = $state<string | null>(null);
  let sort = $state<SortState | null>({ id: 'duration', desc: true });
  let componentSort = $state<SortState | null>({ id: 'self', desc: true });
  let selectedComponent = $state<string | null>(null);
  let pending = $state(false);
  let actionError = $state<string | null>(null);

  const recording = $derived(rec.data.state === 'recording');
  const updates = $derived(rec.data.updates);
  const byId = $derived(new Map(updates.map(u => [String(u.id), u])));
  const current = $derived(selected === null ? null : (byId.get(selected) ?? null));
  const slow = $derived(updates.filter(u => u.duration >= SLOW_UPDATE_MS).length);
  const summary = $derived(
    [
      `${updates.length.toLocaleString()} update${updates.length === 1 ? '' : 's'}`,
      `${slow} over ${SLOW_UPDATE_MS} ms`,
      rec.data.droppedUpdates ? `${rec.data.droppedUpdates.toLocaleString()} not kept (limit)` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  const maxDuration = $derived(updates.reduce((m, u) => Math.max(m, u.duration), 0.0001));

  // The elapsed time on the Stop button.
  let now = $state(Date.now());
  $effect(() => {
    if (!recording) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), POLL_MS);
    return () => clearInterval(timer);
  });
  const elapsed = $derived(recording && rec.data.startedAt !== null ? now - rec.data.startedAt : 0);
  /** What the timeline spans: the recording so far, at least up to the last update. */
  const span = $derived(
    Math.max(
      updates.reduce((m, u) => Math.max(m, u.start + u.duration), 0),
      rec.data.startedAt === null
        ? 0
        : (recording ? now : (rec.data.stoppedAt ?? now)) - rec.data.startedAt,
    ),
  );

  async function toggle() {
    pending = true;
    actionError = null;
    try {
      if (recording) {
        rec.set(await stopPerformanceRecording());
      } else {
        await startPerformanceRecording();
        selected = null;
        selectedComponent = null;
        await rec.refresh();
      }
    } catch (e) {
      actionError = errorMessage(e);
    } finally {
      pending = false;
    }
  }

  const effectsAndDerived = (u: PerfUpdate) => u.effects + u.deriveds;

  const columns: Column<PerfUpdate>[] = [
    {
      id: 'time',
      label: 'Time',
      width: '76px',
      sort: (a, b) => a.start - b.start,
    },
    { id: 'trigger', label: 'Trigger (state written)', width: 'minmax(0, 1fr)' },
    {
      id: 'components',
      label: 'Components',
      width: '92px',
      align: 'end',
      descFirst: true,
      minWidth: 560,
      sort: (a, b) => a.components - b.components,
    },
    {
      id: 'work',
      label: 'Effects / Derived',
      width: '120px',
      align: 'end',
      descFirst: true,
      minWidth: 680,
      sort: (a, b) => effectsAndDerived(a) - effectsAndDerived(b),
    },
    {
      id: 'duration',
      label: 'Duration',
      width: '170px',
      align: 'end',
      descFirst: true,
      sort: (a, b) => a.duration - b.duration,
    },
  ];

  const componentKey = (c: PerfComponentTotal) => `${c.kind}:${c.file}:${c.name}`;
  const maxComponentSelf = $derived(
    rec.data.components.reduce((m, c) => Math.max(m, selfMs(c)), 0.0001),
  );
  const avg = (c: PerfComponentTotal) => (c.updates > 0 ? selfMs(c) / c.updates : 0);

  const componentColumns: Column<PerfComponentTotal>[] = [
    {
      id: 'name',
      label: 'Component',
      width: 'minmax(0, 1fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
    },
    {
      id: 'instances',
      label: 'Inst.',
      width: '56px',
      align: 'end',
      descFirst: true,
      minWidth: 600,
      sort: (a, b) => a.instances - b.instances,
    },
    {
      id: 'updates',
      label: 'Updates',
      width: '68px',
      align: 'end',
      descFirst: true,
      sort: (a, b) => a.updates - b.updates,
    },
    {
      id: 'runs',
      label: 'Render / Effect / Derived',
      width: '170px',
      align: 'end',
      descFirst: true,
      minWidth: 720,
      sort: (a, b) => a.renders + a.effects + a.deriveds - (b.renders + b.effects + b.deriveds),
    },
    {
      id: 'avg',
      label: 'Avg / update',
      width: '96px',
      align: 'end',
      descFirst: true,
      minWidth: 520,
      sort: (a, b) => avg(a) - avg(b),
    },
    {
      id: 'self',
      label: 'Self time',
      width: '170px',
      align: 'end',
      descFirst: true,
      sort: (a, b) => selfMs(a) - selfMs(b),
    },
  ];
</script>

<Panel title="Performance">
  {#snippet toolbar()}
    <Button
      icon={recording ? 'stop' : 'record'}
      variant={recording ? 'danger' : 'primary'}
      disabled={pending}
      onclick={toggle}>{recording ? `Stop · ${formatElapsed(elapsed)}` : 'Record'}</Button
    >
    <Segmented
      label="View"
      bind:value={view}
      options={[
        { value: 'updates', label: 'Updates' },
        { value: 'components', label: 'Components' },
      ]}
    />
    {#if rec.data.recordingId !== null}
      <span class="summary num">{summary}</span>
    {/if}
    {#if actionError}<span class="error" role="alert">{actionError}</span>{/if}
  {/snippet}

  {#if view === 'updates'}
    <SplitView id="performance" open={!!current} initial={420}>
      <div class="main">
        {#if updates.length}
          <Timeline
            {updates}
            {span}
            selected={current?.id ?? null}
            onselect={id => (selected = String(id))}
          />
        {/if}
        <div class="table">
          <DataTable
            items={updates}
            {columns}
            getKey={(u: PerfUpdate) => String(u.id)}
            bind:sort
            bind:selected
            label="Recorded updates"
          >
            {#snippet row(u: PerfUpdate, { visible }: TableRowState)}
              <span class="num mono">{formatOffset(u.start)}</span>
              <span class="triggers truncate">
                {#each causes(u).slice(0, 2) as t (t.nodeId)}
                  <span class="chip mono">{t.scope} · {t.name}</span>
                {/each}
                {#if causes(u).length > 2}<span class="faint">+{causes(u).length - 2}</span>{/if}
                {#if u.event}<span class="faint">{u.event.type}</span>{/if}
              </span>
              {#if visible.has('components')}<span class="end num">{u.components}</span>{/if}
              {#if visible.has('work')}<span class="end num muted">{u.effects} / {u.deriveds}</span
                >{/if}
              <span class="dur end">
                <span
                  class={['bar', severity(u.duration)]}
                  style:width="{Math.max(2, (u.duration / maxDuration) * 90)}px"
                ></span>
                <span class={['num', severity(u.duration)]}>{formatMs(u.duration)}</span>
              </span>
            {/snippet}
            {#snippet empty()}
              {@render nothing()}
            {/snippet}
          </DataTable>
        </div>
      </div>
      {#snippet aside()}
        {#if current}
          <UpdateDetail update={current} epoch={rec.data.epoch} onclose={() => (selected = null)} />
        {/if}
      {/snippet}
    </SplitView>
  {:else}
    <div class="main">
      {#if rec.data.componentsOmitted}
        <p class="note">
          Only the {rec.data.components.length} heaviest component files are listed.
        </p>
      {/if}
      <div class="table">
        <DataTable
          items={rec.data.components}
          columns={componentColumns}
          getKey={componentKey}
          bind:sort={componentSort}
          bind:selected={selectedComponent}
          label="Components in the recording"
          onactivate={(c: PerfComponentTotal) => {
            if (c.file) openInEditor(c.file).catch(() => {});
          }}
        >
          {#snippet row(c: PerfComponentTotal, { visible }: TableRowState)}
            <span class="name">
              <span class="cname">{c.name}</span>
              {#if c.kind !== 'component'}<span class="faint">{c.kind}</span>{/if}
              <span class="file truncate">{shortPath(c.file)}</span>
            </span>
            {#if visible.has('instances')}<span class="end num muted">{c.instances}</span>{/if}
            <span class="end num">{c.updates}</span>
            {#if visible.has('runs')}<span class="end num muted"
                >{c.renders} / {c.effects} / {c.deriveds}</span
              >{/if}
            {#if visible.has('avg')}<span class="end num muted">{formatMs(avg(c))}</span>{/if}
            <span class="dur end">
              <span
                class="stack"
                style:width="{Math.max(2, (selfMs(c) / maxComponentSelf) * 90)}px"
              >
                <span class="seg render" style:flex-grow={c.renderMs}></span>
                <span class="seg effect" style:flex-grow={c.effectMs}></span>
                <span class="seg derived" style:flex-grow={c.derivedMs}></span>
              </span>
              <span class="num">{formatMs(selfMs(c))}</span>
            </span>
          {/snippet}
          {#snippet empty()}
            {@render nothing()}
          {/snippet}
        </DataTable>
      </div>
    </div>
  {/if}
</Panel>

{#snippet nothing()}
  <ResourceEmpty
    res={rec}
    total={0}
    loading="Loading the recording…"
    failed="Could not load the recording"
    icon="render"
    title={recording
      ? 'Recording…'
      : rec.data.recordingId === null
        ? 'Find what makes your app slow'
        : 'No updates were recorded'}
  >
    {#if recording}
      <p>Use your app. Every update it makes appears here.</p>
    {:else}
      <p>
        Press <strong>Record</strong>, use your app, then <strong>Stop</strong>. Each update shows
        which state change caused it and where the time went.
      </p>
    {/if}
  </ResourceEmpty>
{/snippet}

<style>
  .summary {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .error {
    color: var(--red);
    font-size: var(--fs-xs);
  }
  .main {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
  .table {
    flex: 1;
    min-height: 0;
  }
  .note {
    margin: 8px 16px 0;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
  }
  .triggers {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .chip {
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--blue-bg);
    color: var(--blue);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .dur {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .dur .num {
    min-width: 60px;
    text-align: right;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--fg-faint);
  }
  .bar.slow {
    background: var(--yellow);
  }
  .bar.bad {
    background: var(--red);
  }
  .num.slow {
    color: var(--yellow);
  }
  .num.bad {
    color: var(--red);
    font-weight: 600;
  }
  .name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .cname {
    font-weight: 500;
    white-space: nowrap;
  }
  .file {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
  }
  .stack {
    display: flex;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
  }
  .seg {
    flex-basis: 0;
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
</style>
