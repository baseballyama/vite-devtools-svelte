import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface SvelteSupport {
  /** The app's Svelte version, or undefined when its package.json is not found or unreadable. */
  version: string | undefined;
  /**
   * Whether that Svelte has the devtools events: `svelte/internal/devtools` and
   * the compiler option `experimental.devtools` (an older compiler throws
   * `options_unrecognised` on it).
   */
  devtoolsEvents: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** What the Svelte installed for the app at `root` supports. */
export function svelteSupport(root: string): SvelteSupport {
  let manifest: unknown;
  try {
    const require = createRequire(path.join(root, 'package.json'));
    manifest = JSON.parse(fs.readFileSync(require.resolve('svelte/package.json'), 'utf8'));
  } catch {
    manifest = null;
  }
  if (!isRecord(manifest)) return { version: undefined, devtoolsEvents: false };
  const { version, exports } = manifest;
  return {
    version: typeof version === 'string' ? version : undefined,
    devtoolsEvents: isRecord(exports) && exports['./internal/devtools'] !== undefined,
  };
}
