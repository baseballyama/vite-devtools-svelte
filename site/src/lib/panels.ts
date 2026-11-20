export type Panel = {
  slug: string;
  title: string;
  /** The entry under Svelte tools in the Vite DevTools dock that holds the panel. */
  dockEntry: 'Overview' | 'Problems' | 'Inspect' | 'Profile' | 'Project' | 'Add';
  tagline: string;
  description: string;
  highlights: string[];
  /** Where the panel shows up, when that is not everywhere. */
  availability?: string;
  /** Screenshots (1200×750) in `static/images/`, taken from an earlier version of the UI. */
  images: string[];
  /** Shown under the screenshots when the data needs explaining. */
  caption?: string;
};

// Same order as the panels in the DevTools sidebar (packages/client/src/lib/panels.ts).
// Copy describes what the current UI does; the screenshots are older (the panel page says so).
export const panels: Panel[] = [
  {
    slug: 'overview',
    title: 'Overview',
    dockEntry: 'Overview',
    tagline: 'Your project at a glance',
    description:
      'Project name and version, the Svelte, SvelteKit and Vite versions, and tiles that count routes, mounted components, modules, static assets and problems. Outside the Vite DevTools dock, each tile opens its panel. Below the tiles is the dependency list.',
    highlights: [
      'Svelte, SvelteKit and Vite versions',
      'Tiles for routes, mounted components, modules, static assets and problems',
      'Dependencies split into runtime and dev, with a filter',
    ],
    images: ['v2-panel-overview.jpg'],
  },
  {
    slug: 'errors',
    title: 'Problems',
    dockEntry: 'Problems',
    tagline: 'Compiler warnings and runtime errors in one list',
    description:
      'Svelte compiler warnings and runtime errors from your app, filterable by severity, text and warning code. Each one links to its file and line, and warnings link to the Svelte documentation for their code.',
    highlights: [
      'Severity filter and the most frequent warning codes',
      'Stack traces for runtime errors',
      'Open the file and line in your editor',
    ],
    images: ['v2-panel-errors.jpg'],
  },
  {
    slug: 'components',
    title: 'Components',
    dockEntry: 'Inspect',
    tagline: 'The live component tree, and how files relate',
    description:
      'Walk the tree of mounted component instances in your running app. Filter it, move through it with the keyboard and open an inspector with ancestors, children and imports, or jump to the reactivity of the selected instance. The Files view lists every component file with what it imports, what uses it and how many instances are mounted.',
    highlights: [
      'Virtualized tree that stays responsive on large apps',
      'Shows when only part of a very large tree was captured',
      'Selection and expansion survive live updates and HMR',
      'Pick element: right-click an element in your app and choose Inspect to select its component (in the Vite DevTools dock, with the Svelte Inspector)',
      'Files view: imports, used-by and mounted counts',
    ],
    images: ['v2-panel-components.jpg', 'v2-panel-components-files.jpg'],
  },
  {
    slug: 'reactive',
    title: 'Reactivity',
    dockEntry: 'Inspect',
    tagline: 'How `$state`, `$derived` and `$effect` connect',
    description:
      'The overview lists components or instances by how much they changed and rendered since mount, or the states that changed most in the State timeline. Pick a component to load its signals and the signals they are directly linked to, or open the full graph of loaded signals. Values that change flash, and every signal links to what it depends on and what it triggers.',
    highlights: [
      'Overview by component, instance or state',
      'One component or the full graph, laid out as a graph or a sortable list',
      'Depends-on / triggers links between signals',
      'Go to the definition in your editor',
    ],
    images: ['v2-panel-reactive.jpg'],
  },
  {
    slug: 'timeline',
    title: 'State timeline',
    dockEntry: 'Inspect',
    tagline: 'Recent `$state` changes, newest first',
    description:
      'Recent $state changes with the value before and after each one, filterable by signal, component or value. The app checks $state every 200 ms, and the log keeps the latest 500 changes, not the whole session.',
    highlights: [
      'Before / after values in the inspector',
      'Go to the signal definition',
      'Clear the recorded changes',
    ],
    images: ['v2-panel-timeline.jpg'],
  },
  {
    slug: 'profiler',
    title: 'Render',
    dockEntry: 'Profile',
    tagline: 'Which components cost the most',
    description:
      'Init time, render count and average / total render time per component or per instance, sortable, with slow rows highlighted.',
    highlights: [
      'Group by component or by instance',
      'Sort by renders, average or total time',
      'Share of all render time in the inspector',
    ],
    images: ['v2-panel-profiler.jpg'],
  },
  {
    slug: 'loads',
    title: 'Load functions',
    dockEntry: 'Profile',
    tagline: 'How long your `load` functions take',
    description:
      'Every server and universal load call with its route, file, duration and data size, including loads that run in the browser. Calls, average, p50, p95, max and the number of calls over 100 ms are shown for the calls currently listed.',
    highlights: [
      'Server / universal filter',
      'Calls over 100 ms marked and counted',
      'Open the load file in your editor with one click',
    ],
    availability: 'Shown in SvelteKit apps.',
    images: ['v2-panel-loads.jpg'],
  },
  {
    slug: 'fps',
    title: 'Frame rate',
    dockEntry: 'Profile',
    tagline: 'Live FPS of your app',
    description:
      'A live frame-rate chart over the last 15, 30 or 60 seconds with minimum, 1% low, average, maximum and drops below 30, and a recording mode to measure one interaction.',
    highlights: [
      '15 / 30 / 60 second windows',
      'Minimum, 1% low, average, maximum and drops',
      'Record a window to measure an interaction',
    ],
    images: ['v2-panel-fps.jpg'],
  },
  {
    slug: 'build',
    title: 'Build',
    dockEntry: 'Profile',
    tagline: 'What your production build contains',
    description:
      'Chunks of the last production build with their sizes and share of the total, and a composition bar by type. Run vite build first, then refresh.',
    highlights: ['JS / CSS / other composition', 'Largest chunks first', 'Entry chunks marked'],
    availability: 'Shown in SvelteKit apps.',
    images: ['v2-panel-build.jpg'],
  },
  {
    slug: 'routes',
    title: 'Routes',
    dockEntry: 'Project',
    tagline: 'SvelteKit routes, read from the filesystem',
    description:
      'Every route as a tree of segments, marked as page, layout, server load, universal load or endpoint, with filters for pages, endpoints and dynamic routes. The inspector shows the pattern, parameters and route files, with a link to open the page.',
    highlights: [
      'Dynamic, optional and rest parameters, and matchers',
      'Route groups and layouts',
      'Open a page or a route file from the inspector',
    ],
    availability: 'Shown in SvelteKit apps.',
    images: ['v2-panel-routes.jpg'],
  },
  {
    slug: 'api',
    title: 'API',
    dockEntry: 'Project',
    tagline: 'Call your `+server` endpoints',
    description:
      'Pick an endpoint found in your +server files, set the method, headers and body, and read the formatted response with its status, time, size and headers. The browser sends the request with your app’s cookies.',
    highlights: [
      'Endpoints and their methods read from +server files',
      'Method, headers and body editor',
      'Formatted response, shown while it streams',
    ],
    availability: 'Shown in SvelteKit apps.',
    images: ['v2-panel-api.jpg'],
  },
  {
    slug: 'modules',
    title: 'Modules',
    dockEntry: 'Project',
    tagline: 'Imports between modules, and circular ones',
    description:
      'Every project module Vite has loaded (node_modules excluded), with its imports, importers and size, filterable by type. .svelte.js and .svelte.ts modules are listed under Svelte. Files SvelteKit generates under .svelte-kit/ are hidden until you show them, and a switch keeps only modules that are part of a circular import.',
    highlights: [
      'Circular-import filter, with each cycle in the inspector',
      'Generated SvelteKit modules hidden by default',
      'Jump between importers and imports',
      'Sort by imports, importers or size',
    ],
    images: ['v2-panel-modules.jpg'],
  },
  {
    slug: 'assets',
    title: 'Assets',
    dockEntry: 'Project',
    tagline: 'Everything under `static/` or `public/`',
    description:
      'Static files by category with size bars, sorting by name, type, date or size, and a preview of the selected file.',
    highlights: [
      'Image, font, video, audio and text categories',
      'Sort by size or modification date',
      'Preview the selected asset',
    ],
    images: ['v2-panel-assets.jpg'],
  },
  {
    slug: 'addons',
    title: 'Add',
    dockEntry: 'Add',
    tagline: 'Install `sv` add-ons in one click',
    description:
      'Official sv add-ons, and community add-ons from npm, each with its sv add command and whether your package.json already has it. Install runs sv add in the Vite DevTools terminal and opens it, so you can answer its prompts. Community add-ons are experimental and not reviewed by the Svelte maintainers.',
    highlights: [
      'Official add-ons, with the SvelteKit-only ones marked',
      'Community add-ons: npm packages with the sv-add keyword',
      'Installed add-ons marked, from your package.json',
    ],
    availability: 'Shown only in the Vite DevTools dock, which runs the install in its terminal.',
    images: [],
  },
  {
    slug: 'og',
    title: 'Social preview',
    dockEntry: 'Project',
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
];

/** A tagline split at its `code` spans, for rendering without HTML. */
export const taglineParts = (s: string) =>
  s.split('`').map((text, i) => ({ text, code: i % 2 === 1 }));

/** The tagline as plain text (for meta tags). */
export const taglineText = (s: string) => s.replaceAll('`', '');
