/** A hot-channel payload: an untrusted JSON object from the app's runtime. */
export type Payload = Record<string, unknown>;

export function asPayload(value: unknown): Payload | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Payload)
    : undefined;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function nonNegInt(value: unknown): number {
  return clampInt(value, 0, Number.MAX_SAFE_INTEGER, 0);
}

export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
