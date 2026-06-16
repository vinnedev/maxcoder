// tests/core/orchestration/planner.test.ts  ←mirrors→  src/core/orchestration/planner.ts
import { expect, test } from 'bun:test'
import { parsePlan } from '../../../src/core/orchestration/planner.ts'

test('parses a clean JSON array of subtasks', () => {
  const raw = JSON.stringify([
    { id: 'a', goal: 'research the API', role: 'researcher' },
    { id: 'b', goal: 'write a summary', dependsOn: ['a'] },
  ])
  const plan = parsePlan(raw)
  expect(plan.map(p => p.id)).toEqual(['a', 'b'])
  expect(plan[0].role).toBe('researcher')
  expect(plan[1].dependsOn).toEqual(['a'])
})

test('extracts JSON embedded in prose and code fences', () => {
  const raw = 'Sure! Here is the plan:\n```json\n[{"goal":"do A"},{"goal":"do B"}]\n```\nHope it helps.'
  const plan = parsePlan(raw)
  expect(plan.length).toBe(2)
  expect(plan[0].id).toBe('s1') // synthesized id
})

test('infers a role when none/invalid is given', () => {
  const plan = parsePlan('[{"goal":"search the web for docs"},{"goal":"implement the fix"}]')
  expect(plan[0].role).toBe('researcher')
  expect(plan[1].role).toBe('coder')
})

test('drops entries without a goal and dedupes ids', () => {
  const plan = parsePlan('[{"id":"x","goal":"one"},{"id":"x","goal":"two"},{"id":"y"}]')
  expect(plan.map(p => p.goal)).toEqual(['one', 'two'])
  expect(new Set(plan.map(p => p.id)).size).toBe(2) // ids made unique
})

test('strips dependencies that reference unknown or self ids', () => {
  const plan = parsePlan('[{"id":"a","goal":"A","dependsOn":["ghost","a"]},{"id":"b","goal":"B","dependsOn":["a"]}]')
  expect(plan[0].dependsOn).toEqual([]) // ghost + self removed
  expect(plan[1].dependsOn).toEqual(['a'])
})

test('caps at maxNodes', () => {
  const raw = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ goal: `g${i}` })))
  expect(parsePlan(raw, 4).length).toBe(4)
})

test('returns [] for malformed or non-array output (triggers inline fallback)', () => {
  expect(parsePlan('I cannot make a plan.')).toEqual([])
  expect(parsePlan('{"goal":"not an array"}')).toEqual([])
  expect(parsePlan('[ {broken json ')).toEqual([])
})
