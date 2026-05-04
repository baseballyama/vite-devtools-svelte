import type { PageServerLoad } from './$types'

const posts: Record<string, { title: string; content: string }> = {
  'hello-world': {
    title: 'Hello World',
    content: 'Welcome to the Svelte DevTools Playground blog!',
  },
  'getting-started': {
    title: 'Getting Started with Svelte DevTools',
    content: 'Learn how to use the Svelte DevTools plugin for Vite DevTools.',
  },
  'advanced-features': {
    title: 'Advanced Features',
    content:
      'Explore advanced features like reactive graph visualization and performance profiling.',
  },
}

export const load: PageServerLoad = async ({ params }) => {
  const post = posts[params.slug]

  if (!post) {
    return { status: 404, title: 'Not Found', content: 'Post not found.' }
  }

  return { ...post }
}
