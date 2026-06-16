// tests/core/config/index.test.ts  ←mirrors→  src/core/config/index.ts
import { afterAll, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { configPath, DEFAULT_CONFIG, loadConfig, normalizeConfig, saveConfig } from '../../../src/core/config/index.ts'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-cfg-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

test('normalizeConfig fills defaults and rejects invalid fields', () => {
  expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG)
  const n = normalizeConfig({ effort: 'banana', maxToolCalls: -3, defaultModel: '' })
  expect(n.effort).toBe(DEFAULT_CONFIG.effort) // invalid → default
  expect(n.maxToolCalls).toBe(DEFAULT_CONFIG.maxToolCalls)
  expect(n.defaultModel).toBe(DEFAULT_CONFIG.defaultModel)
  expect(normalizeConfig({ effort: 'high' }).effort).toBe('high') // valid kept
})

test('missing config loads defaults', async () => {
  const cfg = await loadConfig(tmp)
  expect(cfg).toEqual(DEFAULT_CONFIG)
})

test('save then load round-trips and writes .maxcoder/config.json', async () => {
  await saveConfig({ ...DEFAULT_CONFIG, effort: 'max', maxToolCalls: 7 }, tmp)
  expect(existsSync(configPath(tmp))).toBe(true)
  expect(configPath(tmp)).toContain(path.join('.maxcoder', 'config.json'))
  const cfg = await loadConfig(tmp)
  expect(cfg.effort).toBe('max')
  expect(cfg.maxToolCalls).toBe(7)
})
