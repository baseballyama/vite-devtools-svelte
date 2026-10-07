<script lang="ts">
  import Counter from './lib/Counter.svelte'
  import TodoList from './lib/TodoList.svelte'

  // Compat scenario (plain Svelte + Vite): a few signals of each kind and a
  // bounded, deterministic ticker so the DevTools overview has activity
  // without user input. Everything has a stable data-testid for the smoke.
  const TICK_MS = 1000
  const MAX_TICKS = 120

  let ticks = $state(0)
  let todos = $state([
    { id: 1, text: 'Open /.svelte-devtools/', done: false },
    { id: 2, text: 'Pick App in Components', done: false },
  ])
  const remaining = $derived(todos.filter(t => !t.done).length)
  const label = $derived(`${remaining} of ${todos.length} left`)

  $effect(() => {
    document.title = `plain-svelte · ${label}`
  })

  $effect(() => {
    const id = setInterval(() => {
      if (ticks >= MAX_TICKS) clearInterval(id)
      else ticks++
    }, TICK_MS)
    return () => clearInterval(id)
  })

  function add(text: string) {
    todos.push({ id: todos.length + 1, text, done: false })
  }

  function toggle(id: number) {
    const t = todos.find(x => x.id === id)
    if (t) t.done = !t.done
  }
</script>

<main>
  <h1>plain-svelte</h1>
  <p data-testid="ticks">ticks: {ticks}</p>
  <p data-testid="remaining">{label}</p>
  <Counter start={1} />
  <TodoList {todos} onadd={add} ontoggle={toggle} />
</main>
