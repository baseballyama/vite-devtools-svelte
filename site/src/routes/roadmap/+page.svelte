<script lang="ts">
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head>
  <title>Roadmap — vite-devtools-svelte</title>
</svelte:head>

<section class="section">
  <div class="container narrow">
    <span class="tag">Plan</span>
    <h1>Roadmap</h1>
    <p class="lead">
      Research, design decisions, and the implementation plan behind
      vite-devtools-svelte. Pulled from
      <code>ROADMAP.md</code>.
    </p>

    <article class="prose">
      {@html data.html}
    </article>
  </div>
</section>

<style>
  .narrow {
    max-width: 820px;
  }

  .lead {
    color: var(--text-dim);
    margin-bottom: 2rem;
  }

  .prose :global(h1) {
    font-size: 1.6rem;
    margin-top: 2.5rem;
  }

  .prose :global(h2) {
    font-size: 1.3rem;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .prose :global(h3) {
    font-size: 1.05rem;
    margin-top: 1.5rem;
  }

  .prose :global(p) {
    line-height: 1.7;
  }

  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.4rem;
  }

  .prose :global(li) {
    margin-bottom: 0.3rem;
  }

  .prose :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0 1.5rem;
    font-size: 0.92rem;
  }

  .prose :global(th),
  .prose :global(td) {
    border: 1px solid var(--border);
    padding: 0.5rem 0.7rem;
    text-align: left;
    vertical-align: top;
  }

  .prose :global(th) {
    background: var(--bg-elev);
    font-weight: 600;
  }

  .prose :global(blockquote) {
    border-left: 3px solid var(--brand);
    padding: 0.4rem 1rem;
    color: var(--text-dim);
    background: var(--bg-elev);
    border-radius: 0 var(--radius) var(--radius) 0;
    margin: 1rem 0;
  }

  .prose :global(hr) {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 2rem 0;
  }
</style>
