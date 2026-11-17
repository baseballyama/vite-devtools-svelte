import { componentName } from './format.js';

/** `componentId` is only meaningful within `epoch` (one page load), so a scope always carries it. */
export interface ReactiveScope {
  componentId: number;
  epoch: string;
  /** Display name, e.g. `<Row>`. */
  label: string;
  file: string;
  /** Node to select once the graph is loaded (e.g. a state from the Performance panel). */
  focus?: string;
}

let current = $state<ReactiveScope | null>(null);

export const reactiveScope = {
  get current() {
    return current;
  },
  set(scope: ReactiveScope | null) {
    current = scope;
  },
  scopeTo(componentId: number, file: string, epoch: string, focus?: string) {
    current = { componentId, epoch, label: `<${componentName(file)}>`, file, focus };
  },
  /** The focused node was selected: later visits keep the user's own selection. */
  focused() {
    if (current?.focus !== undefined) current = { ...current, focus: undefined };
  },
};
