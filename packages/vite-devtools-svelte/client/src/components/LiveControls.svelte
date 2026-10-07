<script lang="ts">
  import type { Resource } from '../lib/resource.svelte.js'
  import { formatAgo } from '../lib/format.js'
  import Button from './Button.svelte'

  /** Live/paused toggle + manual refresh for polling resources. */
  let { res, onclear }: { res: Resource<unknown>; onclear?: () => void } = $props()

  let now = $state(Date.now())
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 5000)
    return () => clearInterval(id)
  })
</script>

<button
  type="button"
  class="live"
  class:on={res.live}
  aria-pressed={res.live}
  title={res.live ? 'Live updates on — click to pause' : 'Paused — click to resume live updates'}
  onclick={() => (res.live = !res.live)}
>
  <span class="dot" aria-hidden="true"></span>
  {res.live ? 'Live' : 'Paused'}
</button>
<Button
  icon="refresh"
  variant="ghost"
  label="Refresh (updated {formatAgo(res.updatedAt, now)})"
  disabled={res.busy}
  onclick={() => res.refresh()}
/>
{#if onclear}
  <Button icon="trash" variant="ghost" label="Clear recorded data" onclick={onclear} />
{/if}

<style>
  .live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--control-h);
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    font-weight: 500;
  }
  .live:hover {
    border-color: var(--border-strong);
    color: var(--fg);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-faint);
  }
  /* Static on purpose: in the Vite DevTools dock this UI shares the app's
     main thread, so a never-ending animation (a box-shadow pulse here
     forced a style recalc + paint every frame) lowers the frame rate the
     Frame rate panel measures. */
  .on .dot {
    background: var(--green);
    box-shadow: 0 0 0 2px rgb(74 222 128 / 0.25);
  }
</style>
