// tests/core/memory/index.test.ts  ←mirrors→  src/core/memory/index.ts
import { afterAll, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { memoryCategories, recall, recallForPrompt, redactSecrets, remember } from '../../../src/core/memory/index.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-mem-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const at = new Date('2026-06-16T12:00:00Z')

test('categories map to the spec files', () => {
  expect(memoryCategories()).toEqual(['lesson', 'failure', 'tool-error', 'preference', 'decision'])
})

test('remember appends a dated note and recall reads it back', async () => {
  const r = await remember(root, 'lesson', 'The test command is `bun test`.', at)
  expect(r.saved).toBe(true)
  expect(r.redacted).toBe(false)
  expect(existsSync(path.join(root, '.maxcoder/memory/project-lessons.md'))).toBe(true)
  const text = await recall(root, 'lesson')
  expect(text).toContain('2026-06-16')
  expect(text).toContain('bun test')
})

test('redactSecrets masks tokens/keys but keeps the lesson', () => {
  const r = redactSecrets('use API_KEY=sk-abcdef0123456789abcdef to call it')
  expect(r.redacted).toBe(true)
  expect(r.text).not.toContain('sk-abcdef0123456789abcdef')
  expect(r.text).toContain('[REDACTED]')
})

test('remember redacts secrets before saving', async () => {
  const r = await remember(root, 'tool-error', 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 failed', at)
  expect(r.redacted).toBe(true)
  const text = await recall(root, 'tool-error')
  expect(text).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
})

test('empty/invalid input is rejected', async () => {
  expect((await remember(root, 'lesson', '   ', at)).saved).toBe(false)
  // @ts-expect-error invalid category
  expect((await remember(root, 'bogus', 'x', at)).saved).toBe(false)
})

test('multiple notes in a category are stored as separate lines', async () => {
  await remember(root, 'decision', 'chose Bun over Node', at)
  await remember(root, 'decision', 'lexical retrieval, no embeddings', at)
  const text = await recall(root, 'decision')
  expect(text.split('\n').filter(Boolean).length).toBe(2)
})

test('recallForPrompt returns preferences + lessons only, bounded', async () => {
  await remember(root, 'preference', 'Prefers concise answers.', at)
  const p = await recallForPrompt(root)
  expect(p).toContain('User preferences')
  expect(p).toContain('Project lessons')
  expect(p).not.toContain('tool-error') // not included in the prompt slice
})
