import type { ElementPick } from './types.js';

/**
 * The element last picked on the app page, until the Components panel has
 * revealed its instance. A tab that is hidden when the pick arrives keeps it
 * and reveals it once visible.
 */
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
