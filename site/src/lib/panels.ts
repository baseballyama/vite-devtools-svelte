export type Panel = {
  slug: string
  title: string
  tagline: string
  description: string
  highlights: string[]
  images: string[]
}

export const panels: Panel[] = [
  {
    slug: 'overview',
    title: 'Overview',
    tagline: 'Project summary at a glance',
    description:
      'A single dashboard that shows your project metadata: Svelte and SvelteKit versions, plugin versions, dependency counts, and quick links to the rest of DevTools.',
    highlights: [
      'Svelte / SvelteKit / Vite versions',
      'Dependency and devDependency counts',
      'Entry points to other panels',
    ],
    images: ['panel-overview.png'],
  },
  {
    slug: 'components',
    title: 'Component Inspector',
    tagline: 'Tree, props, state, and reactives in real time',
    description:
      'Walk the component tree of your running app. Inspect props, local state, and reactive values resolved at runtime — including derived values and effects.',
    highlights: [
      'Hierarchical component tree',
      'Live props and `$state` values',
      'Identifies the source file for each component',
    ],
    images: ['panel-components.png'],
  },
  {
    slug: 'reactive',
    title: 'Reactive Graph',
    tagline: 'See how `$state`, `$derived`, and `$effect` connect',
    description:
      'Render the dependency graph of Svelte 5 runes as a DAG. Find unexpected fan-out, missing memoization, or accidental coupling between unrelated components.',
    highlights: [
      'Force-directed graph layout',
      'Edges show derivation and effect dependencies',
      'Click a node to jump to its source',
    ],
    images: ['panel-reactive.png'],
  },
  {
    slug: 'profiler',
    title: 'Render Profiler',
    tagline: 'Find the components that re-render too much',
    description:
      'Track render count, total time, and per-render duration for every component. Sort by hotspot, expand to see the call stack of reactive triggers.',
    highlights: [
      'Render counts and timings per component',
      'Sortable by total time, mean time, or count',
      'Highlights regressions during a session',
    ],
    images: ['panel-profiler.png'],
  },
  {
    slug: 'routes',
    title: 'Route Viewer',
    tagline: 'SvelteKit file-based routing, visualized',
    description:
      'See every route in your SvelteKit app, including dynamic parameters, layouts, and server endpoints — derived directly from the filesystem.',
    highlights: [
      'Dynamic and rest parameters detected',
      'Layout group structure',
      '`+page` / `+server` / `+layout` annotations',
    ],
    images: ['panel-routes.png'],
  },
  {
    slug: 'loads',
    title: 'Load Profiler',
    tagline: 'Waterfall for SvelteKit `load` functions',
    description:
      'Visualize the timing of every `load` function — server, universal, and layout — as a waterfall. Identify serial loads that should be parallel.',
    highlights: [
      'Per-route waterfall timing',
      'Distinguishes server vs. universal loads',
      'Captures parent-child load chains',
    ],
    images: ['panel-loads.png'],
  },
  {
    slug: 'timeline',
    title: 'State Timeline',
    tagline: 'Record and replay state changes',
    description:
      'Capture a session of state mutations across `$state` runes. Scrub backward and forward to reproduce bugs without re-running the user flow.',
    highlights: [
      'Time-travel scrubber',
      'Per-rune mutation log',
      'Source-mapped to the call site that mutated state',
    ],
    images: ['panel-timeline.png'],
  },
  {
    slug: 'api',
    title: 'API Playground',
    tagline: 'Test `+server.ts` endpoints from DevTools',
    description:
      'Call any SvelteKit server endpoint directly from the panel — set method, headers, and body, and see the response without leaving the IDE.',
    highlights: [
      'Auto-detects endpoints from the route tree',
      'Method/header/body editor',
      'Response body and headers inspector',
    ],
    images: ['panel-api.png'],
  },
  {
    slug: 'errors',
    title: 'Errors & Warnings',
    tagline: 'Compiler and runtime issues in one place',
    description:
      'A unified inbox for Svelte compiler warnings, Vite errors, and runtime exceptions. Each entry links back to the offending file and line.',
    highlights: [
      'Compiler warnings (a11y, deprecations)',
      'Runtime errors with stack traces',
      'Click-to-open in your editor',
    ],
    images: ['panel-errors.png'],
  },
  {
    slug: 'inspect',
    title: 'Code Inspector',
    tagline: 'See the compiled output for any Svelte file',
    description:
      'Compare your `.svelte` source side-by-side with the compiled JavaScript. Source maps connect every line, so you can trace runes to the generated reactive scaffolding.',
    highlights: [
      'Side-by-side source / output',
      'Bidirectional source-map navigation',
      'Syntax-highlighted with Shiki',
    ],
    images: ['panel-inspect.png', 'panel-inspect-detail.png'],
  },
  {
    slug: 'modules',
    title: 'Module Graph',
    tagline: 'Dependency graph and circular import detection',
    description:
      'See how your modules import each other. Spot circular imports, oversized barrel files, and unexpected dependencies on heavy libraries.',
    highlights: [
      'Interactive force-directed graph',
      'Circular dependency detection',
      'Filter by file pattern',
    ],
    images: ['panel-modules.png'],
  },
  {
    slug: 'og',
    title: 'OG Preview',
    tagline: 'Validate Open Graph metadata for SEO',
    description:
      'Preview how each route renders on social platforms. The panel scrapes meta tags from your dev server and shows Twitter/X, Facebook, and LinkedIn cards.',
    highlights: [
      'Per-route OG card preview',
      'Twitter, Facebook, LinkedIn layouts',
      'Warns when required tags are missing',
    ],
    images: ['panel-og.png'],
  },
  {
    slug: 'build',
    title: 'Build Analysis',
    tagline: 'Bundle composition without leaving DevTools',
    description:
      'Analyze chunks and module sizes directly from a production build, similar to rollup-plugin-visualizer — but stays in your dev workflow.',
    highlights: [
      'Treemap of chunk sizes',
      'Per-module gzip size',
      'Highlights duplicated dependencies',
    ],
    images: ['panel-build.png'],
  },
  {
    slug: 'fps',
    title: 'FPS Monitor',
    tagline: 'Real-time frame rate with history',
    description:
      'A continuous frame rate graph for your app. Spot dropped frames during interactions, animations, or long tasks — useful for animation-heavy SvelteKit apps.',
    highlights: [
      'Live FPS gauge and history',
      'Markers for long tasks',
      'Lightweight: only runs in dev',
    ],
    images: ['panel-fps.png'],
  },
  {
    slug: 'assets',
    title: 'Asset Browser',
    tagline: 'Browse static assets with metadata',
    description:
      'Explore everything under `static/`. Preview images, fonts, and audio with size and dimension metadata — useful for finding oversized assets.',
    highlights: [
      'Preview for images, fonts, audio',
      'File size and image dimensions',
      'Filter by directory and type',
    ],
    images: ['panel-assets.png'],
  },
]

export function findPanel(slug: string): Panel | undefined {
  return panels.find((p) => p.slug === slug)
}
