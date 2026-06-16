// Max Coder — effort auto-classifier (`/effort auto`). Deterministic heuristic + optional small-model
// JSON opinion, with deterministic RISK FLOORS applied ABOVE the model: rules can only RAISE effort,
// never lower it. This keeps a tiny model from under-sizing a risky task.

import { type EffortLevel, maxEffort } from './profiles.ts'

export type TaskType =
  | 'question'
  | 'code_review'
  | 'bug_fix'
  | 'refactor'
  | 'architecture'
  | 'tool_creation'
  | 'test_creation'
  | 'documentation'
  | 'research'
  | 'unknown'

export type Risk = 'low' | 'medium' | 'high'

export interface EffortAssessment {
  effort: EffortLevel
  task_type: TaskType
  risk: Risk
  requires_plan: boolean
  requires_tests: boolean
  requires_file_edits: boolean
  requires_tool_use: boolean
  reason: string
}

export interface ClassifierDeps {
  /** Optional small-model opinion (JSON). Injected by the CLI; omitted in unit tests. */
  assess?: (task: string) => Promise<Partial<EffortAssessment>>
}

const RISK_ORDER: Risk[] = ['low', 'medium', 'high']
const maxRisk = (a: Risk, b: Risk): Risk => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b)

// --- deterministic signals -------------------------------------------------- //

// Build/infra/critical files → highest floor (max).
const CRITICAL_FILE =
  /\b(package\.json|package-lock|bun\.lockb?|yarn\.lock|pnpm-lock|go\.mod|go\.sum|wails\.json|tsconfig|vite\.config|webpack|rollup\.config|Dockerfile|docker-compose|terraform|\.tf\b|migrations?|schema\.prisma|\.env\b|lockfile|ci\.ya?ml|\.github\/workflows)\b/i
// Touching execution / fs / permissions → at least high.
const COMMAND_EXEC = /\b(run a command|execute|terminal|shell command|chmod|permissions?|sudo|rm -rf|spawn|child process)\b/i
// Touching the agent's own brain → at least high.
const CORE_AGENT = /\b(system prompt|tool router|intent router|model adapter|guardrails?|prompt template)\b/i
// Wide structural change → at least high.
const REFACTOR_WIDE = /\b(refactor|migrat(e|ion)|rewrite|overhaul|architecture|redesign)\b/i

const SIMPLE_QUESTION = /^\s*(what|who|whom|when|where|why|how|explain|describe|define|qual|quem|quando|onde|por que|como|explique|defina)\b/i
const EDIT_INTENT = /\b(edit|write|fix|add|create|implement|change|update|remove|delete|rename|refactor|generate)\b/i
const TEST_INTENT = /\b(test|spec|coverage|tdd)\b/i
const TOOL_INTENT = /\b(read|list|search|grep|run|fetch|file|directory|command)\b/i

/** The deterministic minimum effort a task demands (null = no floor). */
export function effortFloor(task: string): EffortLevel | null {
  if (CRITICAL_FILE.test(task)) return 'max'
  if (COMMAND_EXEC.test(task) || CORE_AGENT.test(task) || REFACTOR_WIDE.test(task)) return 'high'
  return null
}

function guessTaskType(task: string): TaskType {
  if (/\b(review|audit)\b/i.test(task)) return 'code_review'
  if (/\b(bug|fix|broken|error|crash|fails?)\b/i.test(task)) return 'bug_fix'
  if (REFACTOR_WIDE.test(task) && /\b(refactor|rewrite|migrat)/i.test(task)) return 'refactor'
  if (/\b(architecture|design|structure)\b/i.test(task)) return 'architecture'
  if (/\b(tool|integration|adapter)\b/i.test(task)) return 'tool_creation'
  if (TEST_INTENT.test(task)) return 'test_creation'
  if (/\b(document|docs|readme|comment)\b/i.test(task)) return 'documentation'
  if (/\b(research|investigate|find out|search the web)\b/i.test(task)) return 'research'
  if (SIMPLE_QUESTION.test(task)) return 'question'
  return 'unknown'
}

