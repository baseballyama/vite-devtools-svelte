<script lang="ts">
  import type { Attachment } from 'svelte/attachments';

  import { clickOutside } from '../lib/actions';

  let outside = $state(0);
  let size = $state('');
  let color = $state('#2563eb');

  // Attachment factory: re-runs when `color` changes.
  const outline =
    (c: string): Attachment<HTMLElement> =>
    node => {
      node.style.outline = `2px solid ${c}`;
      return () => (node.style.outline = '');
    };

  const measure: Attachment<HTMLElement> = node => {
    const observer = new ResizeObserver(([entry]) => {
      size = `${Math.round(entry.contentRect.width)}px`;
    });
    observer.observe(node);
    return () => observer.disconnect();
  };
</script>

<h2>Actions & attachments</h2>

<div class="box" use:clickOutside={() => outside++}>
  use:clickOutside — clicks outside this box: {outside}
</div>

<input type="color" bind:value={color} />
<div class="box" {@attach outline(color)} {@attach measure}>
  {'{@attach}'} outline in {color}, width {size}
</div>

<style>
  .box {
    padding: 0.75rem;
    margin: 0.5rem 0;
    border: 1px solid #ccc;
    resize: horizontal;
    overflow: auto;
  }
</style>
