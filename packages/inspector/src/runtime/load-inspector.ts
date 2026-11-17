import { mount } from 'svelte';
import Inspector from 'virtual:vite-devtools-svelte-inspector-path:Inspector.svelte';

// devtools leave this component, what it renders and its state out of their panels
(Inspector as unknown as Record<symbol, boolean>)[Symbol.for('svelte.devtools.ignore')] = true;

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

mount(Inspector, { target: create_inspector_host() });
