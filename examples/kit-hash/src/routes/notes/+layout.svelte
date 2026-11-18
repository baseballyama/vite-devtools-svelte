<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
  let filter = $state('');
  let shown = $derived(
    data.notes.filter(n => n.title.toLowerCase().includes(filter.toLowerCase())),
  );
</script>

<div class="split">
  <aside>
    <input placeholder="Filter notes" bind:value={filter} />
    <ul>
      {#each shown as note (note.slug)}
        <li>
          <a
            href={resolve('/notes/[slug]', { slug: note.slug })}
            aria-current={page.params.slug === note.slug ? 'page' : undefined}>{note.title}</a
          >
        </li>
      {/each}
    </ul>
  </aside>
  <section>{@render children()}</section>
</div>

<style>
  .split {
    display: grid;
    grid-template-columns: 14rem 1fr;
    gap: 1rem;
  }
  [aria-current='page'] {
    font-weight: bold;
  }
</style>
