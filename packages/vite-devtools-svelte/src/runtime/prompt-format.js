// Markdown for the prompt toolbar: the page, the user's request, and one block
// per picked element (where it is written, which components rendered it, the
// template frames around it). Pure functions, no DOM: the plugin serves this
// file as a virtual module next to the toolbar, and the unit tests import it
// directly.
//
// Live values are not copied. The prompt names each instance by id and epoch,
// which is what the plugin's MCP tools take (`get_reactive_scope`), so an agent
// connected to them reads the state itself, current at the time it asks.

/**
 * @typedef {{ file: string | null, line: number | null, column: number | null, enclosing?: boolean }} SourceLocation
 * @typedef {{ type: string, file: string | null, line: number | null, column: number | null, componentTag: string | null }} TemplateFrame
 * @typedef {{ id: number, name: string, file: string }} ComponentRef
 * @typedef {{ tag: string, id: string, classes: string[] }} ElementRef
 * @typedef {{ url: string, title: string, viewport: string }} PageInfo
 * @typedef {{
 *   epoch?: string,
 *   page?: PageInfo,
 *   element: ElementRef | null,
 *   source: SourceLocation | null,
 *   template: TemplateFrame[],
 *   components: ComponentRef[],
 * }} Inspected
 */

/** `file` relative to the project root, with forward slashes. */
export function relPath(file, root) {
  if (!file) return ''
  const path = String(file).replaceAll('\\', '/')
  if (!root) return path
  const normalizedRoot = String(root).replaceAll('\\', '/')
  const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/'
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/**
 * `file:line:column`, root-relative.
 * @param {SourceLocation | null | undefined} loc
 * @param {string} root
 */
export function relLocation(loc, root) {
  if (!loc?.file) return ''
  let text = relPath(loc.file, root)
  if (typeof loc.line === 'number') {
    text += ':' + loc.line
    if (typeof loc.column === 'number') text += ':' + loc.column
  }
  return text
}

/**
 * Files of the app itself: installed packages and SvelteKit's generated root
 * are not something to edit.
 */
export function isProjectFile(file) {
  if (!file) return false
  const path = String(file).replaceAll('\\', '/')
  return !path.includes('/node_modules/') && !path.includes('.svelte-kit/')
}

/**
 * `tag#id.class`: what the element is, without the text the app renders in it.
 * @param {ElementRef | null | undefined} element
 */
export function elementTitle(element) {
  if (!element?.tag) return 'element'
  const id = element.id ? '#' + element.id : ''
  const classes = element.classes?.length ? '.' + element.classes.join('.') : ''
  return element.tag + id + classes
}

const FRAME_LABELS = {
  if: '{#if}',
  each: '{#each}',
  await: '{#await}',
  key: '{#key}',
  render: '{@render}',
  snippet: '{#snippet}',
  boundary: '<svelte:boundary>',
}

/** @param {TemplateFrame} frame */
function frameLabel(frame) {
  if (frame.type === 'component') return '<' + (frame.componentTag ?? 'Component') + ' />'
  return FRAME_LABELS[frame.type] ?? '{#' + frame.type + '}'
}

const code = value => '`' + value + '`'

/**
 * The location line of one selection.
 * @param {SourceLocation | null} source
 * @param {string} root
 */
function locationLine(source, root) {
  if (!source?.file) {
    return '- location: unknown (Svelte recorded none for this element or its ancestors)'
  }
  if (source.enclosing) {
    return (
      '- location: inside ' +
      code(relLocation(source, root)) +
      ' (Svelte recorded no location for the element itself, e.g. `{@html}` or library markup)'
    )
  }
  return '- location: ' + code(relLocation(source, root))
}

/**
 * Markdown for one picked element.
 * @param {Inspected} payload
 * @param {number} index 1-based position in the prompt
 * @param {string} root project root, for repository-relative paths
 */
export function formatSelection(payload, index, root) {
  const lines = [
    '### ' + index + '. ' + code(elementTitle(payload?.element)),
    locationLine(payload?.source ?? null, root),
  ]

  const components = (payload?.components ?? []).filter(component => isProjectFile(component.file))
  if (components.length > 0) {
    lines.push(
      '- components (innermost first): ' +
        components
          .map(component => code(component.name) + ' (' + code(relPath(component.file, root)) + ')')
          .join(' › '),
    )
    const owner = components[0]
    const sourceFile = payload?.source?.file
    if (
      sourceFile &&
      !payload.source.enclosing &&
      relPath(sourceFile, root) !== relPath(owner.file, root)
    ) {
      lines.push(
        '- note: written in ' +
          code(relPath(sourceFile, root)) +
          ' and rendered by ' +
          code(owner.name) +
          ' (markup passed as a snippet or children)',
      )
    }
    if (payload?.epoch) {
      lines.push(
        '- live state: MCP tool `get_reactive_scope` of vite-devtools-svelte with ' +
          code(JSON.stringify({ componentId: owner.id, epoch: payload.epoch })) +
          ' (valid while this page stays loaded)',
      )
    }
  }

  const frames = (payload?.template ?? []).filter(frame => isProjectFile(frame.file)).slice(0, 6)
  if (frames.length > 0) {
    lines.push(
      '- template (innermost first): ' +
        frames
          .map(frame => code(frameLabel(frame)) + ' at ' + code(relLocation(frame, root)))
          .join(' › '),
    )
  }
  return lines.join('\n')
}

/**
 * The document copied to the clipboard.
 * @param {Inspected[]} selections
 * @param {string} instructions
 * @param {string} root
 */
export function buildPrompt(selections, instructions, root) {
  const page = selections.find(selection => selection?.page)?.page ?? null
  const sections = ['# UI context from the running app']
  if (page) {
    sections.push(
      'Page: ' +
        code(page.url) +
        (page.title ? ' (' + page.title + ')' : '') +
        '\nViewport: ' +
        page.viewport,
    )
  }
  const request = (instructions ?? '').trim()
  sections.push(
    '## Request',
    request || '(describe the change here)',
    '## Selected elements',
    selections.map((payload, index) => formatSelection(payload, index + 1, root)).join('\n\n'),
  )
  return sections.join('\n\n') + '\n'
}
