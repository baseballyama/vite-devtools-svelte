<script lang="ts">
  import { setContext, type Component } from 'svelte'
  import { PANEL_ACTIVE } from '../lib/resource.svelte.js'

  /** Keeps a visited panel mounted; exposes visibility so polling pauses. */
  let { component: Panel, active }: { component: Component; active: boolean } = $props()

  setContext(PANEL_ACTIVE, () => active)
</script>

<div class="host" hidden={!active}>
  <Panel />
</div>

<style>
  .host {
    height: 100%;
    min-height: 0;
  }
  .host[hidden] {
    display: none;
  }
</style>
