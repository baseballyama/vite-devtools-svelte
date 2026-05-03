/**
 * Path / file display helpers shared across panels.
 *
 * Vite normalizes paths to forward-slash on every platform, but we still
 * accept backslash too so that anything bypassing Vite's normalization
 * (e.g. raw FS paths surfaced from analyzers on Windows) renders correctly.
 */

const PATH_SEP = /[\\/]/

/**
 * Last `depth` segments of a path, joined with `/`. Useful for compact
 * display in lists where the full path is in a tooltip / detail panel.
 *
 * @example
 *   shortPath('src/lib/components/Counter.svelte') // → 'components/Counter.svelte'
 *   shortPath('src/lib/components/Counter.svelte', 3) // → 'lib/components/Counter.svelte'
 *   shortPath('Counter.svelte') // → 'Counter.svelte'
 */
export function shortPath(path: string, depth = 2): string {
  if (!path) return ''
  return path.split(PATH_SEP).slice(-depth).join('/')
}

/**
 * Last segment of a path (basename), without directory.
 *
 * @example
 *   basename('src/lib/Counter.svelte') // → 'Counter.svelte'
 *   basename('') // → ''
 */
export function basename(path: string): string {
  if (!path) return ''
  return path.split(PATH_SEP).pop() ?? ''
}

/**
 * Display name for a Svelte component file. Strips both the directory
 * prefix and the `.svelte` extension. Falls back to a passed default.
 *
 * @example
 *   componentName('src/lib/Counter.svelte') // → 'Counter'
 *   componentName('') // → 'Unknown'
 *   componentName(undefined, '?') // → '?'
 */
export function componentName(file: string | undefined | null, fallback = 'Unknown'): string {
  if (!file) return fallback
  const last = basename(file)
  return last.replace(/\.svelte$/, '') || fallback
}
