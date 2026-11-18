import { render as renderSvelte } from 'svelte/server';

import App from './App.svelte';

export interface AppProps {
  renderedAt: string;
  url: string;
  initialCount: number;
  items: string[];
}

/** Server render: the props are serialized into the page for hydrate(). */
export function render(url: string) {
  const props: AppProps = {
    renderedAt: new Date().toISOString(),
    url,
    initialCount: 3,
    items: ['middleware mode', 'server rendering', 'hydration', 'SSE transport'],
  };
  const { head, body } = renderSvelte(App, { props });
  return { head, body, props };
}
