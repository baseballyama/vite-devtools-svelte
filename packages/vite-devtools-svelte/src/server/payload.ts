/** A hot-channel payload: an untrusted JSON object from the app's runtime. */
export type Payload = Record<string, unknown>

export function asPayload(value: unknown): Payload | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Payload)
    : undefined
}

/** An integer within [min, max], or `fallback` when absent / not a number. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** A non-negative safe integer, 0 when absent / not a number. */
export function nonNegInt(value: unknown): number {
  return clampInt(value, 0, Number.MAX_SAFE_INTEGER, 0)
}

/** A finite number, or `null` when absent / not one. */
export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The array's elements (none when it is not an array). */
export function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
