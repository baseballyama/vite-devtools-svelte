import { asset } from '$app/paths'
import type { AssetPath } from '$app/types'

/** URL of a screenshot in `static/images/`, with the base path applied. */
export function image(file: string): string {
  return asset(`images/${file}` as AssetPath)
}
