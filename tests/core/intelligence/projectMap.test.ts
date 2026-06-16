// tests/core/intelligence/projectMap.test.ts  ←mirrors→  src/core/intelligence/projectMap.ts
import { expect, test } from 'bun:test'
import { buildProjectMap } from '../../../src/core/intelligence/projectMap.ts'

const files = [
  'src/cli.ts',
  'src/core/agent/index.ts',
  'tests/core.test.ts',
  'tests/core/agent/index.test.ts',
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'README.md',
]
const pkg = {
  main: 'src/cli.ts',
  scripts: { test: 'bun test', 'test:unit': 'bun test unit', build: 'bun build', lint: 'eslint', dev: 'bun run' },
  dependencies: { react: '18.0.0' },
}

test('detects stack, package manager, commands, dirs, and conventions', () => {
  const m = buildProjectMap(files, pkg, 123)
  expect(m.stack).toContain('TypeScript')
  expect(m.stack).toContain('React')
  expect(m.packageManagers).toContain('bun')
  expect(m.testCommands).toContain('bun run test')
  expect(m.testCommands).toContain('bun run test:unit')
  expect(m.testCommands.some(c => c.includes('lint'))).toBe(false) // lint is not a test command
  expect(m.buildCommands).toContain('bun run build')
  expect(m.sourceDirs).toEqual(['src'])
  expect(m.testDirs).toEqual(['tests'])
  expect(m.entrypoints).toContain('src/cli.ts')
  expect(m.generatedAt).toBe(123)
})

test('critical files and conventions are factual', () => {
  const m = buildProjectMap(files, pkg, 0)
  expect(m.criticalFiles).toContain('package.json')
  expect(m.criticalFiles).toContain('tsconfig.json')
  expect(m.criticalFiles).toContain('bun.lock')
  expect(m.detectedConventions).toContain('TypeScript project (tsconfig.json)')
  expect(m.detectedConventions).toContain('src/core/ domain layout')
  expect(m.detectedConventions).toContain('tests/ tree mirrors src/')
})

test('tolerates a missing package.json', () => {
  const m = buildProjectMap(['main.go', 'go.mod', 'go.sum'], null, 0)
  expect(m.stack).toContain('Go')
  expect(m.packageManagers).toContain('go')
  expect(m.testCommands).toEqual([])
})
