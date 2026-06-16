// tests/core/intelligence/walk.test.ts  ←mirrors→  src/core/intelligence/walk.ts
import { afterAll, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { walkRepo } from '../../../src/core/intelligence/walk.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-walk-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const write = (rel: string, content = 'x') => {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

write('src/a.ts')
write('src/b.ts')
write('node_modules/pkg/junk.js')
write('dist/out.js')
write('.env', 'SECRET=1')
write('keys/server.pem', 'KEY')
write('big.txt', 'z'.repeat(300 * 1024))
write('.git/config', '[core]')
write('README.md')

test('walks source files in deterministic order, skipping ignored dirs/secrets/large files', () => {
  const paths = walkRepo(root).map(f => f.path)
  expect(paths).toContain('src/a.ts')
  expect(paths).toContain('src/b.ts')
  expect(paths).toContain('README.md')
  // excluded:
  expect(paths.some(p => p.startsWith('node_modules/'))).toBe(false)
  expect(paths.some(p => p.startsWith('dist/'))).toBe(false)
  expect(paths.some(p => p.startsWith('.git/'))).toBe(false)
  expect(paths).not.toContain('.env') // secret
  expect(paths).not.toContain('keys/server.pem') // secret
  expect(paths).not.toContain('big.txt') // over size cap
  // sorted:
  expect([...paths]).toEqual([...paths].sort())
})

test('respects maxFiles and maxFileBytes caps', () => {
  expect(walkRepo(root, { maxFiles: 2 }).length).toBe(2)
  expect(walkRepo(root, { maxFileBytes: 0 }).length).toBe(0)
})
