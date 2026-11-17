<script lang="ts" module>
  export type Node = { name: string; children?: Node[] };
</script>

<script lang="ts">
  import Tree from './Tree.svelte';

  let { node, depth = 0 }: { node: Node; depth?: number } = $props();
  let open = $state(true);
</script>

<div style:padding-left="{depth}rem">
  {#if node.children}
    <button type="button" onclick={() => (open = !open)}>{open ? '▾' : '▸'}</button>
  {/if}
  {node.name}
</div>
{#if open}
  {#each node.children ?? [] as child (child.name)}
    <Tree node={child} depth={depth + 1} />
  {/each}
{/if}
