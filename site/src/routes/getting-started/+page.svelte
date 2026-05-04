<script lang="ts">
  import { base } from '$app/paths'
  import CodeBlock from '$lib/CodeBlock.svelte'

  const installCode = `npm install -D vite-devtools-svelte`

  const configCode = `import { svelteDevtools } from 'vite-devtools-svelte'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [
    svelteDevtools(),
    sveltekit(),
  ],
})`

  const runCode = `vp dev
# or with plain Vite:
npm run dev`

  const optionsCode = `svelteDevtools({
  // Enable component lifecycle tracking (default: true)
  componentTracking: true,
})`
</script>

<svelte:head>
  <title>Getting Started — vite-devtools-svelte</title>
</svelte:head>

<section class="section">
  <div class="container narrow">
    <span class="tag">Setup</span>
    <h1>Getting Started</h1>
    <p class="lead">
      Add the plugin to a Svelte 5 + SvelteKit project running on Vite 8 or
      later. The plugin is dev-only — production builds are unaffected.
    </p>

    <div class="callout">
      <strong>Requirements</strong>
      <ul>
        <li>Vite ≥ 8.0.0 (or Vite+)</li>
        <li>Svelte 5 (runes mode)</li>
        <li>SvelteKit recommended for full feature set</li>
      </ul>
    </div>

    <h2>1. Install</h2>
    <CodeBlock code={installCode} lang="bash" />

    <h2>2. Configure Vite</h2>
    <p>
      Add the plugin to your <code>vite.config.ts</code>. It must come
      <strong>before</strong>
      <code>sveltekit()</code> so its transforms run before the Svelte compiler.
    </p>
    <CodeBlock code={configCode} lang="ts" filename="vite.config.ts" />

    <p class="muted small">
      Note: this project uses
      <a href="https://viteplus.dev/" target="_blank" rel="noreferrer noopener"
        >Vite+</a
      >
      as its toolchain. With plain Vite, replace
      <code>'vite-plus'</code> with <code>'vite'</code> in the import above.
    </p>

    <h2>3. Run the dev server</h2>
    <CodeBlock code={runCode} lang="bash" />
    <p>
      Open the Vite DevTools UI in your browser. The Svelte panels appear in the
      sidebar.
    </p>

    <h2>Options</h2>
    <CodeBlock code={optionsCode} lang="ts" />

    <div class="next">
      <h2>Next steps</h2>
      <ul>
        <li>
          Try the live demo: <a href="{base}/try">Open in StackBlitz</a>
        </li>
        <li>
          Browse the <a href="{base}/#panels">15 panels</a>
        </li>
        <li>
          Read the
          <a
            href="https://github.com/baseballyama/vite-devtools-svelte"
            target="_blank"
            rel="noreferrer noopener">README on GitHub</a
          >
        </li>
      </ul>
    </div>
  </div>
</section>

<style>
  .narrow {
    max-width: 760px;
  }

  .lead {
    font-size: 1.1rem;
    color: var(--text-dim);
    margin-bottom: 2rem;
  }

  h2 {
    margin-top: 2.5rem;
  }

  .callout {
    border: 1px solid var(--border);
    background: var(--bg-elev);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    margin-bottom: 2rem;
  }

  .callout ul {
    margin: 0.5rem 0 0;
    padding-left: 1.2rem;
    color: var(--text-dim);
  }

  .small {
    font-size: 0.875rem;
  }

  .next {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .next ul {
    padding-left: 1.2rem;
  }

  .next li {
    margin-bottom: 0.4rem;
  }
</style>
