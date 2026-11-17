// Prerendered as an empty shell; the page renders in the browser only.
export const ssr = false;

export const load = () => ({ renderedIn: typeof window === 'undefined' ? 'server' : 'browser' });
