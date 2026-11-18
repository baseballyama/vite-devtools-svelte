<script lang="ts">
  import Button from '../components/Button.svelte';
  import CodePane from '../components/CodePane.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Highlight from '../components/Highlight.svelte';
  import Panel from '../components/Panel.svelte';
  import ResourceEmpty from '../components/ResourceEmpty.svelte';
  import SearchField from '../components/SearchField.svelte';
  import SplitView from '../components/SplitView.svelte';
  import TreeView from '../components/TreeView.svelte';
  import type { CodePaneApi } from '../components/types.js';
  import { buildFileTree, type FileNode } from '../lib/file-tree.js';
  import { errorMessage, shortPath } from '../lib/format.js';
  import { highlightJS, highlightSvelte } from '../lib/highlight.js';
  import { matcher } from '../lib/match.js';
  import { resource } from '../lib/resource.svelte.js';
  import { getSvelteFiles, inspectFile, openInEditor, type SvelteFileEntry } from '../lib/rpc.js';
  import { parseLineMappings, type LineMaps } from '../lib/sourcemap.js';
  import { branchKeys } from '../lib/tree.js';
  import type { InspectResult } from '../lib/types.js';

  const LH = 18;

  const files = resource<SvelteFileEntry[]>(getSvelteFiles, { initial: [] });

  let query = $state('');
  let selected = $state<string | null>(null);
  let result = $state.raw<InspectResult | null>(null);
  let maps = $state.raw<LineMaps | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let srcHl = $state(new Set<number>());
  let outHl = $state(new Set<number>());
  let origin = $state<'source' | 'compiled' | null>(null);
  let srcTop = $state(0);
  let outTop = $state(0);
  let gutterH = $state(0);
  let srcPane = $state<CodePaneApi | null>(null);
  let outPane = $state<CodePaneApi | null>(null);
  let codeWidth = $state(1000);

  const tree = $derived(buildFileTree(files.data));
  let expanded = $state(new Set<string>());
  let seeded = false;
  $effect(() => {
    if (seeded || tree.length === 0) return;
    seeded = true;
    expanded = branchKeys(tree, { key: n => n.key, children: n => n.children });
  });

  const match = $derived(matcher(query));
  const filter = $derived(match && ((n: FileNode) => !!n.file && match(n.file.name, n.file.file)));
  const matches = $derived(
    match ? files.data.filter(f => match(f.name, f.file)).length : files.data.length,
  );

  const srcHtml = $derived(result ? highlightSvelte(result.source.split('\n')) : []);
  const outHtml = $derived(result ? highlightJS(result.compiled.split('\n')) : []);
  const stacked = $derived(codeWidth < 700);

  let token = 0;
  async function load(file: string) {
    const my = ++token;
    loading = true;
    error = null;
    srcHl = new Set();
    outHl = new Set();
    origin = null;
    try {
      const r = await inspectFile(file);
      if (my !== token) return;
      result = r;
      maps = r.mappings ? parseLineMappings(r.mappings) : null;
    } catch (e) {
      if (my !== token) return;
      result = null;
      maps = null;
      error = errorMessage(e);
    } finally {
      if (my === token) loading = false;
    }
  }

  function clickSource(ln: number) {
    origin = 'source';
    srcHl = new Set([ln]);
    const m = maps?.sourceToCompiled.get(ln);
    outHl = new Set(m ?? []);
    if (m?.size) outPane?.scrollToLine(Math.min(...m));
  }

  function clickCompiled(ln: number) {
    origin = 'compiled';
    outHl = new Set([ln]);
    const m = maps?.compiledToSource.get(ln);
    srcHl = new Set(m ?? []);
    if (m?.size) srcPane?.scrollToLine(Math.min(...m));
  }

  // Bezier connectors between linked lines, in gutter coordinates.
  const links = $derived.by(() => {
    if (!maps || stacked) return [];
    const out: { a: number; b: number }[] = [];
    const from = origin === 'compiled' ? outHl : srcHl;
    for (const ln of from) {
      const targets =
        origin === 'compiled' ? maps.compiledToSource.get(ln) : maps.sourceToCompiled.get(ln);
      for (const t of targets ?? []) {
        const [s, c] = origin === 'compiled' ? [t, ln] : [ln, t];
        out.push({ a: (s - 0.5) * LH - srcTop, b: (c - 0.5) * LH - outTop });
      }
    }
    return out
      .filter(l => (l.a > -LH || l.b > -LH) && (l.a < gutterH + LH || l.b < gutterH + LH))
      .slice(0, 200);
  });
