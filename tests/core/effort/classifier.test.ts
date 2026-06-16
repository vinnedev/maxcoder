// tests/core/effort/classifier.test.ts  ←mirrors→  src/core/effort/classifier.ts
import { expect, test } from 'bun:test'
import { assessEffort, effortFloor, heuristicAssessment, parseAssessmentJson } from '../../../src/core/effort/classifier.ts'

test('deterministic floors: critical files → max, command/core-agent/refactor → high', () => {
  expect(effortFloor('bump the version in package.json')).toBe('max')
  expect(effortFloor('edit the Dockerfile and docker-compose')).toBe('max')
  expect(effortFloor('run a command to install deps')).toBe('high')
  expect(effortFloor('change the system prompt')).toBe('high')
  expect(effortFloor('refactor the parser module')).toBe('high')
  expect(effortFloor('implement auto-improve memory reviewer')).toBe('max')
  expect(effortFloor('what does this function do?')).toBe(null)
})

test('heuristic assessment classifies type and flags without a model', () => {
  const q = heuristicAssessment('what is a closure?')
  expect(q.effort).toBe('low')
  expect(q.task_type).toBe('question')
  expect(q.requires_file_edits).toBe(false)

  const fix = heuristicAssessment('fix the off-by-one bug in the loop and add a test')
  expect(fix.task_type).toBe('bug_fix')
  expect(fix.requires_file_edits).toBe(true)
  expect(fix.requires_tests).toBe(true)
})

test('floors RAISE the model opinion, never lower it', async () => {
  // Model under-sizes a critical-file change; the floor must pull it up to max.
  const a = await assessEffort('edit package.json to add a dependency', {
    assess: async () => ({ effort: 'low', risk: 'low', reason: 'looks trivial' }),
  })
  expect(a.effort).toBe('max')
  expect(a.risk).toBe('high')
  expect(a.requires_plan).toBe(true)
})

test('model opinion is honored when no floor applies', async () => {
  const a = await assessEffort('summarize the README', {
    assess: async () => ({ effort: 'medium', task_type: 'documentation', risk: 'low', reason: 'model said so' }),
  })
  expect(a.effort).toBe('medium')
  expect(a.reason).toBe('model said so')
})

test('a throwing model assessor degrades to the heuristic', async () => {
  const a = await assessEffort('explain the architecture', { assess: async () => { throw new Error('offline') } })
  expect(['low', 'medium', 'high', 'max']).toContain(a.effort)
  expect(a.task_type).toBe('architecture') // 'architecture' keyword wins over the question prefix
})

test('requires_tests is forced when file edits are required', async () => {
  const a = await assessEffort('add a new function to utils', {
    assess: async () => ({ requires_file_edits: true, requires_tests: false }),
  })
  expect(a.requires_tests).toBe(true)
})

test('the model is not consulted for floored or plain-question tasks', async () => {
  let calls = 0
  const assess = async () => { calls++; return {} }
  await assessEffort('edit package.json', { assess }) // floored → deterministic
  await assessEffort('what is recursion?', { assess }) // question → deterministic
  expect(calls).toBe(0)
  await assessEffort('add a helper to the utils module', { assess }) // ambiguous → consults
  expect(calls).toBe(1)
})

test('parseAssessmentJson extracts JSON from prose/fences and tolerates garbage', () => {
  expect(parseAssessmentJson('Here:\n```json\n{"effort":"high","risk":"medium"}\n```')).toEqual({ effort: 'high', risk: 'medium' })
  expect(parseAssessmentJson('no json here')).toEqual({})
  expect(parseAssessmentJson('{broken')).toEqual({})
})
