<script>
  export let start = 0
  let count = start
  $: doubled = count * 2
  export function inc() {
    count += 1
  }
</script>

<p>{count} {doubled}</p>
