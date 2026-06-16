// Max Coder — defensive parser for the planner agent's output (P4).
// A local model frequently emits malformed/fenced/partial JSON. parsePlan() extracts what it can
// and sanitizes it (valid ids, known dependencies, a role, a node cap). Returns [] when nothing
// usable was found — the orchestrator then falls back to a single inline agent on the goal.

import type { PlanSubtask, Role } from './types.ts'

const ROLES: Role[] = ['planner', 'researcher', 'coder', 'synthesizer', 'reviewer', 'general']

/** Guess a role from the subtask wording when the planner didn't give a valid one. */
function inferRole(goal: string): Role {
  const g = goal.toLowerCase()
  if (/\b(search|find|research|look up|investigate|gather|docs?|web)\b/.test(g)) return 'researcher'
  if (/\b(implement|write|code|refactor|fix|add|build|create|edit)\b/.test(g)) return 'coder'
  if (/\b(review|verify|check|validate|test)\b/.test(g)) return 'reviewer'
  return 'general'
}

/** Pull the first balanced JSON array out of free-form model text. */
function extractJsonArray(raw: string): string | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('[')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Parse + sanitize a planner response into at most `maxNodes` subtasks.
 * Drops entries without a goal, dedupes ids, normalizes roles, and strips dependencies that
 * don't reference a kept subtask. Returns [] when no valid subtask could be recovered.
 */
export function parsePlan(raw: string, maxNodes = 6): PlanSubtask[] {
  const json = extractJsonArray(raw)
  if (!json) return []

  let arr: unknown
  try {
    arr = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []

  const kept: PlanSubtask[] = []
  const usedIds = new Set<string>()

  for (const item of arr) {
    if (kept.length >= maxNodes) break
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const goal = typeof o.goal === 'string' ? o.goal.trim() : ''
    if (!goal) continue

    let id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `s${kept.length + 1}`
    while (usedIds.has(id)) id = `${id}_`
    usedIds.add(id)

    const role: Role = ROLES.includes(o.role as Role) ? (o.role as Role) : inferRole(goal)
    const dependsOn = Array.isArray(o.dependsOn)
      ? o.dependsOn.filter((d): d is string => typeof d === 'string')
      : []

    kept.push({ id, goal, dependsOn, role })
  }

  // Second pass: drop dependencies that don't reference a kept subtask (and self-deps).
  const ids = new Set(kept.map(k => k.id))
  for (const k of kept) k.dependsOn = k.dependsOn.filter(d => d !== k.id && ids.has(d))

  return kept
}
