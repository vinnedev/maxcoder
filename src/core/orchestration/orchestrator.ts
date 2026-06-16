// Max Coder — orchestrator (P4): plan → bounded-parallel subagents → synthesize → review.
// Reuses runAgent (fresh context + role per subagent) and the pure scheduler/planner.
// Read-only by default (parallel writes are deferred to a later worktree phase). A shared
// Semaphore caps total in-flight model calls so multiple orchestrations don't swamp the
// single local backend. `run`/`tools`/`gate`/`manager` are injectable for testing.

import { runAgent as defaultRunAgent, type AgentEvent, type RunAgentParams } from '../agent/index.ts'
import { allTools, type Tool } from '../../tools.ts'
import { Semaphore } from '../../shared/async/semaphore.ts'
import type { TaskManager } from '../tasks/manager.ts'
import { runDag } from './scheduler.ts'
import { parsePlan } from './planner.ts'
import {
  ROLE_PROMPTS,
  digestOutcomes,
  needsRevision,
  planPrompt,
  reviewPrompt,
  subtaskPrompt,
  synthPrompt,
} from './roles.ts'
import type { Role } from './types.ts'

type AgentRunner = (p: RunAgentParams) => Promise<string>

export interface OrchestrateDeps {
  model: string
  numCtx: number
  signal?: AbortSignal
  onEvent?: (e: AgentEvent) => void
  manager?: TaskManager
  parentId?: string
  gate?: Semaphore
  tools?: Tool[]
  run?: AgentRunner
  maxSubtasks?: number
  maxTurns?: number
  concurrency?: number
}

export async function orchestrate(goal: string, deps: OrchestrateDeps): Promise<string> {
  const run = deps.run ?? defaultRunAgent
  const tools = deps.tools ?? allTools().filter(t => !t.mutating)
  const gate = deps.gate ?? new Semaphore(2)
  const onEvent = deps.onEvent ?? (() => {})
  const maxSubtasks = deps.maxSubtasks ?? 6
  const maxTurns = deps.maxTurns ?? 6
  const concurrency = deps.concurrency ?? 2

  const info = (text: string) => onEvent({ type: 'info', text })
  const progress = (p: string) => {
    if (deps.manager && deps.parentId) deps.manager.update(deps.parentId, { progress: p })
  }

  // Every model-producing call goes through the shared gate (global concurrency bound) and
  // runs as a depth-1 subagent so its own nested subagents stay within the depth-2 guard.
  const runRole = (task: string, role: Role) =>
    gate.run(() =>
      run({
        task,
        model: deps.model,
        numCtx: deps.numCtx,
        messages: [],
        tools,
        onEvent,
        depth: 1,
        agentRole: ROLE_PROMPTS[role],
        maxTurns,
        signal: deps.signal,
      }),
    )

  if (deps.signal?.aborted) return ''

  // (a) PLAN — decompose; fall back to a single inline agent if planning yields nothing useful.
  progress('planning')
  info('orchestration: planning…')
  const planRaw = await runRole(planPrompt(goal), 'planner')
  const subtasks = parsePlan(planRaw, maxSubtasks)

  if (subtasks.length <= 1) {
    info('orchestration: no useful decomposition — running inline')
    progress('running inline')
    return runRole(goal, 'general')
  }

  // (b) SCHEDULE — independent subtasks run in bounded parallel; dependents get upstream results.
  info(`orchestration: ${subtasks.length} subtasks`)
  const goals = Object.fromEntries(subtasks.map(s => [s.id, s.goal]))
  const roleById = Object.fromEntries(subtasks.map(s => [s.id, s.role])) as Record<string, Role>
  let completed = 0

  const outcomes = await runDag(
    subtasks,
    async (node, depResults) => {
      if (deps.signal?.aborted) throw new Error('cancelled')
      const childId = deps.manager?.create(node.goal, 'orchestrated', deps.parentId).id
      if (childId) deps.manager?.start(childId)
      try {
        const result = await runRole(subtaskPrompt(goal, node.goal, depResults), roleById[node.id])
        if (childId) deps.manager?.finish(childId, result)
        progress(`subtasks ${++completed}/${subtasks.length}`)
        return result
      } catch (e) {
        if (childId) deps.manager?.fail(childId, e instanceof Error ? e.message : String(e))
        throw e
      }
    },
    { concurrency },
  )

  if (deps.signal?.aborted) return ''

  // (c) SYNTHESIZE — merge subtask results into one answer.
  progress('synthesizing')
  info('orchestration: synthesizing')
  const digest = digestOutcomes(outcomes, goals)
  let answer = await runRole(synthPrompt(goal, digest), 'synthesizer')

  // (d) VERIFY — one adversarial review + at most one corrective synthesis pass.
  if (!deps.signal?.aborted) {
    progress('reviewing')
    const review = await runRole(reviewPrompt(goal, answer), 'reviewer')
    if (needsRevision(review)) {
      info('orchestration: revising after review')
      answer = await runRole(synthPrompt(goal, digest, review), 'synthesizer')
    }
  }

  return answer
}
