<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Highlight from '../components/Highlight.svelte'
  import Inspector from '../components/Inspector.svelte'
  import Panel from '../components/Panel.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import SplitView from '../components/SplitView.svelte'
  import TreeView from '../components/TreeView.svelte'
  import type { Tone } from '../components/types.js'
  import { matcher } from '../lib/match.js'
  import { resource } from '../lib/resource.svelte.js'
  import { buildRouteTree, type RouteNode } from '../lib/route-tree.js'
  import { getRoutes, openInEditor } from '../lib/rpc.js'
  import { branchKeys } from '../lib/tree.js'
  import type { RouteFile, RouteInfo } from '../lib/types.js'

  const routes = resource<RouteInfo[]>(getRoutes, { initial: [] })

  const tree = $derived(buildRouteTree(routes.data))

  let query = $state('')
  let kind = $state<'all' | 'pages' | 'endpoints' | 'dynamic'>('all')
  let expanded = $state(new Set<string>(['/']))
  let selected = $state<string | null>(null)
  let seeded = false

  $effect(() => {
    if (seeded || routes.data.length === 0) return
    seeded = true
    // Small apps: open everything. Large apps: first two levels.
    expanded =
      routes.data.length <= 60
        ? branchKeys(tree.roots, { key: n => n.key, children: n => n.children })
        : new Set(['/', ...(tree.roots[0]?.children ?? []).map(c => c.key)])
  })

  const kindTest = $derived(
    kind === 'pages'
      ? (r: RouteInfo) => r.hasPage
      : kind === 'endpoints'
        ? (r: RouteInfo) => r.hasEndpoint
        : kind === 'dynamic'
          ? (r: RouteInfo) => r.params.length > 0
          : null,
  )

  const filter = $derived.by(() => {
    const m = matcher(query)
    const k = kindTest
    if (!m && !k) return null
    return (n: RouteNode) => !!n.route && (!k || k(n.route)) && (!m || m(n.route.path, n.route.id))
  })

  const counts = $derived({
    all: routes.data.length,
    pages: routes.data.filter(r => r.hasPage).length,
    endpoints: routes.data.filter(r => r.hasEndpoint).length,
    dynamic: routes.data.filter(r => r.params.length > 0).length,
  })

  const selectedRoute = $derived(selected ? (tree.byKey.get(selected)?.route ?? null) : null)

  // Complete for every known type (checked by `satisfies`); a type a newer
  // server adds falls back to its raw name.
  const fileLabels: Partial<Record<string, string>> = {
    page: '+page.svelte',
    layout: '+layout.svelte',
    'server-page': '+page.server',
    'server-layout': '+layout.server',
    endpoint: '+server',
    'page-load': '+page',
    'layout-load': '+layout',
    error: '+error.svelte',
    'page-load-server': '+page.server',
    'layout-load-server': '+layout.server',
  } satisfies Record<RouteFile['type'], string>

  function fileTone(t: RouteFile['type']): Tone {
    if (t === 'endpoint') return 'green'
    if (t.includes('server')) return 'blue'
    if (t.includes('layout')) return 'purple'
    if (t === 'error') return 'red'
    return 'accent'
  }

  function segTone(seg: string) {
    if (seg.startsWith('[...')) return 'rest'
    if (seg.startsWith('[')) return 'param'
    if (seg.startsWith('(')) return 'group'
    return ''
  }

  function canVisit(r: RouteInfo) {
    return r.hasPage && r.params.length === 0
  }

  function visit(r: RouteInfo) {
    window.open(new URL(r.path, location.origin).href, '_blank', 'noopener')
  }

  function primaryFile(r: RouteInfo) {
    return (
      r.files.find(f => f.type === 'page') ??
      r.files.find(f => f.type === 'endpoint') ??
      r.files[0]
    )?.path
  }

  function open(path: string | undefined) {
    if (path) openInEditor(path).catch(() => {})
  }
</script>

