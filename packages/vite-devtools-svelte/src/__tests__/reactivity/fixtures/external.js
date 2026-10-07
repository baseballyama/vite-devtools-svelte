// A signal created outside any component or Svelte module (as SvelteKit's
// own state in node_modules is): devtools does not track it.
import { createSubscriber } from 'svelte/reactivity'
const value = 0
const subscribe = createSubscriber(() => () => {})
export const external = {
  get value() {
    subscribe()
    return value
  },
}
