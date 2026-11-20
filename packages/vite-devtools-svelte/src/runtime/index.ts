// Kept as plain .js files so they are linted and formatted like any other source;
// the package build minifies them (build/minify-runtime.ts).
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import runtimeSource from './page-runtime.js?raw';
// oxlint-disable-next-line import/default -- `?raw` modules are resolved by Vite
import wrapperSource from './wrapper.js?raw';

export { RESOLVED_RUNTIME_ID, RUNTIME_MODULE_ID, WRAPPER_MODULE_ID } from './ids.js';

// Wrapping svelte/internal/client instead of regex-transforming compiled
// output keeps tracking independent of the compiler's output shape.
export const wrapperCode: string = wrapperSource;

export const runtimeCode: string = runtimeSource;
