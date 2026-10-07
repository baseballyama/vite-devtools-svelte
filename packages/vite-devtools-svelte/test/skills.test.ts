// Shipped agent skills (skills/*/SKILL.md) must load in every agent that
// follows the Agent Skills spec, not just Claude Code: `name` is lowercase
// letters, digits and single hyphens, at most 64 chars, equal to its
// directory name (pi rejects names with `:`).
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SKILLS = fileURLToPath(new URL('../skills/', import.meta.url))
const dirs = readdirSync(SKILLS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)

function frontmatter(dir: string): Record<string, string> {
  const text = readFileSync(`${SKILLS}${dir}/SKILL.md`, 'utf8')
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  return Object.fromEntries(
    block.split('\n').map(line => {
      const i = line.indexOf(':')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
    }),
  )
}

describe('shipped skills', () => {
  it('ships the perf skills', () => {
    expect(dirs.toSorted()).toEqual([
      'vite-devtools-svelte-perf-audit',
      'vite-devtools-svelte-perf-fix',
    ])
  })

  it.each(dirs)('%s: spec-valid name equal to its directory, with a description', dir => {
    const { name, description } = frontmatter(dir)
    expect(name).toBe(dir)
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(name!.length).toBeLessThanOrEqual(64)
    expect(description?.length).toBeGreaterThan(0)
    expect(description!.length).toBeLessThanOrEqual(1024)
  })

  it.each(dirs)('%s: references sibling skills by their real names', dir => {
    const text = readFileSync(`${SKILLS}${dir}/SKILL.md`, 'utf8')
    const refs = Array.from(text.matchAll(/vite-devtools-svelte[:-][a-z-]+/g), m => m[0])
    expect(refs.filter(r => !dirs.includes(r))).toEqual([])
  })
})
