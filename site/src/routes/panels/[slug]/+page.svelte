<script lang="ts">
  import { base } from '$app/paths'
  import { panels } from '$lib/panels'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
  let panel = $derived(data.panel)
  let prev = $derived(data.prev)
  let next = $derived(data.next)
  let panelIndex = $derived(panels.findIndex(p => p.slug === panel.slug))
</script>

<svelte:head>
  <title>{panel.title} — vite-devtools-svelte</title>
  <meta name="description" content={panel.tagline} />
</svelte:head>

<article class="panel-article">
  <div class="container">
    <a class="back" href="{base}/#panels">
      <span class="back-arrow" aria-hidden="true">←</span>
      All panels
    </a>

    <header class="panel-head">
      <div class="head-meta">
        <span class="eyebrow">
          <span class="eyebrow-num">{String(panelIndex + 1).padStart(2, '0')} / 15</span>
          · panel
        </span>
        <span class="mono dim">{panel.slug}</span>
      </div>

      <h1>{panel.title}</h1>
      <p class="tagline">{panel.tagline}</p>
    </header>

    <hr class="divider" />

    <div class="layout">
      <section class="content">
        <p class="description">{panel.description}</p>

        <h2 class="content-h2">What you can do</h2>
        <ul class="highlights">
          {#each panel.highlights as item, i (item)}
            <li>
              <span class="bullet mono">{String(i + 1).padStart(2, '0')}</span>
              <span>{item}</span>
            </li>
          {/each}
        </ul>

        <h2 class="content-h2">Try it</h2>
        <p>
          Add the plugin to your project
          (<a href="{base}/getting-started">Getting Started</a>),
          or run the
          <a href="{base}/try">live StackBlitz demo</a>
          to play with this panel right in your browser.
        </p>
      </section>

      <aside class="screenshots">
        {#each panel.images as src, i (src)}
          <figure class="shot">
            <div class="shot-chrome mono">
              <span class="shot-dot"></span>
              <span class="shot-dot"></span>
              <span class="shot-dot"></span>
              <span class="shot-title">{panel.slug}{panel.images.length > 1 ? ` · ${i + 1}` : ''}</span>
            </div>
            <img
              src="{base}/images/{src}"
              alt={`${panel.title} screenshot ${i + 1}`}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          </figure>
        {/each}
      </aside>
    </div>

    <nav class="pager" aria-label="Panel navigation">
      <a class="pager-btn" href="{base}/panels/{prev.slug}">
        <span class="pager-label mono">← previous</span>
        <span class="pager-title">{prev.title}</span>
      </a>
      <a class="pager-btn right" href="{base}/panels/{next.slug}">
        <span class="pager-label mono">next →</span>
        <span class="pager-title">{next.title}</span>
      </a>
    </nav>
  </div>
</article>

<style>
  .panel-article {
    padding: 3.5rem 0 5rem;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 2rem;
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 0.82rem;
  }

  .back-arrow {
    transition: transform 220ms var(--ease);
  }

  .back:hover {
    color: var(--text);
    text-decoration: none;
  }

  .back:hover .back-arrow {
    transform: translateX(-3px);
    color: var(--brand);
  }

  .panel-head {
    margin-bottom: 1.75rem;
  }

  .head-meta {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    color: var(--text-3);
  }

  .head-meta::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .panel-head h1 {
    margin: 0 0 0.6rem;
    font-size: clamp(2.2rem, 5vw, 4rem);
  }

  .tagline {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 144, 'SOFT' 80;
    font-style: italic;
    font-weight: 350;
    font-size: clamp(1.15rem, 1.6vw, 1.5rem);
    color: var(--text-2);
    margin: 0;
    max-width: 720px;
  }

  .divider {
    margin: 0 0 2.5rem;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
    gap: 3rem;
    align-items: start;
  }

  @media (max-width: 920px) {
    .layout {
      grid-template-columns: 1fr;
      gap: 2rem;
    }
  }

  .description {
    font-size: 1.08rem;
    color: var(--text);
    margin-bottom: 1.75rem;
    line-height: 1.6;
  }

  .content-h2 {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 500;
    margin: 2rem 0 0.85rem;
    color: var(--text-3);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .highlights {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
    border-top: 1px solid var(--line);
  }

  .highlights li {
    display: flex;
    gap: 1rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--line);
    color: var(--text);
    line-height: 1.5;
  }

  .bullet {
    color: var(--brand);
    font-size: 0.78rem;
    padding-top: 0.18rem;
    flex-shrink: 0;
  }

  .screenshots {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    position: sticky;
    top: 88px;
  }

  @media (max-width: 920px) {
    .screenshots {
      position: static;
    }
  }

  .shot {
    margin: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--paper);
    overflow: hidden;
    box-shadow: var(--shadow-md);
  }

  .shot-chrome {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.75rem;
    background: var(--paper-2);
    border-bottom: 1px solid var(--line);
    font-size: 0.7rem;
    color: var(--text-3);
  }

  .shot-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bg-3);
  }

  .shot-dot:nth-child(1) {
    background: #ff5f57;
  }
  .shot-dot:nth-child(2) {
    background: #ffbd2e;
  }
  .shot-dot:nth-child(3) {
    background: #27c93f;
  }

  .shot-title {
    margin-left: 0.4rem;
  }

  .shot img {
    width: 100%;
    display: block;
    background: var(--bg-1);
  }

  .pager {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-top: 3.5rem;
    padding-top: 2rem;
    border-top: 1px solid var(--line);
  }

  @media (max-width: 600px) {
    .pager {
      grid-template-columns: 1fr;
    }
  }

  .pager-btn {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 1.1rem 1.25rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--paper);
    color: inherit;
    transition:
      border-color 200ms var(--ease),
      background 200ms var(--ease);
  }

  .pager-btn:hover {
    text-decoration: none;
    border-color: var(--line-strong);
    background: var(--paper-2);
  }

  .pager-btn.right {
    text-align: right;
    align-items: flex-end;
  }

  .pager-label {
    font-size: 0.7rem;
    color: var(--text-3);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .pager-title {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 144, 'SOFT' 50;
    font-weight: 400;
    font-size: 1.3rem;
    color: var(--text);
    letter-spacing: -0.025em;
  }
</style>
