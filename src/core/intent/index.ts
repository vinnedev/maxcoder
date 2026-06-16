// Max Coder — intent router (P5). Classifies a task into an intent and resolves a Route: which tools
// are allowed, the minimum effort, output expectations, and a fallback. Lookup table (no switch).
// Complements the execution-strategy router (inline/background/orchestrate) and the effort classifier.

import type { EffortLevel } from '../effort/profiles.ts'

export type IntentType =
  | 'simple_question'
  | 'project_scan'
  | 'code_review'
  | 'bug_fix'
  | 'refactor'
  | 'create_tests'
  | 'architecture_plan'
  | 'tool_creation'
  | 'prompt_generation'
  | 'documentation_update'
  | 'execute_plan'

export interface IntentRoute {
  intent: IntentType
  minEffort: EffortLevel
  /** Allowed tool names, or 'all'. Read-only intents restrict to non-mutating tools. */
  tools: string[] | 'all'
  /** A short role/strategy hint to steer the model for this intent. */
  guidance: string
  /** What the answer should look like. */
  outputFormat: string
  fallback: IntentType
}

const READ_TOOLS = [
  'read_file', 'list_dir', 'grep', 'datetime', 'web_search',
  'repo_map', 'search_symbols', 'find_context', 'recall_memory',
]
const EDIT_TOOLS = [...READ_TOOLS, 'write_file', 'edit_file', 'run_bash', 'reflect', 'task']

// Ordered matchers: first hit wins (most specific first). Deterministic, no model.
const MATCHERS: Array<{ intent: IntentType; re: RegExp }> = [
  { intent: 'execute_plan', re: /\b(execute|run|carry out|implement)\b.*\bplan\b|\bplan\b.*\b(execute|run)\b/i },
  { intent: 'project_scan', re: /\b(scan|overview|map|understand|explore)\b.*\b(project|repo|repository|codebase)\b|what does (this|the) (project|repo|codebase)/i },
  { intent: 'create_tests', re: /\b(write|add|create|generate)\b.*\b(tests?|specs?)\b|\btest coverage\b|\btdd\b/i },
  { intent: 'code_review', re: /\b(review|audit|inspect)\b/i },
  { intent: 'refactor', re: /\b(refactor|restructure|rewrite|migrate|clean ?up|overhaul)\b/i },
  { intent: 'bug_fix', re: /\b(bug|fix|broken|crash|regression|stack ?trace|fails?|error)\b/i },
  { intent: 'tool_creation', re: /\b(create|build|add)\b.*\btool\b|\b(integration|adapter|plugin)\b/i },
  { intent: 'prompt_generation', re: /\b(prompt|system message|system prompt)\b/i },
  { intent: 'architecture_plan', re: /\b(architecture|design|propose|planning|plan)\b/i },
  { intent: 'documentation_update', re: /\b(document|docs|readme|changelog|comment)\b/i },
  { intent: 'simple_question', re: /^\s*(what|who|whom|when|where|why|how|explain|describe|define|is|are|does|can|qual|quem|quando|onde|por que|como|explique)\b/i },
]

export const INTENT_ROUTES: Record<IntentType, IntentRoute> = {
  simple_question: { intent: 'simple_question', minEffort: 'low', tools: READ_TOOLS, guidance: 'Answer directly and concisely; only read if needed.', outputFormat: 'a short direct answer', fallback: 'simple_question' },
  project_scan: { intent: 'project_scan', minEffort: 'low', tools: READ_TOOLS, guidance: 'Use repo_map / find_context to orient before answering.', outputFormat: 'a structured overview', fallback: 'simple_question' },
  code_review: { intent: 'code_review', minEffort: 'medium', tools: READ_TOOLS, guidance: 'Read the target code; report concrete findings with file:line.', outputFormat: 'a list of findings (severity, file:line, fix)', fallback: 'simple_question' },
  bug_fix: { intent: 'bug_fix', minEffort: 'medium', tools: EDIT_TOOLS, guidance: 'Reproduce/locate the cause, make a minimal fix, run tests.', outputFormat: 'the fix + a passing test', fallback: 'code_review' },
  refactor: { intent: 'refactor', minEffort: 'high', tools: EDIT_TOOLS, guidance: 'Plan first; keep behavior; minimal diffs; run tests after.', outputFormat: 'the refactor + green tests', fallback: 'architecture_plan' },
  create_tests: { intent: 'create_tests', minEffort: 'medium', tools: EDIT_TOOLS, guidance: 'Mirror src/ under tests/; cover behavior, then run them.', outputFormat: 'new tests that pass', fallback: 'bug_fix' },
  architecture_plan: { intent: 'architecture_plan', minEffort: 'high', tools: READ_TOOLS, guidance: 'Survey the code, weigh options, recommend with trade-offs.', outputFormat: 'a written plan (steps, risks, acceptance)', fallback: 'project_scan' },
  tool_creation: { intent: 'tool_creation', minEffort: 'high', tools: EDIT_TOOLS, guidance: 'Define a clear schema, implement, register, and test the tool.', outputFormat: 'a registered tool + tests', fallback: 'refactor' },
  prompt_generation: { intent: 'prompt_generation', minEffort: 'medium', tools: READ_TOOLS, guidance: 'Produce a precise, structured prompt; no execution.', outputFormat: 'the prompt text', fallback: 'simple_question' },
  documentation_update: { intent: 'documentation_update', minEffort: 'low', tools: EDIT_TOOLS, guidance: 'Read the code, then write accurate, concise docs.', outputFormat: 'the doc edits', fallback: 'simple_question' },
  execute_plan: { intent: 'execute_plan', minEffort: 'high', tools: EDIT_TOOLS, guidance: 'Follow the plan step by step; verify each step; run tests.', outputFormat: 'completed steps + verification', fallback: 'refactor' },
}

/** Classify a task into an intent (deterministic; defaults to simple_question). */
export function classifyIntent(task: string): IntentType {
  const t = task.trim()
  if (!t) return 'simple_question'
  for (const { intent, re } of MATCHERS) if (re.test(t)) return intent
  return 'simple_question'
}

/** Resolve the route config for an intent. */
export function resolveRoute(intent: IntentType): IntentRoute {
  return INTENT_ROUTES[intent]
}

/** Classify + resolve in one call. */
export function routeTask(task: string): IntentRoute {
  return resolveRoute(classifyIntent(task))
}
