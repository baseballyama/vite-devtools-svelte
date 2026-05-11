<script lang="ts">
  import { base } from '$app/paths'
  import { panels } from '$lib/panels'

  const stats = [
    { label: 'panels', value: '15' },
    { label: 'runtime overhead', value: '0' },
    { label: 'config required', value: '0' },
    { label: 'transport', value: 'WS' },
  ]

  const pipeline = [
    {
      step: '01',
      title: 'Runtime wrapper',
      body:
        'Intercepts svelte/internal/client to track component lifecycle and reactive signals — $state, $derived, $effect.',
      tag: 'in browser',
    },
    {
      step: '02',
      title: 'HMR channel',
      body:
        'Streams runtime data — component tree, render profiles, reactive graph — from the browser to the dev server via WebSocket.',
      tag: 'ws · dual-rpc',
    },
    {
      step: '03',
      title: 'Static analyzers',
      body:
        'Extract routes, component relations, assets, and project metadata straight from the filesystem — no runtime instrumentation needed.',
      tag: 'fs',
    },
    {
      step: '04',
      title: 'DevTools panels',
      body:
        'Mounted in the Vite DevTools Kit shell. Dev-only, opt-in, with HTTP fallback for older DevTools Kit versions.',
      tag: 'in devtools',
    },
  ]
</script>

<svelte:head>
  <title>vite-devtools-svelte — DevTools for Svelte, inside Vite</title>
</svelte:head>

<section class="hero">
  <div class="grid-bg" aria-hidden="true"></div>
  <span class="crosshair" style="top:24px;left:24px"></span>
  <span class="crosshair" style="top:24px;right:24px"></span>

  <div class="container hero-inner">
    <h1 class="hero-title reveal reveal-2">
      DevTools for <em>Svelte</em>,<br />
      inside <em>Vite</em>.
    </h1>

    <p class="lead reveal reveal-3">
      A Vite DevTools plugin for Svelte and SvelteKit. Fifteen specialized
      panels for inspecting components, profiling reactivity, debugging routes,
      and everything in between — without leaving your dev server.
    </p>

    <div class="cta reveal reveal-4">
      <a class="btn btn-primary" href="{base}/getting-started">
        Get Started
        <span class="btn-arrow" aria-hidden="true">→</span>
      </a>
      <a class="btn btn-secondary" href="{base}/try">
        Try Live in StackBlitz
      </a>
      <a
        class="btn btn-ghost"
        href="https://github.com/baseballyama/vite-devtools-svelte"
        target="_blank"
        rel="noreferrer noopener"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.04c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.93 10.93 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.15v3.18c0 .31.21.68.8.56 4.57-1.52 7.85-5.83 7.85-10.91C23.5 5.65 18.35.5 12 .5Z"
          />
        </svg>
        Source
      </a>
    </div>

    <div class="install-line reveal reveal-4">
      <span class="prompt">$</span>
      <span class="cmd">npm install -D vite-devtools-svelte</span>
      <span class="caret" aria-hidden="true"></span>
    </div>

    <figure class="hero-frame reveal reveal-5">
      <header class="frame-chrome">
        <div class="dots" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="frame-tabs">
          <span class="tab active">overview.svelte</span>
          <span class="tab">reactive.graph</span>
          <span class="tab">profiler.ts</span>
        </div>
        <div class="frame-status mono">
          <span class="status-led"></span>
          <span>vite-devtools-svelte</span>
        </div>
      </header>
      <div class="frame-body">
        <img
          src="{base}/images/panel-overview.png"
          alt="Overview panel of vite-devtools-svelte"
          loading="eager"
        />
      </div>
      <footer class="frame-foot mono">
        <span><span class="led led-green"></span> dev-server: ready</span>
        <span class="foot-sep">·</span>
        <span>15 panels</span>
        <span class="foot-sep">·</span>
        <span>RPC: WS + HTTP fallback</span>
        <span class="foot-sep">·</span>
        <span class="dim">UTF-8 · LF</span>
      </footer>
    </figure>
  </div>
</section>

