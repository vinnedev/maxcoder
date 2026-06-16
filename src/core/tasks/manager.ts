// Max Coder — TaskManager: pure registry of background/orchestrated tasks (deterministic, testable).
// Knows nothing about runAgent/IO — the runner drives it. See docs/background-orchestration-plan.md.

import type { TaskKind, TaskRecord, TaskStatus } from './types.ts'

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`

const TERMINAL: TaskStatus[] = ['done', 'error', 'cancelled']

export class TaskManager {
  private tasks = new Map<string, TaskRecord>()

  constructor(
    private genId: () => string = uuid,
    private clock: () => number = Date.now,
  ) {}

  create(goal: string, kind: TaskKind = 'background', parentId?: string): TaskRecord {
    const rec: TaskRecord = { id: this.genId(), goal, kind, status: 'queued', createdAt: this.clock() }
    if (parentId) rec.parentId = parentId
    this.tasks.set(rec.id, rec)
    return { ...rec }
  }

  get(id: string): TaskRecord | undefined {
    const t = this.tasks.get(id)
    return t ? { ...t } : undefined
  }

  /** All tasks, oldest first (copies). */
  list(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) => a.createdAt - b.createdAt).map(t => ({ ...t }))
  }

  /** Queued or running tasks. */
  active(): TaskRecord[] {
    return this.list().filter(t => t.status === 'queued' || t.status === 'running')
  }

  children(id: string): TaskRecord[] {
    return this.list().filter(t => t.parentId === id)
  }

  /** Patch fields that aren't lifecycle-managed (e.g. progress). */
  update(id: string, patch: Partial<Pick<TaskRecord, 'progress' | 'goal'>>): boolean {
    const t = this.tasks.get(id)
    if (!t) return false
    Object.assign(t, patch)
    return true
  }

  start(id: string): boolean {
    const t = this.tasks.get(id)
    if (!t || t.status !== 'queued') return false
    t.status = 'running'
    t.startedAt = this.clock()
    return true
  }

  finish(id: string, result: string): boolean {
    return this.terminate(id, 'done', { result })
  }

  fail(id: string, error: string): boolean {
    return this.terminate(id, 'error', { error })
  }

  /** Cancel a non-terminal task. */
  cancel(id: string): boolean {
    const t = this.tasks.get(id)
    if (!t || TERMINAL.includes(t.status)) return false
    t.status = 'cancelled'
    t.endedAt = this.clock()
    return true
  }

  private terminate(id: string, status: TaskStatus, extra: Partial<TaskRecord>): boolean {
    const t = this.tasks.get(id)
    if (!t || TERMINAL.includes(t.status)) return false
    t.status = status
    t.endedAt = this.clock()
    Object.assign(t, extra)
    return true
  }
}
