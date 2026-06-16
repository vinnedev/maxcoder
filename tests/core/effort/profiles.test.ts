// tests/core/effort/profiles.test.ts  ←mirrors→  src/core/effort/profiles.ts
import { expect, test } from 'bun:test'
import { EFFORT_ORDER, EFFORT_PROFILES, effortRank, maxEffort } from '../../../src/core/effort/profiles.ts'

test('every level has a profile and budgets grow monotonically with effort', () => {
  let prev = -1
  for (const level of EFFORT_ORDER) {
    const p = EFFORT_PROFILES[level]
    expect(p.level).toBe(level)
    expect(p.maxModelCalls).toBeGreaterThan(prev)
    prev = p.maxModelCalls
  }
  // low does the least, max the most
  expect(EFFORT_PROFILES.low.critiqueCycles).toBe(0)
  expect(EFFORT_PROFILES.max.useTreeOfThoughts).toBe(true)
  expect(EFFORT_PROFILES.low.useTreeOfThoughts).toBe(false)
})

test('effortRank and maxEffort compare levels', () => {
  expect(effortRank('low')).toBe(0)
  expect(effortRank('max')).toBe(3)
  expect(maxEffort('low', 'high')).toBe('high')
  expect(maxEffort('max', 'medium')).toBe('max')
})
