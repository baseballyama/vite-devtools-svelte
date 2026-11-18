// A `.js` load file (the profiler handles .js and .ts alike).
/** @type {import('./$types').PageLoad} */
export async function load({ fetch }) {
  const response = await fetch('/api/text');
  return {
    posts: ['hello-world', 'routing-deep-dive', 'streaming'],
    banner: await response.text(),
  };
}