</script>

<Panel title="Compiled output">
  {#snippet toolbar()}
    <SearchField bind:value={query} placeholder="Find a .svelte file…" count={matches} />
    {#if result}
      <span class="file mono truncate" title={result.file}>{shortPath(result.file, 3)}</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if result}
      <Button
        icon="editor"
        variant="ghost"
        label="Open source in editor"
        onclick={() => openInEditor(result!.file).catch(() => {})}
      />
      <Button
        icon="refresh"
        variant="ghost"
        label="Recompile"
        disabled={loading}
        onclick={() => load(result!.file)}
      />
    {/if}
  {/snippet}

  <SplitView id="inspect" side="start" initial={280} min={180} open>
    <div class="code" class:stacked bind:clientWidth={codeWidth} aria-busy={loading}>
      {#if error}
        <EmptyState title="Could not compile this file" {error} />
      {:else if !result}
        <EmptyState icon="inspect" title={loading ? 'Compiling…' : 'Pick a component'}>
          {#if !loading}<p>
              See exactly what the Svelte compiler emits. Click a line to see the code it compiles
              to.
            </p>{/if}
        </EmptyState>
      {:else}
        <CodePane
          bind:this={srcPane}
          bind:scrollTop={srcTop}
          title="Source"
          html={srcHtml}
          highlighted={srcHl}
          origin={origin === 'source'}
          lineHeight={LH}
          onlineclick={clickSource}
        />
        {#if !stacked}
          <div class="gutter" bind:clientHeight={gutterH} aria-hidden="true">
            <svg width="100%" height="100%" preserveAspectRatio="none">
              {#each links as l, i (i)}
                <path d="M0 {l.a + 28} C 24 {l.a + 28}, 24 {l.b + 28}, 48 {l.b + 28}" />
              {/each}
            </svg>
          </div>
        {/if}
        <CodePane
          bind:this={outPane}
          bind:scrollTop={outTop}
          title="Compiled JS"
          html={outHtml}
          highlighted={outHl}
          origin={origin === 'compiled'}
          lineHeight={LH}
          onlineclick={clickCompiled}
        />
      {/if}
    </div>
    {#snippet aside()}
      <TreeView
        bind:expanded
        bind:selected
        roots={tree}
        getKey={(n: FileNode) => n.key}
        getChildren={(n: FileNode) => n.children}
        {filter}
        label="Svelte files"
        onselect={(n: FileNode) => n.file && load(n.file.file)}
      >
        {#snippet row(n: FileNode)}
          <span class="truncate" class:dir={!n.file}><Highlight text={n.label} {query} /></span>
        {/snippet}
        {#snippet empty()}
          <ResourceEmpty
            res={files}
            total={files.data.length}
            loading="Listing files…"
            failed="Could not list files"
            icon="inspect"
            title="No .svelte files"
            noMatch="No files match"
          />
        {/snippet}
      </TreeView>
    {/snippet}
  </SplitView>
</Panel>

<style>
  .file {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    max-width: 320px;
  }
  .code {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }
  .code.stacked {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .code.stacked > :global(.pane + .pane) {
    border-top: 1px solid var(--border);
  }
  .code:has(> :global(.empty)) {
    display: block;
  }
  .gutter {
    position: relative;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    background: var(--bg-subtle);
  }
  .gutter svg {
    position: absolute;
    inset: 0;
  }
  .gutter path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    opacity: 0.75;
  }
  .dir {
    color: var(--fg-muted);
  }
</style>
