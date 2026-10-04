<script lang="ts">
  import { base } from '$app/paths'
  import { panels } from '$lib/panels'

  const install = 'npm install -D vite-devtools-svelte'
  let copied = $state(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(install)
      copied = true
      setTimeout(() => (copied = false), 1600)
    } catch {
      /* clipboard unavailable — the command stays selectable */
    }
  }

  // Each row: one task, one sentence, one real screenshot of the current UI.
  const workflows = [
    {
      kicker: 'Reactivity',
      title: 'Follow a value through its runes.',
      body: 'See which $derived and $effect depend on a $state, scoped to one component, and jump to the definition.',
      img: 'home-reactivity',
      alt: 'Reactivity panel showing a dependency graph of $state, $derived and $effect for one component',
    },
    {
      kicker: 'State timeline',
      title: 'Know what changed, and when.',
      body: 'Recent $state writes, newest first, with the value before and after. The log keeps the latest entries, not the whole session.',
      img: 'home-timeline',
      alt: 'State timeline panel listing state changes with an inspector showing before and after values',
    },
    {
      kicker: 'Compiled output',
      title: 'Read what the compiler wrote.',
      body: 'Your component next to its compiled JavaScript, linked line by line through the source map.',
      img: 'home-compiled',
      alt: 'Compiled output panel with Svelte source and compiled JavaScript side by side, connected by source-map lines',
    },
  ]
</script>

<svelte:head>
  <title>vite-devtools-svelte — DevTools for Svelte and SvelteKit</title>
</svelte:head>

<section class="hero">
  <div class="container">
    <p class="kicker mono">Svelte 5 · SvelteKit · Vite</p>
    <h1>See inside<br />your Svelte app.</h1>
    <p class="sub">
      Components, reactivity, routes and compiled output — in one DevTools UI served by your
      Vite dev server.
    </p>
    <div class="actions">
      <a class="btn btn-primary" href="{base}/getting-started">Get started <span aria-hidden="true">→</span></a>
      <a class="btn btn-ghost" href="https://github.com/baseballyama/vite-devtools-svelte" target="_blank" rel="noreferrer noopener">GitHub</a>
    </div>
    <div class="install">
      <code class="mono">{install}</code>
      <button type="button" class="copy" onclick={copy} aria-label="Copy install command">
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span class="sr-only" aria-live="polite">{copied ? 'Install command copied' : ''}</span>
    </div>
  </div>

  <!-- The theme is set before first paint; the hidden variant is display:none and lazy, so only
       the image for the active theme is fetched. -->
  <figure class="shot hero-shot container">
    <img
      class="only-dark"
      src="{base}/images/home-components-dark.jpg"
      width="1600"
      height="1000"
      alt="Components panel: a filtered live component tree of a large app with an inspector showing ancestors, children and imports"
      loading="lazy"
      fetchpriority="high"
    />
    <img
      class="only-light"
      src="{base}/images/home-components-light.jpg"
      width="1600"
      height="1000"
      alt="Components panel in the light theme with the component inspector open"
      loading="lazy"
      fetchpriority="high"
    />
    <figcaption>
      Components: the live tree stays virtualized on large apps and tells you when only part of
      it was captured.
    </figcaption>
  </figure>
</section>

