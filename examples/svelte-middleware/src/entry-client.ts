import { hydrate } from 'svelte';

import App from './App.svelte';
import type { AppProps } from './entry-server.ts';

declare global {
  interface Window {
    __INITIAL_PROPS__: AppProps;
  }
}

export default hydrate(App, {
  target: document.querySelector('#app')!,
  props: window.__INITIAL_PROPS__,
});
