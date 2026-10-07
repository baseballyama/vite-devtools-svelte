import { componentName } from './format.js'

/**
 * The component instance Reactivity is scoped to (§6.7 A). Set from the
 * Components inspector ("Show reactivity") or the Reactivity overview.
 * `componentId` is only meaningful within `epoch` (one page load), so a
 * scope always carries it.
 */
export interface ReactiveScope {
  componentId: number
  epoch: string
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
  /** Scope to instance `componentId` of `file`, labelled `<Name>`. */
  scopeTo(componentId: number, file: string, epoch: string) {
    current = { componentId, epoch, label: `<${componentName(file)}>`, file }
  },
}
