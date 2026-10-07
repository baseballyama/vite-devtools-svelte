<script>
  import Child from './Child.svelte'
  import { Counter } from './counter.svelte.js'
  let num = $state(0)
  let list = $state([1, 2])
  let obj = $state({ a: 1 })
  let raw = $state.raw({ r: 1 })
  let date = $state(new Date(0))
  const first = new Counter()
  const second = new Counter()
  let rows = $state([1])
  export const api = {
    num: () => num++,
    push: () => list.push(list.length + 1),
    deep: () => (obj.a += 1),
    reassign: () => (obj = { a: 100 }),
    raw: () => (raw = { r: raw.r + 1 }),
    date: () => (date = new Date(1000)),
    second: () => second.inc(),
    addRow: () => rows.push(rows.length + 1),
  }
</script>

<p>{num} {list.length} {obj.a} {raw.r} {date.getTime()} {first.count} {second.count}</p>
{#each rows as r (r)}<Child label={'row' + r + ':' + num} />{/each}
