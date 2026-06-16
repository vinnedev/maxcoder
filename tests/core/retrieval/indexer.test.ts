// tests/core/retrieval/indexer.test.ts  ←mirrors→  src/core/retrieval/indexer.ts
import { afterAll, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { buildIndex, contextDir, ensureIndex, loadIndex } from '../../../src/core/retrieval/indexer.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-index-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const write = (rel: string, content: string) => {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

write('src/auth.ts', '// authentication helpers\nexport function login() {}\nimport { db } from "./db.ts"')
write('src/db.ts', '// database layer\nexport const db = {}')

test('builds an index with symbols, imports, and a heuristic summary', async () => {
  const idx = await buildIndex(root, {}, 100)
  expect(Object.keys(idx.files).sort()).toEqual(['src/auth.ts', 'src/db.ts'])
  expect(idx.files['src/auth.ts'].symbols).toContain('login')
  expect(idx.files['src/auth.ts'].imports).toContain('./db.ts')
  expect(idx.files['src/auth.ts'].summary).toContain('authentication helpers')
})

test('ensureIndex persists index.json and the spec projections', async () => {
  await ensureIndex(root, {}, 100)
  for (const f of ['index.json', 'symbols.json', 'dependency-map.json', 'file-summaries.json', 'recent-changes.json']) {
    expect(existsSync(path.join(contextDir(root), f))).toBe(true)
  }
  const loaded = await loadIndex(root)
  expect(loaded.files['src/db.ts'].symbols).toContain('db')
})

test('reuses unchanged entries and drops deleted files on rebuild', async () => {
  await ensureIndex(root, {}, 100) // persist a baseline to reuse from
  const first = await buildIndex(root, {}, 100)
  const cachedAuth = first.files['src/auth.ts']

  // delete db.ts, rebuild — it should drop out; auth.ts is unchanged so its entry is reused as-is.
  rmSync(path.join(root, 'src/db.ts'))
  const second = await buildIndex(root, {}, 200)
  expect(Object.keys(second.files)).toEqual(['src/auth.ts']) // deleted file dropped
  expect(second.files['src/auth.ts']).toEqual(cachedAuth) // unchanged entry reused (mtime+size match)
})