/** A complete assessment from deterministic signals alone (works with no model). */
export function heuristicAssessment(task: string): EffortAssessment {
  const t = task.trim()
  const floor = effortFloor(t)
  const type = guessTaskType(t)
  const editsDisk = EDIT_INTENT.test(t) && !SIMPLE_QUESTION.test(t)
  const baseEffort: EffortLevel = floor ?? (type === 'question' ? 'low' : editsDisk ? 'medium' : 'low')

  const risk: Risk = floor === 'max' ? 'high' : floor === 'high' ? 'medium' : 'low'
  return {
    effort: baseEffort,
    task_type: type,
    risk,
    requires_plan: baseEffort === 'high' || baseEffort === 'max',
    requires_tests: editsDisk,
    requires_file_edits: editsDisk,
    requires_tool_use: TOOL_INTENT.test(t) || editsDisk,
    reason: floor
      ? `deterministic floor: ${floor} (${type})`
      : `heuristic: ${type}`,
  }
}

/** Merge a model opinion onto the heuristic base, keeping only valid fields. */
function merge(base: EffortAssessment, llm: Partial<EffortAssessment>): EffortAssessment {
  const valid = <T extends string>(v: unknown, set: readonly T[]): v is T => typeof v === 'string' && (set as readonly string[]).includes(v)
  return {
    effort: valid(llm.effort, ['low', 'medium', 'high', 'max']) ? llm.effort : base.effort,
    task_type: typeof llm.task_type === 'string' ? (llm.task_type as TaskType) : base.task_type,
    risk: valid(llm.risk, RISK_ORDER) ? llm.risk : base.risk,
    requires_plan: typeof llm.requires_plan === 'boolean' ? llm.requires_plan : base.requires_plan,
    requires_tests: typeof llm.requires_tests === 'boolean' ? llm.requires_tests : base.requires_tests,
    requires_file_edits: typeof llm.requires_file_edits === 'boolean' ? llm.requires_file_edits : base.requires_file_edits,
    requires_tool_use: typeof llm.requires_tool_use === 'boolean' ? llm.requires_tool_use : base.requires_tool_use,
    reason: typeof llm.reason === 'string' && llm.reason.trim() ? llm.reason.trim() : base.reason,
  }
}

/** Apply deterministic floors above any opinion — rules can only RAISE effort/risk. */
function applyFloors(task: string, a: EffortAssessment): EffortAssessment {
  const floor = effortFloor(task)
  const effort = floor ? maxEffort(a.effort, floor) : a.effort
  const risk = floor === 'max' ? maxRisk(a.risk, 'high') : floor === 'high' ? maxRisk(a.risk, 'medium') : a.risk
  const requires_plan = a.requires_plan || effort === 'high' || effort === 'max'
  const requires_tests = a.requires_tests || a.requires_file_edits
  return { ...a, effort, risk, requires_plan, requires_tests }
}

/** Extract the first balanced JSON object from free-form model text (for `assess`). */
export function parseAssessmentJson(raw: string): Partial<EffortAssessment> {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  if (start < 0) return {}
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Partial<EffortAssessment>
        } catch {
          return {}
        }
      }
    }
  }
  return {}
}

/**
 * Assess effort for a task: heuristic base → optional model opinion → deterministic floors on top.
 * The model is consulted ONLY for genuinely ambiguous tasks (no floor, not a plain question) — floored
 * or simple tasks are decided deterministically, so a tiny model isn't called when it isn't needed.
 * Never throws; a failing model assessor degrades to the heuristic.
 */
export async function assessEffort(task: string, deps: ClassifierDeps = {}): Promise<EffortAssessment> {
  const base = heuristicAssessment(task)
  let merged = base
  const confident = effortFloor(task) !== null || base.task_type === 'question'
  if (deps.assess && !confident) {
    try {
      const llm = await deps.assess(task)
      if (llm && typeof llm === 'object') merged = merge(base, llm)
    } catch {
      // keep heuristic base
    }
  }
  return applyFloors(task, merged)
}
