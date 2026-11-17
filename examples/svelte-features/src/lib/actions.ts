import type { Action } from 'svelte/action';

/** use:clickOutside — calls `callback` for clicks outside the node. */
export const clickOutside: Action<HTMLElement, () => void> = (node, callback) => {
  let cb = callback;
  const onClick = (event: MouseEvent) => {
    if (!node.contains(event.target as Node)) cb();
  };
  document.addEventListener('click', onClick, true);
  return {
    update(next) {
      cb = next;
    },
    destroy() {
      document.removeEventListener('click', onClick, true);
    },
  };
};
