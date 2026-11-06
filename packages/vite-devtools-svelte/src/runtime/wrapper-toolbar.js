// Element ownership for the prompt toolbar. The plugin appends this file to
// `wrapper.js` only when `promptToolbar` is enabled, so a project without the
// toolbar runs none of it.
//
// The toolbar needs two answers for a clicked element: which component
// instance rendered it, and where it is written. Both are settled in
// `append()`, which the compiled code calls once per template (component or
// block) after everything inside that template, child components included, has
// been created or hydrated:
//
// - ownership: every element of the template that no inner template claimed
//   first belongs to the component whose template it is (`__owner()`). Children
//   append before their parent, so a child's elements are already claimed when
//   the parent's walk reaches them, and the walk skips them. Owners live in a
//   WeakMap on the runtime (`dt._elementOwners`), not on the elements.
// - locations: Svelte assigns `__svelte_meta.loc` when a template is created.
//   During hydration that template is the server markup, which Svelte walks by
//   position; a child component's markup is not delimited by hydration markers,
//   so the child's root takes the location of the parent's next element and the
//   parent's later elements are left without one (svelte 5.57). Once the
//   children have hydrated (their own templates overwrite what they received),
//   the parent's elements are matched against the template by tag and the
//   missing locations are filled in.

const __templates = new WeakMap()
const __pendingLocations = new WeakMap()

/** Remember the markup of every template factory, to know its element tags. */
function __markTemplate(original, kind) {
  return function (content) {
    const fn = original.apply(null, arguments)
    try {
      __templates.set(fn, { kind, content, tags: null })
    } catch {}
    return fn
  }
}

export const from_html = __markTemplate(__svelte_original.from_html, 'html')
export const from_svg = __markTemplate(__svelte_original.from_svg, 'svg')
export const from_mathml = __markTemplate(__svelte_original.from_mathml, 'mathml')
export const from_tree = __markTemplate(__svelte_original.from_tree, 'tree')

function __elementOwners() {
  const dt = __dt()
  if (!dt) return null
  dt._elementOwners ??= new WeakMap()
  return dt._elementOwners
}

// --- Template tags ---

function __domTags(parent) {
  const out = []
  for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
    const inner = child.localName === 'template' ? child.content : child
    out.push({ tag: child.localName.toLowerCase(), children: __domTags(inner) })
  }
  return out
}

function __treeTags(structure) {
  const out = []
  for (const item of structure) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || item[0].startsWith('/')) continue
    out.push({ tag: item[0].toLowerCase(), children: __treeTags(item.slice(2)) })
  }
  return out
}

// The element tags of a template, in the order the compiler lists their
// locations (depth first, elements only). Parsed once, on first need.
function __templateTags(template) {
  if (template.tags) return template.tags
  if (template.kind === 'tree') {
    template.tags = __treeTags(template.content)
    return template.tags
  }
  const holder = document.createElement('template')
  if (template.kind === 'svg') {
    holder.innerHTML = '<svg>' + template.content + '</svg>'
    template.tags = __domTags(holder.content.firstElementChild)
  } else if (template.kind === 'mathml') {
    holder.innerHTML = '<math>' + template.content + '</math>'
    template.tags = __domTags(holder.content.firstElementChild)
  } else {
    holder.innerHTML = template.content
    template.tags = __domTags(holder.content)
  }
  return template.tags
}

// --- Locations (hydration) ---

// Svelte gave `locations[0]` to the first element of the template, together
// with its dev stack (`parent`); the repaired entries get the same stack.
function __devStackOf(dom, filename, location) {
  for (let node = dom; node; node = node.nextSibling) {
    const loc = node.nodeType === 1 ? node.__svelte_meta?.loc : null
    if (loc && loc.file === filename && loc.line === location[0] && loc.column === location[1]) {
      return node.__svelte_meta.parent ?? null
    }
  }
  return null
}

