<script lang="ts">
  import { getComponentRelations, getLiveComponents, getLiveComponentsMeta, openInEditor } from '../lib/rpc.js'
  import type { ComponentInstance, ComponentRelation, LiveComponentsMeta } from '../lib/types.js'
  import { resource } from '../lib/resource.svelte.js'
  import { persisted } from '../lib/persisted.svelte.js'
  import { matcher } from '../lib/match.js'
  import { untrack } from 'svelte'
  import { branchKeys, remapAcross } from '../lib/tree.js'
  import { componentName, shortPath } from '../lib/format.js'
  import Panel from '../components/Panel.svelte'
  import SplitView from '../components/SplitView.svelte'
  import TreeView from '../components/TreeView.svelte'
  import DataTable, { type Column, type SortState } from '../components/DataTable.svelte'
  import Inspector from '../components/Inspector.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import Button from '../components/Button.svelte'
  import Badge from '../components/Badge.svelte'
  import Highlight from '../components/Highlight.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import CaptureNotice from '../components/CaptureNotice.svelte'
  import type { CaptureInfo } from '../lib/capture.svelte.js'
  import { datasetVersion } from '../lib/versions.js'
  import { router } from '../lib/router.svelte.js'
  import { reactiveScope } from '../lib/reactive-selection.svelte.js'

  type Mode = 'tree' | 'files'
  const mode = persisted<Mode>('components:mode', 'tree')
  let query = $state('')

  // ---- Live instance tree -------------------------------------------------
  // Polled in both modes: Files mode shows per-file mounted counts too.
  //
  // Instance ids restart per app page load, so a snapshot carries the epoch
  // (page load) it came from. The meta is read before and after the list:
  // if the served epoch flipped in between (two app tabs), the epoch is
  // `null` = unknown, and ids of that snapshot are never compared.
  interface LiveSnapshot {
    list: ComponentInstance[]
    meta: LiveComponentsMeta | null
    epoch: string | null
  }
  const live = resource<LiveSnapshot>(
    async () => {
      const before = await getLiveComponentsMeta()
      const list = await getLiveComponents()
      const meta = await getLiveComponentsMeta()
      return { list, meta, epoch: before.epoch === meta.epoch ? (meta.epoch ?? '') : null }
    },
    { initial: { list: [], meta: null, epoch: '' }, interval: 2000, version: datasetVersion('components') },
  )
  const liveList = $derived(live.data.list)

  interface LiveNode {
    c: ComponentInstance
    key: string
    children: LiveNode[]
  }

  // Rows are keyed by a path (`Parent#0/Name#ordinal`, ordinal among
  // same-name siblings). Tree state is *anchored* by instance id though:
  // on every snapshot the selection and expanded set are carried over with
  // `remapKeys` — a live id wins (so removing an earlier same-name sibling,
  // which shifts ordinals, never moves the selection to a neighbour) and
  // the path is used only for fresh ids, i.e. HMR remounts (review U4b).
  // Tree order is registration order, which can differ from DOM order
  // after keyed reorders.
  const tree = $derived.by(() => {
    const byId = new Map<number, LiveNode>()
    for (const c of liveList) byId.set(c.id, { c, key: '', children: [] })
    const roots: LiveNode[] = []
    // A parent outside the server's bounded capture leaves its subtree
    // without an anchor: surface it as a root, flagged as detached.
    const detachedNodes = new Set<LiveNode>()
    for (const node of byId.values()) {
      const parent = node.c.parentId != null ? byId.get(node.c.parentId) : undefined
      if (parent) parent.children.push(node)
      else {
        roots.push(node)
        if (node.c.parentId != null) detachedNodes.add(node)
      }
    }
    const byKey = new Map<string, LiveNode>()
    const assign = (nodes: LiveNode[], prefix: string) => {
      const seen = new Map<string, number>()
      for (const n of nodes) {
        const ord = seen.get(n.c.name) ?? 0
        seen.set(n.c.name, ord + 1)
        n.key = `${prefix}${detachedNodes.has(n) ? '~' : ''}${n.c.name}#${ord}`
        byKey.set(n.key, n)
        if (n.children.length) assign(n.children, n.key + '/')
      }
    }
    assign(roots, '')
    const detached = new Set([...detachedNodes].map((n) => n.key))
    return { roots, byId, byKey, detached, epoch: live.data.epoch }
  })

  const capture = $derived.by<CaptureInfo | null>(() => {
    const m = live.data.meta
    return m ? { captured: m.kept, total: m.total, truncated: m.truncated, policy: 'parents first' } : null
  })

  const instancesPerFile = $derived.by(() => {
    const m = new Map<string, number>()
    for (const c of liveList) m.set(c.file, (m.get(c.file) ?? 0) + 1)
    return m
  })

  let expanded = $state(new Set<string>())
  let treeSelected = $state<string | null>(null)
  let treeView = $state<TreeView<LiveNode> | null>(null)
  let seeded = false

  // Carry selection / expansion across snapshots (see `tree` above);
  // across an epoch change only paths are used (`remapAcross`).
  let prevTree: typeof tree | null = null
  const idOf = (n: LiveNode) => n.c.id
  const keyOf = (n: LiveNode) => n.key
  $effect.pre(() => {
    const next = tree
    untrack(() => {
      const prev = prevTree
      prevTree = next
      if (!prev || prev === next) return
      if (expanded.size) {
        const keys = remapAcross(expanded, prev, next, idOf, keyOf)
        // Skip the reassignment when nothing moved, so TreeView does not
        // re-flatten on every poll.
        if (keys.length !== expanded.size || keys.some((k) => !expanded.has(k))) expanded = new Set(keys)
      }
      if (treeSelected != null) treeSelected = remapAcross([treeSelected], prev, next, idOf, keyOf)[0] ?? null
    })
  })

  // Open the first three levels once, the first time data arrives.
  $effect(() => {
    if (seeded || tree.roots.length === 0) return
    seeded = true
    const next = new Set<string>()
    const walk = (nodes: LiveNode[], d: number) => {
      if (d > 2) return
      for (const n of nodes) if (n.children.length) (next.add(n.key), walk(n.children, d + 1))
    }
    walk(tree.roots, 0)
    expanded = next
  })

  const treeFilter = $derived.by(() => {
    const m = matcher(query)
    return m ? (n: LiveNode) => m(n.c.name, n.c.file) : null
  })

  const treeMatches = $derived(treeFilter ? liveList.filter((c) => treeFilter({ c } as LiveNode)).length : null)

  const selectedNode = $derived(treeSelected != null ? (tree.byKey.get(treeSelected) ?? null) : null)

  function ancestorsOf(id: number): LiveNode[] {
    const out: LiveNode[] = []
    let cur = tree.byId.get(id)
    while (cur && cur.c.parentId != null) {
      const p = tree.byId.get(cur.c.parentId)
      if (!p) break
      out.unshift(p)
      cur = p
    }
    return out
  }

  function revealInstance(id: number) {
    const node = tree.byId.get(id)
    if (!node) return
    treeView?.reveal(
      node.key,
      ancestorsOf(id).map((a) => a.key),
    )
  }

  // ---- Static file relations ---------------------------------------------
  const relations = resource<ComponentRelation[]>(getComponentRelations, {
    initial: [],
    when: () => mode.value === 'files' || treeSelected != null,
  })

  const importers = $derived.by(() => {
    const m = new Map<string, ComponentRelation[]>()
    for (const r of relations.data)
      for (const imp of r.imports) {
        const list = m.get(imp)
        if (list) list.push(r)
        else m.set(imp, [r])
      }
    return m
  })

  const relationByFile = $derived(new Map(relations.data.map((r) => [r.file, r])))

  const fileRows = $derived.by(() => {
    const m = matcher(query)
    return m ? relations.data.filter((r) => m(r.name, r.file)) : relations.data
  })

  let fileSort = $state<SortState | null>({ id: 'name', desc: false })
  let fileSelected = $state<string | null>(null)
  const selectedFile = $derived(fileSelected ? (relationByFile.get(fileSelected) ?? null) : null)

  const columns: Column<ComponentRelation>[] = [
    { id: 'name', label: 'Component', width: 'minmax(0, 1fr)', sort: (a, b) => a.name.localeCompare(b.name) },
    { id: 'imports', label: 'Imports', width: '72px', align: 'end', descFirst: true, sort: (a, b) => a.imports.length - b.imports.length },
    { id: 'used', label: 'Used by', width: '72px', align: 'end', descFirst: true, sort: (a, b) => (importers.get(a.file)?.length ?? 0) - (importers.get(b.file)?.length ?? 0) },
    { id: 'live', label: 'Mounted', width: '72px', align: 'end', descFirst: true, minWidth: 520, sort: (a, b) => (instancesPerFile.get(a.file) ?? 0) - (instancesPerFile.get(b.file) ?? 0) },
  ]

  /**
   * The page load this snapshot's ids belong to: set only when the meta read
   * before and after the list agree (`live.data.epoch`). `null` means the
   * served page load changed in between; the snapshot is refetched.
   */
  const liveEpoch = $derived(live.data.epoch || null)
  $effect(() => {
    if (live.data.epoch === null) untrack(() => live.refresh())
  })

  /** Scope Reactivity to this instance (§6.7 A) with the validated page load its id belongs to. */
  function showReactivity(c: ComponentInstance) {
    if (!liveEpoch) return
    reactiveScope.set({ componentId: c.id, epoch: liveEpoch, label: `<${c.name}>`, file: c.file })
    router.go('reactive')
  }

  function open(file: string) {
    openInEditor(file).catch(() => {})
  }

  function showFile(file: string) {
    mode.value = 'files'
    query = ''
    fileSelected = file
  }

  function showInstancesOf(file: string) {
    const first = liveList.find((c) => c.file === file)
    mode.value = 'tree'
    query = ''
    if (first) queueMicrotask(() => revealInstance(first.id))
  }
