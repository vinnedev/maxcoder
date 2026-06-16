// tests/websearch/providers/duckduckgo.test.ts  ←mirrors→  src/websearch/providers/duckduckgo.ts
import { expect, test } from 'bun:test'
import { __test } from '../../../../src/tools/websearch/providers/duckduckgo.ts'
import type { NormalizedWebSearchArgs } from '../../../../src/tools/websearch/types.ts'

const region = (o: Partial<NormalizedWebSearchArgs>) =>
  __test.regionParam({ country: null, language: null, ...o } as NormalizedWebSearchArgs)

test('regionParam: country + language', () => {
  expect(region({ country: 'BR', language: 'pt' })).toBe('br-pt')
  expect(region({ country: 'US', language: 'en-US' })).toBe('us-en')
})

test('regionParam tolerates a LOCALE passed as country (the bug)', () => {
  expect(region({ country: 'pt-BR' })).toBe('br-pt')
  expect(region({ country: 'pt_BR' })).toBe('br-pt')
})

test('regionParam returns undefined (global) for missing/invalid country', () => {
  expect(region({})).toBeUndefined()
  expect(region({ country: 'invalid' })).toBeUndefined()
})

test('decodeUddg decodes the DDG redirect to the real URL', () => {
  expect(__test.decodeUddg('//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fen&rut=abc')).toBe('https://nodejs.org/en')
  expect(__test.decodeUddg('https://direct.example.com/x')).toBe('https://direct.example.com/x')
})
