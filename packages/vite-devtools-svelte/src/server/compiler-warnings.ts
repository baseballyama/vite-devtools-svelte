import path from 'node:path';

import type { Plugin } from 'vite';

import type { CompilerWarning } from '../types.js';

interface SvelteWarning {
  code: string;
  message: string;
  filename?: string;
  start?: { line: number; column: number };
}

type OnWarn = (warning: SvelteWarning, defaultHandler: (warning: SvelteWarning) => void) => void;

// vite-plugin-svelte's sub-plugins share this object and read `onwarn` from it
// on every compile, so patching it takes effect.
function svelteOptions(plugins: readonly Plugin[]): { onwarn?: OnWarn } | undefined {
  for (const p of plugins) {
    if (!p.name.startsWith('vite-plugin-svelte')) continue;
    const options = (p.api as { options?: unknown } | undefined)?.options;
    if (typeof options === 'object' && options !== null) return options;
  }
  return undefined;
}

// vite-plugin-svelte prints dev warnings with `console.log`, past Vite's
// logger, so they are captured through `onwarn`. Must run after its
// `configResolved`, which creates the options (a restart creates new ones,
// so wrappers never stack).
export function captureCompilerWarnings(
  plugins: readonly Plugin[],
  record: (warning: CompilerWarning) => void,
): void {
  const options = svelteOptions(plugins);
  if (!options) return;
  const userOnwarn = options.onwarn;
  options.onwarn = (warning, defaultHandler) => {
    if (!warning.filename?.includes('node_modules')) {
      record({
        code: warning.code,
        message: warning.message,
        // Relative to the cwd the compiler ran in.
        file: warning.filename ? path.resolve(warning.filename) : '',
        line: warning.start?.line,
        column: warning.start?.column,
      });
    }
    if (userOnwarn) userOnwarn(warning, defaultHandler);
    else defaultHandler(warning);
  };
}
