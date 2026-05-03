<script lang="ts">
  import { onMount } from 'svelte'
  import type { ApiEndpoint, ApiResponse } from '../lib/types.js'
  import { getApiEndpoints, sendApiRequest } from '../lib/rpc.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'

  let endpoints = $state<ApiEndpoint[]>([])
  let selectedEndpoint = $state<ApiEndpoint | null>(null)
  let method = $state('GET')
  let requestUrl = $state('')
  let requestHeaders = $state('{}')
  let requestBody = $state('')
  let response = $state<ApiResponse | null>(null)
  let loading = $state(false)

  function selectEndpoint(ep: ApiEndpoint) {
    selectedEndpoint = ep
    method = ep.methods[0] || 'GET'
    requestUrl = `${window.location.origin}${ep.path}`
    requestHeaders = '{}'
    requestBody = ''
    response = null
  }

  async function send() {
    loading = true
    response = null
    try {
      response = await sendApiRequest(requestUrl, method, requestHeaders, requestBody)
    } catch (e) {
      response = { status: 0, statusText: String(e), headers: {}, body: '', duration: 0 }
    }
    loading = false
  }

  function statusColor(status: number): 'success' | 'warning' | 'error' | 'neutral' {
    if (status >= 200 && status < 300) return 'success'
    if (status >= 300 && status < 400) return 'warning'
    if (status >= 400) return 'error'
    return 'neutral'
  }

  onMount(async () => {
    try { endpoints = await getApiEndpoints() } catch { /* ignore */ }
  })
</script>

<PanelContainer>
  <div class="header">
    <h2>API Playground</h2>
  </div>

  <div class="api-layout">
    <div class="endpoints-list">
      <Card title="Endpoints ({endpoints.length})">
        {#if endpoints.length === 0}
          <p class="empty">No API endpoints found. Create +server.ts files to add API routes.</p>
        {:else}
          {#each endpoints as ep}
            <button class="endpoint-item" class:selected={selectedEndpoint === ep} onclick={() => selectEndpoint(ep)}>
              <span class="ep-path">{ep.path}</span>
              <div class="ep-methods">
                {#each ep.methods as m}
                  <Badge variant={m === 'GET' ? 'info' : m === 'POST' ? 'success' : m === 'DELETE' ? 'error' : 'warning'}>{m}</Badge>
                {/each}
              </div>
            </button>
          {/each}
        {/if}
      </Card>
    </div>

    <div class="request-area">
      <Card title="Request">
        <div class="request-row">
          <select class="method-select" bind:value={method}>
            {#each selectedEndpoint?.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as m}
              <option value={m}>{m}</option>
            {/each}
          </select>
          <input class="url-input" type="text" bind:value={requestUrl} placeholder="URL" />
          <ActionButton onclick={send}>{loading ? '...' : 'Send'}</ActionButton>
        </div>

        <div class="input-group">
          <label class="input-label" for="api-playground-headers">Headers (JSON)</label>
          <textarea id="api-playground-headers" class="text-input" rows="2" bind:value={requestHeaders} placeholder="Headers JSON"></textarea>
        </div>

        {#if method !== 'GET' && method !== 'HEAD'}
          <div class="input-group">
            <label class="input-label" for="api-playground-body">Body</label>
            <textarea id="api-playground-body" class="text-input" rows="3" bind:value={requestBody} placeholder="Request body"></textarea>
          </div>
        {/if}
      </Card>

      {#if response}
        <Card title="Response">
          <div class="response-header">
            <Badge variant={statusColor(response.status)}>{response.status} {response.statusText}</Badge>
            <span class="res-duration">{response.duration}ms</span>
          </div>
          {#if Object.keys(response.headers).length > 0}
            <details class="res-section">
              <summary class="res-section-title">Headers ({Object.keys(response.headers).length})</summary>
              <pre class="res-code">{JSON.stringify(response.headers, null, 2)}</pre>
            </details>
          {/if}
          <div class="res-section">
            <span class="res-section-title">Body</span>
            <pre class="res-code">{response.body || '(empty)'}</pre>
          </div>
        </Card>
      {/if}
    </div>
  </div>
</PanelContainer>

<style>
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
  h2 { font-size: var(--text-lg); font-weight: 600; color: var(--color-text); margin: 0; }
  .empty { color: var(--color-text-muted); font-size: var(--text-sm); }

  .api-layout { display: flex; gap: var(--space-3); }
  .endpoints-list { width: 260px; flex-shrink: 0; }
  .request-area { flex: 1; display: flex; flex-direction: column; gap: var(--space-3); }

  .endpoint-item {
    display: flex; align-items: center; justify-content: space-between; width: 100%;
    padding: var(--space-2); background: none; border: none; border-bottom: 1px dashed var(--color-border);
    cursor: pointer; font-family: var(--font-sans); text-align: left; transition: background var(--transition-fast);
  }
  .endpoint-item:hover { background: var(--color-surface-active); }
  .endpoint-item.selected { background: var(--color-surface-active); }
  .ep-path { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text); }
  .ep-methods { display: flex; gap: 2px; }

  .request-row { display: flex; gap: var(--space-2); align-items: center; margin-bottom: var(--space-2); }
  .method-select {
    padding: var(--space-1) var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border);
    border-radius: var(--radius-sm); color: var(--color-text); font-family: var(--font-mono); font-size: var(--text-sm);
  }
  .url-input {
    flex: 1; padding: var(--space-1) var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border);
    border-radius: var(--radius-sm); color: var(--color-text); font-family: var(--font-mono); font-size: var(--text-sm);
  }
  .url-input:focus, .method-select:focus, .text-input:focus { outline: none; border-color: var(--color-accent-500); }

  .input-group { margin-bottom: var(--space-2); }
  .input-label { display: block; font-size: var(--text-xs); color: var(--color-text-muted); margin-bottom: 4px; }
  .text-input {
    width: 100%; padding: var(--space-1) var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border);
    border-radius: var(--radius-sm); color: var(--color-text); font-family: var(--font-mono); font-size: var(--text-xs);
    resize: vertical;
  }

  .response-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2); }
  .res-duration { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-subtle); }
  .res-section { margin-top: var(--space-2); }
  .res-section-title { font-size: var(--text-xs); color: var(--color-text-muted); font-weight: 500; cursor: pointer; }
  .res-code {
    margin: var(--space-1) 0 0; padding: var(--space-2); background: var(--color-base);
    border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs);
    color: var(--color-text); overflow-x: auto; white-space: pre-wrap; max-height: 300px; overflow-y: auto;
  }
</style>
