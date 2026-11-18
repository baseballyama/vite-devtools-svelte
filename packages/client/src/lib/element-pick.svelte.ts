import type { ElementPick } from './types.js';

// Kept until the Components panel reveals it, so a tab that is hidden when
// the pick arrives reveals it once visible.
let pending = $state.raw<ElementPick | null>(null);

export const elementPick = {
  get pending() {
    return pending;
  },
  set(pick: ElementPick) {
    pending = pick;
  },
  /** `pick` was revealed (a newer pick that arrived meanwhile stays pending). */
  done(pick: ElementPick) {
    if (pending === pick) pending = null;
  },
};
