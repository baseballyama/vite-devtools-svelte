<script lang="ts">
  import { getUser } from '#lib/todos.remote.ts';

  let { id }: { id: number } = $props();
</script>

<li>
  <svelte:boundary>
    #{id}: {(await getUser(id)).name}
    {#snippet pending()}#{id}: …{/snippet}
  </svelte:boundary>
</li>
