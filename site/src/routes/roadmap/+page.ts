import { marked } from 'marked'
import roadmap from '../../../../ROADMAP.md?raw'
import type { PageLoad } from './$types'

export const prerender = true

export const load: PageLoad = async () => {
  const html = await marked.parse(roadmap, { async: true })
  return { html }
}
