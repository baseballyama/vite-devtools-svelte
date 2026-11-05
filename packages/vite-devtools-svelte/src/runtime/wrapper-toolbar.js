// Element instrumentation for the prompt toolbar. The plugin appends this file
// to `wrapper.js` only when `promptToolbar` is enabled, so a project that does
// not use the toolbar pays nothing: no stamping walk, no per-instance props.
//
// Svelte's dev compile wraps every component tag and block in
// `add_svelte_meta()`, and every element it creates in `add_locations()`. Both
// are imported from `svelte/internal/client`, which the wrapper replaces:
//
// - a parallel frame stack mirrors Svelte's own `dev_stack` (not exported), so
//   an instance can record where its tag sits in the parent;
// - every element Svelte locates is stamped with the id of the component that
//   created it (`__svelte_meta.dtComponentId`). That stamp turns a clicked DOM
//   node into a component instance, and through the instance tree into its
//   props and `$state`.
//
// Svelte's own metadata (`__svelte_meta.loc` / `.parent`) is left untouched.

const __metaStack = []

function __fileOf(component) {
  try {
    return component?.[__svelte_original.FILENAME] ?? null
  } catch {
    return null
  }
}

// Nearest enclosing component tag frame. A component can also be created
// inside a block or a snippet, whose own frame is then on top: the stack is
// read backwards instead of trusting its head.
function __componentFrame() {
  for (let i = __metaStack.length - 1; i >= 0; i--) {
    if (__metaStack[i].type === 'component') return __metaStack[i]
  }
  return null
}

export function add_svelte_meta() {
  const frame = {
    type: arguments[1],
    file: __fileOf(arguments[2]),
    line: arguments[3],
    column: arguments[4],
  }
  try {
    const additional = arguments[5]
    if (additional) for (const key of Object.keys(additional)) frame[key] = additional[key]
  } catch {}
  __metaStack.push(frame)
  try {
    return __svelte_original.add_svelte_meta.apply(null, arguments)
  } finally {
    __metaStack.pop()
  }
}

// Elements of one `add_locations()` call are created together, for one
// component instance, so walking the returned nodes is cheaper than an
// observer. Bounded so a huge subtree cannot stall a render.
const __STAMP_LIMIT = 20000

function __stampSubtree(root, componentId) {
  if (!root || componentId === null) return
  const stack = [root]
  let visited = 0
  while (stack.length > 0 && visited < __STAMP_LIMIT) {
    const node = stack.pop()
    visited++
    if (node.nodeType === 1 && node.__svelte_meta) node.__svelte_meta.dtComponentId = componentId
    for (let child = node.firstChild; child; child = child.nextSibling) stack.push(child)
  }
}

// Svelte stamps locations by walking the *siblings* of the first node it gets
// (`assign_locations` in `svelte/internal/client/dev/elements.js`), and during
// hydration that first node is an element of the existing tree rather than a
// fragment. A template with several roots therefore has siblings to walk, and
// the compiler's own location list bounds the walk: one entry per root.
function __stampFragment(dom, componentId, locations) {
  const limit = Array.isArray(locations) ? locations.length : 1
  let node = dom?.nodeType === 11 ? dom.firstChild : dom
  let roots = 0
  while (node && roots < limit) {
    if (node.nodeType === 1) {
      roots++
      __stampSubtree(node, componentId)
    }
    node = node.nextSibling
  }
}

export function add_locations(fn, filename, locations) {
  const located = __svelte_original.add_locations(fn, filename, locations)
  return function () {
    const dom = located.apply(null, arguments)
    try {
      // `__owner()` falls back to the context-derived owner: markup created by
      // a snippet or an effect runs outside the component's push()..pop().
      __stampFragment(dom, __owner(), locations)
    } catch {}
    return dom
  }
}

// Wired into `push()` by the wrapper: the props object and the frame of the
// tag that created this instance.
__toolbarHooks.instanceContext = (dt, id, props) =>
  dt.setInstanceContext(id, props, __componentFrame())
