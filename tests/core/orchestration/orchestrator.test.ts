// tests/core/orchestration/orchestrator.test.ts  ←mirrors→  src/core/orchestration/orchestrator.ts
import { expect, test } from 'bun:test'
import { orchestrate } from '../../../src/core/orchestration/orchestrator.ts'
import { ROLE_PROMPTS } from '../../../src/core/orchestration/roles.ts'
import { TaskManager } from '../../../src/core/tasks/manager.ts'
import type { RunAgentParams } from '../../../src/core/agent/index.ts'

// Map a runAgent call back to the orchestration phase that issued it, via its role prompt.
function phaseOf(p: RunAgentParams): string {
  for (const [role, prompt] of Object.entries(ROLE_PROMPTS)) if (p.agentRole === prompt) return role
  return 'unknown'
}

const baseDeps = { model: 'fake', numCtx: 8192, tools: [] }

test('full flow: plan → parallel subtasks → synthesize → review (OK)', async () => {
  const seen: string[] = []
  const run = async (p: RunAgentParams) => {
    const phase = phaseOf(p)
    seen.push(phase)
    if (phase === 'planner') return '[{"id":"a","goal":"A"},{"id":"b","goal":"B","dependsOn":["a"]}]'
    if (phase === 'synthesizer') return 'FINAL ANSWER'
    if (phase === 'reviewer') return 'OK'
    return `result of ${p.task.slice(0, 1)}`
  }
  const answer = await orchestrate('do a thing', { ...baseDeps, run })
  expect(answer).toBe('FINAL ANSWER')
  // planner first, both subtask roles ran, then synthesizer, then reviewer
  expect(seen[0]).toBe('planner')
  expect(seen.filter(s => s === 'synthesizer').length).toBe(1)
  expect(seen.at(-1)).toBe('reviewer')
})

test('falls back to a single inline agent when planning is not decomposable', async () => {
  const seen: string[] = []
  const run = async (p: RunAgentParams) => {
    seen.push(phaseOf(p))
    if (phaseOf(p) === 'planner') return 'I cannot decompose this.'
    return 'INLINE RESULT'
  }
  const answer = await orchestrate('simple ask', { ...baseDeps, run })
  expect(answer).toBe('INLINE RESULT')
  expect(seen).toEqual(['planner', 'general']) // no synthesize/review
})

test('a REVISE verdict triggers exactly one corrective synthesis pass', async () => {
  let synthCount = 0
  const run = async (p: RunAgentParams) => {
    const phase = phaseOf(p)
    if (phase === 'planner') return '[{"goal":"A"},{"goal":"B"}]'
    if (phase === 'synthesizer') return `SYNTH-${++synthCount}`
    if (phase === 'reviewer') return 'REVISE: add more detail about B'
    return 'sub'
  }
  const answer = await orchestrate('goal', { ...baseDeps, run })
  expect(synthCount).toBe(2) // initial + one revision
  expect(answer).toBe('SYNTH-2')
})

test('registers subtasks as orchestrated children of the parent task', async () => {
  const manager = new TaskManager(((): () => string => { let n = 0; return () => `t${++n}` })())
  const parent = manager.create('root', 'orchestrated')
  const run = async (p: RunAgentParams) => {
    const phase = phaseOf(p)
    if (phase === 'planner') return '[{"goal":"A"},{"goal":"B"}]'
    if (phase === 'synthesizer') return 'done'
    if (phase === 'reviewer') return 'OK'
    return 'sub-result'
  }
  await orchestrate('root', { ...baseDeps, run, manager, parentId: parent.id })
  const children = manager.children(parent.id)
  expect(children.length).toBe(2)
  expect(children.every(c => c.kind === 'orchestrated' && c.status === 'done')).toBe(true)
})

test('aborted signal short-circuits before planning', async () => {
  const ac = new AbortController()
  ac.abort()
  let called = false
  const run = async () => { called = true; return 'x' }
  const answer = await orchestrate('goal', { ...baseDeps, run, signal: ac.signal })
  expect(answer).toBe('')
  expect(called).toBe(false)
})
