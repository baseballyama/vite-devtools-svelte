import type { Action } from 'svelte/action';

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
