import fs from 'node:fs'
import vm from 'node:vm'

// @ts-expect-error -- Svelte ships no types for its internal entry
import * as original from 'svelte/internal/client'
import { describe, it, expect } from 'vitest'

import {
  RUNTIME_MODULE_ID,
  RESOLVED_RUNTIME_ID,
  runtimeCode,
  WRAPPER_MODULE_ID,
  wrapperCode,
} from '../src/runtime/index.js'
// @ts-expect-error -- browser source without declarations (served as text)
import * as wrapper from '../src/runtime/wrapper.js'

// Behaviour of the runtime and the wrapper is covered by test/perf (the
// runtime in a fake browser) and test/reactivity (real Svelte components
// through the wrapper). This file pins the module contract the plugin serves.

describe('virtual module ids', () => {
  it.each([
    ['RUNTIME_MODULE_ID', RUNTIME_MODULE_ID, 'virtual:svelte-devtools-runtime'],
    // `\0`: Rollup/Vite convention, so no other plugin tries to load them
    ['RESOLVED_RUNTIME_ID', RESOLVED_RUNTIME_ID, '\0virtual:svelte-devtools-runtime'],
    ['WRAPPER_MODULE_ID', WRAPPER_MODULE_ID, '\0svelte-devtools:wrapped-client'],
  ])('%s', (_, actual, expected) => {
    expect(actual).toBe(expected)
  })
})

describe('served sources', () => {
  it.each([
    ['runtime', runtimeCode, 'client.js'],
    ['wrapper', wrapperCode, 'wrapper.js'],
  ])('the %s text is its source file, verbatim', (_, code, file) => {
    const source = fs.readFileSync(new URL(`../src/runtime/${file}`, import.meta.url), 'utf8')
    expect(code).toBe(source)
  })

  it('the runtime is a self-contained script (no imports) that parses', () => {
    // `import.meta` is only valid in modules; the runtime uses nothing else.
    const script = runtimeCode.replaceAll('import.meta.hot', 'undefined')
    expect(script).not.toMatch(/^\s*(import|export)\b/m)
    expect(() => new vm.Script(script)).not.toThrow()
  })
})

// The wrapper replaces `svelte/internal/client` for app code: every export the
// compiled components may use must still be there, and anything it does not
// override must be Svelte's own binding.
describe('svelte/internal/client wrapper export surface', () => {
  const originalNames = Object.keys(original)
  const wrapperNames = Object.keys(wrapper)
  const overridden = wrapperNames.filter(
    name =>
      (wrapper as Record<string, unknown>)[name] !== (original as Record<string, unknown>)[name],
  )

  it('re-exports every export of svelte/internal/client', () => {
    expect(originalNames.filter(name => !wrapperNames.includes(name))).toEqual([])
    expect(originalNames.length).toBeGreaterThan(100)
  })

  it('adds no export Svelte does not have (an override of a removed API)', () => {
    expect(wrapperNames.filter(name => !originalNames.includes(name))).toEqual([])
  })

  it('overrides exactly the instrumented functions, with functions', () => {
    expect(overridden.toSorted()).toEqual(
      [
        'await',
        'boundary',
        'component',
        'deferred_template_effect',
        'derived',
        'each',
        'if',
        'key',
        'pop',
        'proxy',
        'push',
        'state',
        'tag',
        'tag_proxy',
        'template_effect',
        'user_effect',
        'user_pre_effect',
      ].toSorted(),
    )
    const kinds = (mod: object) =>
      overridden.map(name => [name, typeof (mod as Record<string, unknown>)[name]])
    const functions = overridden.map(name => [name, 'function'])
    expect(kinds(wrapper)).toEqual(functions)
    expect(kinds(original)).toEqual(functions)
  })

  it('without a devtools runtime (no window), overrides behave like Svelte', () => {
    const s = wrapper.state(41)
    expect(s.v).toBe(41)
    expect(wrapper.tag(s, 'count')).toBe(s)
    const p = wrapper.proxy({ a: [1, 2] })
    expect(p).toEqual({ a: [1, 2] })
    expect(wrapper.tag_proxy(p, 'items')).toBe(p)
  })
})
