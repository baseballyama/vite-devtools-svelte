/**
 * Dataset change counters (`getVersions`).
 * Panels poll this tiny payload and refetch a dataset only when its counter
 * moved. Concurrent panels share one in-flight request (and a result younger
 * than `MAX_AGE`). A failed request reads as unknown, so the panel refetches.
 */
import { getVersions } from './rpc.js';
import type { DatasetVersions } from './types.js';

export type DatasetKey = keyof DatasetVersions;

const MAX_AGE = 250;
let pending: Promise<DatasetVersions | null> | null = null;
let at = 0;

function fetchVersions(): Promise<DatasetVersions | null> {
  const age = Date.now() - at;
  // A negative age means the clock went back: the cached answer's age is unknown.
  if (pending && age >= 0 && age < MAX_AGE) return pending;
  at = Date.now();
  pending = getVersions().catch(() => null);
  return pending;
}

/** Version getter for `resource({ version })`; `undefined` = unknown, always refetch. */
export function datasetVersion(...keys: DatasetKey[]): () => Promise<string | undefined> {
  return async () => {
    const v = await fetchVersions();
    return v ? keys.map(k => v[k]).join(':') : undefined;
  };
}
