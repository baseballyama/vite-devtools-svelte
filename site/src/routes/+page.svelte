<script lang="ts">
  import { base } from '$app/paths'
  import { panels, taglineParts } from '$lib/panels'
  import { MCP_TOOL_COUNT } from '$lib/mcp-tools'
  import InstallTabs from '$lib/InstallTabs.svelte'

  const repo = 'https://github.com/baseballyama/vite-devtools-svelte'

  const features = [
    {
      slug: 'components',
      title: 'Components',
      body: 'The live tree of mounted instances, virtualized for large apps, with an inspector for ancestors, children and imports.',
    },
    {
      slug: 'reactive',
      title: 'Reactivity',
      body: 'Which $state, $derived and $effect connect inside one component. Edges mean “can affect”, not a recorded cause.',
    },
    {
      slug: 'timeline',
      title: 'State timeline',
      body: 'Sampled $state changes, newest first, with the value before and after.',
    },
    {
      slug: 'inspect',
      title: 'Compiled output',
      body: 'Your component next to the JavaScript the compiler wrote, linked line by line through the source map.',
    },
    {
      slug: 'routes',
      title: 'Routes and load functions',
      body: 'The SvelteKit routes tree from your files, and how long each load function takes.',
    },
    {
      slug: 'profiler',
      title: 'Render',
      body: 'Which components render most and take the longest, per instance.',
    },
  ]

  const showcase = [
    {
      img: 'home-timeline.jpg',
      alt: 'State timeline panel listing state changes with an inspector showing before and after values',
      title: 'Know what changed, and when.',
      body: 'Recent $state writes, newest first, with the value before and after. The log keeps the latest entries, not the whole session.',
    },
    {
      img: 'home-compiled.jpg',
      alt: 'Compiled output panel with Svelte source and compiled JavaScript side by side, connected by source-map lines',
      title: 'Read what the compiler wrote.',
      body: 'Your component next to its compiled JavaScript, linked line by line through the source map.',
    },
  ]
</script>

<svelte:head>
  <title>vite-devtools-svelte — DevTools for Svelte and SvelteKit</title>
</svelte:head>

<section class="band no-border hero">
  <div class="hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Svelte 5 · SvelteKit · Vite</p>
      <h1>See inside your Svelte app.</h1>
      <p class="lead">
        Components, reactivity, routes and compiled output in one DevTools UI, served by your Vite
        dev server.
      </p>
      <div class="actions">
        <a class="btn btn-primary" href="{base}/getting-started">Get started</a>
        <a class="btn btn-secondary" href={repo} target="_blank" rel="noreferrer noopener">
          View on GitHub
        </a>
      </div>
    </div>
    <div class="hero-install">
      <InstallTabs />
      <ol class="next-steps">
        <li>Add <code>svelteDevtools()</code> before <code>sveltekit()</code> in <code>vite.config.ts</code>.</li>
        <li>Run your dev server.</li>
        <li>Open <code>/.svelte-devtools/</code>.</li>
      </ol>
    </div>
  </div>
  <p class="note release">
    Requires <strong>vite-devtools-svelte ≥ 0.4.0</strong> (not yet published; 0.3.0 is documented to
    run inside <code>@vitejs/devtools</code>).
  </p>
</section>

<section class="band flush showcase-hero" aria-label="Components panel">
  <figure class="hero-shot">
    <!-- The theme is set before first paint; the hidden variant is display:none. -->
    <img
      class="only-dark"
      src="{base}/images/home-components-dark.jpg"
      width="1600"
      height="1000"
      alt="Components panel: a filtered live component tree of a large app with an inspector showing ancestors, children and imports"
      fetchpriority="high"
    />
    <img
      class="only-light"
      src="{base}/images/home-components-light.jpg"
      width="1600"
      height="1000"
      alt="Components panel in the light theme with the component inspector open"
      loading="lazy"
    />
    <figcaption>
      Components: the live tree stays virtualized on large apps and tells you when only part of it
      was captured. Captured from the UI in dev-mock mode with synthetic data, before the
      reactivity update.
    </figcaption>
  </figure>
</section>

