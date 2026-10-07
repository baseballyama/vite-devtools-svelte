<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import CaptureNotice from '../components/CaptureNotice.svelte'
  import Highlight from '../components/Highlight.svelte'
  import Icon from '../components/Icon.svelte'
  import Inspector from '../components/Inspector.svelte'
  import LiveControls from '../components/LiveControls.svelte'
  import Panel from '../components/Panel.svelte'
  import ResourceEmpty from '../components/ResourceEmpty.svelte'
  import SearchField from '../components/SearchField.svelte'
  import Segmented from '../components/Segmented.svelte'
  import SplitView from '../components/SplitView.svelte'
  import VirtualList from '../components/VirtualList.svelte'
  import { captureInfo } from '../lib/capture.svelte.js'
  import { countBy, uniqueKeys } from '../lib/collections.js'
  import { formatClock, shortPath } from '../lib/format.js'
  import { matcher } from '../lib/match.js'
  import { resource } from '../lib/resource.svelte.js'
  import { getCompilerWarnings, getRuntimeErrors, clearErrors, openInEditor } from '../lib/rpc.js'
  import type { CompilerWarning, RuntimeError } from '../lib/types.js'
  import { datasetVersion } from '../lib/versions.js'

  interface Problem {
    key: string
    kind: 'error' | 'warning'
    message: string
    code?: string
    file?: string
    line?: number
    column?: number
    stack?: string
    timestamp?: number
  }

  const problems = resource(
    async () => {
      const [warnings, errors] = await Promise.all([getCompilerWarnings(), getRuntimeErrors()])
      return { warnings, errors }
    },
    {
      initial: { warnings: [] as CompilerWarning[], errors: [] as RuntimeError[] },
      interval: 3000,
      version: datasetVersion('errors'),
    },
  )

  const capture = captureInfo(3000)
  let kind = $state<'all' | 'error' | 'warning'>('all')
  let query = $state('')
  let selected = $state<string | null>(null)

  // Keys must survive polls: an index into the newest-first list would move
  // the selection to another problem whenever a new error arrives.
  const all = $derived.by<Problem[]>(() => {
    const { errors, warnings } = problems.data
    const errorKeys = uniqueKeys(errors, e => `e:${e.timestamp}`)
    const warningKeys = uniqueKeys(
      warnings,
      w => `w:${w.file}:${w.line ?? 0}:${w.column ?? 0}:${w.code}`,
    )
    const errs = errors
      .map<Problem>((e, i) => ({ ...e, key: errorKeys[i]!, kind: 'error' }))
      .reverse()
    const warns = warnings.map<Problem>((w, i) => ({ ...w, key: warningKeys[i]!, kind: 'warning' }))
    return [...errs, ...warns]
  })

  const rows = $derived.by(() => {
    const m = matcher(query)
    return all.filter(
      p => (kind === 'all' || p.kind === kind) && (!m || m(p.message, p.code, p.file)),
    )
  })

  const current = $derived(selected ? (all.find(p => p.key === selected) ?? null) : null)

  // Most frequent warning codes — a quick way to triage a noisy project.
  const topCodes = $derived(
    [...countBy(problems.data.warnings, w => w.code)].sort((a, b) => b[1] - a[1]).slice(0, 4),
  )

  function open(p: Problem) {
    if (p.file) openInEditor(p.file, p.line).catch(() => {})
  }

  async function clear() {
    await clearErrors().catch(() => {})
    problems.set({ warnings: [], errors: [] })
    selected = null
  }

  const loc = (p: Problem) =>
    p.file
      ? `${shortPath(p.file, 3)}${p.line ? `:${p.line}` : ''}${p.column ? `:${p.column}` : ''}`
      : ''
</script>

