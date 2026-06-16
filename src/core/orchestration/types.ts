// Max Coder — orchestration types. See docs/background-orchestration-plan.md (P3/P4).

/** Roles a subagent can play. Maps to a prompt in roles.ts. */
export type Role = 'planner' | 'researcher' | 'coder' | 'synthesizer' | 'reviewer' | 'general'

/** A planned unit of work in the decomposition DAG. */
export interface PlanSubtask {
  id: string
  goal: string
  dependsOn: string[]
  role: Role
}

/** A node fed to the scheduler (subset of PlanSubtask the scheduler needs). */
export interface DagNode {
  id: string
  goal: string
  dependsOn?: string[]
}

/** Per-node result after scheduling. */
export type NodeOutcome =
  | { id: string; status: 'done'; result: string }
  | { id: string; status: 'error'; error: string }
  | { id: string; status: 'skipped'; reason: string }
