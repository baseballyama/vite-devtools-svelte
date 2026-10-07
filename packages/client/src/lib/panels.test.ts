import { describe, expect, it, vi } from 'vitest'

// Panels import the RPC layer (feature-detected functions included) and the
// router, which reads the hash on load; nothing is called while loading.
vi.mock('./rpc.js', () => ({ getCaptureInfo: vi.fn(), getVersions: vi.fn() }))
vi.stubGlobal('location', { hash: '' })

const { groupLabels, panelById, panels } = await import('./panels.js')
const { icons } = await import('./icons.js')

describe('panel registry', () => {
  it('has unique ids, known icons and known groups', () => {
    const ids = panels.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of panels) {
      expect(icons).toHaveProperty(p.icon)
      expect(groupLabels).toHaveProperty(p.group)
      expect(p.label.trim()).not.toBe('')
      expect(p.description.trim()).not.toBe('')
    }
  })

  it('lists the panels of one group together (navigation renders them in order)', () => {
    const groups = panels.map(p => p.group)
    const firstSeen = [...new Set(groups)]
    expect(groups).toEqual(firstSeen.flatMap(g => groups.filter(x => x === g)))
  })

  it.each(panels.map(p => p.id))('panelById(%j) finds it', id => {
    expect(panelById(id).id).toBe(id)
  })

  it.each(['', 'nope', 'OVERVIEW', 'overview/', '__proto__', 'constructor'])(
    'panelById(%j) falls back to the first panel (overview)',
    id => {
      expect(panelById(id)).toBe(panels[0])
      expect(panels[0].id).toBe('overview')
    },
  )

  // Compiles and evaluates every panel (and the components it imports) once:
  // slow under coverage instrumentation, hence the timeout.
  it('every panel module loads a component', { timeout: 60_000 }, async () => {
    const mods = await Promise.all(panels.map(async p => [p.id, typeof (await p.load()).default]))
    expect(Object.fromEntries(mods)).toEqual(
      Object.fromEntries(panels.map(p => [p.id, 'function'])),
    )
  })
})
