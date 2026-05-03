import { error } from '@sveltejs/kit'
import { findPanel, panels } from '$lib/panels'
import type { PageLoad } from './$types'

export const prerender = true

export const entries = () =>
  panels.map((p) => ({ slug: p.slug }))

export const load: PageLoad = ({ params }) => {
  const panel = findPanel(params.slug)
  if (!panel) {
    error(404, `Panel "${params.slug}" not found`)
  }
  const index = panels.findIndex((p) => p.slug === panel.slug)
  return {
    panel,
    prev: panels[(index - 1 + panels.length) % panels.length],
    next: panels[(index + 1) % panels.length],
  }
}
