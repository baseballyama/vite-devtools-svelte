import { describe, expect, it } from 'vitest'

import { digitsOf, isDigits, isSpace, isWord, leadingDigits, words } from './chars.js'

describe('chars', () => {
  it('isSpace matches what a regex `\\s` matches', () => {
    for (const c of [' ', '\t', '\n', '\r', ' ', ' ', '﻿']) {
      expect(isSpace(c)).toBe(true)
    }
    for (const c of ['a', '0', '_', '', undefined]) expect(isSpace(c)).toBe(false)
  })

  it('isWord is ASCII letters, digits and `_`', () => {
    expect(['a', 'Z', '0', '_'].every(isWord)).toBe(true)
    expect(['$', '-', 'é', undefined].some(isWord)).toBe(false)
  })

  it('words splits on any run of whitespace and drops empties', () => {
    expect(words('  foo \t bar baz  ')).toEqual(['foo', 'bar', 'baz'])
    expect(words('')).toEqual([])
    expect(words(' \n ')).toEqual([])
  })

  it('digit helpers', () => {
    expect(isDigits('0123')).toBe(true)
    expect(isDigits('')).toBe(false)
    expect(isDigits('1a')).toBe(false)
    expect(leadingDigits('12ab3')).toBe('12')
    expect(leadingDigits('x1')).toBe('')
    expect(digitsOf(' 12-3a4 ')).toBe('1234')
  })
})
