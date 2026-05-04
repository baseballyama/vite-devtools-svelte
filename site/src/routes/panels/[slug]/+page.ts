import { error } from '@sveltejs/kit'
import { panels } from '$lib/panels'
import type { PageLoad } from './$types'

export const prerender = true

export const entries = () => panels.map(p => ({ slug: p.slug }))

export const load: PageLoad = ({ params }) => {
  const index = panels.findIndex(p => p.slug === params.slug)
  if (index < 0) {
    error(404, `Panel "${params.slug}" not found`)
  }
  return {
    panel: panels[index],
    prev: panels[(index - 1 + panels.length) % panels.length],
    next: panels[(index + 1) % panels.length],
  }
}
