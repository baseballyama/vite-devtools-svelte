import { assertOutboundUrl } from '../security.js'
import type { OutboundUrlOptions } from '../security.js'
import type { OGPreview } from '../types.js'

/**
 * Fetch a public URL (or a page of the dev server itself) and report its Open
 * Graph tags + missing-tag issues. Redirects are not followed.
 */
export async function getOGPreview(
  url: string,
  options: OutboundUrlOptions = {},
): Promise<OGPreview> {
  const preview: OGPreview = { url, title: '', description: '', image: '', tags: [], issues: [] }
  try {
    await assertOutboundUrl(url, options)
    const res = await fetch(url, { redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      preview.issues.push(
        `Redirects to ${res.headers.get('location') ?? '(no location)'} (not followed)`,
      )
      return preview
    }
    const html = await res.text()
    // Attribute-order independent; matches both <meta ...> and <meta ... />
    const metaRegex = /<meta\s+([^>]*?)\/?>/gi
    const propRegex = /(?:property|name)=["']([^"']+)["']/
    const contentRegex = /content=["']([^"']+)["']/
    let match
    while ((match = metaRegex.exec(html)) !== null) {
      const attrs = match[1]
      const propMatch = attrs.match(propRegex)
      const contentMatch = attrs.match(contentRegex)
      if (propMatch && contentMatch) {
        const prop = propMatch[1]
        const content = contentMatch[1]
        preview.tags.push({ property: prop, content })
        if (prop === 'og:title') preview.title = content
        else if (prop === 'og:description') preview.description = content
        else if (prop === 'og:image') preview.image = content
      }
    }
    if (!preview.title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
      if (titleMatch) preview.title = titleMatch[1]
    }
    if (!preview.description) {
      const descTag = preview.tags.find(t => t.property === 'description')
      if (descTag) preview.description = descTag.content
    }
    if (!preview.title) preview.issues.push('Missing og:title or <title>')
    if (!preview.description) preview.issues.push('Missing og:description or meta description')
    if (!preview.image) preview.issues.push('Missing og:image')
    if (!preview.tags.some(t => t.property === 'og:url')) preview.issues.push('Missing og:url')
    if (!preview.tags.some(t => t.property === 'og:type')) preview.issues.push('Missing og:type')
  } catch (e) {
    preview.issues.push(`Failed to fetch: ${String(e)}`)
  }
  return preview
}
