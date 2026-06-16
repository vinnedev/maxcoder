// tests/core/orchestration/router.test.ts  ←mirrors→  src/core/orchestration/router.ts
import { expect, test } from 'bun:test'
import { route } from '../../../src/core/orchestration/router.ts'
import type { Route } from '../../../src/core/orchestration/complexity.ts'

test('strong heuristic decides without calling the judge', async () => {
  let judgeCalls = 0
  const judge = async (): Promise<Route> => { judgeCalls++; return 'inline' }
  const d = await route('refactor the auth module', { judge })
  expect(d.route).toBe('orchestrate')
  expect(d.source).toBe('heuristic')
  expect(judgeCalls).toBe(0)
})

test('borderline inline task consults the judge', async () => {
  const judge = async (): Promise<Route> => 'orchestrate'
  const d = await route('add caching and then update the docs and tests', { judge })
  expect(d.route).toBe('orchestrate')
  expect(d.source).toBe('judge')
})

test('judge can keep a borderline task inline', async () => {
  const judge = async (): Promise<Route> => 'inline'
  const d = await route('add caching and then update the docs', { judge })
  expect(d.route).toBe('inline')
})

test('clearly simple task never calls the judge', async () => {
  let judgeCalls = 0
  const judge = async (): Promise<Route> => { judgeCalls++; return 'orchestrate' }
  const d = await route('what is 2 + 2?', { judge })
  expect(d.route).toBe('inline')
  expect(judgeCalls).toBe(0)
})

test('no judge wired → stays inline even when borderline', async () => {
  const d = await route('add caching and then update the docs and tests')
  expect(d.route).toBe('inline')
})
