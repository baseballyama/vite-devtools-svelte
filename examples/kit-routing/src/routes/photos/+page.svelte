<script lang="ts">
  import { goto, preloadData } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  import type { PageProps } from './$types';
  import PhotoPage from './[id=integer]/+page.svelte';

  let { data }: PageProps = $props();

  // Shallow routing: load /photos/[id]'s data without navigating and show it in a
  // modal; the URL changes but the route (and this page) stays. (`pushState` is
  // deprecated in SvelteKit 3 in favour of `goto(url, { state, shallow: true })`.)
  async function open(event: MouseEvent, id: number) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    const href = resolve('/photos/[id=integer]', { id });
    const result = await preloadData(href);
    if (result.type === 'loaded' && result.status === 200) {
      await goto(href, {
        state: { photo: result.data.photo as App.PageState['photo'] },
        shallow: true,
      });
    } else {
      await goto(href);
    }
  }
</script>

<h1>Photos</h1>
<p>
  Click a photo: <code>preloadData</code> + <code>goto(…, &#123; shallow: true &#125;)</code> open it
  in a modal.
</p>
<ul class="grid">
  {#each data.photos as photo (photo.id)}
    <li>
      <a
        href={resolve('/photos/[id=integer]', { id: photo.id })}
        onclick={e => open(e, photo.id)}
        style:background={photo.color}
      >
        {photo.title}
      </a>
    </li>
  {/each}
</ul>

{#if page.state.photo}
  <div class="backdrop" role="presentation" onclick={() => history.back()}>
    <div
      class="modal"
      role="dialog"
      aria-label="Photo"
      tabindex="-1"
      onclick={e => e.stopPropagation()}
      onkeydown={e => e.key === 'Escape' && history.back()}
    >
      <PhotoPage
        data={{ requestId: data.requestId, photo: page.state.photo }}
        params={{ id: page.state.photo.id }}
      />
      <button type="button" onclick={() => history.back()}>close</button>
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 8rem);
    gap: 0.5rem;
    list-style: none;
    padding: 0;
  }
  .grid a {
    display: block;
    height: 5rem;
    color: white;
    padding: 0.5rem;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.4);
    display: grid;
    place-items: center;
  }
  .modal {
    background: white;
    padding: 1rem;
    min-width: 20rem;
  }
</style>
