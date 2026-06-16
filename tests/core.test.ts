// Unit tests for pure core logic (frontmatter + token estimation).
// Run: `bun test`

import { expect, test } from 'bun:test'
import { contextTokens, estimateTokens, messageTokens } from '../src/context.ts'
import { parseFrontmatter } from '../src/skills.ts'
import { completeInput, suggestInput } from '../src/tui.ts'

test('estimateTokens ~ chars/4', () => {
  expect(estimateTokens('')).toBe(0)
  expect(estimateTokens('abcd')).toBe(1)
  expect(estimateTokens('a'.repeat(40))).toBe(10)
})

test('messageTokens adds per-message overhead and tool_calls', () => {
  expect(messageTokens({ role: 'user', content: 'abcd' })).toBe(5) // 1 + 4
  const withTool = messageTokens({
    role: 'assistant',
    content: '',
    tool_calls: [{ function: { name: 'x', arguments: {} } }],
  })
  expect(withTool).toBeGreaterThan(4)
})

test('contextTokens sums messages', () => {
  expect(contextTokens([{ role: 'user', content: 'abcd' }, { role: 'assistant', content: 'abcd' }])).toBe(10)
})

test('parseFrontmatter extracts meta and body', () => {
  const { meta, body } = parseFrontmatter('---\nname: code-review\ndescription: "review code"\n---\nDo the review.')
  expect(meta.name).toBe('code-review')
  expect(meta.description).toBe('review code')
  expect(body).toBe('Do the review.')
})

test('parseFrontmatter without frontmatter returns whole body', () => {
  const { meta, body } = parseFrontmatter('just a body')
  expect(meta).toEqual({})
  expect(body).toBe('just a body')
})

test('completeInput completes slash commands', () => {
  const out = completeInput('/he', 3)
  expect(out.input).toBe('/help ')
  expect(out.cursor).toBe(6)
  expect(out.completed).toBe(true)
})

test('completeInput completes CLI flags', () => {
  const out = completeInput('--pla', 5)
  expect(out.input).toBe('--plain ')
  expect(out.completed).toBe(true)
})

test('completeInput completes top-level doctor command', () => {
  const out = completeInput('doc', 3)
  expect(out.input).toBe('doctor ')
  expect(out.completed).toBe(true)
})

test('completeInput cycles ambiguous commands', () => {
  const first = completeInput('/c', 2, 0)
  const second = completeInput('/c', 2, 1)
  expect(first.suggestions).toEqual(['/compact', '/clear', '/clean', '/cost'])
  expect(second.input).toBe('/clear')
})

test('suggestInput returns visible slash and flag suggestions while typing', () => {
  expect(suggestInput('/', 1)).toContain('/help')
  expect(suggestInput('/cl', 3)).toContain('/clean')
  expect(suggestInput('/he', 3)).toEqual(['/help'])
  expect(suggestInput('--', 2)).toContain('--model')
})
