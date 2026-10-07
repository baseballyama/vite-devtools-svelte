<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Highlight from '../components/Highlight.svelte'
  import Panel from '../components/Panel.svelte'
  import SearchField from '../components/SearchField.svelte'
  import SplitView from '../components/SplitView.svelte'
  import type { Tone } from '../components/types.js'
  import VirtualList from '../components/VirtualList.svelte'
  import { formatBytes, formatMs } from '../lib/format.js'
  import { matcher } from '../lib/match.js'
  import { resource } from '../lib/resource.svelte.js'
  import { getApiEndpoints, sendApiRequest, openInEditor } from '../lib/rpc.js'
  import type { ApiEndpoint, ApiResponse } from '../lib/types.js'

  const endpoints = resource<ApiEndpoint[]>(getApiEndpoints, { initial: [] })

  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  const methodTone = (m: string): Tone =>
    m === 'GET'
      ? 'blue'
      : m === 'POST'
        ? 'green'
        : m === 'DELETE'
          ? 'red'
          : m === 'HEAD' || m === 'OPTIONS'
            ? 'neutral'
            : 'yellow'

  let query = $state('')
  let selected = $state<string | null>(null)
  let method = $state('GET')
  let url = $state('')
  let headers = $state('{\n  \n}')
  let body = $state('')
  let tab = $state<'body' | 'headers'>('body')
  let sending = $state(false)
  let response = $state<ApiResponse | null>(null)
  let requestError = $state<string | null>(null)

  const rows = $derived.by(() => {
    const m = matcher(query)
    return m ? endpoints.data.filter(e => m(e.path, e.route, e.methods.join(' '))) : endpoints.data
  })
  const current = $derived(
    selected ? (endpoints.data.find(e => e.route === selected) ?? null) : null,
  )

  const headersError = $derived.by(() => {
    if (!headers.trim()) return null
    try {
      const v: unknown = JSON.parse(headers)
      return v && typeof v === 'object' && !Array.isArray(v)
        ? null
        : 'Headers must be a JSON object'
    } catch (e) {
      return (e as Error).message
    }
  })

  const hasBody = $derived(method !== 'GET' && method !== 'HEAD')

  const pretty = $derived.by(() => {
    if (!response?.body) return ''
    const ct =
      Object.entries(response.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
    const first = response.body.trimStart()[0]
    if (ct.includes('json') || first === '[' || first === '{') {
      try {
        return JSON.stringify(JSON.parse(response.body), null, 2)
      } catch {}
    }
    return response.body
  })

  function pick(e: ApiEndpoint) {
    selected = e.route
    method = e.methods[0] ?? 'GET'
    url = new URL(e.path, location.origin).href
    response = null
    requestError = null
  }

  async function send() {
    if (!url || headersError || sending) return
    sending = true
    requestError = null
    try {
      response = await sendApiRequest(url, method, headers.trim() || '{}', hasBody ? body : '')
    } catch (e) {
      response = null
      requestError = e instanceof Error ? e.message : String(e)
    } finally {
      sending = false
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void send()
    }
  }

  function statusTone(s: number): Tone {
    return s >= 200 && s < 300
      ? 'green'
      : s >= 300 && s < 400
        ? 'yellow'
        : s >= 400
          ? 'red'
          : 'neutral'
  }
</script>

<Panel title="API" count={endpoints.data.length}>
  {#snippet toolbar()}
    <SearchField bind:value={query} placeholder="Filter endpoints…" count={rows.length} />
  {/snippet}
  {#snippet actions()}
    <Button
      icon="refresh"
      variant="ghost"
      label="Rescan endpoints"
      disabled={endpoints.busy}
      onclick={() => endpoints.refresh()}
    />
  {/snippet}

  <SplitView id="api" side="start" initial={300} min={200}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="client" {onkeydown}>
      <form
        class="bar"
        onsubmit={e => {
          e.preventDefault()
          void send()
        }}
      >
        <select class="select method" bind:value={method} aria-label="HTTP method">
          {#each current?.methods.length ? current.methods : METHODS as m (m)}<option>{m}</option
            >{/each}
        </select>
        <input
          class="input url mono"
          bind:value={url}
          placeholder="http://localhost:5173/api/…"
          aria-label="Request URL"
          spellcheck="false"
        />
        <Button
          type="submit"
          variant="primary"
          icon="send"
          disabled={!url || !!headersError || sending}
          title="Send (⌘↵)"
        >
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </form>

      <div class="tabs" role="tablist" aria-label="Request parts">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'body'}
          onclick={() => (tab = 'body')}>Body</button
        >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'headers'}
          onclick={() => (tab = 'headers')}
        >
          Headers {#if headersError}<span class="err-dot" title={headersError}></span>{/if}
        </button>
        {#if current}
          <button
            type="button"
            class="file mono"
            onclick={() => openInEditor(current.file).catch(() => {})}
            title="Open handler in editor">{current.file}</button
          >
        {/if}
      </div>
      <div class="req" role="tabpanel">
        {#if tab === 'body'}
          {#if hasBody}
            <textarea
              class="input editor"
              bind:value={body}
              placeholder={'{ "name": "value" }'}
              aria-label="Request body"
              spellcheck="false"></textarea>
          {:else}
            <p class="hint">{method} requests have no body.</p>
          {/if}
        {:else}
          <textarea
            class="input editor"
            bind:value={headers}
            aria-label="Request headers as JSON"
            aria-invalid={!!headersError}
            spellcheck="false"></textarea>
          {#if headersError}<p class="hint error">{headersError}</p>{/if}
        {/if}
      </div>

      <section class="res" aria-label="Response" aria-live="polite">
        {#if requestError}
          <EmptyState icon="errors" tone="error" title="Request failed"
            ><p class="mono">{requestError}</p></EmptyState
          >
        {:else if response}
          <header class="res-head">
            <Badge tone={statusTone(response.status)}>{response.status} {response.statusText}</Badge
            >
            <span class="num muted">{formatMs(response.duration)}</span>
            <span class="num muted">{formatBytes(new Blob([response.body]).size)}</span>
            <details class="hdrs">
              <summary>{Object.keys(response.headers).length} headers</summary>
              <dl class="kv">
                {#each Object.entries(response.headers) as [k, v] (k)}<dt class="mono">{k}</dt>
                  <dd class="mono">{v}</dd>{/each}
              </dl>
            </details>
          </header>
          <pre class="body mono">{pretty || '(empty body)'}</pre>
        {:else}
          <EmptyState icon="send" title="Send a request">
            <p>Pick an endpoint on the left or type any URL. <kbd>⌘</kbd> <kbd>↵</kbd> sends.</p>
          </EmptyState>
        {/if}
      </section>
    </div>

    {#snippet aside()}
      <VirtualList
        items={rows}
        getKey={(e: ApiEndpoint) => e.route}
        bind:selected
        label="API endpoints"
        onselect={pick}
      >
        {#snippet row(e: ApiEndpoint)}
          <span class="methods">
            {#each e.methods.slice(0, 3) as m (m)}<Badge tone={methodTone(m)}>{m}</Badge>{/each}
            {#if e.methods.length > 3}<Badge>+{e.methods.length - 3}</Badge>{/if}
          </span>
          <span class="truncate mono path"><Highlight text={e.path} {query} /></span>
        {/snippet}
        {#snippet empty()}
          {#if endpoints.loading}
            <EmptyState title="Scanning +server files…" />
          {:else}
            <EmptyState
              icon="api"
              title={endpoints.data.length ? 'No endpoints match' : 'No +server endpoints'}
            />
          {/if}
        {/snippet}
      </VirtualList>
    {/snippet}
  </SplitView>
</Panel>

<style>
  .client {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .bar {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
  }
  .method {
    width: 96px;
    font-weight: 600;
  }
  .url {
    flex: 1;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    position: relative;
    height: 30px;
    padding: 0 10px;
    border: 0;
    background: none;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .tabs [aria-selected='true'] {
    color: var(--fg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .tabs .file {
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--fg-faint);
  }
  .tabs .file:hover {
    color: var(--accent-fg);
  }
  .err-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--red);
  }
  .req {
    padding: 10px 12px;
  }
  .editor {
    width: 100%;
    min-height: 84px;
    height: 110px;
  }
  .hint {
    margin: 4px 0 0;
    color: var(--fg-faint);
    font-size: var(--fs-sm);
  }
  .hint.error {
    color: var(--red);
  }
  .res {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
  }
  .res-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    font-size: var(--fs-xs);
  }
  .hdrs {
    margin-left: auto;
    color: var(--fg-muted);
  }
  .hdrs[open] {
    flex-basis: 100%;
    margin-left: 0;
  }
  .hdrs summary {
    cursor: pointer;
  }
  .hdrs .kv {
    padding: 6px 0 0;
  }
  .body {
    flex: 1;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    background: var(--bg-inset);
    border-top: 1px solid var(--border);
    font-size: var(--fs-xs);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .methods {
    display: inline-flex;
    gap: 2px;
  }
  .path {
    font-size: var(--fs-xs);
  }
  kbd {
    padding: 0 4px;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    font-size: var(--fs-2xs);
  }
</style>
