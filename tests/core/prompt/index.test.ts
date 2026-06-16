// tests/core/prompt/index.test.ts  ←mirrors→  src/core/prompt/index.ts
import { afterEach, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { loadProjectMemory } from '../../../src/core/prompt/index.ts'

let tmp: string | null = null

function tempProject(): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-prompt-'))
  return tmp
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

test('loads lowercase project memory files', async () => {
  const cwd = tempProject()
  writeFileSync(path.join(cwd, 'maxcoder.md'), 'lower maxcoder')
  writeFileSync(path.join(cwd, 'agents.md'), 'lower agents')
  writeFileSync(path.join(cwd, 'claude.md'), 'lower claude')

  const memory = await loadProjectMemory(cwd)

  expect(memory).toContain('lower maxcoder')
  expect(memory).toContain('lower agents')
  expect(memory).toContain('lower claude')
})

test('falls back to uppercase project memory files', async () => {
  const cwd = tempProject()
  writeFileSync(path.join(cwd, 'MAXCODER.md'), 'upper maxcoder')
  writeFileSync(path.join(cwd, 'AGENTS.md'), 'upper agents')
  writeFileSync(path.join(cwd, 'CLAUDE.md'), 'upper claude')

  const memory = await loadProjectMemory(cwd)

  expect(memory).toContain('upper maxcoder')
  expect(memory).toContain('upper agents')
  expect(memory).toContain('upper claude')
})

test('prefers lowercase project memory files when both cases exist', async () => {
  const cwd = tempProject()
  const lower = path.join(cwd, 'maxcoder.md')
  const upper = path.join(cwd, 'MAXCODER.md')
  writeFileSync(lower, 'preferred lower')

  if (existsSync(upper)) {
    const memory = await loadProjectMemory(cwd)
    expect(memory).toContain('preferred lower')
    return
  }

  writeFileSync(upper, 'ignored upper')

  const memory = await loadProjectMemory(cwd)

  expect(memory).toContain('preferred lower')
  expect(memory).not.toContain('ignored upper')
})
