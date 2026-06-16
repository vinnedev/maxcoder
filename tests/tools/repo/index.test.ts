// tests/tools/repo/index.test.ts  ←mirrors→  src/tools/repo/index.ts
import { afterAll, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { registerRepoTools } from '../../../src/tools/repo/index.ts'
import { executeTool, getTool, type ToolContext } from '../../../src/tools.ts'

registerRepoTools()

const root = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-repotool-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const write = (rel: string, content: string) => {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}
write('package.json', JSON.stringify({ scripts: { test: 'bun test', build: 'bun build' } }))
write('bun.lock', '')
write('src/auth/login.ts', '// login flow\nexport function authenticate() {}')
write('src/util/format.ts', '// formatting helpers\nexport function formatDate() {}')

const ctx: ToolContext = { cwd: root, model: 'test', depth: 0 }

test('the repo tools are registered and read-only', () => {
  for (const name of ['repo_map', 'search_symbols', 'find_context']) {
    const t = getTool(name)
    expect(t?.mutating).toBe(false)
    expect(t?.policy?.readOnly).toBe(true)
  }
})

test('repo_map reports stack, package manager, and commands', async () => {
  const out = await executeTool('repo_map', {}, ctx)
  expect(out).toContain('TypeScript')
  expect(out).toContain('bun')
  expect(out).toContain('bun run test')
})

test('search_symbols finds a declared function by query', async () => {
  const out = await executeTool('search_symbols', { query: 'authenticate' }, ctx)
  expect(out).toContain('src/auth/login.ts')
  expect(out).toContain('authenticate')
})

test('find_context returns ranked relevant files', async () => {
  const out = await executeTool('find_context', { query: 'format date helper' }, ctx)
  expect(out).toContain('src/util/format.ts')
  expect(out).toContain('read_file')
})