<section class="stats">
  <div class="container">
    <div class="stat-grid">
      {#each stats as s, i (s.label)}
        <div class="stat" style="--i:{i}">
          <div class="stat-value">{s.value}</div>
          <div class="stat-label mono">{s.label}</div>
        </div>
      {/each}
    </div>
  </div>
</section>

<section class="section panels-section" id="panels">
  <div class="container">
    <div class="section-head">
      <div class="head-meta">
        <span class="eyebrow"><span class="eyebrow-num">§ 01</span> · catalogue</span>
        <span class="mono dim">panels[0..14]</span>
      </div>
      <h2>Fifteen panels,<br />one workflow.</h2>
      <p class="lead-small muted">
        Every panel is opt-in, dev-only, and adds zero overhead to your
        production build. Mix and match — pick the ones you need, ignore the rest.
      </p>
    </div>

    <div class="panel-grid">
      {#each panels as p, i (p.slug)}
        <a class="panel-card" href="{base}/panels/{p.slug}">
          <div class="panel-card-head">
            <span class="panel-num mono">{String(i + 1).padStart(2, '0')}</span>
            <span class="panel-arrow" aria-hidden="true">→</span>
          </div>
          <div class="panel-card-image">
            <img
              src="{base}/images/{p.images[0]}"
              alt={p.title}
              loading={i < 3 ? 'eager' : 'lazy'}
            />
          </div>
          <div class="panel-card-body">
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
      <div class="head-meta">
        <span class="eyebrow"><span class="eyebrow-num">§ 02</span> · architecture</span>
        <span class="mono dim">virtual-modules · ws · fs</span>
      </div>
      <h2>How it works.</h2>
      <p class="lead-small muted">
        A virtual-module architecture instead of fragile regex transforms.
        Runtime data flows out, static analysis flows in.
      </p>
    </div>

    <ol class="pipeline">
      {#each pipeline as item, i (item.step)}
        <li class="pipeline-item">
          <div class="pipeline-rail" aria-hidden="true">
            <span class="rail-num mono">{item.step}</span>
            <span class="rail-line"></span>
          </div>
          <div class="pipeline-body">
            <div class="pipeline-head">
              <h3>{item.title}</h3>
              <span class="pipeline-tag mono">{item.tag}</span>
            </div>
            <p class="muted">{item.body}</p>
          </div>
          {#if i < pipeline.length - 1}
            <span class="pipeline-arrow mono" aria-hidden="true">▼</span>
          {/if}
        </li>
      {/each}
    </ol>
  </div>
</section>

<section class="section cta-section">
  <div class="container">
    <div class="cta-block">
      <div class="cta-content">
        <span class="eyebrow"><span class="eyebrow-num">§ 03</span> · start</span>
        <h2>Open the workshop.</h2>
        <p class="muted">
          Three lines of config. No production code touched. Drop the plugin
          into a Svelte 5 + Vite 8 project and the panels appear in your
          DevTools sidebar.
        </p>
        <div class="cta">
          <a class="btn btn-primary" href="{base}/getting-started">
            Read the setup
            <span class="btn-arrow" aria-hidden="true">→</span>
          </a>
          <a class="btn btn-secondary" href="{base}/try">
            Open in StackBlitz
          </a>
        </div>
      </div>
      <pre class="cta-snippet"><span class="comment">// vite.config.ts</span>
<span class="kw">import</span> &#123; svelteDevtools &#125; <span class="kw">from</span> <span class="str">'vite-devtools-svelte'</span>
<span class="kw">import</span> &#123; sveltekit &#125; <span class="kw">from</span> <span class="str">'@sveltejs/kit/vite'</span>
<span class="kw">import</span> &#123; defineConfig &#125; <span class="kw">from</span> <span class="str">'vite'</span>

<span class="kw">export default</span> <span class="fn">defineConfig</span>(&#123;
  plugins: [
    <span class="fn">svelteDevtools</span>(),
    <span class="fn">sveltekit</span>(),
  ],
&#125;)</pre>
    </div>
  </div>
</section>

<style>
  /* ---------- hero ---------- */

  .hero {
    position: relative;
    padding: 5.5rem 0 4rem;
    overflow: hidden;
    isolation: isolate;
    background:
      radial-gradient(
        ellipse 70% 50% at 50% 0%,
        var(--brand-glow),
        transparent 60%
      );
  }

  .hero::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(
        180deg,
        transparent 0%,
        var(--bg) 92%
      );
    pointer-events: none;
    z-index: 1;
  }

  .hero-inner {
    position: relative;
    z-index: 2;
    text-align: center;
  }

  .hero-title {
    margin: 0 0 1.5rem;
    text-align: center;
  }

  .hero-title em {
    color: var(--brand);
    font-style: italic;
    font-variation-settings: 'opsz' 144, 'SOFT' 100;
  }

  .lead {
    font-size: clamp(1.05rem, 1.3vw, 1.2rem);
    color: var(--text-2);
    max-width: 640px;
    margin: 0 auto 2rem;
    line-height: 1.6;
  }

  .cta {
    display: flex;
    gap: 0.65rem;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }

  .btn-arrow {
    transition: transform 220ms var(--ease);
  }

  .btn:hover .btn-arrow {
    transform: translateX(3px);
  }

  .install-line {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.95rem;
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--paper) 50%, transparent);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-2);
    margin-bottom: 4rem;
  }

  .prompt {
    color: var(--brand);
  }

  .caret {
    display: inline-block;
    width: 7px;
    height: 14px;
    background: var(--text-2);
    margin-left: 2px;
    animation: blink 1.1s steps(2) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .hero-frame {
    position: relative;
    margin: 0 auto;
    max-width: 1080px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
    box-shadow:
      var(--shadow-lg),
      0 0 0 1px var(--line-faint);
  }

  .frame-chrome {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.65rem 0.85rem;
    background: var(--paper-2);
    border-bottom: 1px solid var(--line);
  }

  .dots {
    display: inline-flex;
    gap: 6px;
  }

  .dots span {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--bg-3);
  }

  .dots span:nth-child(1) {
    background: #ff5f57;
  }
  .dots span:nth-child(2) {
    background: #ffbd2e;
  }
  .dots span:nth-child(3) {
    background: #27c93f;
  }

  .frame-tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    overflow: hidden;
  }

  .tab {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 0.32rem 0.65rem;
    border-radius: 5px;
    color: var(--text-3);
    background: transparent;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .tab.active {
    color: var(--text);
    background: var(--paper);
    border-color: var(--line);
  }

  .frame-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--text-3);
  }

  .status-led {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }

  .frame-body {
    position: relative;
    background: var(--bg-1);
  }

  .frame-body img {
    width: 100%;
    display: block;
  }

  .frame-foot {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.85rem;
    border-top: 1px solid var(--line);
    background: var(--paper-2);
    font-size: 0.7rem;
    color: var(--text-2);
    flex-wrap: wrap;
  }

  .led {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 0.35rem;
    vertical-align: 1px;
  }

  .led-green {
    background: var(--accent);
    box-shadow: 0 0 4px var(--accent);
  }

  .foot-sep {
    color: var(--text-4);
  }

  /* ---------- stats ---------- */

  .stats {
    padding: 2rem 0 3rem;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    background: var(--paper);
    position: relative;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
  }

  @media (max-width: 720px) {
    .stat-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .stat {
    text-align: center;
    padding: 1.25rem 1rem;
    border-right: 1px solid var(--line);
  }

  .stat:last-child {
    border-right: 0;
  }

  @media (max-width: 720px) {
    .stat:nth-child(2n) {
      border-right: 0;
    }
    .stat:nth-child(-n + 2) {
      border-bottom: 1px solid var(--line);
    }
  }

  .stat-value {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 144, 'SOFT' 50;
    font-weight: 360;
    font-size: clamp(2.5rem, 4vw, 3.5rem);
    line-height: 1;
    color: var(--text);
    margin-bottom: 0.4rem;
    letter-spacing: -0.04em;
  }

  .stat-label {
    font-size: 0.7rem;
    color: var(--text-3);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  /* ---------- section heads ---------- */

  .section-head {
    margin-bottom: 3.5rem;
    max-width: 720px;
  }

  .head-meta {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.1rem;
    color: var(--text-3);
  }

  .head-meta::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .lead-small {
    font-size: 1.05rem;
    max-width: 580px;
    line-height: 1.6;
  }

  /* ---------- panels grid ---------- */

  .panel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1px;
    border: 1px solid var(--line);
    background: var(--line);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .panel-card {
    display: flex;
    flex-direction: column;
    background: var(--paper);
    color: inherit;
    transition:
      background 200ms var(--ease),
      transform 240ms var(--ease-out);
    position: relative;
  }

  .panel-card:hover {
    text-decoration: none;
    background: var(--paper-2);
    z-index: 2;
  }

  .panel-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.1rem 0.5rem;
  }

  .panel-num {
    font-size: 0.7rem;
    color: var(--text-3);
    letter-spacing: 0.1em;
  }

  .panel-arrow {
    color: var(--text-4);
    font-family: var(--font-mono);
    font-size: 0.95rem;
    transition:
      color 200ms var(--ease),
      transform 240ms var(--ease-out);
  }

  .panel-card:hover .panel-arrow {
    color: var(--brand);
    transform: translate(3px, -3px);
  }

  .panel-card-image {
    aspect-ratio: 16 / 9;
    background: var(--bg-1);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    overflow: hidden;
    position: relative;
  }

  .panel-card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
    transition: transform 600ms var(--ease-out);
  }

  .panel-card:hover .panel-card-image img {
    transform: scale(1.03);
  }

  .panel-card-body {
    padding: 1rem 1.1rem 1.25rem;
  }

  .panel-card-body h3 {
    margin: 0 0 0.25rem;
    font-size: 1.05rem;
    font-weight: 500;
  }

  .panel-card-body p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.45;
  }

  /* ---------- pipeline ---------- */

  .how {
    background: var(--paper);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .pipeline {
    list-style: none;
    margin: 0;
    padding: 0;
    counter-reset: pipeline;
    max-width: 880px;
  }

  .pipeline-item {
    position: relative;
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 0;
    padding: 1.5rem 0;
    border-top: 1px solid var(--line);
  }

  .pipeline-item:last-child {
    border-bottom: 1px solid var(--line);
  }

  .pipeline-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 0.35rem;
  }

  .rail-num {
    font-size: 0.72rem;
    color: var(--text-3);
    letter-spacing: 0.12em;
  }

  .rail-line {
    flex: 1;
    width: 1px;
    background: var(--line);
    margin-top: 0.6rem;
  }

  .pipeline-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.3rem;
  }

  .pipeline-head h3 {
    margin: 0;
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 144, 'SOFT' 50;
    font-weight: 400;
    font-size: 1.6rem;
    letter-spacing: -0.03em;
  }

  .pipeline-tag {
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-3);
    border: 1px solid var(--line);
    padding: 0.18em 0.6em;
    border-radius: 999px;
    white-space: nowrap;
  }

  .pipeline-body {
    padding-right: 0.5rem;
  }

  .pipeline-body p {
    margin: 0;
    max-width: 640px;
  }

  .pipeline-arrow {
    position: absolute;
    bottom: -8px;
    left: 28px;
    transform: translateX(-50%);
    color: var(--brand);
    font-size: 0.65rem;
    background: var(--paper);
    padding: 0 4px;
  }

  /* ---------- cta block ---------- */

  .cta-block {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 3rem;
    align-items: center;
    padding: 3rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-xl);
    background:
      linear-gradient(
        135deg,
        var(--paper) 0%,
        var(--paper-2) 100%
      );
    position: relative;
    overflow: hidden;
  }

  .cta-block::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        circle at 100% 0%,
        var(--brand-glow),
        transparent 50%
      );
    pointer-events: none;
  }

  .cta-content {
    position: relative;
  }

  .cta-content h2 {
    margin: 0.8rem 0 1rem;
  }

  .cta-content .cta {
    justify-content: flex-start;
    margin-bottom: 0;
  }

  .cta-snippet {
    position: relative;
    margin: 0;
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1.25rem 1.4rem;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.7;
    color: var(--text-2);
    overflow-x: auto;
    box-shadow: var(--shadow-md);
  }

  .cta-snippet :global(.kw) {
    color: var(--brand-soft);
  }

  .cta-snippet :global(.str) {
    color: var(--accent);
  }

  .cta-snippet :global(.fn) {
    color: var(--accent-2);
  }

  .cta-snippet :global(.comment) {
    color: var(--text-4);
    font-style: italic;
  }

  @media (max-width: 820px) {
    .cta-block {
      grid-template-columns: 1fr;
      padding: 2rem 1.5rem;
      gap: 2rem;
    }
  }
</style>
