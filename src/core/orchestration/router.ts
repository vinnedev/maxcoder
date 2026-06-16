// Max Coder — routing decision: heuristic first, model judge for borderline cases (P3).
// Philosophy: don't cap the model — give it scaffolding. The heuristic handles the obvious cases
// instantly; for anything borderline the MODEL itself decides (the judge), and the user confirms.

import { classify, hasWeakComplexitySignals, type Route } from './complexity.ts'

export interface RouteDecision {
  route: Route
  reason: string
  source: 'heuristic' | 'judge'
}

export interface RouterDeps {
  /** Consulted only for borderline tasks the heuristic called `inline`. Injected by the CLI. */
  judge?: (task: string) => Promise<Route>
}

/** Decide how to run a task. Cheap and synchronous unless a borderline case needs the judge. */
export async function route(task: string, deps: RouterDeps = {}): Promise<RouteDecision> {
  const heuristic = classify(task)
  if (heuristic === 'orchestrate') return { route: 'orchestrate', reason: 'decomposition signals', source: 'heuristic' }
  if (heuristic === 'background') return { route: 'background', reason: 'long-running phrasing', source: 'heuristic' }

  // heuristic === 'inline': let the model weigh in on borderline tasks.
  if (deps.judge && hasWeakComplexitySignals(task)) {
    const judged = await deps.judge(task)
    if (judged === 'orchestrate') return { route: 'orchestrate', reason: 'model judged it complex', source: 'judge' }
    if (judged === 'background') return { route: 'background', reason: 'model judged it long-running', source: 'judge' }
  }
  return { route: 'inline', reason: 'no complexity signals', source: 'heuristic' }
}
