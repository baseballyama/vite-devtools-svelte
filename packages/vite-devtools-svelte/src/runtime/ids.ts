// The runtime is injected into the user's app as a virtual module. It tracks
// Svelte component mount/unmount and sends data to the Vite server via HMR.
export const RUNTIME_MODULE_ID = 'virtual:svelte-devtools-runtime'
export const RESOLVED_RUNTIME_ID = '\0' + RUNTIME_MODULE_ID

// Virtual module ID for the svelte/internal/client wrapper.
// When user code imports 'svelte/internal/client', it is redirected to this module.
// The wrapper re-exports everything and overrides key functions for devtools tracking.
export const WRAPPER_MODULE_ID = '\0svelte-devtools:wrapped-client'
