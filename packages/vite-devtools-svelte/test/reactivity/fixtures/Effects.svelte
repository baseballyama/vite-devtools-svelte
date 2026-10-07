<script>
  let a = $state(1)
  let b = $state(2)
  let log = []
  $effect(() => {
    log.push(a)
  })
  $effect.pre(() => {
    log.push(b)
  })
  $effect(() => {
    // nested effect created while the outer one runs (not during init);
    // reading a re-runs the outer effect, which re-creates the nested one
    log.push(-a)
    $effect(() => {
      log.push(a + b)
    })
  })
  export function bumpA() {
    a++
  }
  export function bumpB() {
    b++
  }
</script>
