<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Highlight from '../components/Highlight.svelte'
  import Panel from '../components/Panel.svelte'
  import RefreshButton from '../components/RefreshButton.svelte'
  import ResourceEmpty from '../components/ResourceEmpty.svelte'
  import SearchField from '../components/SearchField.svelte'
  import SplitView from '../components/SplitView.svelte'
  import type { Tone } from '../components/types.js'
  import VirtualList from '../components/VirtualList.svelte'
  import { errorMessage, formatBytes, formatMs } from '../lib/format.js'
  import { sendRequest } from '../lib/http.js'
  import type { ApiResponse, Truncation } from '../lib/http.js'
  import { matcher } from '../lib/match.js'
  import { resource } from '../lib/resource.svelte.js'
  import { getApiEndpoints, openInEditor } from '../lib/rpc.js'
  import type { ApiEndpoint } from '../lib/types.js'

  const endpoints = resource<ApiEndpoint[]>(getApiEndpoints, { initial: [] })

  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  const METHOD_TONES: Partial<Record<string, Tone>> = {
    GET: 'blue',
    POST: 'green',
    DELETE: 'red',
    HEAD: 'neutral',
    OPTIONS: 'neutral',
  }
  const methodTone = (m: string): Tone => METHOD_TONES[m] ?? 'yellow'

  let query = $state('')
  let selected = $state<string | null>(null)
  let method = $state('GET')
  let url = $state('')
  let headers = $state('{\n  \n}')
  let body = $state('')
  let tab = $state<'body' | 'headers'>('body')
  let sending = $state(false)
  /** Stops the request in flight. */
  let inflight: AbortController | null = null
  let bodyEl = $state<HTMLPreElement>()
  /** Whether a streaming body keeps scrolling to its end. */
  let following = true
  let response = $state<ApiResponse | null>(null)
  let requestError = $state<string | null>(null)

  const rows = $derived.by(() => {
    const m = matcher(query)
    return m ? endpoints.data.filter(e => m(e.path, e.route, e.methods.join(' '))) : endpoints.data
  })
  const current = $derived(
    selected ? (endpoints.data.find(e => e.route === selected) ?? null) : null,
  )

  /** The typed headers as an object, or the reason they are not one. */
  const parsedHeaders = $derived.by((): { value: Record<string, string> } | { error: string } => {
    if (!headers.trim()) return { value: {} }
    try {
      const v: unknown = JSON.parse(headers)
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { error: 'Headers must be a JSON object' }
      }
      if (!Object.values(v).every(x => typeof x === 'string')) {
        return { error: 'Header values must be strings' }
      }
      return { value: v as Record<string, string> }
    } catch (e) {
      return { error: errorMessage(e) }
    }
  })
  const headersError = $derived('error' in parsedHeaders ? parsedHeaders.error : null)

  const TRUNCATION: Record<Truncation, string> = {
    size: 'Body cut at 5 MB',
    stopped: 'Stopped while streaming; showing what arrived',
    error: 'Connection failed midway; showing what arrived',
  }

  const hasBody = $derived(method !== 'GET' && method !== 'HEAD')

  const pretty = $derived.by(() => {
    if (!response?.body) return ''
    // A body still arriving is shown as it comes: half a JSON document does not parse.
    if (sending) return response.body
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
    url = new URL(e.url, location.origin).href
    response = null
    requestError = null
  }

  async function send() {
    if (!url || 'error' in parsedHeaders || sending) return
    sending = true
    requestError = null
    response = null
    following = true
    const controller = new AbortController()
    inflight = controller
    try {
      response = await sendRequest(
        { url, method, headers: parsedHeaders.value, body: hasBody ? body : '' },
        {
          signal: controller.signal,
          onProgress: r => {
            response = r
          },
        },
      )
    } catch (e) {
      response = null
      requestError = errorMessage(e)
    } finally {
      sending = false
      inflight = null
    }
  }

  function stop() {
    inflight?.abort()
  }

  // Follow a streaming body while the view is at its end; a reader who
  // scrolled up keeps their place.
  $effect(() => {
    if (!bodyEl || !sending || pretty === '') return
    if (following) bodyEl.scrollTop = bodyEl.scrollHeight
  })
  function onscroll() {
    if (!bodyEl) return
    following = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 24
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void send()
    }
  }

  function statusTone(s: number): Tone {
    if (s >= 400) return 'red'
    if (s >= 300) return 'yellow'
    return s >= 200 ? 'green' : 'neutral'
  }
</script>

<Panel title="API" count={endpoints.data.length}>
  {#snippet toolbar()}
    <SearchField bind:value={query} placeholder="Filter endpoints…" count={rows.length} />
  {/snippet}
  {#snippet actions()}
    <RefreshButton res={endpoints} label="Rescan endpoints" />
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
        {#if sending}
          <Button variant="danger" icon="stop" onclick={stop} title="Stop the request">Stop</Button>
        {:else}
          <Button
            type="submit"
            variant="primary"
            icon="send"
            disabled={!url || !!headersError}
            title="Send (⌘↵)"
          >
            Send
          </Button>
        {/if}
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

      <section class="res" aria-label="Response" aria-live="polite" aria-busy={sending}>
        {#if requestError}
          <EmptyState title="Request failed" error={requestError} />
        {:else if response}
          <header class="res-head">
            <Badge tone={statusTone(response.status)}>{response.status} {response.statusText}</Badge
            >
            {#if sending}<Badge tone="blue">Streaming…</Badge>{/if}
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
          {#if response.redirected || response.truncated}
            <p class="notes">
              {#if response.redirected}<span class="mono">Redirected to {response.url}</span>{/if}
              {#if response.truncated}<span>{TRUNCATION[response.truncated]}</span>{/if}
            </p>
          {/if}
          <pre class="body mono" bind:this={bodyEl} {onscroll}>{pretty ||
              (sending ? '' : '(empty body)')}</pre>
        {:else if sending}
          <EmptyState icon="send" title="Waiting for a response…" />
        {:else}
          <EmptyState icon="send" title="Send a request">
            <p>
              Pick an endpoint on the left or type a URL. The browser sends it with the app's
              cookies. <kbd>⌘</kbd> <kbd>↵</kbd> sends.
            </p>
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
          <ResourceEmpty
            res={endpoints}
            total={endpoints.data.length}
            loading="Scanning +server files…"
            failed="Could not read endpoints"
            icon="api"
            title="No +server endpoints"
            noMatch="No endpoints match"
          />
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
  .notes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 0;
    padding: 0 12px 8px;
    color: var(--yellow);
    font-size: var(--fs-xs);
    overflow-wrap: anywhere;
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
