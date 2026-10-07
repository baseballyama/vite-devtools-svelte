<script>
  import { Counter } from './counter.svelte.js'
  const first = new Counter()
  const second = new Counter()
  export function incSecond() {
    second.inc()
  }
</script>

<p>{first.doubled} {second.doubled}</p>
