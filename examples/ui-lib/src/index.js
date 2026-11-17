// A library as an app gets it from npm: components outside the app (under
// node_modules once installed injected). The DevTools leave them out of the
// tree and put app components passed into them under the nearest app component.
export { default as Card } from './Card.svelte';
export { default as LibButton } from './LibButton.svelte';
export { default as Tabs } from './Tabs.svelte';
