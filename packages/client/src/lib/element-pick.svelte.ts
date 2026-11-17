import type { ElementPick } from './types.js';

/** A component instance to reveal: an element pick, or a component chosen in another panel. */
export type InstanceRef = Pick<ElementPick, 'epoch' | 'componentId'>;

// Kept until the Components panel reveals it, so a tab that is hidden when
// the pick arrives reveals it once visible.
let pending = $state.raw<InstanceRef | null>(null);

export const elementPick = {
  get pending() {
    return pending;
  },
  set(pick: InstanceRef) {
    pending = pick;
  },
  /** `pick` was revealed (a newer pick that arrived meanwhile stays pending). */
  done(pick: InstanceRef) {
    if (pending === pick) pending = null;
  },
};
