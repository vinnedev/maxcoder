// tests/core/intent/index.test.ts  ←mirrors→  src/core/intent/index.ts
import { expect, test } from 'bun:test'
import { classifyIntent, INTENT_ROUTES, resolveRoute, routeTask } from '../../../src/core/intent/index.ts'

test('classifies common intents deterministically', () => {
  expect(classifyIntent('what does this function do?')).toBe('simple_question')
  expect(classifyIntent('scan the project and summarize it')).toBe('project_scan')
  expect(classifyIntent('review the auth module')).toBe('code_review')
  expect(classifyIntent('fix the off-by-one bug')).toBe('bug_fix')
  expect(classifyIntent('refactor the parser')).toBe('refactor')
  expect(classifyIntent('write tests for the queue')).toBe('create_tests')
  expect(classifyIntent('design the architecture for plugins')).toBe('architecture_plan')
  expect(classifyIntent('create a tool to fetch weather')).toBe('tool_creation')
  expect(classifyIntent('update the README docs')).toBe('documentation_update')
  expect(classifyIntent('execute the plan')).toBe('execute_plan')
})

test('empty/unknown falls back to simple_question', () => {
  expect(classifyIntent('')).toBe('simple_question')
  expect(classifyIntent('asdf qwerty zxcv')).toBe('simple_question')
})

test('every intent has a complete route with a valid fallback', () => {
  for (const [key, route] of Object.entries(INTENT_ROUTES)) {
    expect(route.intent).toBe(key as never)
    expect(['low', 'medium', 'high', 'max']).toContain(route.minEffort)
    expect(route.tools === 'all' || Array.isArray(route.tools)).toBe(true)
    expect(route.guidance.length).toBeGreaterThan(0)
    expect(INTENT_ROUTES[route.fallback]).toBeDefined() // fallback resolves
  }
})

test('read-only intents do not expose mutating tools', () => {
  const review = resolveRoute('code_review')
  expect(review.tools).not.toContain('write_file')
  expect(review.tools).not.toContain('run_bash')
  const fix = resolveRoute('bug_fix')
  expect(fix.tools).toContain('write_file') // edit intents may write
})

test('routeTask classifies and resolves in one call', () => {
  const r = routeTask('refactor the core module')
  expect(r.intent).toBe('refactor')
  expect(r.minEffort).toBe('high')
})
