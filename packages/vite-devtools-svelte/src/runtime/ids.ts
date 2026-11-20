export const RUNTIME_MODULE_ID = 'virtual:svelte-devtools-runtime';
export const RESOLVED_RUNTIME_ID = '\0' + RUNTIME_MODULE_ID;

export const WRAPPER_MODULE_ID = '\0svelte-devtools:wrapped-client';

/**
 * Stable contract with the browser runtime. client.js (loaded `?raw`) repeats all but
 * `loadProfile` as literals; the load wrapper generated in server/load-profile.ts reads it from here.
 */
export const HOT_EVENTS = {
  components: 'svelte-devtools:components',
  profiles: 'svelte-devtools:profiles',
  stateTimeline: 'svelte-devtools:state-timeline',
  fps: 'svelte-devtools:fps',
  runtimeError: 'svelte-devtools:runtime-error',
  reactiveGraph: 'svelte-devtools:reactive-graph',
  requestReactiveGraph: 'svelte-devtools:request-reactive-graph',
  /** server → runtime `{ requestId, epoch?, topK }`; reply `reactiveSummary`. */
  requestReactiveSummary: 'svelte-devtools:request-reactive-summary',
  reactiveSummary: 'svelte-devtools:reactive-summary',
  clearStateTimeline: 'svelte-devtools:clear-state-timeline',
  /** runtime → server, once per page load: "send me the current subscription state". */
  runtimeReady: 'svelte-devtools:runtime-ready',
  /** server → runtime(s): `{ active: boolean }`, whether any consumer is watching. */
  subscription: 'svelte-devtools:subscription',
  /** runtime → server: `{ epoch, componentId }`, a component chosen with Inspect in the inspector. */
  elementPicked: 'svelte-devtools:element-picked',
  /** browser → server: a `load` run in the browser, which has no recorder (see server/load-profile.ts). */
  loadProfile: 'svelte-devtools:load-profile',
} as const;
