import { afterEach, describe, expect, it, vi } from 'vitest'

const loc = { hash: '' }
const history = { pushState: vi.fn() }
let onHashChange: (() => void) | undefined

/** Fresh router module (it reads the hash and subscribes on load). */
async function load(hash: string) {
  vi.resetModules()
  loc.hash = hash
  onHashChange = undefined
  history.pushState.mockClear()
  vi.stubGlobal('location', loc)
  vi.stubGlobal('history', history)
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'hashchange') onHashChange = cb
    },
  })
  return import('./router.svelte.js')
}

function navigate(hash: string) {
  loc.hash = hash
  onHashChange!()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('router: initial hash', () => {
  it.each([
    ['', 'overview'],
    ['#', 'overview'],
    ['#/', 'overview'],
    ['#/routes', 'routes'],
    ['#routes', 'routes'],
    ['#/routes/extra/segments', 'routes'],
    ['#/fps?x=1', 'fps'],
    ['#/nope', 'overview'],
    ['#/ROUTES', 'overview'],
    ['#/__proto__', 'overview'],
    // devframe's magic link is not a panel.
    ['#devframe_otp=123456', 'overview'],
  ])('%j → %s', async (hash, panel) => {
    const { router } = await load(hash)
    expect(router.current).toBe(panel)
  })
})

describe('router: navigation', () => {
  it('follows hash changes (back button, deep links)', async () => {
    const { router } = await load('#/routes')
    navigate('#/fps')
    expect(router.current).toBe('fps')
    navigate('#/unknown')
    expect(router.current).toBe('overview')
  })

  it.each(['#devframe_otp=123', '#/x?devframe_otp=1', '#/fps?a=b&devframe_otp=42'])(
    'keeps the current panel for an OTP magic link %j',
    async hash => {
      const { router } = await load('#/routes')
      navigate(hash)
      expect(router.current).toBe('routes')
    },
  )

  it('go() switches panels and pushes one history entry', async () => {
    const { router } = await load('')
    router.go('reactive')
    expect(router.current).toBe('reactive')
    expect(history.pushState).toHaveBeenCalledWith(null, '', '#/reactive')
    router.go('reactive')
    expect(history.pushState).toHaveBeenCalledTimes(1)
  })

  it('is reactive', async () => {
    const { router } = await load('')
    const { track } = await import('./testing.svelte.js')
    const t = track(() => router.current)
    router.go('api')
    t.flush()
    navigate('#/og')
    t.flush()
    t.stop()
    expect(t.seen).toEqual(['overview', 'api', 'og'])
  })

  it('loads without a window (no hashchange subscription)', async () => {
    vi.resetModules()
    vi.stubGlobal('location', { hash: '#/build' })
    Reflect.deleteProperty(globalThis, 'window')
    const { router } = await import('./router.svelte.js')
    expect(router.current).toBe('build')
  })
})

describe('hashOtp', () => {
  it.each([
    ['#devframe_otp=123456', '123456'],
    ['#/fps?devframe_otp=1', '1'],
    ['#/fps?x&devframe_otp=007', '007'],
    ['#a=b&devframe_otp=9', '9'],
    // Only the leading digits are the code.
    ['#devframe_otp=12a', '12'],
    // A later parameter still counts when an earlier one has no code.
    ['#devframe_otp=x&devframe_otp=5', '5'],
    ['#devframe_otp=abc', null],
    ['#devframe_otp=', null],
    ['#xdevframe_otp=1', null],
    ['#/devframe_otp=1', null],
    ['devframe_otp=1', null],
    ['', null],
  ])('%j → %s', async (hash, code) => {
    const { hashOtp } = await load('')
    expect(hashOtp(hash)).toBe(code)
  })
})