function __assignLocations(nodes, locations, tags, owners, context) {
  let index = 0
  let depth = 0
  for (const node of nodes) {
    if (index >= locations.length) break
    if (node.nodeType === 8) {
      // Blocks are delimited (`<!--[-->` … `<!--]-->`): their elements belong
      // to the block's own template.
      const data = node.data
      if (data.startsWith('[')) depth++
      else if (data.startsWith(']')) depth--
      continue
    }
    if (node.nodeType !== 1 || depth !== 0) continue
    // Claimed already: a child component's element (or a block's).
    if (owners.has(node)) continue
    const expected = tags[index]
    // Markup the template does not list (`{@html}`): not one of ours.
    if (!expected || node.localName.toLowerCase() !== expected.tag) continue
    const location = locations[index]
    const loc = node.__svelte_meta?.loc
    if (
      !loc ||
      loc.file !== context.file ||
      loc.line !== location[0] ||
      loc.column !== location[1]
    ) {
      node.__svelte_meta = {
        parent: context.parent,
        loc: { file: context.file, line: location[0], column: location[1] },
      }
    }
    if (location[2]) {
      __assignLocations(node.childNodes, location[2], expected.children, owners, context)
    }
    index++
  }
}

export function add_locations(fn, filename, locations) {
  const located = __svelte_original.add_locations(fn, filename, locations)
  const template = __templates.get(fn) ?? null
  return function () {
    const dom = located.apply(null, arguments)
    try {
      // Hydrating: `dom` is the first node of the server markup, already in
      // the document. Repaired in `append()`, once the children hydrated.
      if (
        template &&
        dom &&
        dom.nodeType !== 11 &&
        dom.parentNode !== null &&
        locations.length > 0
      ) {
        // A template that starts with a child component shares its first
        // node with that child: one stack per node, unwound innermost first
        // as the templates append.
        let pending = __pendingLocations.get(dom)
        if (!pending) __pendingLocations.set(dom, (pending = []))
        pending.push({
          template,
          locations,
          file: filename,
          parent: __devStackOf(dom, filename, locations[0]),
        })
      }
    } catch {}
    return dom
  }
}

// --- Ownership ---

const __CLAIM_LIMIT = 50000

// Claim every element under `nodes` that no inner template claimed first. A
// claimed element's subtree was claimed with it, so it is skipped whole.
function __claim(nodes, owner, owners) {
  const stack = Array.from(nodes)
  let visited = 0
  while (stack.length > 0 && visited < __CLAIM_LIMIT) {
    const node = stack.pop()
    visited++
    if (node.nodeType === 1) {
      if (owners.has(node)) continue
      owners.set(node, owner)
    }
    for (let child = node.firstChild; child; child = child.nextSibling) stack.push(child)
  }
}

// The hydrated range of one template: `dom` up to the end Svelte recorded,
// only when that end really is a later sibling (anything else claims `dom`).
function __hydratedRange(dom, end) {
  const nodes = []
  for (let node = dom; node; node = node.nextSibling) {
    nodes.push(node)
    if (node === end) return nodes
  }
  return [dom]
}

export function append(anchor, dom) {
  if (!dom || dom.nodeType === 11 || dom.parentNode === null) {
    // Created from scratch (mount or a later update): the template's own
    // nodes, still outside the document, children already inside them.
    try {
      const owner = __owner()
      const owners = owner === null ? null : __elementOwners()
      if (owners && dom) __claim(dom.nodeType === 11 ? dom.childNodes : [dom], owner, owners)
    } catch {}
    return __svelte_original.append.apply(null, arguments)
  }
  const result = __svelte_original.append.apply(null, arguments)
  try {
    const owners = __elementOwners()
    if (owners) {
      const range = __hydratedRange(dom, __svelte_original.active_effect?.nodes?.end ?? null)
      const stack = __pendingLocations.get(dom)
      const pending = stack?.pop()
      if (stack?.length === 0) __pendingLocations.delete(dom)
      if (pending) {
        const context = { file: pending.file, parent: pending.parent }
        __assignLocations(
          range,
          pending.locations,
          __templateTags(pending.template),
          owners,
          context,
        )
      }
      const owner = __owner()
      if (owner !== null) __claim(range, owner, owners)
    }
  } catch {}
  return result
}
