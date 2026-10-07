/**
 * Reactive connection/auth state for the shell.
 *
 * `rpc.ts` (owned by the architecture lead) exposes the devframe connection
 * API additively (docs/devframe-migration.md §6.1). Feature-detect it so the
 * UI works unchanged on transports that do not report a status.
 */
import * as rpc from './rpc.js'

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'unauthorized'
  | 'disconnected'
  | 'error'
export interface ConnectionState {
  status: ConnectionStatus
  host: 'standalone' | 'vite-devtools' | 'unknown'
  error?: string
}

interface ConnectionApi {
  getConnectionState?: () => ConnectionState
  onConnectionState?: (cb: (s: ConnectionState) => void) => () => void
  requestAuthCode?: (options?: { reissue?: boolean }) => Promise<void>
  submitAuthCode?: (code: string) => Promise<boolean>
}

const api = rpc as unknown as ConnectionApi

export const connectionSupported = typeof api.onConnectionState === 'function'

let state = $state<ConnectionState>(
  api.getConnectionState?.() ?? { status: 'connected', host: 'unknown' },
)

if (connectionSupported) {
  api.onConnectionState!(s => {
    state = s
  })
}

export const connection = {
  get state() {
    return state
  },
  get canAuth() {
    return typeof api.submitAuthCode === 'function'
  },
  /**
   * Ask the dev server to print the auth code. `reissue: true` rotates the
   * code so a fresh one is printed (devframe prints each code only once);
   * use it only for an explicit user request.
   */
  async requestCode(options?: { reissue?: boolean }) {
    await api.requestAuthCode?.(options)
  },
  async submitCode(code: string) {
    return (await api.submitAuthCode?.(code)) ?? false
  },
}