<Panel title="Problems" count={all.length}>
  {#snippet toolbar()}
    <Segmented
      label="Severity"
      bind:value={kind}
      options={[
        { value: 'all', label: 'All', count: all.length },
        { value: 'error', label: 'Errors', count: problems.data.errors.length },
        { value: 'warning', label: 'Warnings', count: problems.data.warnings.length },
      ]}
    />
    <SearchField
      bind:value={query}
      placeholder="Filter by message, code or file…"
      count={rows.length}
    />
    <CaptureNotice info={capture.data.runtimeErrors} noun="runtime errors" />
    <CaptureNotice info={capture.data.compilerWarnings} noun="warnings" />
    {#each topCodes as [code, n] (code)}
      <button
        type="button"
        class="chip"
        class:on={query === code}
        onclick={() => (query = query === code ? '' : code)}
        title="Filter by {code}"
      >
        {code}<span class="num">{n}</span>
      </button>
    {/each}
  {/snippet}
  {#snippet actions()}
    <LiveControls res={problems} onclear={clear} />
  {/snippet}

  <SplitView id="problems" open={!!current}>
    <VirtualList
      items={rows}
      getKey={(p: Problem) => p.key}
      bind:selected
      rowHeight={44}
      label="Problems"
      onactivate={open}
    >
      {#snippet row(p: Problem)}
        <span class="sev {p.kind}"
          ><Icon name={p.kind === 'error' ? 'errors' : 'warning'} size={14} /></span
        >
        <span class="text">
          <span class="msg truncate"><Highlight text={p.message} {query} /></span>
          <span class="meta">
            {#if p.code}<span class="code mono"><Highlight text={p.code} {query} /></span>{/if}
            {#if p.file}<span class="loc mono truncate"><Highlight text={loc(p)} {query} /></span
              >{/if}
            {#if p.timestamp}<span class="faint num">{formatClock(p.timestamp)}</span>{/if}
          </span>
        </span>
        {#if p.file}
          <button
            type="button"
            class="open"
            tabindex="-1"
            title="Open in editor"
            onclick={e => (e.stopPropagation(), open(p))}><Icon name="editor" size={13} /></button
          >
        {/if}
      {/snippet}
      {#snippet empty()}
        <ResourceEmpty
          res={problems}
          total={all.length}
          loading="Collecting diagnostics…"
          failed="Could not load problems"
          icon="check"
          title="No problems"
          noMatch="No problems match"
        >
          <p>Compiler warnings and runtime errors from your app show up here as they happen.</p>
        </ResourceEmpty>
      {/snippet}
    </VirtualList>
    {#snippet aside()}
      {#if current}
        <Inspector
          title={current.kind === 'error' ? 'Runtime error' : (current.code ?? 'Warning')}
          subtitle={loc(current)}
          onclose={() => (selected = null)}
        >
          {#snippet badges()}
            <Badge tone={current.kind === 'error' ? 'red' : 'yellow'}>{current.kind}</Badge>
            {#if current.timestamp}<Badge>{formatClock(current.timestamp, true)}</Badge>{/if}
          {/snippet}
          {#snippet actions()}
            {#if current.file}<Button icon="editor" onclick={() => open(current)}
                >Open {current.line ? `line ${current.line}` : 'file'}</Button
              >{/if}
          {/snippet}
          <h3 class="section-title">Message</h3>
          <p class="message">{current.message}</p>
          {#if current.stack}
            <h3 class="section-title">Stack</h3>
            <pre class="code-block">{current.stack}</pre>
          {/if}
          {#if current.code}
            <h3 class="section-title">Reference</h3>
            <p class="message">
              <a
                href="https://svelte.dev/docs/svelte/compiler-warnings#{current.code}"
                target="_blank"
                rel="noopener noreferrer">svelte.dev — {current.code}</a
              >
            </p>
          {/if}
        </Inspector>
      {/if}
    {/snippet}
  </SplitView>
</Panel>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    max-width: 220px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chip:hover,
  .chip.on {
    border-color: var(--yellow);
    color: var(--yellow);
  }
  .chip .num {
    color: var(--fg-faint);
  }
  .sev {
    display: grid;
    place-items: center;
    align-self: flex-start;
    margin-top: 6px;
  }
  .sev.error {
    color: var(--red);
  }
  .sev.warning {
    color: var(--yellow);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .msg {
    color: var(--fg);
  }
  .meta {
    display: flex;
    gap: 10px;
    font-size: var(--fs-xs);
    min-width: 0;
  }
  .code {
    color: var(--yellow);
    white-space: nowrap;
  }
  .loc {
    color: var(--fg-muted);
  }
  .open {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg-faint);
    opacity: 0;
  }
  :global([role='option']:hover) .open,
  :global([role='option'][aria-selected='true']) .open {
    opacity: 1;
  }
  .open:hover {
    background: var(--bg-active);
    color: var(--fg);
  }
  .message {
    margin: 0;
    padding: 0 14px;
    font-size: var(--fs-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .message a {
    color: var(--accent-fg);
  }
</style>
