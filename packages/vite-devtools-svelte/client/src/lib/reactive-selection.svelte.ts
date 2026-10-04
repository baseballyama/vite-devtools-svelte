/**
 * The component instance Reactivity is scoped to (§6.7 A). Set from the
 * Components inspector ("Show reactivity") or the Reactivity overview.
 * `componentId` is only meaningful within `epoch` (one page load).
 */
export interface ReactiveScope {
  componentId: number
  epoch: string | null
  /** Display name, e.g. `<Row>`. */
  label: string
  file: string
}

let current = $state<ReactiveScope | null>(null)

export const reactiveScope = {
  get current() {
    return current
  },
  set(scope: ReactiveScope | null) {
    current = scope
  },
}
