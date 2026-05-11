<script lang="ts">
  const repo = 'baseballyama/vite-devtools-svelte'
  const file = 'playground/src/routes/+page.svelte'

  // ctl=1 (click-to-load) avoids burning StackBlitz embed quota until the user opts in.
  const embedUrl = `https://stackblitz.com/github/${repo}?embed=1&ctl=1&file=${encodeURIComponent(
    file,
  )}&terminal=dev&theme=dark&view=editor`

  const openUrl = `https://stackblitz.com/github/${repo}?file=${encodeURIComponent(
    file,
  )}&terminal=dev`

  const steps = [
    {
      num: '01',
      title: 'Run',
      body:
        'Click "Run this project" on the embed. StackBlitz clones the repo, installs deps via pnpm, and runs pnpm dev.',
    },
    {
      num: '02',
      title: 'Open DevTools',
      body:
        'Once the dev server is up, click the Vite DevTools floating button in the preview to open the DevTools UI.',
    },
    {
      num: '03',
      title: 'Explore',
      body:
        'The Svelte panels — Components, Reactive Graph, Profiler, and more — appear in the DevTools sidebar.',
    },
  ]
</script>

<svelte:head>
  <title>Try Live — vite-devtools-svelte</title>
  <meta
    name="description"
    content="Try vite-devtools-svelte live in StackBlitz — runs the included SvelteKit playground in your browser with full DevTools support."
  />
</svelte:head>

<section class="hero">
  <div class="grid-bg" aria-hidden="true"></div>
  <div class="container">
    <header class="head">
      <div class="head-meta">
        <span class="eyebrow">
          <span class="eyebrow-num">§ playground</span> · live demo
        </span>
        <span class="mono dim">webcontainer · stackblitz</span>
      </div>
      <h1>Try it in <em>StackBlitz</em>.</h1>
      <p class="lead">
        StackBlitz boots the repository's <code>playground/</code> SvelteKit app
        in a WebContainer and runs the full Vite dev server — DevTools panels
        included. No install required.
      </p>
      <div class="actions">
        <a
          class="btn btn-primary"
          href={openUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open in a new tab
          <span class="btn-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </header>

    <div class="frame">
      <header class="frame-chrome mono">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="frame-url">stackblitz.com/github/{repo}</span>
        <span class="frame-status">
          <span class="led"></span>
          embedded
        </span>
      </header>
      <iframe
        src={embedUrl}
        title="vite-devtools-svelte playground in StackBlitz"
        loading="lazy"
        allow="clipboard-read; clipboard-write; cross-origin-isolated"
        sandbox="allow-scripts allow-popups allow-forms allow-same-origin allow-modals allow-pointer-lock"
      ></iframe>
    </div>

    <section class="how-section">
      <div class="head-meta">
        <span class="eyebrow"><span class="eyebrow-num">§ flow</span> · 3 steps</span>
        <span class="mono dim">how to use</span>
      </div>
      <h2>How to use.</h2>

      <ol class="steps">
        {#each steps as step (step.num)}
          <li class="step">
            <span class="step-num mono">{step.num}</span>
            <div>
              <h3>{step.title}</h3>
              <p class="muted">{step.body}</p>
            </div>
          </li>
        {/each}
      </ol>

      <p class="hint mono">
        <span class="hint-bullet">⚐</span>
        WebContainers run entirely in your browser — no code is sent to a
        server. First boot can take 30–60 seconds while dependencies install.
      </p>
    </section>
  </div>
</section>

<style>
  .hero {
    position: relative;
    padding: 4rem 0 6rem;
    overflow: hidden;
  }

  .head {
    text-align: center;
    margin-bottom: 2.5rem;
    max-width: 820px;
    margin-left: auto;
    margin-right: auto;
  }

  .head-meta {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    color: var(--text-3);
    justify-content: center;
  }

  .head-meta::before,
  .head-meta::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .how-section .head-meta {
    justify-content: flex-start;
  }

  .how-section .head-meta::before {
    display: none;
  }

  h1 {
    margin: 0.6rem 0 0.8rem;
  }

  h1 em {
    color: var(--brand);
    font-style: italic;
    font-variation-settings: 'opsz' 144, 'SOFT' 100;
  }

  .lead {
    font-size: 1.1rem;
    color: var(--text-2);
    max-width: 660px;
    margin: 0 auto 1.75rem;
    line-height: 1.6;
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .btn-arrow {
    transition: transform 220ms var(--ease);
  }

  .btn:hover .btn-arrow {
    transform: translate(2px, -2px);
  }

  .frame {
    position: relative;
    margin-top: 2.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-xl);
    overflow: hidden;
    background: var(--paper);
    box-shadow: var(--shadow-lg);
  }

  .frame-chrome {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.6rem 0.85rem;
    background: var(--paper-2);
    border-bottom: 1px solid var(--line);
    font-size: 0.72rem;
    color: var(--text-3);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--bg-3);
  }

  .frame-chrome .dot:nth-child(1) {
    background: #ff5f57;
  }
  .frame-chrome .dot:nth-child(2) {
    background: #ffbd2e;
  }
  .frame-chrome .dot:nth-child(3) {
    background: #27c93f;
  }

  .frame-url {
    margin-left: 0.6rem;
    flex: 1;
    text-align: center;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .frame-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .led {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 4px var(--accent);
  }

  iframe {
    display: block;
    width: 100%;
    height: 78vh;
    min-height: 600px;
    border: 0;
    background: #0a0d10;
  }

  .how-section {
    margin-top: 4rem;
    max-width: 820px;
  }

  h2 {
    margin: 0 0 2rem;
  }

  .steps {
    list-style: none;
    margin: 0 0 2rem;
    padding: 0;
    border-top: 1px solid var(--line);
  }

  .step {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 1rem;
    padding: 1.25rem 0;
    border-bottom: 1px solid var(--line);
  }

  .step-num {
    color: var(--brand);
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    padding-top: 0.2rem;
  }

  .step h3 {
    margin: 0 0 0.25rem;
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 144, 'SOFT' 50;
    font-weight: 400;
    font-size: 1.4rem;
    letter-spacing: -0.025em;
  }

  .step p {
    margin: 0;
    max-width: 640px;
  }

  .hint {
    display: flex;
    gap: 0.6rem;
    padding: 1rem 1.25rem;
    border: 1px dashed var(--line);
    background: var(--paper);
    border-radius: var(--radius);
    color: var(--text-2);
    font-size: 0.82rem;
    line-height: 1.5;
  }

  .hint-bullet {
    color: var(--brand);
    font-size: 1rem;
    line-height: 1.2;
  }
</style>