<Panel title="Routes" count={routes.data.length}>
  {#snippet toolbar()}
    <Segmented
      label="Route kind"
      bind:value={kind}
      options={[
        { value: 'all', label: 'All', count: counts.all },
        { value: 'pages', label: 'Pages', count: counts.pages },
        { value: 'endpoints', label: 'Endpoints', count: counts.endpoints },
        { value: 'dynamic', label: 'Dynamic', count: counts.dynamic },
      ]}
    />
    <SearchField bind:value={query} placeholder="Filter by path…" />
    <Button
      icon="expand"
      variant="ghost"
      label="Expand all"
      onclick={() =>
        (expanded = branchKeys(tree.roots, { key: n => n.key, children: n => n.children }))}
    />
    <Button
      icon="collapse"
      variant="ghost"
      label="Collapse all"
      onclick={() => (expanded = new Set(['/']))}
    />
  {/snippet}
  {#snippet actions()}
    <Button
      icon="refresh"
      variant="ghost"
      label="Rescan routes"
      disabled={routes.busy}
      onclick={() => routes.refresh()}
    />
  {/snippet}

  <SplitView id="routes" open={!!selectedRoute}>
    <TreeView
      bind:expanded
      bind:selected
      roots={routes.data.length ? tree.roots : []}
      getKey={(n: RouteNode) => n.key}
      getChildren={(n: RouteNode) => n.children}
      {filter}
      label="Route tree"
      onactivate={(n: RouteNode) => n.route && open(primaryFile(n.route))}
    >
      {#snippet row(n: RouteNode)}
        <span class="seg {segTone(n.segment)}" class:dir={!n.route}
          ><Highlight text={n.segment} {query} /></span
        >
        {#if n.route}
          <span class="kinds">
            {#if n.route.hasPage}<span class="k page" title="+page.svelte">P</span>{/if}
            {#if n.route.hasLayout}<span class="k layout" title="+layout.svelte">L</span>{/if}
            {#if n.route.hasServerPage || n.route.hasServerLayout}<span
                class="k server"
                title="server load">S</span
              >{/if}
            {#if n.route.hasPageLoad || n.route.hasLayoutLoad}<span
                class="k load"
                title="universal load">U</span
              >{/if}
            {#if n.route.hasEndpoint}<span class="k api" title="+server endpoint">API</span>{/if}
          </span>
          <span class="path truncate"><Highlight text={n.route.path} {query} /></span>
        {/if}
      {/snippet}
      {#snippet empty()}
        {#if routes.loading}
          <EmptyState title="Scanning src/routes…" />
        {:else if routes.error}
          <EmptyState icon="errors" tone="error" title="Could not read routes"
            ><p class="mono">{routes.error}</p></EmptyState
          >
        {:else if routes.data.length === 0}
          <EmptyState icon="routes" title="No routes found"
            ><p>
              Routes appear here for SvelteKit projects with a <code>src/routes</code> directory.
            </p></EmptyState
          >
        {:else}
          <EmptyState icon="search" title="No routes match" />
        {/if}
      {/snippet}
    </TreeView>
    {#snippet aside()}
      {#if selectedRoute}
        {@const r = selectedRoute}
        <Inspector
          title={r.path}
          subtitle={'src/routes' + (r.id === '/' ? '' : r.id)}
          onclose={() => (selected = null)}
        >
          {#snippet badges()}
            {#if r.hasPage}<Badge tone="accent">page</Badge>{/if}
            {#if r.hasLayout}<Badge tone="purple">layout</Badge>{/if}
            {#if r.hasEndpoint}<Badge tone="green">endpoint</Badge>{/if}
            {#if r.hasServerPage || r.hasServerLayout}<Badge tone="blue">server load</Badge>{/if}
          {/snippet}
          {#snippet actions()}
            {#if canVisit(r)}<Button icon="external" onclick={() => visit(r)}>Open page</Button
              >{/if}
          {/snippet}
          <h3 class="section-title">Matching</h3>
          <dl class="kv">
            <dt>Pattern</dt>
            <dd class="mono">{r.pattern}</dd>
            <dt>Params</dt>
            <dd>
              {#if r.params.length}
                <span class="params">
                  {#each r.params as p (p.name)}
                    <Badge tone="yellow" title={p.matcher ? `matcher: ${p.matcher}` : undefined}
                      >{p.rest ? '...' : ''}{p.name}{p.optional ? '?' : ''}{p.matcher
                        ? `=${p.matcher}`
                        : ''}</Badge
                    >
                  {/each}
                </span>
              {:else}<span class="faint">none</span>{/if}
            </dd>
          </dl>
          <h3 class="section-title">Files <span class="num">{r.files.length}</span></h3>
          <ul class="link-list">
            {#each r.files as f (f.path)}
              <li>
                <button type="button" onclick={() => open(f.path)} title="Open {f.path} in editor">
                  <Badge tone={fileTone(f.type)}>{fileLabels[f.type] ?? f.type}</Badge>
                  <span class="sub truncate mono">{f.path}</span>
                </button>
              </li>
            {/each}
          </ul>
        </Inspector>
      {/if}
    {/snippet}
  </SplitView>
</Panel>

<style>
  .seg {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    white-space: nowrap;
  }
  .seg.dir {
    color: var(--fg-muted);
  }
  .seg.param {
    color: var(--yellow);
  }
  .seg.rest {
    color: var(--purple);
  }
  .seg.group {
    color: var(--fg-faint);
    font-style: italic;
  }
  .kinds {
    display: inline-flex;
    gap: 2px;
  }
  .k {
    display: inline-grid;
    place-items: center;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 700;
  }
  .k.page {
    background: var(--bg-selected);
    color: var(--accent-fg);
  }
  .k.layout {
    background: var(--purple-bg);
    color: var(--purple);
  }
  .k.server {
    background: var(--blue-bg);
    color: var(--blue);
  }
  .k.load {
    background: var(--cyan-bg);
    color: var(--cyan);
  }
  .k.api {
    background: var(--green-bg);
    color: var(--green);
  }
  .path {
    margin-left: auto;
    padding-left: 12px;
    color: var(--fg-faint);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .params {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .link-list .sub {
    margin-left: 0;
  }
</style>
