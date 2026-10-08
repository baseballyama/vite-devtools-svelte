export type Panel = {
  slug: string
  title: string
  tagline: string
  description: string
  highlights: string[]
  /** Screenshots of the current UI (1200×750), in `static/images/`. */
  images: string[]
  /** Shown under the screenshots when the data needs explaining. */
  caption?: string
}

// Copy describes what the current UI does; screenshots are taken from it with
// synthetic demo data. A panel without a current screenshot has none rather
// than an outdated one.
export const panels: Panel[] = [
  {
    slug: 'overview',
    title: 'Overview',
    tagline: 'Your project at a glance',
    description:
      'Project name, Svelte / SvelteKit / Vite versions and dependencies, with tiles that count routes, live components, modules, assets and problems — each one opens the matching panel.',
    highlights: [
      'Stack versions and dependency list with a filter',
      'Clickable health tiles for routes, components, modules, assets and problems',
    ],
    images: ['v2-panel-overview.jpg'],
  },
  {
    slug: 'components',
    title: 'Components',
    tagline: 'The live component tree, and how files relate',
    description:
      'Walk the tree of mounted component instances in your running app. Filter it, move through it with the keyboard and open an inspector with ancestors, children and imports. The Files view lists every component file with what it imports, what uses it and how many instances are mounted.',
    highlights: [
      'Virtualized tree that stays responsive on large apps',
      'Shows when only part of a very large tree was captured',
      'Selection and expansion survive live updates and HMR',
      'Files view: imports, used-by and mounted counts',
    ],
    images: ['v2-panel-components.jpg', 'v2-panel-components-files.jpg'],
  },
  {
    slug: 'reactive',
    title: 'Reactivity',
    tagline: 'How `$state`, `$derived` and `$effect` connect',
    description:
      'See the dependency graph of Svelte 5 runes, scoped to one component when the app is large, or as a sortable list. Values that change flash, and every signal links to what it depends on and what it triggers.',
    highlights: [
      'Graph or list view, limited to one component on demand',
      'Depends-on / triggers links between signals',
      'Go to the definition in your editor',
    ],
    images: ['v2-panel-reactive.jpg'],
  },
  {
    slug: 'profiler',
    title: 'Render',
    tagline: 'Which components cost the most',
    description:
      'Init time, render count and average / total render time per component or per instance, sortable, with the most expensive rows highlighted.',
    highlights: ['Group by component or by instance', 'Sort by renders, average or total time'],
    images: ['v2-panel-profiler.jpg'],
  },
  {
    slug: 'routes',
    title: 'Routes',
    tagline: 'SvelteKit routes, read from the filesystem',
    description:
      'Every route as a tree of segments, marked as page, layout, server or endpoint, with an inspector for the pattern, parameters and route files, and a link to open the page.',
    highlights: [
      'Dynamic, optional and rest parameters',
      'Route groups and layouts',
      'Open a page or a route file from the inspector',
    ],
    images: ['v2-panel-routes.jpg'],
  },
  {
    slug: 'loads',
    title: 'Load functions',
    tagline: 'How long your `load` functions take',
    description:
      'Every server and universal `load` call with its duration and data size, plus average, p50, p95 and max for what is currently shown.',
    highlights: ['Server vs. universal filter', 'Slow-call filter', 'Average, p50, p95 and max'],
    images: ['v2-panel-loads.jpg'],
  },
  {
    slug: 'timeline',
    title: 'State timeline',
    tagline: 'Recent `$state` changes, newest first',
    description:
      'Recent `$state` writes with the value before and after each change, filterable by signal, component or value. The log is bounded: it keeps the latest entries, not the whole session.',
    highlights: ['Before / after values in the inspector', 'Go to the signal definition'],
    images: ['v2-panel-timeline.jpg'],
  },
  {
    slug: 'api',
    title: 'API',
    tagline: 'Call your `+server` endpoints',
    description:
      'Pick an endpoint found in your routes, set the method, headers and body, and read the formatted response with its status, timing and headers.',
    highlights: [
      'Endpoints detected from the route tree',
      'Method, headers and body editor',
      'Formatted response with status, time and headers',
    ],
    images: ['v2-panel-api.jpg'],
  },
  {
    slug: 'errors',
    title: 'Problems',
    tagline: 'Compiler warnings and runtime errors in one list',
    description:
      'Svelte compiler warnings and runtime errors from your app, filterable by severity and warning code, each linking to the file and line and to the Svelte documentation for its code.',
    highlights: [
      'Severity filter and most frequent warning codes',
      'Stack traces for runtime errors',
      'Open the file and line in your editor',
    ],
    images: ['v2-panel-errors.jpg'],
  },
  {
    slug: 'inspect',
    title: 'Compiled output',
    tagline: 'Your `.svelte` file next to its compiled JavaScript',
    description:
      'Pick any `.svelte` file and read its source beside the compiled JavaScript. Source-map lines connect the two, so you can see what a rune turns into.',
    highlights: [
      'Side-by-side source and compiled output',
      'Source-map connections in both directions',
    ],
    images: ['v2-panel-inspect.jpg'],
  },
  {
    slug: 'modules',
    title: 'Modules',
    tagline: 'Imports between modules, and circular ones',
    description:
      'Every module with its imports, importers and size, filterable by type, with a switch for modules that are part of a circular import.',
    highlights: [
      'Circular-import filter',
      'Jump between importers and imports',
      'Sort by imports, importers or size',
    ],
    images: ['v2-panel-modules.jpg'],
  },
  {
    slug: 'og',
    title: 'Social preview',
    tagline: 'How a page unfurls when shared',
    description:
      'Fetch a route or any URL and see its Open Graph and Twitter tags as an X / Twitter card and a chat-style link preview, with a list of missing or problematic tags.',
    highlights: [
      'Card previews built from the page’s tags',
      'Checks for missing tags',
      'All tags in a table',
    ],
    images: ['v2-panel-og.jpg'],
    caption:
      'Shown on a generated SvelteKit test app (route /section-16/g-163). The page sets only og:title, so the panel previews the card and lists the four missing tags.',
  },
  {
    slug: 'build',
    title: 'Build',
    tagline: 'What your production build contains',
    description:
      'Chunks of the last production build with their sizes and share of the total, and a composition bar by type.',
    highlights: ['JS / CSS / other composition', 'Largest chunks first'],
    images: ['v2-panel-build.jpg'],
  },
  {
    slug: 'fps',
    title: 'Frame rate',
    tagline: 'Live FPS of your app',
    description:
      'A live frame-rate chart over the last 15, 30 or 60 seconds with average, minimum and 1% low, and a recording mode to measure one interaction.',
    highlights: [
      '15 / 30 / 60 second windows',
      'Average, minimum and 1% low',
      'Record a window to measure an interaction',
    ],
    images: ['v2-panel-fps.jpg'],
  },
  {
    slug: 'assets',
    title: 'Assets',
    tagline: 'Everything under `static/`',
    description:
      'Static files by category with size bars, sorting by size or date, and a preview of the selected file.',
    highlights: [
      'Image, font, video, audio and text categories',
      'Sort by size or modification date',
      'Preview the selected asset',
    ],
    images: ['v2-panel-assets.jpg'],
  },
]

/** A tagline split at its `code` spans, for rendering without HTML. */
export const taglineParts = (s: string) =>
  s.split('`').map((text, i) => ({ text, code: i % 2 === 1 }))

/** The tagline as plain text (for meta tags). */
export const taglineText = (s: string) => s.replaceAll('`', '')
