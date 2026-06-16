// Max Coder — pure bounded-parallel DAG scheduler (no IO; testable with a fake worker).
// Runs ready nodes up to a concurrency limit, passes each node its dependencies' results,
// skips nodes whose dependencies failed, and rejects cyclic/unknown-dependency graphs.

import type { DagNode, NodeOutcome } from './types.ts'

export interface RunDagOptions {
  concurrency?: number
}

/** Topological sanity check — throws on cycles or dangling dependency ids. */
function assertAcyclic(nodes: DagNode[]): void {
  const ids = new Set(nodes.map(n => n.id))
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const n of nodes) indegree.set(n.id, 0)
  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!ids.has(dep)) throw new Error(`subtask "${n.id}" depends on unknown id "${dep}"`)
      indegree.set(n.id, (indegree.get(n.id) ?? 0) + 1)
      dependents.set(dep, [...(dependents.get(dep) ?? []), n.id])
    }
  }

  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let visited = 0
  while (queue.length) {
    const id = queue.shift()!
    visited++
    for (const child of dependents.get(id) ?? []) {
      const d = (indegree.get(child) ?? 0) - 1
      indegree.set(child, d)
      if (d === 0) queue.push(child)
    }
  }
  if (visited !== nodes.length) throw new Error('dependency cycle detected in subtask graph')
}

/**
 * Run every node through `worker`, honoring dependencies and a concurrency cap.
 * A node runs only after all its dependencies finish 'done'; if any dependency does not
 * complete (error/skipped), the node is skipped. Returns outcomes in the input order.
 */
export async function runDag(
  nodes: DagNode[],
  worker: (node: DagNode, deps: Record<string, string>) => Promise<string>,
  opts: RunDagOptions = {},
): Promise<NodeOutcome[]> {
  if (nodes.length === 0) return []
  const dupes = nodes.length - new Set(nodes.map(n => n.id)).size
  if (dupes > 0) throw new Error('subtask graph has duplicate ids')
  assertAcyclic(nodes)

  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 2))
  const outcomes = new Map<string, NodeOutcome>()
  const inFlight = new Map<string, Promise<void>>()

  const depsOf = (n: DagNode) => n.dependsOn ?? []

  // 'ready' = all deps done; 'skip' = a dep failed/skipped; 'wait' = a dep still pending.
  const readiness = (n: DagNode): 'ready' | 'wait' | 'skip' => {
    let allDone = true
    for (const d of depsOf(n)) {
      const o = outcomes.get(d)
      if (!o) { allDone = false; continue }
      if (o.status !== 'done') return 'skip'
    }
    return allDone ? 'ready' : 'wait'
  }

  while (outcomes.size < nodes.length) {
    for (const n of nodes) {
      if (outcomes.has(n.id) || inFlight.has(n.id)) continue
      if (inFlight.size >= concurrency) break
      const state = readiness(n)
      if (state === 'wait') continue
      if (state === 'skip') {
        outcomes.set(n.id, { id: n.id, status: 'skipped', reason: 'a dependency did not complete' })
        continue
      }
      const deps: Record<string, string> = {}
      for (const d of depsOf(n)) {
        const o = outcomes.get(d)
        if (o?.status === 'done') deps[d] = o.result
      }
      const p = Promise.resolve()
        .then(() => worker(n, deps))
        .then(result => { outcomes.set(n.id, { id: n.id, status: 'done', result }) })
        .catch(e => { outcomes.set(n.id, { id: n.id, status: 'error', error: e instanceof Error ? e.message : String(e) }) })
        .finally(() => { inFlight.delete(n.id) })
      inFlight.set(n.id, p)
    }

    if (inFlight.size === 0) {
      // Nothing running and nothing launchable → remaining nodes depend on failed work.
      for (const n of nodes) {
        if (!outcomes.has(n.id)) outcomes.set(n.id, { id: n.id, status: 'skipped', reason: 'unsatisfiable dependencies' })
      }
      break
    }
    await Promise.race(inFlight.values())
  }

  return nodes.map(n => outcomes.get(n.id)!)
}
