// tests/core/effort/controller.test.ts  ←mirrors→  src/core/effort/controller.ts
import { expect, test } from 'bun:test'
import { EffortController } from '../../../src/core/effort/controller.ts'
import { DEFAULT_CONFIG, type MaxcoderConfig } from '../../../src/core/config/index.ts'

const cfg = (over: Partial<MaxcoderConfig> = {}): MaxcoderConfig => ({ ...DEFAULT_CONFIG, ...over })

test('fixed level resolves to that profile without classifying', async () => {
  let assessed = false
  const ctrl = new EffortController(cfg({ effort: 'high' }), { assess: async () => { assessed = true; return {} } })
  const r = await ctrl.resolve('anything')
  expect(r.level).toBe('high')
  expect(r.auto).toBe(false)
  expect(r.profile.maxToolCalls).toBe(20)
  expect(assessed).toBe(false) // no model call for a fixed level
})

test('auto mode classifies and resolves the chosen profile', async () => {
  const ctrl = new EffortController(cfg({ effort: 'auto' }), {
    assess: async () => ({ effort: 'medium', task_type: 'bug_fix', risk: 'medium', reason: 'clear repro' }),
  })
  const r = await ctrl.resolve('fix the parser bug')
  expect(r.auto).toBe(true)
  expect(r.level).toBe('medium')
  expect(r.assessment?.task_type).toBe('bug_fix')
})

test('auto floors still apply through the controller', async () => {
  const ctrl = new EffortController(cfg({ effort: 'auto' }), { assess: async () => ({ effort: 'low' }) })
  const r = await ctrl.resolve('edit package.json')
  expect(r.level).toBe('max') // floor wins
})

test('explain reflects manual vs auto', async () => {
  const manual = new EffortController(cfg({ effort: 'low' }))
  expect(manual.explain()).toContain('manually')

  const auto = new EffortController(cfg({ effort: 'auto' }), { assess: async () => ({ effort: 'high', reason: 'risky' }) })
  expect(auto.explain()).toContain('no task classified yet')
  await auto.resolve('refactor the core')
  expect(auto.explain()).toContain('auto →')
})

test('setSetting switches mode and clears stale auto assessment', async () => {
  const ctrl = new EffortController(cfg({ effort: 'auto' }), { assess: async () => ({ effort: 'high', reason: 'x' }) })
  await ctrl.resolve('refactor things')
  ctrl.setSetting('low')
  expect(ctrl.setting).toBe('low')
  expect(ctrl.explain()).toContain('manually')
})
