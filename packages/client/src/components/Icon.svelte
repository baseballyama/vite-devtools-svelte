<script lang="ts">
  import { icons, type IconName } from '../lib/icons.js'

  let {
    name,
    size = 16,
    class: cls = '',
  }: { name: IconName; size?: number; class?: string } = $props()
</script>

<svg
  class="icon {cls}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- static, bundled SVG markup from lib/icons.ts keyed by a typed name -->
  {@html icons[name]}
</svg>

<style>
  .icon {
    flex-shrink: 0;
    display: block;
  }
</style>
