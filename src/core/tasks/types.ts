// Max Coder — background task types. See docs/background-orchestration-plan.md.
// Foundation for background execution; orchestration (planner/scheduler) builds on this later.

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export type TaskKind = 'background' | 'orchestrated'

export interface TaskRecord {
  id: string
  goal: string
  kind: TaskKind
  status: TaskStatus
  parentId?: string
  progress?: string
  result?: string
  error?: string
  createdAt: number
  startedAt?: number
  endedAt?: number
}
