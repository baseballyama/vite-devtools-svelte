<script lang="ts">
  import Badge from '../../components/Badge.svelte'
  import Button from '../../components/Button.svelte'
  import Inspector from '../../components/Inspector.svelte'
  import { componentName, prettyValue, shortPath } from '../../lib/format.js'
  import { isValueSummary, kindLabel } from '../../lib/reactive.js'
  import { router } from '../../lib/router.svelte.js'
  import type { ReactiveNode, ReactiveSummary } from '../../lib/types.js'
  import KindBadge from './KindBadge.svelte'

  /** Detail pane for one signal of the loaded graph. */
  let {
    node,
    byId,
    deps,
    dependents,
    flash,
    capabilities,
    scopedTo,
    canScope,
    onselect,
    onopen,
    onscope,
    onclose,
  }: {
    node: ReactiveNode
    byId: Map<string, ReactiveNode>
    /** Ids this signal reads (can affect it). */
    deps: string[]
    /** Ids this signal can affect. */
    dependents: string[]
    /** Its value changed in the latest reply. */
    flash: boolean
    capabilities: ReactiveSummary['capabilities']
    /** The component the graph is scoped to, if any: links elsewhere are marked. */
    scopedTo: number | null
    /** A page-load id is known, so another component can be scoped to. */
    canScope: boolean
    onselect: (id: string) => void
    onopen: (n: ReactiveNode) => void
    onscope: (n: ReactiveNode) => void
    onclose: () => void
  } = $props()
</script>

<Inspector title={node.name} subtitle={shortPath(node.componentFile, 3)} {onclose}>
  {#snippet badges()}
    <KindBadge type={node.type} rune />
    <Badge>component #{node.componentId}</Badge>
  {/snippet}
  {#snippet actions()}
    <Button icon="editor" onclick={() => onopen(node)}
      >{node.type === 'template' ? 'Open component' : 'Go to definition (by name)'}</Button
    >
    {#if canScope && node.componentId !== scopedTo}
      <Button icon="reactive" onclick={() => onscope(node)}>Show this component</Button>
    {/if}
  {/snippet}
  {#if node.type === 'template'}
    <p class="section-note">
      All reads from this component's markup: <code>{'{expressions}'}</code>, attributes, block
      conditions and <code>&lt;svelte:head&gt;</code>.
    </p>
  {/if}
  {#if node.unevaluated}
    <h3 class="section-title">Current value</h3>
    <p class="section-note">
      Not evaluated yet: nothing has read this $derived so far (Svelte computes deriveds on first
      read).
    </p>
  {/if}
  {#if node.value !== undefined}
    {@const summary = isValueSummary(node.value)}
    <h3 class="section-title">Current value</h3>
    <pre class="code-block" class:flash>{summary ? node.value : prettyValue(node.value)}</pre>
    {#if summary && !capabilities.valueInspection}
      <p class="section-note">
        Full value: not available yet. This dev server reports only a summary for objects and
        arrays.
      </p>
    {/if}
  {/if}
  <h3 class="section-title">Cause</h3>
  <p class="section-note">
    {capabilities.writeCause
      ? 'Recorded writes appear here.'
      : 'Not recorded. This dev server does not capture which write changed a signal; the links below are dependencies, not causes.'}
  </p>
  {@render rel('Reads (can affect this)', deps)}
  {@render rel('Can affect', dependents)}
  <h3 class="section-title">History</h3>
  <p class="section-note">
    {#if node.type === 'state'}
      {#if !capabilities.signalHistory}Per-signal history: not available yet.{/if}
      Sampled changes of all signals (latest 500) are in the
      <button type="button" class="link" onclick={() => router.go('timeline')}
        >State timeline</button
      >.
    {:else}
      Not recorded for {kindLabel(node.type)}.
    {/if}
  </p>
</Inspector>

{#snippet rel(title: string, ids: string[])}
  <h3 class="section-title">{title} <span class="num">{ids.length}</span></h3>
  {#if ids.length}
    <ul class="link-list">
      {#each ids as id (id)}
        {@const n = byId.get(id)}
        {#if n}
          <li>
            <button type="button" onclick={() => onselect(id)}>
              <KindBadge type={n.type} />
              <span class="truncate mono">{n.name}</span>
              <span class="sub truncate"
                >{componentName(n.componentFile)}{scopedTo !== null && n.componentId !== scopedTo
                  ? ' · other component'
                  : ''}</span
              >
            </button>
          </li>
        {/if}
      {/each}
    </ul>
  {:else}
    <p class="section-note">None</p>
  {/if}
{/snippet}

<style>
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-fg);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .flash {
    animation: flash 1s var(--ease);
  }
  @keyframes flash {
    from {
      background: var(--yellow-bg);
      color: var(--yellow);
    }
  }
</style>
