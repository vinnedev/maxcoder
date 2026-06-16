// tests/core/orchestration/complexity.test.ts  ←mirrors→  src/core/orchestration/complexity.ts
import { expect, test } from 'bun:test'
import { classify, hasWeakComplexitySignals } from '../../../src/core/orchestration/complexity.ts'

test('simple asks route inline', () => {
  expect(classify('what is 2 + 2?')).toBe('inline')
  expect(classify('read src/cli.ts and summarize it')).toBe('inline')
  expect(classify('')).toBe('inline')
})

test('decomposition verbs route to orchestrate', () => {
  expect(classify('refactor the auth module')).toBe('orchestrate')
  expect(classify('audit the codebase for security issues')).toBe('orchestrate')
  expect(classify('migrate the project from npm to bun')).toBe('orchestrate')
  expect(classify('build a feature for exporting reports')).toBe('orchestrate')
  expect(classify('use agents to investigate the flaky test')).toBe('orchestrate')
})

test('a numbered/bulleted list of 3+ steps routes to orchestrate', () => {
  expect(classify('do this:\n1. read files\n2. find bugs\n3. write a report')).toBe('orchestrate')
})

test('background phrasing routes to background', () => {
  expect(classify('run the full test suite in the background')).toBe('background')
  expect(classify('rode os testes em segundo plano')).toBe('background')
})

test('orchestrate signal outranks background phrasing', () => {
  expect(classify('refactor the parser in the background')).toBe('orchestrate')
})

test('hasWeakComplexitySignals flags borderline tasks for the judge', () => {
  expect(hasWeakComplexitySignals('add caching and then update the docs')).toBe(true) // chain
  expect(hasWeakComplexitySignals('find the bug and write a test for it')).toBe(true) // 2+ verbs
  expect(hasWeakComplexitySignals('a'.repeat(200))).toBe(true) // long
  expect(hasWeakComplexitySignals('- one thing')).toBe(true) // a list item (below orchestrate threshold)
})

test('hasWeakComplexitySignals ignores clearly simple asks', () => {
  expect(hasWeakComplexitySignals('what time is it?')).toBe(false)
  expect(hasWeakComplexitySignals('read package.json')).toBe(false)
  expect(hasWeakComplexitySignals('')).toBe(false)
})
