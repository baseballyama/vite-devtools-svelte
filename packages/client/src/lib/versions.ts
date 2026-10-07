/**
 * Dataset change counters (`getVersions`, docs/devframe-migration.md §6.4).
 * Panels poll this tiny payload and refetch a dataset only when its counter
 * moved. Concurrent panels share one in-flight request (and a result younger
 * than `MAX_AGE`). Feature-detected: without the RPC every tick refetches.
 */
import * as rpc from './rpc.js'
import type { DatasetVersions } from './types.js'

export type DatasetKey = keyof DatasetVersions

const api = rpc as unknown as { getVersions?: () => Promise<DatasetVersions> }

export const versionsSupported = typeof api.getVersions === 'function'

const MAX_AGE = 250
let pending: Promise<DatasetVersions | null> | null = null
let at = 0

function fetchVersions(): Promise<DatasetVersions | null> {
  if (pending && Date.now() - at < MAX_AGE) return pending
  at = Date.now()
  pending = api.getVersions!().catch(() => null)
  return pending
}

/** Version getter for `resource({ version })`; `undefined` = unknown, always refetch. */
export function datasetVersion(
  ...keys: DatasetKey[]
): (() => Promise<string | undefined>) | undefined {
  if (!versionsSupported) return undefined
  return async () => {
    const v = await fetchVersions()
    return v ? keys.map(k => v[k]).join(':') : undefined
  }
}
