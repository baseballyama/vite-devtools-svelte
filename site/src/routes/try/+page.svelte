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
</script>

<svelte:head>
  <title>Try Live — vite-devtools-svelte</title>
  <meta
    name="description"
    content="Try vite-devtools-svelte live in StackBlitz — runs the included SvelteKit playground in your browser with full DevTools support."
  />
</svelte:head>

<section class="section">
  <div class="container">
    <header class="head">
      <span class="tag">Live demo</span>
      <h1>Try it in StackBlitz</h1>
      <p class="lead">
        StackBlitz boots the repository's
        <code>playground/</code> SvelteKit app in a WebContainer and runs the
        full Vite dev server — DevTools panels included. No install required.
      </p>
      <div class="actions">
        <a
          class="btn btn-primary"
          href={openUrl}
          target="_blank"
          rel="noreferrer noopener">Open in a new tab ↗</a
        >
      </div>
    </header>

    <div class="frame">
      <iframe
        src={embedUrl}
        title="vite-devtools-svelte playground in StackBlitz"
        loading="lazy"
        allow="clipboard-read; clipboard-write; cross-origin-isolated"
        sandbox="allow-scripts allow-popups allow-forms allow-same-origin allow-modals allow-pointer-lock"
      ></iframe>
    </div>

    <div class="hint">
      <h2>How to use</h2>
      <ol>
        <li>
          Click <strong>Run this project</strong> on the embed above. StackBlitz
          will clone the repo, install dependencies via <code>pnpm</code>, and
          run <code>pnpm dev</code>.
        </li>
        <li>
          Once the dev server is up, click the
          <strong>Vite DevTools</strong> floating button in the preview to open
          the DevTools UI.
        </li>
        <li>
          The Svelte panels (Components, Reactive Graph, Profiler, …) appear in
          the DevTools sidebar.
        </li>
      </ol>
      <p class="muted small">
        WebContainers run entirely in your browser — no code is sent to a
        server. First boot can take 30–60s as dependencies install.
      </p>
    </div>
  </div>
</section>

<style>
  .head {
    text-align: center;
    margin-bottom: 2rem;
  }

  .head h1 {
    margin: 0.6rem 0 0.6rem;
  }

  .lead {
    font-size: 1.1rem;
    color: var(--text-dim);
    max-width: 680px;
    margin: 0 auto 1.5rem;
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .frame {
    margin-top: 2rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--bg-elev);
    box-shadow: var(--shadow-md);
  }

  iframe {
    display: block;
    width: 100%;
    height: 78vh;
    min-height: 600px;
    border: 0;
  }

  .hint {
    margin-top: 2.5rem;
    padding: 1.5rem 1.75rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .hint h2 {
    margin-top: 0;
    margin-bottom: 0.75rem;
    font-size: 1.05rem;
  }

  .hint ol {
    padding-left: 1.2rem;
    margin: 0 0 0.75rem;
  }

  .hint li {
    margin-bottom: 0.4rem;
  }

  .small {
    font-size: 0.875rem;
  }
</style>
