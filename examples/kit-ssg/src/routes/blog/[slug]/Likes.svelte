<script lang="ts">
  let { slug }: { slug: string } = $props();
  let likes = $state(0);
</script>

<button type="button" data-testid="like" onclick={() => likes++}>♥ {likes} for {slug}</button>
