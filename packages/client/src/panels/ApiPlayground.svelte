<script lang="ts">
  import Badge from '../components/Badge.svelte';
  import Button from '../components/Button.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Highlight from '../components/Highlight.svelte';
  import Panel from '../components/Panel.svelte';
  import RefreshButton from '../components/RefreshButton.svelte';
  import ResourceEmpty from '../components/ResourceEmpty.svelte';
  import SearchField from '../components/SearchField.svelte';
  import SplitView from '../components/SplitView.svelte';
  import type { Tone } from '../components/types.js';
  import VirtualList from '../components/VirtualList.svelte';
  import { errorMessage, formatBytes, formatMs } from '../lib/format.js';
  import { MAX_BODY_BYTES, sendRequest } from '../lib/http.js';
  import type { ApiResponse, Truncation } from '../lib/http.js';
  import { matcher } from '../lib/match.js';
  import { resource } from '../lib/resource.svelte.js';
  import { getApiEndpoints, openInEditor } from '../lib/rpc.js';
  import type { ApiEndpoint } from '../lib/types.js';
  import { datasetVersion } from '../lib/versions.js';

  // Rescans after the dev server sees a file added, changed or deleted.
  const endpoints = resource<ApiEndpoint[]>(getApiEndpoints, {
    initial: [],
    interval: 2000,
    version: datasetVersion('apiEndpoints'),
  });

  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const METHOD_TONES: Partial<Record<string, Tone>> = {
    GET: 'blue',
    POST: 'green',
    DELETE: 'red',
    HEAD: 'neutral',
    OPTIONS: 'neutral',
  };
  const methodTone = (m: string): Tone => METHOD_TONES[m] ?? 'yellow';

  let query = $state('');
  let selected = $state<string | null>(null);
  let method = $state('GET');
  let url = $state('');
  let headers = $state('{\n  \n}');
  let body = $state('');
  let tab = $state<'body' | 'headers'>('body');
  let sending = $state(false);
  let inflight: AbortController | null = null;
  /** Counts sends; a request whose number is no longer current shows nothing. */
  let generation = 0;
  /** The latest streamed progress not yet shown, and the frame that will show it. */
  let progress: ApiResponse | null = null;
  let frame = 0;
  let bodyEl = $state<HTMLPreElement>();
  /** Whether a streaming body keeps scrolling to its end. */
  let following = true;
  let response = $state<ApiResponse | null>(null);
  let requestError = $state<string | null>(null);
  /** The user stopped the request before any response arrived: not a failure. */
  let stoppedEarly = $state(false);

  const rows = $derived.by(() => {
    const m = matcher(query);
    return m ? endpoints.data.filter(e => m(e.path, e.route, e.methods.join(' '))) : endpoints.data;
  });
  const current = $derived(
    selected ? (endpoints.data.find(e => e.route === selected) ?? null) : null,
  );

  /** The typed headers as an object, or the reason they are not one. */
  const parsedHeaders = $derived.by((): { value: Record<string, string> } | { error: string } => {
    if (!headers.trim()) return { value: {} };
    try {
      const v: unknown = JSON.parse(headers);
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { error: 'Headers must be a JSON object' };
      }
      if (!Object.values(v).every(x => typeof x === 'string')) {
        return { error: 'Header values must be strings' };
      }
      return { value: v as Record<string, string> };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });
  const headersError = $derived('error' in parsedHeaders ? parsedHeaders.error : null);

  const TRUNCATION: Record<Truncation, string> = {
    size: `Body cut at ${formatBytes(MAX_BODY_BYTES)}`,
    stopped: 'Stopped while streaming; showing what arrived',
    error: 'Connection failed midway; showing what arrived',
  };

  /** The detected methods, or every method when detection is unsure. */
  const methodOptions = $derived(
    current?.complete && current.methods.length ? current.methods : METHODS,
  );
  /** The chosen method while it is still offered (a rescan may drop it), else the first. */
  const sendMethod = $derived(methodOptions.includes(method) ? method : methodOptions[0]!);
  const hasBody = $derived(sendMethod !== 'GET' && sendMethod !== 'HEAD');

  /** Characters of a streaming body shown while it arrives; the whole body shows once it ends. */
  const STREAM_TAIL = 64 * 1024;
  const streamingTail = $derived(sending && (response?.body.length ?? 0) > STREAM_TAIL);

  /** The last `n` characters, never starting inside a surrogate pair. */
  function tail(text: string, n: number): string {
    const s = text.slice(-n);
    const c = s.charCodeAt(0);
    return c >= 0xdc00 && c <= 0xdfff ? s.slice(1) : s;
  }

  const pretty = $derived.by(() => {
    if (!response?.body) return '';
    // A body still arriving is shown as it comes (half a JSON document does
    // not parse), and only its end: each frame renders all of it again.
    if (sending) return streamingTail ? tail(response.body, STREAM_TAIL) : response.body;
    // `Headers` names are lowercase.
    const ct = response.headers['content-type'] ?? '';
    const first = response.body.trimStart()[0];
    if (ct.includes('json') || first === '[' || first === '{') {
      try {
        return JSON.stringify(JSON.parse(response.body), null, 2);
      } catch {}
    }
    return response.body;
  });

  /** Hands the view back from the request in flight, which then shows nothing. */
  function abandon() {
    generation++;
    inflight?.abort();
    inflight = null;
    cancelAnimationFrame(frame);
    frame = 0;
    progress = null;
    sending = false;
  }

  function pick(e: ApiEndpoint) {
    // A request still streaming belongs to the endpoint picked before.
    abandon();
    stoppedEarly = false;
    selected = e.route;
    method = e.methods[0] ?? 'GET';
    url = new URL(e.url, location.origin).href;
    response = null;
    requestError = null;
  }

  async function send() {
    if (!url || 'error' in parsedHeaders || sending) return;
    sending = true;
    requestError = null;
    stoppedEarly = false;
    response = null;
    following = true;
    const id = ++generation;
    const controller = new AbortController();
    inflight = controller;
    try {
      // `sendRequest` drops the body of GET and HEAD itself.
      const result = await sendRequest(
        { url, method: sendMethod, headers: parsedHeaders.value, body },
        {
          signal: controller.signal,
          // At most one repaint per frame: a fast stream sends many chunks a
          // frame, and each repaint renders the body shown so far.
          onProgress: r => {
            // a chunk of an abandoned request must not wait in `progress` for the next frame
            if (id !== generation) return;
            progress = r;
            frame ||= requestAnimationFrame(() => {
              frame = 0;
              if (progress && id === generation) response = progress;
            });
          },
        },
      );
      if (id !== generation) return;
      response = null;
      // Status 0: no response at all (network, CORS, timeout, or Stop).
      if (result.status !== 0) response = result;
      else if (controller.signal.aborted) stoppedEarly = true;
      else requestError = result.statusText;
    } catch (e) {
      if (id !== generation) return;
      response = null;
      requestError = errorMessage(e);
    } finally {
      // An abandoned request no longer owns the view (`abandon` reset it).
      if (id === generation) {
        // A frame still pending would paint older progress over the result.
        cancelAnimationFrame(frame);
        frame = 0;
        progress = null;
        sending = false;
        inflight = null;
      }
    }
  }

  function stop() {
    inflight?.abort();
  }

  // Leaving the panel stops a request still in flight (an endless stream
  // would otherwise keep reading in the background).
  $effect(() => abandon);

  /**
   * What a screen reader hears: the status when it arrives and the size once
   * the body ends, not every repaint of the time and size counters.
   */
  const announcement = $derived.by(() => {
    if (!response) return stoppedEarly ? 'Stopped before a response' : '';
    const status = `${response.status} ${response.statusText}`.trim();
    return sending ? `${status}, streaming` : `${status}, ${formatBytes(response.size)}`;
  });

  /** Headers the browser sets itself and drops from a script's request (Fetch "forbidden" names). */
  const FORBIDDEN = new Set([
    'accept-charset',
    'accept-encoding',
    'access-control-request-headers',
    'access-control-request-method',
    'connection',
    'content-length',
    'cookie',
    'cookie2',
    'date',
    'dnt',
    'expect',
    'host',
    'keep-alive',
    'origin',
    'referer',
    'set-cookie',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'via',
  ]);
  const droppedHeaders = $derived(
    'value' in parsedHeaders
      ? Object.keys(parsedHeaders.value).filter(name => {
          const n = name.toLowerCase();
          return FORBIDDEN.has(n) || n.startsWith('proxy-') || n.startsWith('sec-');
        })
      : [],
  );

  // Follow a streaming body while the view is at its end. Scrolling up stops
  // following; the text under a reader still moves while only the end of a
  // long body is shown (see STREAM_TAIL), and settles once it ends.
  $effect(() => {
    if (!bodyEl || !sending || pretty === '') return;
    if (following) bodyEl.scrollTop = bodyEl.scrollHeight;
  });
  function onscroll() {
    if (!bodyEl) return;
    following = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 24;
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  }

  function statusTone(s: number): Tone {
    if (s >= 400) return 'red';
    if (s >= 300) return 'yellow';
    return s >= 200 ? 'green' : 'neutral';
  }
