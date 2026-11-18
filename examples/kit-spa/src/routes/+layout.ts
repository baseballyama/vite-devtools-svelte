import type { LayoutLoad } from './$types';

// The whole app is a SPA: nothing renders on the server, so every load below
// is a universal load that runs in the browser (adapter-static serves
// 200.html as the fallback). Their timings reach the DevTools over the HMR
// channel instead of the server-side recorder.
export const ssr = false;

export const load: LayoutLoad = async ({ fetch, depends }) => {
  depends('app:site');
  const res = await fetch('/data/site.json');
  const site = (await res.json()) as { name: string; tagline: string };
  return { site, loadedAt: new Date().toLocaleTimeString() };
};
