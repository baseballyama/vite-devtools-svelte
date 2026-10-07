import { describe, it, expect } from 'vitest'

import CodeSample from './fixtures/CodeSample.svelte'
import { render, instance } from './harness.js'

describe('component tracking transform on real compiler output', () => {
  it('a component whose markup shows `$.push(` code is tracked under its file, markup intact', () => {
    const r = render(CodeSample)
    expect(instance('CodeSample').file).toMatch(/fixtures\/CodeSample\.svelte$/)
    expect((r.target as unknown as { textContent: string }).textContent).toContain(
      '$.push($$props, true);',
    )
    r.destroy()
  })
})
