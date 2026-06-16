// tests/tools.test.ts  ←mirrors→  src/tools.ts
// Characterization tests: registry + builtin execution behavior before refactor.
import { expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { allTools, executeTool, registerBuiltins, type ToolContext } from '../src/tools.ts'

registerBuiltins()

const cwd = path.join(os.tmpdir(), `maxcoder-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const ctx: ToolContext = { cwd, model: 'test', depth: 0 }

test('registerBuiltins exposes the core tools', () => {
  const names = allTools().map(t => t.name)
  for (const n of ['datetime', 'read_file', 'write_file', 'edit_file', 'list_dir', 'grep', 'run_bash']) {
    expect(names).toContain(n)
  }
})

test('write_file then read_file round-trips', async () => {
  const w = await executeTool('write_file', { path: 'note.txt', content: 'hello world' }, ctx)
  expect(w).toContain('note.txt')
  const r = await executeTool('read_file', { path: 'note.txt' }, ctx)
  expect(r).toContain('hello world')
})

test('unknown tool returns an error string (never throws)', async () => {
  const r = await executeTool('does_not_exist', {}, ctx)
  expect(r).toMatch(/unknown tool/i)
})

test('a tool that throws is caught and returned as an error string', async () => {
  // read_file with a missing required arg throws inside run() -> caught by executeTool
  const r = await executeTool('read_file', {}, ctx)
  expect(r).toMatch(/ERROR running read_file|missing/i)
})

test('executeTool hard-blocks destructive commands and secret reads on every path', async () => {
  const cmd = await executeTool('run_bash', { command: 'rm -rf /' }, ctx)
  expect(cmd).toMatch(/^BLOCKED by safety policy/)

  const secret = await executeTool('read_file', { path: '.env' }, ctx)
  expect(secret).toMatch(/^BLOCKED by safety policy/)

  // explicit opt-in lets a secret read through (the file simply won't exist here)
  const allowed = await executeTool('read_file', { path: '.env' }, { ...ctx, allowSecrets: true })
  expect(allowed).not.toMatch(/^BLOCKED/)
})

test('datetime tool resolves via the registry', async () => {
  const r = JSON.parse(await executeTool('datetime', { operation: 'now', timezone: 'UTC', locale: 'en-US' }, ctx))
  expect(r.timezone).toBe('UTC')
  expect(typeof r.iso).toBe('string')
})
