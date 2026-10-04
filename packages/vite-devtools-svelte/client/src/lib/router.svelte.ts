/**
 * Hash router: `#/<panel>` selects the panel so reloads, the browser back
 * button and deep links from other tools land on the same view.
 */
import { panels, type PanelId } from './panels.js'

const ids = new Set<string>(panels.map((p) => p.id))

function parse(): PanelId {
  const id = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (ids.has(id) ? id : 'overview') as PanelId
}

let current = $state<PanelId>(parse())

/** devframe's magic link (`#devframe_otp=<code>`) is not a route. */
export const OTP_HASH = /(?:^#|[&?])devframe_otp=(\d+)/

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    // Keep the current panel; ConnectionGate consumes the code and
    // restores the panel hash.
    if (OTP_HASH.test(location.hash)) return
    current = parse()
  })
}

export const router = {
  get current() {
    return current
  },
  go(id: PanelId) {
    if (id === current) return
    current = id
    history.pushState(null, '', `#/${id}`)
  },
}
