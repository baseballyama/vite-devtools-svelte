import { assertOutboundUrl } from '../server/security.js'
import type { OutboundUrlOptions } from '../server/security.js'
import type { OGPreview, OGTag } from '../types.js'
import { HTML_WHITESPACE, collapseWhitespace, decodeEntities, htmlTags } from './html.js'
import { fetchWithTimeout } from './http.js'

/**
 * Meta tags with a `property` (or `name`) and a `content` attribute, in
 * document order, values entity-decoded. Read with an HTML tokenizer, so a
 * `<meta>` inside a comment or a `<script>` does not count.
 */
export function parseMetaTags(html: string): OGTag[] {
  const tags: OGTag[] = []
  for (const tag of htmlTags(html)) {
    if (tag.name !== 'meta' || tag.closing) continue
    const property = tag.attrs.get('property') ?? tag.attrs.get('name')
    const content = tag.attrs.get('content')
    if (property && content !== undefined) {
      tags.push({ property: decodeEntities(property), content: decodeEntities(content) })
    }
  }
  return tags
}

/** The document title: the first `<title>` outside an `<svg>`, whitespace collapsed. */
function documentTitle(html: string): string | undefined {
  let svgDepth = 0
  for (const tag of htmlTags(html)) {
    if (tag.name === 'svg' && !tag.selfClosing) svgDepth += tag.closing ? -1 : 1
    if (tag.name === 'title' && tag.text !== undefined && svgDepth <= 0) {
      return collapseWhitespace(decodeEntities(tag.text))
    }
  }
  return undefined
}

/**
 * The value of the `charset` parameter in a Content-Type value (HTML's
 * "extracting a character encoding from a meta element").
 */
function charsetParam(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  for (let at = lower.indexOf('charset'); at !== -1; at = lower.indexOf('charset', at + 1)) {
    let i = at + 'charset'.length
    while (HTML_WHITESPACE.has(value[i]!)) i++
    if (value[i] !== '=') continue
    i++
    while (HTML_WHITESPACE.has(value[i]!)) i++
    let label: string
    const quote = value[i]
    if (quote === '"' || quote === "'") {
      const close = value.indexOf(quote, i + 1)
      if (close === -1) return undefined
      label = value.slice(i + 1, close).trim()
    } else {
      let end = i
      while (end < value.length && !HTML_WHITESPACE.has(value[end]!) && value[end] !== ';') end++
      label = value.slice(i, end)
    }
    return label === '' ? undefined : label
  }
  return undefined
}

/** The charset a `<meta charset>` or `<meta http-equiv=content-type>` in `head` declares. */
function metaCharset(head: string): string | undefined {
  for (const tag of htmlTags(head)) {
    if (tag.name !== 'meta' || tag.closing) continue
    const charset = tag.attrs.get('charset')?.trim()
    if (charset) return charset
    if (tag.attrs.get('http-equiv')?.toLowerCase() !== 'content-type') continue
    const declared = charsetParam(tag.attrs.get('content'))
    if (declared !== undefined) return declared
  }
  return undefined
}

/**
 * Decode the page body by its declared charset (Content-Type header, else a
 * meta tag in the first 1024 bytes), UTF-8 otherwise. `res.text()` always
 * used UTF-8, garbling e.g. Shift_JIS or Latin-1 pages.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  const label = charsetParam(contentType) ?? metaCharset(head) ?? 'utf-8'
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(label)
  } catch {
    decoder = new TextDecoder('utf-8') // unknown label
  }
  return decoder.decode(bytes)
}

/** `value` resolved against the page URL (`/og.png` → absolute), or as is when invalid. */
function resolveUrl(value: string, base: string): string {
  try {
    return new URL(value, base).href
  } catch {
    return value
  }
}

/**
 * Fetch a public URL (or a page of the dev server itself) and report its Open
 * Graph tags + missing-tag issues. Redirects are not followed. The first of
 * repeated tags wins (Open Graph's rule for single-valued properties), and
 * `image` is resolved against the page URL so a relative og:image previews.
 */
export async function getOGPreview(
  url: string,
  options: OutboundUrlOptions = {},
  timeoutMs?: number,
): Promise<OGPreview> {
  const preview: OGPreview = { url, title: '', description: '', image: '', tags: [], issues: [] }
  try {
    await assertOutboundUrl(url, options)
    const page = await fetchWithTimeout(
      url,
      {},
      async res => ({
        status: res.status,
        location: res.headers.get('location'),
        html:
          res.status >= 300 && res.status < 400
            ? ''
            : decodeBody(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type')),
      }),
      timeoutMs,
    )
    if (page.status >= 300 && page.status < 400) {
      preview.issues.push(`Redirects to ${page.location ?? '(no location)'} (not followed)`)
      return preview
    }
    if (page.status >= 400) preview.issues.push(`Responded with HTTP ${page.status}`)
    const html = page.html
    preview.tags = parseMetaTags(html)
    const first = (property: string) => preview.tags.find(t => t.property === property)?.content
    preview.title = first('og:title') ?? ''
    preview.description = first('og:description') ?? ''
    const image = first('og:image')
    preview.image = image ? resolveUrl(image, url) : ''
    if (!preview.title) preview.title = documentTitle(html) ?? ''
    if (!preview.description) preview.description = first('description') ?? ''
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