</script>

<Panel title="Components" count={mode.value === 'tree' ? liveList.length : relations.data.length}>
  {#snippet toolbar()}
    <Segmented
      label="View"
      bind:value={mode.value}
      options={[
        { value: 'tree', label: 'Live tree' },
        { value: 'files', label: 'Files' },
      ]}
    />
    <SearchField
      bind:value={query}
      placeholder={mode.value === 'tree' ? 'Filter instances…' : 'Filter components…'}
      count={mode.value === 'tree' ? treeMatches : fileRows.length}
    />
    {#if mode.value === 'tree'}
      <CaptureNotice info={capture} noun="components" detached={tree.detached.size} />
      <Button icon="expand" variant="ghost" label="Expand all" onclick={() => (expanded = branchKeys(tree.roots, { key: (n) => n.key, children: (n) => n.children }))} />
      <Button icon="collapse" variant="ghost" label="Collapse all" onclick={() => (expanded = new Set())} />
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if mode.value === 'tree'}
      <LiveControls res={live} />
    {:else}
      <Button icon="refresh" variant="ghost" label="Re-analyze" disabled={relations.busy} onclick={() => relations.refresh()} />
    {/if}
  {/snippet}

  {#if mode.value === 'tree'}
    <SplitView id="components-tree" open={!!selectedNode}>
      {#if live.error && liveList.length === 0}
        <EmptyState icon="errors" tone="error" title="Could not read live components"><p class="mono">{live.error}</p></EmptyState>
      {:else}
        <TreeView
          bind:this={treeView}
          bind:expanded
          bind:selected={treeSelected}
          roots={tree.roots}
          getKey={(n) => n.key}
          getChildren={(n) => n.children}
          filter={treeFilter}
          label="Mounted component tree"
          onactivate={(n) => open(n.c.file)}
        >
          {#snippet row(n, r)}
            <span class="tag" class:dim={!n.c.mounted}>
              <span class="lt">&lt;</span><Highlight text={n.c.name} {query} /><span class="lt">&gt;</span>
            </span>
            <span class="file truncate"><Highlight text={shortPath(n.c.file)} {query} /></span>
            {#if tree.detached.has(n.key)}<span class="detached" title="Parent #{n.c.parentId} is outside the captured set">detached</span>{/if}
            {#if r.hasChildren && !r.expanded}<span class="kids num">{n.children.length}</span>{/if}
          {/snippet}
          {#snippet empty()}
            {#if live.loading}
              <EmptyState title="Connecting to the app…" />
            {:else if query}
              <EmptyState icon="search" title="No instances match “{query}”" />
            {:else}
              <EmptyState icon="components" title="No mounted components">
                <p>Open your app in another tab — the tree updates live as components mount and unmount.</p>
                <Button onclick={() => (mode.value = 'files')}>Browse component files instead</Button>
              </EmptyState>
            {/if}
          {/snippet}
        </TreeView>
      {/if}
      {#snippet aside()}
        {#if selectedNode}
          {@const c = selectedNode.c}
          {@const rel = relationByFile.get(c.file)}
          {@const ancestors = ancestorsOf(c.id)}
          <Inspector title="<{c.name}>" subtitle={c.file} onclose={() => (treeSelected = null)}>
            {#snippet badges()}
              <Badge tone={c.mounted ? 'green' : 'neutral'}>{c.mounted ? 'mounted' : 'unmounted'}</Badge>
              <Badge>#{c.id}</Badge>
            {/snippet}
            {#snippet actions()}
              <Button icon="editor" onclick={() => open(c.file)}>Open in editor</Button>
              {#if c.mounted}
                <Button icon="reactive" disabled={!liveEpoch} onclick={() => showReactivity(c)}>
                  {liveEpoch ? 'Show reactivity' : 'Show reactivity (waiting for a consistent snapshot)'}
                </Button>
              {/if}
            {/snippet}

            {#if ancestors.length}
              <h3 class="section-title">Ancestors</h3>
              <ol class="crumbs">
                {#each ancestors as a (a.key)}
                  <li><button onclick={() => revealInstance(a.c.id)}>{a.c.name}</button></li>
                {/each}
                <li aria-current="true">{c.name}</li>
              </ol>
            {/if}

            <h3 class="section-title">Instance</h3>
            <dl class="kv">
              <dt>Children</dt><dd class="num">{selectedNode.children.length}</dd>
              <dt>Same file</dt>
              <dd>
                <button class="link" onclick={() => showFile(c.file)}>
                  {instancesPerFile.get(c.file) ?? 1} mounted instance{(instancesPerFile.get(c.file) ?? 1) === 1 ? '' : 's'}
                </button>
              </dd>
            </dl>

            {#if selectedNode.children.length}
              <h3 class="section-title">Children <span class="num">{selectedNode.children.length}</span></h3>
              <ul class="link-list">
                {#each selectedNode.children.slice(0, 200) as ch (ch.key)}
                  <li>
                    <button onclick={() => revealInstance(ch.c.id)}>
                      <span class="truncate">{ch.c.name}</span><span class="sub mono">#{ch.c.id}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if rel && rel.imports.length}
              <h3 class="section-title">Imports <span class="num">{rel.imports.length}</span></h3>
              <ul class="link-list">
                {#each rel.imports as imp (imp)}
                  <li><button onclick={() => open(imp)} title="Open {imp}"><span class="truncate">{componentName(imp)}</span><span class="sub truncate">{shortPath(imp)}</span></button></li>
                {/each}
              </ul>
            {/if}
          </Inspector>
        {/if}
      {/snippet}
    </SplitView>
  {:else}
    <SplitView id="components-files" open={!!selectedFile}>
      <DataTable
        items={fileRows}
        {columns}
        getKey={(r) => r.file}
        bind:sort={fileSort}
        bind:selected={fileSelected}
        label="Component files"
        onactivate={(r) => open(r.file)}
      >
        {#snippet row(r, { visible })}
          <span class="name-cell">
            <span class="cname"><Highlight text={r.name} {query} /></span>
            <span class="file truncate"><Highlight text={r.file} {query} /></span>
          </span>
          <span class="end num muted">{r.imports.length || ''}</span>
          <span class="end num muted">{importers.get(r.file)?.length || ''}</span>
          {#if visible.has('live')}<span class="end num" class:faint={!instancesPerFile.get(r.file)}>{instancesPerFile.get(r.file) ?? '–'}</span>{/if}
        {/snippet}
        {#snippet empty()}
          {#if relations.loading}
            <EmptyState title="Analyzing components…" />
          {:else if relations.error}
            <EmptyState icon="errors" tone="error" title="Analysis failed"><p class="mono">{relations.error}</p></EmptyState>
          {:else}
            <EmptyState icon="search" title={query ? `No components match “${query}”` : 'No .svelte files found'} />
          {/if}
        {/snippet}
      </DataTable>
      {#snippet aside()}
        {#if selectedFile}
          {@const users = importers.get(selectedFile.file) ?? []}
          <Inspector title={selectedFile.name} subtitle={selectedFile.file} onclose={() => (fileSelected = null)}>
            {#snippet actions()}
              {#if instancesPerFile.get(selectedFile.file)}
                <Button icon="tree" onclick={() => showInstancesOf(selectedFile.file)}>Show in tree</Button>
              {/if}
              <Button icon="editor" onclick={() => open(selectedFile.file)}>Open in editor</Button>
            {/snippet}
            <h3 class="section-title">Imports <span class="num">{selectedFile.imports.length}</span></h3>
            {#if selectedFile.imports.length}
              <ul class="link-list">
                {#each selectedFile.imports as imp (imp)}
                  <li>
                    <button onclick={() => (relationByFile.has(imp) ? (fileSelected = imp) : open(imp))}>
                      <span class="truncate">{componentName(imp)}</span><span class="sub truncate">{shortPath(imp)}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}<p class="none">Imports no other components.</p>{/if}
            <h3 class="section-title">Used by <span class="num">{users.length}</span></h3>
            {#if users.length}
              <ul class="link-list">
                {#each users as u (u.file)}
                  <li><button onclick={() => (fileSelected = u.file)}><span class="truncate">{u.name}</span><span class="sub truncate">{shortPath(u.file)}</span></button></li>
                {/each}
              </ul>
            {:else}<p class="none">Not imported by any component (route or entry).</p>{/if}
          </Inspector>
        {/if}
      {/snippet}
    </SplitView>
  {/if}
</Panel>

<style>
  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--accent-fg);
    white-space: nowrap;
  }
  .tag.dim {
    opacity: 0.5;
  }
  .lt {
    color: var(--fg-faint);
  }
  .file {
    color: var(--fg-faint);
    font-size: var(--fs-xs);
  }
  .detached {
    padding: 0 5px;
    border-radius: var(--radius-sm);
    background: var(--yellow-bg);
    color: var(--yellow);
    font-size: var(--fs-2xs);
  }
  .kids {
    margin-left: auto;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--bg-active);
    color: var(--fg-muted);
    font-size: var(--fs-2xs);
  }
  .name-cell {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .cname {
    font-weight: 500;
    white-space: nowrap;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 0;
    list-style: none;
    margin: 0;
    padding: 0 14px;
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
  }
  .crumbs li:not(:last-child)::after {
    content: '›';
    margin: 0 4px;
    color: var(--fg-faint);
  }
  .crumbs button,
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-muted);
    font: inherit;
  }
  .crumbs button:hover,
  .link:hover {
    color: var(--accent-fg);
    text-decoration: underline;
  }
  .crumbs [aria-current] {
    color: var(--fg);
  }
  .none {
    margin: 0;
    padding: 0 14px;
    color: var(--fg-faint);
    font-size: var(--fs-sm);
  }
</style>
