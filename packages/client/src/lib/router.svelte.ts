/**
 * Hash router: `#/<panel>` selects the panel so reloads, the browser back
 * button and deep links from other tools land on the same view.
 */
import { leadingDigits } from './chars.js'
import { panels, type PanelId } from './panels.js'

const ids = new Set<string>(panels.map(p => p.id))

function parse(): PanelId {
  let h = location.hash
  if (h.startsWith('#')) h = h.slice(1)
  if (h.startsWith('/')) h = h.slice(1)
  const id = h.split('?')[0]!.split('/')[0]!
  return (ids.has(id) ? id : 'overview') as PanelId
}

let current = $state<PanelId>(parse())

const OTP_KEY = 'devframe_otp='

/**
 * The code in devframe's magic link (`#devframe_otp=<code>`, also as a
 * `?`/`&` parameter after a route), or `null`. A magic link is not a route.
 */
export function hashOtp(hash: string): string | null {
  for (let i = hash.indexOf(OTP_KEY); i !== -1; i = hash.indexOf(OTP_KEY, i + 1)) {
    const prev = hash[i - 1]
    if (!(i === 1 && prev === '#') && prev !== '&' && prev !== '?') continue
    const code = leadingDigits(hash.slice(i + OTP_KEY.length))
    if (code) return code
  }
  return null
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    // Keep the current panel; ConnectionGate consumes the code and
    // restores the panel hash.
    if (hashOtp(location.hash) !== null) return
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
