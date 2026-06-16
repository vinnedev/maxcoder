// tests/core/retrieval/retriever.test.ts  ←mirrors→  src/core/retrieval/retriever.ts
import { expect, test } from 'bun:test'
import { buildContext, scoreFile, searchSymbols, tokenize, type IndexedFile, type RepoIndex } from '../../../src/core/retrieval/retriever.ts'

function file(over: Partial<IndexedFile> & { path: string }): IndexedFile {
  const symbols = over.symbols ?? []
  const summary = over.summary ?? ''
  return {
    mtimeMs: 1, size: 1, imports: [],
    symbols, summary,
    pathTokens: tokenize(over.path),
    symbolTokens: [...new Set(symbols.flatMap(tokenize))],
    summaryTokens: tokenize(summary),
    ...over,
  }
}

const index: RepoIndex = {
  generatedAt: 0,
  files: {
    'src/core/effort/controller.ts': file({ path: 'src/core/effort/controller.ts', symbols: ['EffortController'], summary: 'resolves the active effort budget' }),
    'src/safety/index.ts': file({ path: 'src/safety/index.ts', symbols: ['evaluateToolCall', 'inspectCommand'], summary: 'tool safety guardrails' }),
    'src/ui/brand.ts': file({ path: 'src/ui/brand.ts', symbols: ['banner', 'c'], summary: 'colors and banner' }),
  },
}

test('tokenize splits camelCase, paths, and punctuation', () => {
  expect(tokenize('EffortController')).toEqual(['effort', 'controller'])
  expect(tokenize('src/core/agent/index.ts')).toEqual(['src', 'core', 'agent', 'index', 'ts'])
})

test('scoreFile weights exact symbol matches highest', () => {
  const f = index.files['src/safety/index.ts']
  expect(scoreFile(['evaluatetoolcall'], f)).toBeGreaterThan(scoreFile(['safety'], f))
  expect(scoreFile(['nonexistent'], f)).toBe(0)
})

test('searchSymbols finds files by symbol substring, ranked', () => {
  const hits = searchSymbols(index, 'effort')
  expect(hits[0].path).toBe('src/core/effort/controller.ts')
  expect(hits[0].symbols).toContain('EffortController')
})

test('buildContext ranks relevant files and respects maxFiles', () => {
  // both 'effort' (controller) and 'safety' (safety/index) match; maxFiles caps to the top one.
  const bundle = buildContext(index, 'effort safety', { maxFiles: 1 })
  expect(bundle.items.length).toBe(1)
  expect(bundle.items[0].path).toBe('src/core/effort/controller.ts') // higher score
  expect(bundle.truncated).toBe(true)
})

test('buildContext respects the token budget (but always returns the top hit)', () => {
  const bundle = buildContext(index, 'effort safety brand', { maxFiles: 10, budgetTokens: 1 })
  expect(bundle.items.length).toBe(1) // tiny budget → just the first
  expect(bundle.truncated).toBe(true)
})

test('a query with no matches yields an empty bundle', () => {
  expect(buildContext(index, 'kubernetes helm chart').items).toEqual([])
})