</script>

<Panel title="API">
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
          e.preventDefault();
          void send();
        }}
      >
        <select
          class="select method"
          value={sendMethod}
          onchange={e => (method = e.currentTarget.value)}
          aria-label="HTTP method"
        >
          {#each methodOptions as m (m)}<option>{m}</option>{/each}
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
            <p class="hint">{sendMethod} requests have no body.</p>
          {/if}
        {:else}
          <textarea
            class="input editor"
            bind:value={headers}
            aria-label="Request headers as JSON"
            aria-invalid={!!headersError}
            spellcheck="false"></textarea>
          {#if headersError}<p class="hint error">{headersError}</p>{/if}
          {#if droppedHeaders.length}<p class="hint">
              The browser sets these itself and drops them here: <span class="mono"
                >{droppedHeaders.join(', ')}</span
              >. The app's cookies are sent automatically.
            </p>{/if}
        {/if}
      </div>

      <!-- Always present, so screen readers announce changes to it. -->
      <p class="sr-only" aria-live="polite">{announcement}</p>
      <section class="res" aria-label="Response" aria-busy={sending}>
        {#if requestError}
          <EmptyState title="Request failed" error={requestError} />
        {:else if stoppedEarly}
          <!-- the live region above says it -->
          <EmptyState icon="stop" title="Stopped before a response" announce={false} />
        {:else if response}
          <header class="res-head">
            <Badge tone={statusTone(response.status)}>{response.status} {response.statusText}</Badge
            >
            {#if sending}<Badge tone="blue">Streaming…</Badge>{/if}
            <span class="num muted">{formatMs(response.duration)}</span>
            <span class="num muted">{formatBytes(response.size)}</span>
            <details class="hdrs">
              <summary>{Object.keys(response.headers).length} headers</summary>
              <dl class="kv">
                {#each Object.entries(response.headers) as [k, v] (k)}<dt class="mono">{k}</dt>
                  <dd class="mono">{v}</dd>{/each}
              </dl>
            </details>
          </header>
          {#if response.redirected || response.truncated || streamingTail}
            <p class="notes">
              {#if response.redirected}<span class="mono">Redirected to {response.url}</span>{/if}
              {#if response.truncated}<span>{TRUNCATION[response.truncated]}</span>{/if}
              {#if streamingTail}<span>Showing the end while streaming; all of it once it ends</span
                >{/if}
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
            {#if !e.complete}<Badge
                title="Some exports could not be followed (a module that does not resolve or parse, or a package): more methods may exist"
                >?</Badge
              >{/if}
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
