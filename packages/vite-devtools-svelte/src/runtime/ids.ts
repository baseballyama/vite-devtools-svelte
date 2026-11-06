// The runtime is injected into the user's app as a virtual module. It tracks
// Svelte component mount/unmount and sends data to the Vite server via HMR.
export const RUNTIME_MODULE_ID = 'virtual:svelte-devtools-runtime'
export const RESOLVED_RUNTIME_ID = '\0' + RUNTIME_MODULE_ID

// Virtual module ID for the svelte/internal/client wrapper.
// When user code imports 'svelte/internal/client', it is redirected to this module.
// The wrapper re-exports everything and overrides key functions for devtools tracking.
export const WRAPPER_MODULE_ID = '\0svelte-devtools:wrapped-client'

// The prompt toolbar (`promptToolbar: true`): the browser layer and its
// markdown helpers, both served as virtual modules. The HTML references the
// toolbar through Vite's `/@id/` URL; the toolbar imports the helpers.
export const PROMPT_TOOLBAR_MODULE_ID = 'virtual:vite-devtools-svelte/prompt-toolbar'
export const RESOLVED_PROMPT_TOOLBAR_ID = '\0' + PROMPT_TOOLBAR_MODULE_ID
export const PROMPT_FORMAT_MODULE_ID = 'virtual:vite-devtools-svelte/prompt-format'
export const RESOLVED_PROMPT_FORMAT_ID = '\0' + PROMPT_FORMAT_MODULE_ID
