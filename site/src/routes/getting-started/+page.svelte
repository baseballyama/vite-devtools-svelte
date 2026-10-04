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

  const dockInstallCode = `npm install -D @vitejs/devtools`

  const dockConfigCode = `import { svelteDevtools } from 'vite-devtools-svelte'
import { DevTools } from '@vitejs/devtools'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelteDevtools(), DevTools(), sveltekit()],
})`

  const optionsCode = `svelteDevtools({
  // Enable component lifecycle tracking (default: true)
  componentTracking: true,
})`

  const steps = [
    { num: '01', title: 'Install', anchor: 'install' },
    { num: '02', title: 'Configure Vite', anchor: 'configure' },
    { num: '03', title: 'Run the dev server', anchor: 'run' },
    { num: '04', title: 'Vite DevTools dock (optional)', anchor: 'dock' },
    { num: '05', title: 'Options', anchor: 'options' },
  ]
</script>

<svelte:head>
  <title>Getting Started — vite-devtools-svelte</title>
</svelte:head>

<section class="band no-border hero">
  <div class="container">
    <div class="head-meta">
      <span class="eyebrow"><span class="eyebrow-num">§ setup</span> · getting started</span>
      <span class="mono dim">~3 minutes</span>
    </div>
    <h1>Getting Started.</h1>
    <p class="lead">
      Add the plugin to a Svelte 5 + SvelteKit project running on Vite 8.3.2 or
      later. It runs only in the dev server; production builds are unaffected.
    </p>
    <p class="release-note">
      These steps need <strong>vite-devtools-svelte ≥ 0.4.0</strong> (built on
      Devframe, not yet published). The latest published version, 0.3.0, is
      documented to run inside <code>@vitejs/devtools</code>.
    </p>

    <div class="requirements">
      <h2 class="req-title">Requirements</h2>
      <dl>
        <div class="req">
          <dt>vite-devtools-svelte</dt>
          <dd>≥ 0.4.0 — not yet published; 0.3.0 is documented to run inside @vitejs/devtools</dd>
        </div>
        <div class="req">
          <dt>Vite</dt>
          <dd>≥ 8.3.2</dd>
        </div>
        <div class="req">
          <dt>Svelte</dt>
          <dd>5 (runes mode)</dd>
        </div>
        <div class="req">
          <dt>SvelteKit</dt>
          <dd>recommended for full feature set</dd>
        </div>
        <div class="req">
          <dt>@vitejs/devtools</dt>
          <dd>≥ 0.7.6 — optional, only for the in-page dock</dd>
        </div>
      </dl>
    </div>
  </div>
</section>

<section class="band">
  <div class="container doc">
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
          Open <code>/.svelte-devtools/</code> on your dev server, for example
          <code>http://localhost:5173/.svelte-devtools/</code>. The first time,
          the page asks for a one-time code: the dev server prints a 6-digit code
          and a link in the terminal. Type the code, or open the link.
        </p>
        <p>
          That browser is then trusted: reloads and dev-server restarts don't ask
          again. Trusted tokens are stored by the dev server in
          <code>~/.svelte-devtools/devframe/auth.json</code>, shared by all
          projects on this machine. The browser keeps its token per origin, so a
          dev server on another port or host asks for a code again.
        </p>
      </section>

      <section id="dock" class="step">
        <header class="step-head">
          <span class="step-num mono">04</span>
          <h2>Inside the Vite DevTools dock</h2>
        </header>
        <p>
          Optional. With <code>@vitejs/devtools</code> installed, the same panels
          open as a <strong>Svelte</strong> entry in the Vite DevTools dock
          instead of standalone.
        </p>
        <CodeBlock code={dockInstallCode} lang="bash" />
        <p>
          Add <code>DevTools()</code> after <code>svelteDevtools()</code> and
          before <code>sveltekit()</code>:
        </p>
        <CodeBlock code={dockConfigCode} lang="ts" filename="vite.config.ts" />
        <p>
          Sign-in is handled once by Vite DevTools' own authentication. The panels
          also stay reachable at <code>/.svelte-devtools/</code>.
        </p>
      </section>

      <section id="options" class="step">
        <header class="step-head">
          <span class="step-num mono">05</span>
          <h2>Options</h2>
        </header>
        <CodeBlock code={optionsCode} lang="ts" />
      </section>

      <section class="next">
        <h2 class="content-h2">Next steps</h2>
        <ul>
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
    padding-bottom: 3.5rem;
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

  /* Same look as the old h4 label; h2 keeps the heading order under the page h1. */
  .req-title {
    margin: 0 0 1rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    line-height: 1.4;
    text-transform: uppercase;
    color: var(--text-3);
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
    color: var(--text-3);
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

  /* --brand is 3.18:1 on the light background; --link is the accent's text tone (4.89:1). */
  :global(html[data-theme='light']) .step-num {
    color: var(--link);
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
  .release-note {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--text-2);
    font-size: 0.92rem;
  }
</style>
