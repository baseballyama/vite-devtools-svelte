import { mount } from 'svelte';
// vite-devtools-svelte: the inspector is not one of the app's components
import devtools from 'virtual:vite-devtools-svelte-inspector-devtools';
import Inspector from 'virtual:vite-devtools-svelte-inspector-path:Inspector.svelte';

function create_inspector_host() {
  const id = 'svelte-inspector-host';
  if (document.querySelector(`#${id}`) !== null) {
    throw new Error('svelte-inspector-host element already exists');
  }
  const el = document.createElement('div');
  el.setAttribute('id', id);
  document.documentElement.append(el);
  return el;
}

const mount_inspector = () => mount(Inspector, { target: create_inspector_host() });
if (devtools) devtools.untracked(mount_inspector);
else mount_inspector();
