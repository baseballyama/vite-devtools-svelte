<script lang="ts">
  import { base } from '$app/paths'
  import { panels } from '$lib/panels'
</script>

<svelte:head>
  <title>vite-devtools-plugin-svelte — DevTools for Svelte, inside Vite</title>
</svelte:head>

<section class="hero">
  <div class="container hero-inner">
    <span class="tag">Early development · v0.0.1</span>
    <h1>DevTools for Svelte, <span class="brand-text">inside Vite</span></h1>
    <p class="lead">
      A Vite DevTools plugin for Svelte and SvelteKit. Fifteen specialized panels
      for inspecting components, profiling reactivity, debugging routes, and
      everything in between — without leaving your dev server.
    </p>

    <div class="cta">
      <a class="btn btn-primary" href="{base}/getting-started">
        Get Started
      </a>
      <a class="btn btn-secondary" href="{base}/try">Try Live in StackBlitz</a>
      <a
        class="btn btn-secondary"
        href="https://github.com/baseballyama/vite-devtool-plugin-svelte"
        target="_blank"
        rel="noreferrer noopener">View on GitHub</a
      >
    </div>

    <div class="hero-figure">
      <img
        src="{base}/images/panel-overview.png"
        alt="Overview panel of vite-devtools-plugin-svelte"
        loading="eager"
      />
    </div>
  </div>
</section>

<section class="section" id="panels">
  <div class="container">
    <div class="section-head">
      <h2>Fifteen panels, one workflow</h2>
      <p class="muted">
        Every panel is opt-in, dev-only, and adds zero overhead to your
        production build.
      </p>
    </div>

    <div class="grid">
      {#each panels as p (p.slug)}
        <a class="card" href="{base}/panels/{p.slug}">
          <div class="card-image">
            <img src="{base}/images/{p.images[0]}" alt={p.title} loading="lazy" />
          </div>
          <div class="card-body">
            <h3>{p.title}</h3>
            <p class="muted">{p.tagline}</p>
          </div>
        </a>
      {/each}
    </div>
  </div>
</section>

<section class="section how">
  <div class="container">
    <div class="section-head">
      <h2>How it works</h2>
      <p class="muted">
        A virtual-module architecture instead of fragile regex transforms.
      </p>
    </div>

    <div class="how-grid">
      <div class="how-card">
        <h3>Runtime wrapper</h3>
        <p class="muted">
          Intercepts <code>svelte/internal/client</code> to track component lifecycle and
          reactive signals (<code>$state</code>, <code>$derived</code>,
          <code>$effect</code>).
        </p>
      </div>
      <div class="how-card">
        <h3>HMR channel</h3>
        <p class="muted">
          Streams runtime data — component tree, render profiles, reactive graph —
          from the browser to the dev server via WebSocket.
        </p>
      </div>
      <div class="how-card">
        <h3>Static analyzers</h3>
        <p class="muted">
          Extract routes, component relations, assets, and project metadata
          straight from the filesystem — no runtime instrumentation needed.
        </p>
      </div>
      <div class="how-card">
        <h3>Dual-transport RPC</h3>
        <p class="muted">
          DevTools Kit RPC with HTTP fallback for compatibility with older Vite
          DevTools Kit versions.
        </p>
      </div>
    </div>
  </div>
</section>

<style>
  .hero {
    padding: 4rem 0 2rem;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--brand) 7%, transparent) 0%,
      transparent 100%
    );
    border-bottom: 1px solid var(--border);
  }

  .hero-inner {
    text-align: center;
  }

  .hero h1 {
    margin: 1rem 0 1.25rem;
  }

  .brand-text {
    color: var(--brand);
  }

  .lead {
    font-size: 1.125rem;
    color: var(--text-dim);
    max-width: 680px;
    margin: 0 auto 1.75rem;
  }

  .cta {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 2.5rem;
  }

  .hero-figure {
    margin-top: 2rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--bg-elev);
    padding: 0.5rem;
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }

  .hero-figure img {
    border-radius: calc(var(--radius-lg) - 4px);
  }

  .section-head {
    text-align: center;
    margin-bottom: 2.25rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.1rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    border-radius: var(--radius-lg);
    overflow: hidden;
    color: inherit;
    transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
  }

  .card:hover {
    text-decoration: none;
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--brand) 50%, var(--border));
    box-shadow: var(--shadow-md);
  }

  .card-image {
    aspect-ratio: 16 / 9;
    background: var(--bg-elev-2);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
  }

  .card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }

  .card-body {
    padding: 1rem 1.1rem 1.2rem;
  }

  .card-body h3 {
    margin-bottom: 0.25rem;
  }

  .how {
    background: var(--bg-elev);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .how-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1rem;
  }

  .how-card {
    padding: 1.25rem 1.3rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .how-card h3 {
    margin-bottom: 0.5rem;
  }
</style>
