// Max Coder — pure complexity classifier (P3). Cheap, deterministic routing hint.
// Auto-routing is OFF by default; `/bg` and `/orchestrate` always override. This exists so a
// future opt-in can suggest a route, and so the heuristic is unit-tested before it's wired live.

export type Route = 'inline' | 'background' | 'orchestrate'

// Verbs/phrases that imply decomposition across steps, files, or subsystems → orchestrate.
const ORCHESTRATE: RegExp[] = [
  /\brefactor(ing|ed)?\b/i,
  /\baudit(ing|ed)?\b/i,
  /\bmigrat(e|es|ed|ing|ion)\b/i,
  /\binvestigat(e|es|ed|ing|ion)\b/i,
  /\brewrit(e|es|ing)\b/i,
  /\bbuild (a |an |the )?(feature|system|module|pipeline|app|service)\b/i,
  /\bimplement\b[^.]*\b(across|multiple|several|various)\b/i,
  /\buse agents?\b/i,
  /\borchestrat(e|ed|ing|ion)\b/i,
  /\bend[- ]to[- ]end\b/i,
]

// Phrases that imply a single long-running job → background.
const BACKGROUND: RegExp[] = [
  /\bin (the )?background\b/i,
  /\bem (segundo plano|background)\b/i,
  /\blong[- ]running\b/i,
  /\bwhile i\b/i,
  /\benquanto eu\b/i,
]

/** Count list items (markdown bullets or `1.` style) — a strong multi-step signal. */
function listItems(task: string): number {
  return (task.match(/^\s*(?:[-*]\s+|\d+[.)]\s+)/gm) ?? []).length
}

/** Heuristic route for a task. Conservative: prefers `inline` unless signals are clear. */
export function classify(task: string): Route {
  const t = task.trim()
  if (!t) return 'inline'
  if (ORCHESTRATE.some(re => re.test(t))) return 'orchestrate'
  if (listItems(t) >= 3) return 'orchestrate'
  if (BACKGROUND.some(re => re.test(t))) return 'background'
  return 'inline'
}

// Distinct action verbs hint at multi-step work even when no strong signal matched.
const ACTION_VERBS =
  /\b(add|create|build|implement|write|fix|update|refactor|test|analyz[es]?|compare|find|search|generate|design|review|document|optimi[sz]e|integrate|configure|debug|explain)\b/gi

// Conjunctions that chain clauses ("do X and then Y").
const CHAINS = /\b(and then|then|after that|plus|e depois|e também)\b/i

/**
 * Borderline signals that warrant a second opinion from an LLM judge when the cheap heuristic
 * returned `inline`. Kept loose on purpose: a false positive only costs one extra judge call,
 * never an auto-orchestration (the user still confirms).
 */
export function hasWeakComplexitySignals(task: string): boolean {
  const t = task.trim()
  if (!t) return false
  if (t.length > 160) return true
  if (listItems(t) >= 1) return true
  if (CHAINS.test(t)) return true
  const verbs = new Set((t.toLowerCase().match(ACTION_VERBS) ?? []).map(v => v.toLowerCase()))
  return verbs.size >= 2
}
