<script lang="ts">
  import { base } from '$app/paths'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
  let panel = $derived(data.panel)
  let prev = $derived(data.prev)
  let next = $derived(data.next)
</script>

<svelte:head>
  <title>{panel.title} — vite-devtools-plugin-svelte</title>
  <meta name="description" content={panel.tagline} />
</svelte:head>

<section class="section">
  <div class="container">
    <a class="back" href="{base}/#panels">← All panels</a>

    <header class="panel-head">
      <span class="tag">Panel</span>
      <h1>{panel.title}</h1>
      <p class="tagline">{panel.tagline}</p>
    </header>

    <div class="layout">
      <article class="content">
        <p class="description">{panel.description}</p>

        <h2>What you can do</h2>
        <ul>
          {#each panel.highlights as item (item)}
            <li>{item}</li>
          {/each}
        </ul>

        <h2>Try it</h2>
        <p>
          Add the plugin to your project (<a href="{base}/getting-started"
            >Getting Started</a
          >), or run the
          <a href="{base}/try">live StackBlitz demo</a> to play with this panel
          right in your browser.
        </p>
      </article>

      <aside class="screenshots">
        {#each panel.images as src, i (src)}
          <figure>
            <img
              src="{base}/images/{src}"
              alt={`${panel.title} screenshot ${i + 1}`}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          </figure>
        {/each}
      </aside>
    </div>

    <nav class="pager">
      <a class="pager-btn" href="{base}/panels/{prev.slug}">
        <span class="pager-label">← Previous</span>
        <span class="pager-title">{prev.title}</span>
      </a>
      <a class="pager-btn right" href="{base}/panels/{next.slug}">
        <span class="pager-label">Next →</span>
        <span class="pager-title">{next.title}</span>
      </a>
    </nav>
  </div>
</section>

<style>
  .back {
    display: inline-block;
    margin-bottom: 1rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }

  .panel-head {
    margin-bottom: 2.5rem;
  }

  .panel-head h1 {
    margin: 0.6rem 0 0.5rem;
  }

  .tagline {
    font-size: 1.15rem;
    color: var(--text-dim);
    margin: 0;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 2.5rem;
    align-items: start;
  }

  @media (max-width: 920px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  .description {
    font-size: 1.05rem;
    margin-bottom: 1.5rem;
  }

  .content h2 {
    font-size: 1.05rem;
    margin: 1.6rem 0 0.4rem;
    color: var(--text-dim);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .content ul {
    padding-left: 1.2rem;
    margin: 0 0 1rem;
  }

  .content li {
    margin-bottom: 0.35rem;
  }

  .screenshots {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  figure {
    margin: 0;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    border-radius: var(--radius-lg);
    padding: 0.4rem;
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  figure img {
    border-radius: calc(var(--radius-lg) - 4px);
  }

  .pager {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 3rem;
    padding-top: 2rem;
    border-top: 1px solid var(--border);
  }

  .pager-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    color: inherit;
  }

  .pager-btn:hover {
    text-decoration: none;
    border-color: color-mix(in srgb, var(--brand) 50%, var(--border));
  }

  .pager-btn.right {
    text-align: right;
    align-items: flex-end;
  }

  .pager-label {
    font-size: 0.78rem;
    color: var(--text-dim);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .pager-title {
    font-weight: 600;
  }
</style>
