<script>
  import { external } from './external.js'
  let seen = 0
  $effect(() => {
    seen = external.value
  })
</script>