<section class="band" aria-labelledby="features-title">
  <div class="band-head">
    <p class="eyebrow">What you can see</p>
    <h2 id="features-title">Your running app, panel by panel.</h2>
    <p>The panels read your running app and your project while the dev server runs. Production builds are unaffected.</p>
  </div>
  <ul class="features">
    {#each features as f (f.slug)}
      <li>
        <h3>{f.title}</h3>
        <p>{f.body}</p>
        <a href="{base}/panels/{f.slug}" aria-label="{f.title} panel">Panel details <span aria-hidden="true">→</span></a>
      </li>
    {/each}
  </ul>
</section>

<section class="band split" aria-labelledby="large-title">
  <div class="split-copy">
    <p class="eyebrow">Reactivity in large apps</p>
    <h2 id="large-title">Start from the busiest components, then zoom in.</h2>
    <p>
      The overview counts sampled state changes and renders per component without building the
      whole graph. Pick one instance to see its signals and what can affect what.
    </p>
    <ul class="checks">
      <li>Every view says what it covers: window, 200 ms sampling, caps.</li>
      <li>Edges mean “can affect”. Which write changed a value is not recorded.</li>
      <li>After a page reload, old component ids are refused instead of guessed.</li>
    </ul>
    <a class="more" href="{base}/panels/reactive">The Reactivity panel <span aria-hidden="true">→</span></a>
  </div>
  <figure class="split-shot shot">
    <img
      src="{base}/images/reactivity-component.png"
      width="1440"
      height="900"
      alt="Local graph of ReactivePriceChart with taxRate selected; the inspector says Cause: Not recorded"
      loading="lazy"
      decoding="async"
    />
    <figcaption>Real runtime on the synthetic example app, captured in CI.</figcaption>
  </figure>
</section>

<section class="band" aria-label="More panels">
  <div class="pair">
    {#each showcase as s (s.img)}
      <article>
        <figure class="shot">
          <img src="{base}/images/{s.img}" width="1200" height="750" alt={s.alt} loading="lazy" decoding="async" />
        </figure>
        <h3>{s.title}</h3>
        <p class="muted">{s.body}</p>
        <p class="provenance">Dev-mock mode with synthetic data, before the reactivity update.</p>
      </article>
    {/each}
  </div>
</section>

<section class="band split agents" aria-labelledby="mcp-title">
  <div class="split-copy">
    <p class="eyebrow">For AI agents</p>
    <h2 id="mcp-title">Your coding agent can read it too.</h2>
    <p>
      The dev server also serves an MCP endpoint with {MCP_TOOL_COUNT} read tools. Claude Code and
      other MCP clients get the same data as the panels, and every answer says what it covers.
    </p>
    <a class="btn btn-secondary" href="{base}/mcp">Read the MCP guide</a>
  </div>
  <div class="terminal" role="img" aria-label="Terminal output: the dev server prints a claude mcp add command with the URL and a token">
    <p class="t-dim">$ npm run dev</p>
    <p class="t-dim">…</p>
    <p>svelte-devtools MCP ready — register with Claude Code:</p>
    <p class="t-cmd">claude mcp add --transport http svelte http://localhost:5173/__svelte-devtools/mcp --header x-svelte-devtools-token:&lt;token&gt;</p>
  </div>
</section>

<section class="band" aria-labelledby="modes-title">
  <div class="band-head">
    <p class="eyebrow">Two ways to open it</p>
    <h2 id="modes-title">Standalone, or inside Vite DevTools.</h2>
  </div>
  <div class="modes">
    <div>
      <h3>Standalone</h3>
      <p class="muted">
        Add the plugin and open <code>/.svelte-devtools/</code>. The first visit asks for the one-time
        code printed in your terminal; after that the browser is trusted.
      </p>
    </div>
    <div>
      <h3>Vite DevTools dock</h3>
      <p class="muted">
        Install <code>@vitejs/devtools</code> ≥ 0.7.6 and add <code>DevTools()</code> to your Vite
        config: the same panels open as an entry in the Vite DevTools dock.
      </p>
    </div>
  </div>
</section>

<section class="band" id="panels" aria-labelledby="panels-title">
  <div class="band-head">
    <p class="eyebrow">{panels.length} panels</p>
    <h2 id="panels-title">Every panel.</h2>
  </div>
  <ul class="panel-list">
    {#each panels as p (p.slug)}
      <li>
        <a href="{base}/panels/{p.slug}">
          <span class="p-title">{p.title}</span>
          <span class="p-tag">
            {#each taglineParts(p.tagline) as part, i (i)}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}
          </span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<section class="band closing">
  <h2>Try it in your dev server.</h2>
  <div class="actions">
    <a class="btn btn-primary" href="{base}/getting-started">Get started</a>
    <a class="btn btn-secondary" href={repo} target="_blank" rel="noreferrer noopener">View on GitHub</a>
  </div>
</section>

<style>
  .hero {
    padding-top: calc(var(--band-y) * 1.1);
  }

  /* Two columns split by a hairline, like the frame. */
  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    align-items: center;
  }

  .hero-copy {
    padding-right: 4rem;
  }

  .hero-install {
    padding-left: 4rem;
    border-left: 1px solid var(--line);
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  @media (max-width: 960px) {
    .hero-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 2.5rem;
    }
    .hero-copy {
      padding-right: 0;
    }
    .hero-install {
      padding-left: 0;
      border-left: 0;
    }
  }

  .lead {
    font-size: clamp(1.05rem, 1.6vw, 1.25rem);
    color: var(--text-2);
    max-width: 34rem;
    margin-bottom: 2rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
  }

  .next-steps {
    margin: 1.25rem 0 0;
    padding-left: 1.25rem;
    color: var(--text-2);
    font-size: 0.92rem;
  }

  .next-steps li + li {
    margin-top: 0.35rem;
  }

  .release {
    margin: 3rem 0 0;
    max-width: 44rem;
  }

  .showcase-hero {
    padding: 0 var(--pad-x) var(--band-y);
    border-top: 0;
  }

  .showcase-hero::before,
  .showcase-hero::after {
    display: none;
  }

  .hero-shot img {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
  }

  figcaption {
    margin-top: 0.75rem;
    font-size: 0.88rem;
    color: var(--text-3);
  }

  .features {
    list-style: none;
    margin: 0 calc(-1 * var(--pad-x)) calc(-1 * var(--band-y));
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-top: 1px solid var(--line);
  }

  .features li {
    padding: 2rem var(--pad-x) 2.25rem;
    border-bottom: 1px solid var(--line);
  }

  .features li:not(:nth-child(3n)) {
    border-right: 1px solid var(--line);
  }

  .features li:nth-last-child(-n + 3) {
    border-bottom: 0;
  }

  @media (max-width: 960px) {
    .features {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .features li:not(:nth-child(3n)) {
      border-right: 0;
    }
    .features li:nth-child(odd) {
      border-right: 1px solid var(--line);
    }
    .features li:nth-last-child(-n + 3) {
      border-bottom: 1px solid var(--line);
    }
    .features li:nth-last-child(-n + 2) {
      border-bottom: 0;
    }
  }

  @media (max-width: 640px) {
    .features {
      grid-template-columns: minmax(0, 1fr);
    }
    .features li:nth-child(odd) {
      border-right: 0;
    }
    .features li:nth-last-child(-n + 2) {
      border-bottom: 1px solid var(--line);
    }
    .features li:last-child {
      border-bottom: 0;
    }
  }

  .features p {
    color: var(--text-2);
    font-size: 0.95rem;
  }

  .features a,
  .more {
    font-size: 0.92rem;
    font-weight: 500;
  }

  .split {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 4rem;
    align-items: center;
  }

  @media (max-width: 960px) {
    .split {
      grid-template-columns: minmax(0, 1fr);
      gap: 2.5rem;
    }
  }

  .split-copy p {
    color: var(--text-2);
  }

  .checks {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
  }

  .checks li {
    position: relative;
    padding-left: 1.5rem;
    margin-bottom: 0.6rem;
    color: var(--text-2);
  }

  .checks li::before {
    content: '';
    position: absolute;
    left: 0.15rem;
    top: 0.6em;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 2px;
    background: var(--brand);
  }

  .split-shot img {
    width: 100%;
  }

  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3rem;
  }

  @media (max-width: 760px) {
    .pair {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .pair figure {
    margin: 0 0 1.25rem;
  }

  .provenance {
    font-size: 0.85rem;
    color: var(--text-3);
  }

  .terminal {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.6;
    background: var(--code-bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: 1.25rem 1.4rem;
    overflow-wrap: anywhere;
  }

  .terminal p {
    margin: 0;
  }

  .t-dim {
    color: var(--text-3);
  }

  .t-cmd {
    color: var(--text);
    margin-top: 0.4rem !important;
    padding-left: 1rem;
  }

  .modes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.5rem;
  }

  @media (max-width: 760px) {
    .modes {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .modes > div {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: 1.75rem;
    background: var(--paper);
  }

  .panel-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: 2rem;
    border-top: 1px solid var(--line);
  }

  @media (max-width: 960px) {
    .panel-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .panel-list {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .panel-list a {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 1.1rem 0.25rem 1.1rem 0;
    border-bottom: 1px solid var(--line);
    height: 100%;
  }

  .p-title {
    color: var(--text);
    font-weight: 600;
  }

  .p-tag {
    color: var(--text-2);
    font-size: 0.92rem;
  }

  .panel-list a:hover .p-title {
    color: var(--link);
  }

  .closing {
    text-align: center;
  }

  .closing .actions {
    justify-content: center;
  }
</style>
