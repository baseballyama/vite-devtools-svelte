<script lang="ts">
  import { base } from '$app/paths'
  import CodeBlock from '$lib/CodeBlock.svelte'

  const installCode = `npm install -D vite-devtools-svelte`

  const configCode = `import { svelteDevtools } from 'vite-devtools-svelte'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    svelteDevtools(),
    sveltekit(),
  ],
})`

  const runCode = `npm run dev`

  const optionsCode = `svelteDevtools({
  // Enable component lifecycle tracking (default: true)
  componentTracking: true,
})`

  const steps = [
    { num: '01', title: 'Install', anchor: 'install' },
    { num: '02', title: 'Configure Vite', anchor: 'configure' },
    { num: '03', title: 'Run the dev server', anchor: 'run' },
    { num: '04', title: 'Options', anchor: 'options' },
  ]
</script>

<svelte:head>
  <title>Getting Started — vite-devtools-svelte</title>
</svelte:head>

<section class="hero">
  <div class="grid-bg" aria-hidden="true"></div>
  <div class="container narrow">
    <div class="head-meta">
      <span class="eyebrow"><span class="eyebrow-num">§ setup</span> · getting started</span>
      <span class="mono dim">~3 minutes</span>
    </div>
    <h1>Getting Started.</h1>
    <p class="lead">
      Add the plugin to a Svelte 5 + SvelteKit project running on Vite 8 or
      later. The plugin is dev-only — production builds are unaffected.
    </p>

    <div class="requirements">
      <h4>Requirements</h4>
      <dl>
        <div class="req">
          <dt>Vite</dt>
          <dd>≥ 8.0.0</dd>
        </div>
        <div class="req">
          <dt>Svelte</dt>
          <dd>5 (runes mode)</dd>
        </div>
        <div class="req">
          <dt>SvelteKit</dt>
          <dd>recommended for full feature set</dd>
        </div>
      </dl>
    </div>
  </div>
</section>

<section class="section-sm">
  <div class="container narrow doc">
    <nav class="toc" aria-label="Table of contents">
      <span class="toc-label mono">contents</span>
      <ol>
        {#each steps as step (step.anchor)}
          <li>
            <a href="#{step.anchor}">
              <span class="toc-num mono">{step.num}</span>
              <span>{step.title}</span>
            </a>
          </li>
        {/each}
      </ol>
    </nav>

    <article class="content">
      <section id="install" class="step">
        <header class="step-head">
          <span class="step-num mono">01</span>
          <h2>Install</h2>
        </header>
        <CodeBlock code={installCode} lang="bash" />
      </section>

      <section id="configure" class="step">
        <header class="step-head">
          <span class="step-num mono">02</span>
          <h2>Configure Vite</h2>
        </header>
        <p>
          Add the plugin to your <code>vite.config.ts</code>. It must come
          <strong>before</strong>
          <code>sveltekit()</code> so its transforms run before the Svelte
          compiler.
        </p>
        <CodeBlock code={configCode} lang="ts" filename="vite.config.ts" />
      </section>

      <section id="run" class="step">
        <header class="step-head">
          <span class="step-num mono">03</span>
          <h2>Run the dev server</h2>
        </header>
        <CodeBlock code={runCode} lang="bash" />
        <p>
          Open the Vite DevTools UI in your browser. The Svelte panels appear
          in the sidebar.
        </p>
      </section>

      <section id="options" class="step">
        <header class="step-head">
          <span class="step-num mono">04</span>
          <h2>Options</h2>
        </header>
        <CodeBlock code={optionsCode} lang="ts" />
      </section>

      <section class="next">
        <h2 class="content-h2">Next steps</h2>
        <ul>
          <li>
            <a href="{base}/try">Try the live demo in StackBlitz</a>
          </li>
          <li>
            <a href="{base}/#panels">Browse the 15 panels</a>
          </li>
          <li>
            <a
              href="https://github.com/baseballyama/vite-devtools-svelte"
              target="_blank"
              rel="noreferrer noopener"
            >
              Read the README on GitHub
            </a>
          </li>
        </ul>
      </section>
    </article>
  </div>
</section>

<style>
  .hero {
    position: relative;
    padding: 4rem 0 3rem;
    border-bottom: 1px solid var(--line);
    overflow: hidden;
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

  h1 {
    margin: 0 0 1rem;
  }

  .lead {
    font-size: 1.15rem;
    color: var(--text-2);
    margin: 0 0 2.5rem;
    max-width: 620px;
    line-height: 1.6;
  }

  .requirements {
    border: 1px solid var(--line);
    background: var(--paper);
    border-radius: var(--radius-lg);
    padding: 1.4rem 1.6rem;
  }

  .requirements h4 {
    margin: 0 0 1rem;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin: 0;
  }

  @media (max-width: 600px) {
    dl {
      grid-template-columns: 1fr;
    }
  }

  .req {
    padding-left: 1rem;
    border-left: 2px solid var(--brand);
  }

  dt {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: 0.2rem;
  }

  dd {
    margin: 0;
    font-weight: 500;
    color: var(--text);
    font-size: 0.95rem;
  }

  .doc {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 3rem;
    align-items: start;
  }

  @media (max-width: 820px) {
    .doc {
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }
  }

  .toc {
    position: sticky;
    top: 88px;
  }

  @media (max-width: 820px) {
    .toc {
      position: static;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 1rem;
      background: var(--paper);
    }
  }

  .toc-label {
    display: block;
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: 0.8rem;
  }

  .toc ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .toc li {
    margin-bottom: 0.45rem;
  }

  .toc a {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    color: var(--text-2);
    font-size: 0.88rem;
    padding: 0.3rem 0;
    border-left: 2px solid transparent;
    padding-left: 0.6rem;
    margin-left: -0.6rem;
    transition: border-color 150ms var(--ease), color 150ms var(--ease);
  }

  .toc a:hover {
    color: var(--text);
    border-left-color: var(--brand);
    text-decoration: none;
  }

  .toc-num {
    color: var(--text-4);
    font-size: 0.72rem;
  }

  .step {
    margin-bottom: 3rem;
    scroll-margin-top: 88px;
  }

  .step-head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1.25rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid var(--line);
  }

  .step-head h2 {
    margin: 0;
    font-size: clamp(1.6rem, 2.6vw, 2.1rem);
  }

  .step-num {
    color: var(--brand);
    font-size: 0.78rem;
    letter-spacing: 0.1em;
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

  .next {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--line);
  }

  .next ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .next li {
    border-bottom: 1px solid var(--line);
  }

  .next a {
    display: block;
    padding: 0.85rem 0;
    color: var(--text);
  }

  .next a::after {
    content: ' →';
    color: var(--text-3);
    transition: color 200ms var(--ease), transform 200ms var(--ease);
  }

  .next a:hover {
    text-decoration: none;
    color: var(--brand);
  }
</style>
