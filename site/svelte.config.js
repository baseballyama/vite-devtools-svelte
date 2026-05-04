import adapter from '@sveltejs/adapter-static'

const dev = process.env.NODE_ENV !== 'production'
const base = process.env.BASE_PATH ?? (dev ? '' : '/vite-devtools-svelte')

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: '404.html',
      precompress: false,
      strict: true,
    }),
    paths: {
      base,
    },
    prerender: {
      handleHttpError: 'warn',
    },
  },
}

export default config