<section class="workflows" aria-label="Workflows">
  {#each workflows as w, i (w.img)}
    <article class="row container" class:flip={i % 2 === 1}>
      <div class="copy-col">
        <p class="kicker mono">{w.kicker}</p>
        <h2>{w.title}</h2>
        <p class="body">{w.body}</p>
      </div>
      <figure class="shot">
        <img src="{base}/images/{w.img}.jpg" width="1200" height="750" alt={w.alt} loading="lazy" decoding="async" />
      </figure>
    </article>
  {/each}
</section>

<section class="modes container" aria-labelledby="modes-title">
  <h2 id="modes-title">Two ways to open it.</h2>
  <div class="mode-grid">
    <div class="mode">
      <p class="kicker mono">Standalone</p>
      <h3>Any Vite dev server</h3>
      <p>
        Add the plugin and open <code class="mono">/.svelte-devtools/</code>. The first visit asks for
        the one-time code printed in your terminal; after that the browser is trusted.
      </p>
    </div>
    <div class="mode">
      <p class="kicker mono">Vite DevTools</p>
      <h3>Inside the dock</h3>
      <p>
        Install <code class="mono">@vitejs/devtools</code> ≥ 0.7.6 and add <code class="mono">DevTools()</code>
        to your Vite config: the same panels open as an entry in the Vite DevTools dock.
      </p>
    </div>
  </div>
  <p class="note">
    Both modes require <strong>vite-devtools-svelte ≥ 0.4.0</strong> (not yet published; 0.3.0 is
    documented to run inside <code class="mono">@vitejs/devtools</code>). The plugin only runs while the dev server is running.
  </p>
</section>

<section class="panels container" id="panels" aria-labelledby="panels-title">
  <div class="panels-head">
    <h2 id="panels-title">Every panel.</h2>
    <p class="body">{panels.length} panels, each with its own page.</p>
  </div>
  <ul class="panel-list">
    {#each panels as p (p.slug)}
      <li>
        <a href="{base}/panels/{p.slug}">
          <span class="p-title">{p.title}</span>
          <span class="p-tag">{p.tagline}</span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<section class="closing container">
  <h2>Try it in your dev server.</h2>
  <div class="actions">
    <a class="btn btn-primary" href="{base}/getting-started">Get started <span aria-hidden="true">→</span></a>
    <a class="btn btn-ghost" href="https://github.com/baseballyama/vite-devtools-svelte" target="_blank" rel="noreferrer noopener">GitHub</a>
  </div>
</section>

<style>
  .hero {
    padding: clamp(4rem, 10vw, 8rem) 0 0;
  }
  .kicker {
    margin: 0 0 1rem;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  h1 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: clamp(2.75rem, 8vw, 6.25rem);
    font-weight: 600;
    line-height: 0.98;
    letter-spacing: -0.045em;
    color: var(--text);
  }
  .sub {
    max-width: 34rem;
    margin: 1.75rem 0 0;
    font-size: clamp(1.05rem, 1.6vw, 1.25rem);
    line-height: 1.55;
    color: var(--text-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 2.25rem;
  }
  .install {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 100%;
    margin-top: 1.5rem;
    padding: 0.55rem 0.55rem 0.55rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--paper);
  }
  .install code {
    overflow-x: auto;
    white-space: nowrap;
    font-size: 0.88rem;
    color: var(--text);
  }
  .copy {
    flex-shrink: 0;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-2);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .copy:hover {
    color: var(--text);
    border-color: var(--line-strong);
  }

  .shot {
    margin: 0;
  }
  /* .shot resets figure margins; the hero figure is also a .container and must stay centred. */
  .hero-shot {
    margin-inline: auto;
  }
  .shot img {
    width: 100%;
    height: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--paper);
  }
  .hero-shot {
    margin-top: clamp(3rem, 7vw, 5rem);
  }
  .hero-shot img {
    box-shadow: var(--shadow-lg);
  }
  figcaption {
    margin-top: 1rem;
    font-size: 0.9rem;
    color: var(--text-3);
  }
  :global(html[data-theme='dark']) .only-light,
  :global(html[data-theme='light']) .only-dark {
    display: none;
  }

  .workflows {
    display: grid;
    gap: clamp(5rem, 12vw, 9rem);
    padding: clamp(6rem, 14vw, 11rem) 0;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    gap: clamp(2rem, 5vw, 4.5rem);
    align-items: center;
  }
  .row.flip .copy-col {
    order: 2;
  }
  h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: clamp(1.9rem, 4vw, 3.1rem);
    font-weight: 600;
    line-height: 1.05;
    letter-spacing: -0.035em;
    color: var(--text);
  }
  .body {
    margin: 1.25rem 0 0;
    max-width: 28rem;
    font-size: 1.05rem;
    color: var(--text-2);
  }

  .modes {
    padding-bottom: clamp(6rem, 14vw, 10rem);
  }
  .mode-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    margin-top: 2.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--line);
    overflow: hidden;
  }
  .mode {
    padding: clamp(1.5rem, 3vw, 2.5rem);
    background: var(--bg);
  }
  .mode h3 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .mode p:not(.kicker) {
    margin: 0.75rem 0 0;
    color: var(--text-2);
  }
  .mode code,
  .install code {
    font-size: 0.9em;
  }
  .note {
    margin: 1.25rem 0 0;
    font-size: 0.9rem;
    color: var(--text-3);
  }

  .panels {
    padding-bottom: clamp(6rem, 14vw, 10rem);
  }
  .panels-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  .panels-head .body {
    margin: 0;
  }
  .panel-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 2.5rem 0 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line);
  }
  .panel-list li {
    border-bottom: 1px solid var(--line);
  }
  .panel-list a {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    height: 100%;
    padding: 1.1rem 1rem 1.1rem 0;
    color: var(--text);
  }
  .panel-list a:hover .p-title,
  .panel-list a:focus-visible .p-title {
    color: var(--link);
  }
  .p-title {
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .p-tag {
    font-size: 0.9rem;
    color: var(--text-3);
  }

  .closing {
    padding-bottom: clamp(6rem, 14vw, 10rem);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (max-width: 860px) {
    .row,
    .mode-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .row.flip .copy-col {
      order: 0;
    }
    .panel-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 520px) {
    .panel-list {
      grid-template-columns: minmax(0, 1fr);
    }
    .install {
      display: flex;
    }
    /* Wrap at spaces instead of scrolling, so the command never reads as truncated. */
    .install code {
      white-space: normal;
      overflow-x: visible;
    }
  }
</style>
