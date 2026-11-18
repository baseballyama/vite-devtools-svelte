import type { PageLoad } from './$types';

let runs = 0;

export const load: PageLoad = async ({ depends }) => {
  // `invalidate('app:clock')` re-runs only this load; `refreshAll()` also
  // re-runs the layout load (which depends on 'app:site').
  depends('app:clock');
  runs++;
  await new Promise(resolve => {
    setTimeout(resolve, 50 + Math.random() * 150);
  });
  return { now: new Date().toLocaleTimeString(), runs };
};
