<script lang="ts">
  import { resolve } from '$app/paths';

  import CodeBlock from '#lib/CodeBlock.svelte';
  import { panels } from '#lib/panels.ts';

  const installCode = `npm install -D @sveltejs/vite-devtools-svelte @vitejs/devtools`;

  const configCode = `import { svelteDevtools } from '@sveltejs/vite-devtools-svelte'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  devtools: { apply: 'serve' },
  plugins: [svelteDevtools(), sveltekit()],
})`;

  const runCode = `npm run dev`;

  const standaloneCode = `npm install -D @sveltejs/vite-devtools-svelte`;

  const optionsCode = `svelteDevtools({
  // Track component instances and their state (default: true)
  componentTracking: true,
  // Ask for the one-time code on /.svelte-devtools/ (default: true)
  clientAuth: true,
  // Svelte Inspector options (dock only)
  inspector: { toggleKeyCombo: 'alt-x', holdMode: true },
})`;

  const steps = [
    { num: '01', title: 'Install', anchor: 'install' },
    { num: '02', title: 'Configure Vite', anchor: 'configure' },
    { num: '03', title: 'Open the dock', anchor: 'run' },
    { num: '04', title: 'Without Vite DevTools', anchor: 'standalone' },
    { num: '05', title: 'Options', anchor: 'options' },
  ];
</script>

<svelte:head>
  <title>Getting started · vite-devtools-svelte</title>
</svelte:head>

<section class="band no-border hero">
  <div class="container">
    <div class="head-meta">
      <span class="eyebrow"><span class="eyebrow-num">§ setup</span> · getting started</span>
      <span class="mono dim">~3 minutes</span>
    </div>
    <h1>Getting Started.</h1>
    <p class="lead">
      Add the plugin and Vite DevTools to a Svelte 5 project on Vite 8.3.5 or later. It runs only in
      the dev server; production builds are unaffected.
    </p>

    <div class="requirements">
      <h2 class="req-title">Requirements</h2>
      <dl>
        <div class="req">
          <dt>Vite</dt>
          <dd>8.3.5 or later</dd>
        </div>
        <div class="req">
          <dt>Svelte</dt>
          <dd>5.46.4 or later</dd>
        </div>
        <div class="req">
          <dt>SvelteKit</dt>
          <dd>3.3.0 or later, optional: Routes, Load functions, API and Build need it</dd>
        </div>
        <div class="req">
          <dt>@vitejs/devtools</dt>
          <dd>0.8.3 or later, for the Vite DevTools dock</dd>
        </div>
        <div class="req">
          <dt>Node.js</dt>
          <dd>22 or later</dd>
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
        <p>Install the plugin and Vite DevTools.</p>
        <CodeBlock code={installCode} lang="bash" />
      </section>

      <section id="configure" class="step">
        <header class="step-head">
          <span class="step-num mono">02</span>
          <h2>Configure Vite</h2>
        </header>
        <p>
          Turn on Vite DevTools with Vite's <code>devtools</code> option and add the plugin to your
          <code>vite.config.ts</code>. <code>apply: 'serve'</code> keeps Vite DevTools out of
          <code>vite build</code>. <code>svelteDevtools()</code> must come
          <strong>before</strong>
          <code>sveltekit()</code> so its transforms run before the Svelte compiler.
        </p>
        <CodeBlock code={configCode} lang="ts" filename="vite.config.ts" />
      </section>

      <section id="run" class="step">
        <header class="step-head">
          <span class="step-num mono">03</span>
          <h2>Open the dock</h2>
        </header>
        <CodeBlock code={runCode} lang="bash" />
        <p>
          Open your app, click the floating Vite DevTools handle and open the
          <strong>Svelte tools</strong> group. It has Overview, Problems, Inspect, Profile and
          Project, the Svelte Inspector (Pick element and Inspector settings), and Add, which
          installs
          <code>sv</code> add-ons.
        </p>
        <p>
          Vite DevTools signs in the browser once for the whole dock (to skip it on a single-user
          machine, see <a href="#standalone">below</a>). The Svelte Inspector loads after that: hold
          <code>alt-x</code> in your app and click an element to open its source in your editor.
        </p>
        <p>
          If you use vite-plugin-svelte's own inspector (<code>vitePlugin.inspector</code>), turn it
          off: the dev server does not start with both.
        </p>
      </section>

      <section id="standalone" class="step">
        <header class="step-head">
          <span class="step-num mono">04</span>
          <h2>Without Vite DevTools</h2>
        </header>
        <p>
          Without <code>@vitejs/devtools</code>, install only the plugin and leave out the
          <code>devtools</code> option. The panels then open on their own page at
          <code>/.svelte-devtools/</code>, and the dev server prints its URL. The Svelte Inspector
          and the Add panel need the dock.
        </p>
        <CodeBlock code={standaloneCode} lang="bash" />
        <p>
          The first time, the page asks for a one-time code: the dev server prints a 6-digit code
          and a link in the terminal. Type the code, or open the link. That browser is then trusted,
          also after reloads and dev-server restarts.
        </p>
        <p>
          On a single-user machine where the dev server only listens on <code>localhost</code>, you
          can skip the code with <code>svelteDevtools(&#123; clientAuth: false &#125;)</code>, or
          <code>devtools: &#123; apply: 'serve', clientAuth: false &#125;</code> for the dock. Without
          it, any page or device that can reach the dev server can read your project files through the
          DevTools, so keep it on if you are unsure.
        </p>
      </section>

      <section id="options" class="step">
        <header class="step-head">
          <span class="step-num mono">05</span>
          <h2>Options</h2>
        </header>
        <CodeBlock code={optionsCode} lang="ts" />
        <p>
          <code>inspector</code> also takes <code>navKeys</code>, <code>openKey</code>,
          <code>openMenuKey</code>, <code>escapeKeys</code> and <code>customStyles</code>.
        </p>
      </section>

      <section class="next">
        <h2 class="content-h2">Next steps</h2>
        <ul>
          <li>
            <a href={resolve('/#panels')}>Browse the {panels.length} panels</a>
          </li>
          <li>
            <a href={resolve('/mcp')}>Let your AI agent read the DevTools over MCP</a>
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
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    color: var(--text-3);
  }

  .head-meta::after {
    content: '';
    flex: 1 1 4rem;
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

  /* h2 keeps the heading order under the page h1. */
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
      grid-template-columns: minmax(0, 1fr);
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
      grid-template-columns: minmax(0, 1fr);
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
    transition:
      border-color 150ms var(--ease),
      color 150ms var(--ease);
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

  .content {
    min-width: 0;
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
    transition:
      color 200ms var(--ease),
      transform 200ms var(--ease);
  }

  .next a:hover {
    text-decoration: none;
    color: var(--brand);
  }
</style>
