/** Longest an outbound devtools request (API playground, OG preview) may take, body included. */
export const OUTBOUND_TIMEOUT_MS = 30_000

/**
 * `fetch` that never follows redirects and gives up after `timeoutMs`, body
 * read (`read`) included. Without it a target that never answers left the
 * RPC pending forever. The request is aborted, and the result rejects even
 * if the transfer ignores the abort.
 */
export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
  timeoutMs = OUTBOUND_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Timed out after ${timeoutMs}ms`)
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  const work = (async () => {
    const res = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal })
    return read(res)
  })()
  // A late failure of the abandoned transfer must not surface as unhandled.
  work.catch(() => {})
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}
