// tests/core/retrieval/extract.test.ts  ←mirrors→  src/core/retrieval/extract.ts
import { expect, test } from 'bun:test'
import { extractImports, extractSymbols } from '../../../src/core/retrieval/extract.ts'

test('extracts exported/declared symbols across forms', () => {
  const src = `
export function foo() {}
export async function bar() {}
export default class Baz {}
export const qux = 1
export interface IThing {}
export type T = string
export enum E { A }
export { a, b as c }
export type { D }
`
  const s = extractSymbols(src)
  for (const name of ['foo', 'bar', 'Baz', 'qux', 'IThing', 'T', 'E', 'a', 'b', 'D']) {
    expect(s).toContain(name)
  }
})

test('extracts import/re-export/side-effect/dynamic specifiers', () => {
  const src = `
import x from './x.ts'
import type { Y } from '../y'
import './side-effect.css'
export { z } from './z'
const m = await import('./dyn')
`
  const i = extractImports(src)
  expect(i.sort()).toEqual(['../y', './dyn', './side-effect.css', './x.ts', './z'])
})

test('returns empty for files with no exports/imports', () => {
  expect(extractSymbols('const local = 1')).toEqual([])
  expect(extractImports('const local = 1')).toEqual([])
})
