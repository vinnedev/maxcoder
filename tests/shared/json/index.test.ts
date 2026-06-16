// tests/shared/json/index.test.ts  ←mirrors→  src/shared/json/index.ts
import { expect, test } from 'bun:test'
import { extractJsonValue } from '../../../src/shared/json/index.ts'

test('extracts an object from prose and code fences', () => {
  expect(extractJsonValue<{ a: number; b: string }>('Here:\n```json\n{"a":1,"b":"x"}\n```\ndone')).toEqual({ a: 1, b: 'x' })
})

test('extracts an array', () => {
  expect(extractJsonValue<number[]>('result: [1,2,3] ok')).toEqual([1, 2, 3])
})

test('picks whichever of {/[ comes first', () => {
  expect(extractJsonValue<{ k: number }>('text {"k":1} then [2]')).toEqual({ k: 1 })
})

test('handles braces inside strings', () => {
  expect(extractJsonValue<{ path: string; n: number }>('{"path":"a/{b}/c","n":2}')).toEqual({ path: 'a/{b}/c', n: 2 })
})

test('returns null for no/invalid JSON', () => {
  expect(extractJsonValue('no json here')).toBeNull()
  expect(extractJsonValue('{broken')).toBeNull()
})
