<script lang="ts">
  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import Panel from '../components/Panel.svelte'
  import { resource } from '../lib/resource.svelte.js'
  import { getOGPreview, getRoutes } from '../lib/rpc.js'
  import type { OGPreview } from '../lib/types.js'

  const routes = resource(
    async () =>
      (await getRoutes()).filter(r => r.hasPage && r.params.length === 0).map(r => r.path),
    {
      initial: [] as string[],
    },
  )

  let path = $state('/')
  let custom = $state('')
  let loading = $state(false)
  let preview = $state<OGPreview | null>(null)
  let error = $state<string | null>(null)

  const target = $derived(custom.trim() || new URL(path, location.origin).href)

  async function run() {
    loading = true
    error = null
    try {
      preview = await getOGPreview(target)
    } catch (e) {
      preview = null
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  const host = $derived.by(() => {
    try {
      return new URL(preview?.url ?? target).host
    } catch {
      return ''
    }
  })

  const twitterCard = $derived(
    preview?.tags.find(t => t.property === 'twitter:card')?.content ?? 'summary',
  )
</script>

<Panel title="Social preview" scroll>
  {#snippet toolbar()}
    <form
      class="bar"
      onsubmit={e => {
        e.preventDefault()
        void run()
      }}
    >
      <select class="select" bind:value={path} aria-label="Route" disabled={!!custom.trim()}>
        {#each routes.data.length ? routes.data : ['/'] as r (r)}<option value={r}>{r}</option
          >{/each}
      </select>
      <input
        class="input mono url"
        bind:value={custom}
        placeholder="…or any URL"
        aria-label="Custom URL"
        spellcheck="false"
      />
      <Button type="submit" variant="primary" icon="search" disabled={loading}
        >{loading ? 'Fetching…' : 'Preview'}</Button
      >
    </form>
  {/snippet}

  {#if error}
    <EmptyState icon="errors" tone="error" title="Could not fetch the page"
      ><p class="mono">{error}</p></EmptyState
    >
  {:else if !preview}
    <EmptyState icon="og" title="Check how a page unfurls">
      <p>
        Pick a route and press <strong>Preview</strong> to read its Open Graph and Twitter tags.
      </p>
      <Button variant="primary" icon="search" onclick={run} disabled={loading}
        >Preview {path}</Button
      >
    </EmptyState>
  {:else}
    <div class="wrap">
      <section class="cards" aria-label="Card previews">
        <figure class="card large">
          <span class="label">X / Twitter · {twitterCard}</span>
          <div class="img">
            {#if preview.image}<img src={preview.image} alt="" />{:else}<span
                ><Icon name="assets" size={22} />no og:image</span
              >{/if}
          </div>
          <figcaption>
            <span class="host">{host}</span>
            <strong class="t">{preview.title || 'Untitled page'}</strong>
            <span class="d">{preview.description || 'No description'}</span>
          </figcaption>
        </figure>
        <figure class="card slack">
          <div class="bar-accent"></div>
          <div>
            <span class="site">{host}</span>
            <strong class="t link">{preview.title || 'Untitled page'}</strong>
            <span class="d">{preview.description || 'No description'}</span>
            {#if preview.image}<img class="thumb" src={preview.image} alt="" />{/if}
          </div>
          <span class="label">Slack / Discord</span>
        </figure>
      </section>

      <section class="side">
        <h3 class="section-title">
          Checks
          {#if preview.issues.length}<Badge tone="yellow">{preview.issues.length}</Badge
            >{:else}<Badge tone="green">all good</Badge>{/if}
        </h3>
        <ul class="issues">
          {#each preview.issues as issue (issue)}
            <li><Icon name="warning" size={14} />{issue}</li>
          {:else}
            <li class="ok">
              <Icon name="check" size={14} />Title, description and image are present.
            </li>
          {/each}
        </ul>
        <h3 class="section-title">Tags <span class="num">{preview.tags.length}</span></h3>
        <dl class="kv tags">
          {#each preview.tags as t, i (i)}
            <dt class="mono">{t.property}</dt>
            <dd>{t.content}</dd>
          {:else}
            <dt class="faint">none</dt>
            <dd></dd>
          {/each}
        </dl>
      </section>
    </div>
  {/if}
</Panel>

<style>
  .bar {
    display: flex;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .url {
    flex: 1;
    min-width: 140px;
  }
  .wrap {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 20px;
    padding: 16px;
    max-width: 1200px;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .card {
    position: relative;
    margin: 0;
  }
  .label {
    position: absolute;
    top: -18px;
    left: 0;
    font-size: var(--fs-2xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-faint);
  }
  .large {
    margin-top: 18px;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    overflow: hidden;
    background: var(--bg-elevated);
  }
  .img {
    aspect-ratio: 1.91 / 1;
    display: grid;
    place-items: center;
    background: var(--bg-inset);
    color: var(--fg-faint);
    font-size: var(--fs-sm);
  }
  .img span {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .large figcaption {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-top: 1px solid var(--border);
  }
  .host,
  .site {
    font-size: var(--fs-xs);
    color: var(--fg-faint);
  }
  .t {
    font-weight: 600;
  }
  .t.link {
    color: var(--blue);
  }
  .d {
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .slack {
    display: flex;
    gap: 10px;
    padding: 4px 0;
  }
  .slack > div:last-of-type {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .bar-accent {
    width: 4px;
    border-radius: 2px;
    background: var(--border-strong);
    flex-shrink: 0;
  }
  .thumb {
    margin-top: 6px;
    max-width: 360px;
    border-radius: 8px;
  }
  .side .section-title {
    padding-left: 0;
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sm);
  }
  .issues li {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--yellow);
  }
  .issues li.ok {
    color: var(--green);
  }
  .tags {
    padding: 0;
  }
</style>
