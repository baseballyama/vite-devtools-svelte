/**
 * Setup for the `dom` vitest project (component tests in happy-dom).
 *
 * - `src/lib/rpc.ts` is replaced by the typed fakes in `fake-rpc.ts`, so no
 *   test opens a socket; each test starts from the default answers.
 * - happy-dom lays nothing out: `clientHeight`/`clientWidth` are 0 unless a
 *   test sets them (see `dom.ts`).
 * - Async queries wait up to 5 s: panels are lazy imports, which are slow
 *   to transform under coverage instrumentation on a busy machine.
 */
import { configure } from '@testing-library/svelte'
import { beforeEach, vi } from 'vitest'

import { resetFakeRpc } from './fake-rpc.js'

vi.mock('../lib/rpc.js', () => import('./fake-rpc.js'))

configure({ asyncUtilTimeout: 5000 })

beforeEach(() => {
  resetFakeRpc()
  localStorage.clear()
  history.replaceState(null, '', '/')
})
