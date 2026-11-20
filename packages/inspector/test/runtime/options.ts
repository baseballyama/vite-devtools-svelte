// What `virtual:vite-devtools-svelte-inspector-options` serves, for the runtime tests
const settings = {
  toggleKeyCombo: 'alt-x',
  navKeys: { parent: 'ArrowUp', child: 'ArrowDown', next: 'ArrowRight', prev: 'ArrowLeft' },
  escapeKeys: ['Backspace', 'Escape'],
  openKey: 'Enter',
  openMenuKey: ' ',
  holdMode: true,
  customStyles: true,
};

export default {
  ...settings,
  __internal: { base: '/app', cwd: '/project', defaults: settings },
};
