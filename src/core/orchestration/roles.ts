// Max Coder — orchestration role prompts (P4). Pure string builders; no IO.
// Each subagent runs with one of these as its `agentRole`. The coordinator phases
// (plan / synthesize / review) have dedicated prompt builders.

import type { NodeOutcome, Role } from './types.ts'

/** Per-role system guidance handed to a subagent via runAgent's `agentRole`. */
export const ROLE_PROMPTS: Record<Role, string> = {
  planner:
    'You are the PLANNER for a local coding agent. Break the goal into the FEWEST independent subtasks ' +
    'that genuinely benefit from parallel work (2–5). If the goal is simple, return a single subtask.',
  researcher:
    'You are a RESEARCHER subagent. Gather facts needed for the goal using read-only tools (web_search, ' +
    'read_file, grep). Report concise, sourced findings. Do not speculate beyond what you found.',
  coder:
    'You are a CODER subagent. Work out the concrete change or answer for the delegated task using ' +
    'read-only tools. Describe the exact solution (files, edits, commands) precisely; do not modify files.',
  synthesizer:
    'You are the SYNTHESIZER. Merge the subtask results into one coherent, complete answer to the ' +
    'original goal. Resolve conflicts, drop redundancy, and keep only what the user needs.',
  reviewer:
    'You are an adversarial REVIEWER. Find gaps, errors, and unsupported claims in a candidate answer.',
  general:
    'You are a focused Max Coder subagent. Complete the delegated task autonomously with read-only tools ' +
    'and report a concise, concrete result. You cannot ask the user questions.',
}

/** Prompt for the planner phase — asks for a strict JSON decomposition. */
export function planPrompt(goal: string): string {
  return (
    `Decompose this goal into independent subtasks.\n\nGOAL: ${goal}\n\n` +
    'Reply with ONLY a JSON array (no prose), each item: ' +
    '{"id": string, "goal": string, "role": "researcher"|"coder"|"reviewer"|"general", "dependsOn": string[]}.\n' +
    'Rules: 2–5 subtasks; use dependsOn only when one subtask truly needs another\'s output; ' +
    'prefer independent subtasks so they can run in parallel. If the goal is simple, return one item.'
  )
}

/** Prompt for an individual subtask, including any upstream dependency results. */
export function subtaskPrompt(goal: string, subtaskGoal: string, deps: Record<string, string>): string {
  const ctx = Object.entries(deps)
    .map(([id, result]) => `### Result of dependency "${id}"\n${result}`)
    .join('\n\n')
  return (
    `Overall goal (for context): ${goal}\n\n` +
    `Your subtask: ${subtaskGoal}\n` +
    (ctx ? `\nUpstream results you can build on:\n${ctx}\n` : '') +
    '\nComplete only your subtask and report a concise, concrete result.'
  )
}

/** Render scheduler outcomes into a digest the synthesizer can consume. */
export function digestOutcomes(outcomes: NodeOutcome[], goals: Record<string, string>): string {
  return outcomes
    .map(o => {
      const head = `## ${o.id} — ${goals[o.id] ?? ''}`
      if (o.status === 'done') return `${head}\n${o.result}`
      if (o.status === 'error') return `${head}\n[FAILED: ${o.error}]`
      return `${head}\n[SKIPPED: ${o.reason}]`
    })
    .join('\n\n')
}

/** Prompt for the synthesizer, optionally incorporating reviewer feedback. */
export function synthPrompt(goal: string, digest: string, reviewFeedback?: string): string {
  return (
    `Original goal: ${goal}\n\nSubtask results:\n${digest}\n\n` +
    (reviewFeedback ? `A reviewer asked you to address:\n${reviewFeedback}\n\n` : '') +
    'Write the final, complete answer to the original goal based on these results.'
  )
}

/** Prompt for the reviewer. The verdict contract is parsed by needsRevision(). */
export function reviewPrompt(goal: string, answer: string): string {
  return (
    `Original goal: ${goal}\n\nCandidate answer:\n${answer}\n\n` +
    'Judge whether the answer fully and correctly satisfies the goal. ' +
    'Reply with exactly "OK" on the first line if it does. ' +
    'Otherwise reply "REVISE:" followed by specific, actionable problems to fix.'
  )
}

/** Parse the reviewer verdict — true means the synthesizer should do one corrective pass. */
export function needsRevision(reviewText: string): boolean {
  const first = reviewText.trim().split('\n')[0]?.trim().toUpperCase() ?? ''
  if (first.startsWith('OK')) return false
  return /\bREVISE\b/i.test(reviewText)
}
