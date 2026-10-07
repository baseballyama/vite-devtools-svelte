import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Session ids come from MCP clients and become file names (review C-7): only
 * the issued `s_<base36>_<hex6>` shape may reach the disk. No file outside the
 * temp persist dir is created; escaping ids must be rejected before any fs
 * access, which the fs spies check.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'

import { SessionStore, isSessionId, SESSION_ID_PATTERN } from '../src/mcp/sessions.js'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function store() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-sessions-'))
  dirs.push(base)
  const persistDir = path.join(base, 'sessions')
  const s = new SessionStore({
    persistDir,
    getters: { getRenderProfiles: () => [], getLoadProfiles: () => [], getFpsSamples: () => [] },
  })
  return { s, persistDir }
}

const MALFORMED = [
  '',
  '..',
  '../x',
  '../../etc/passwd',
  '..\\x',
  '/abs/path',
  'C:\\x',
  's_abc_123456/../../x',
  's_abc_12345',
  's_abc_1234567',
  's_ABC_123456',
  's__123456',
  's_abc_12345g',
  'x_abc_123456',
  's_abc_123456\0',
  's_abc_123456.json',
  ' s_abc_123456',
]

describe('session ids', () => {
  it('accepts exactly the shape start() issues', () => {
    const { s } = store()
    const rec = s.start('a', false)
    expect(rec.id).toMatch(SESSION_ID_PATTERN)
    expect(isSessionId(rec.id)).toBe(true)
    for (const id of MALFORMED) expect({ id, valid: isSessionId(id) }).toEqual({ id, valid: false })
  })

  it('rejects malformed and escaping ids in get/delete/compare before touching the disk', () => {
    const { s } = store()
    const read = vi.spyOn(fs, 'readFileSync')
    const exists = vi.spyOn(fs, 'existsSync')
    const unlink = vi.spyOn(fs, 'unlinkSync')
    for (const id of MALFORMED) {
      expect({ id, got: s.get(id), deleted: s.delete(id) }).toEqual({
        id,
        got: undefined,
        deleted: false,
      })
      expect(() => s.compare(id, id)).toThrow(`Session not found: ${id}`)
    }
    expect(read).not.toHaveBeenCalled()
    expect(exists).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('keeps legitimate persistence working: end to disk, load from a new store, list, delete', () => {
    const { s, persistDir } = store()
    const rec = s.start('baseline', true)
    s.end('disk')
    expect(fs.readdirSync(persistDir)).toEqual([`${rec.id}.json`])

    const again = new SessionStore({
      persistDir,
      getters: { getRenderProfiles: () => [], getLoadProfiles: () => [], getFpsSamples: () => [] },
    })
    expect(again.get(rec.id)?.label).toBe('baseline')
    expect(again.list().map(r => r.id)).toEqual([rec.id])
    expect(again.delete(rec.id)).toBe(true)
    expect(fs.readdirSync(persistDir)).toEqual([])
  })

  it('does not list or load files whose name or content is not a valid id', () => {
    const { s, persistDir } = store()
    fs.mkdirSync(persistDir, { recursive: true })
    fs.writeFileSync(
      path.join(persistDir, 'notes.json'),
      JSON.stringify({ id: 'notes', startedAt: 1 }),
    )
    // valid file name, but the content claims another id
    fs.writeFileSync(
      path.join(persistDir, 's_abc_123456.json'),
      JSON.stringify({ id: '../escape', label: 'x', startedAt: 1 }),
    )
    expect(s.list()).toEqual([])
    expect(s.get('s_abc_123456')).toBeUndefined()
  })
})
