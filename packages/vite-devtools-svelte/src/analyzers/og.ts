import { assertOutboundUrl } from '../server/security.js'
import type { OutboundUrlOptions } from '../server/security.js'
import type { OGPreview, OGTag } from '../types.js'
import { fetchWithTimeout } from './http.js'

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Decode the character references that show up in attribute values and titles. */
export function decodeEntities(s: string): string {
  return s.replaceAll(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[(name as string).toLowerCase()] ?? m
    const code = dec ? Number(dec) : Number.parseInt(hex as string, 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
  })
}

/** `<meta …>` tags; quoted values may contain `>`. */
const META = /<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const ATTR = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g

/**
 * Meta tags with a `property` (or `name`) and a `content` attribute, in
 * document order. Attributes are matched as whole names in any order and
 * quoting style (the old regex also matched `data-content=` and stopped a
 * double-quoted value at an apostrophe), and values are entity-decoded.
 */
export function parseMetaTags(html: string): OGTag[] {
  const tags: OGTag[] = []
  for (const meta of html.matchAll(META)) {
    const attrs = new Map<string, string>()
    for (const a of meta[1]!.matchAll(ATTR)) {
      const name = a[1]!.toLowerCase()
      if (!attrs.has(name)) attrs.set(name, a[2] ?? a[3] ?? a[4] ?? '')
    }
    const property = attrs.get('property') ?? attrs.get('name')
    const content = attrs.get('content')
    if (property && content !== undefined) {
      tags.push({ property: decodeEntities(property), content: decodeEntities(content) })
    }
  }
  return tags
}

/** Charset from a Content-Type value or a `<meta charset>` / `http-equiv` tag. */
function charsetIn(text: string | null): string | undefined {
  return text?.match(/charset\s*=\s*["']?\s*([\w.:-]+)/i)?.[1]
}

/**
 * Decode the page body by its declared charset (Content-Type header, else a
 * meta tag in the first 1024 bytes), UTF-8 otherwise. `res.text()` always
 * used UTF-8, garbling e.g. Shift_JIS or Latin-1 pages.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  const sniffed = /<meta\b[^>]*charset[^>]*>/i.exec(head)?.[0] ?? null
  const label = charsetIn(contentType) ?? charsetIn(sniffed) ?? 'utf-8'
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
    if (!preview.title) {
      const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
      if (titleMatch) preview.title = decodeEntities(titleMatch[1]!).replaceAll(/\s+/g, ' ').trim()
    }
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
