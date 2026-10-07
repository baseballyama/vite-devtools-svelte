<script lang="ts">
  let tries = $state(0)
  throw new Error('lab: this component fails on purpose during init')
</script>

<p>{tries}</p>
