import { componentName } from './format.js';

/** `componentId` is only meaningful within `epoch` (one page load), so a scope always carries it. */
export interface ReactiveScope {
  componentId: number;
  epoch: string;
  /** Display name, e.g. `<Row>`. */
  label: string;
  file: string;
}

let current = $state<ReactiveScope | null>(null);

export const reactiveScope = {
  get current() {
    return current;
  },
  set(scope: ReactiveScope | null) {
    current = scope;
  },
  scopeTo(componentId: number, file: string, epoch: string) {
    current = { componentId, epoch, label: `<${componentName(file)}>`, file };
  },
};
