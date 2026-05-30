<script lang="ts">
  const repo = 'baseballyama/vite-devtools-svelte'
  const file = 'playground/src/routes/+page.svelte'

  // Open StackBlitz in a top-level tab rather than a nested iframe — the DevTools
  // overlay UI does not initialize reliably inside StackBlitz's embed iframe.
  const openUrl = `https://stackblitz.com/github/${repo}?file=${encodeURIComponent(
    file,
  )}&terminal=dev`

  const steps = [
    {
      num: '01',
      title: 'Launch',
      body:
        'Click "Open in StackBlitz". The project opens in a new tab — StackBlitz clones the repo, installs deps via pnpm, and runs pnpm dev.',
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
          Open in StackBlitz
          <span class="btn-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </header>

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
