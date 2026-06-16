// Max Coder — BackgroundRunner: cooperative (single-process, async) background task execution.
// Bounded concurrency (default 2 — one local Ollama backend; higher fan-out just causes contention).
// Drives a TaskManager; the `run` callback wraps runAgent in the CLI (fresh context, read-only tools).
// Single-process Bun: "background" = an async Promise tracked here, so the input loop stays responsive.

import type { TaskManager } from './manager.ts'
import type { TaskRecord } from './types.ts'

export interface BackgroundRunOptions {
  manager: TaskManager
  run: (task: TaskRecord, signal: AbortSignal) => Promise<string>
  maxConcurrent?: number
  onUpdate?: (task: TaskRecord) => void
}

export class BackgroundRunner {
  private aborts = new Map<string, AbortController>()
  private inflight = 0
  private waiting: string[] = []

  constructor(private opts: BackgroundRunOptions) {}

  private get max(): number {
    return Math.max(1, this.opts.maxConcurrent ?? 2)
  }

  /** Queue a background task and start it if a slot is free. Returns its id. */
  start(goal: string): string {
    const t = this.opts.manager.create(goal, 'background')
    this.waiting.push(t.id)
    this.pump()
    return t.id
  }

  /** Cancel a queued or running task. */
  cancel(id: string): boolean {
    this.aborts.get(id)?.abort()
    return this.opts.manager.cancel(id)
  }

  /** Number currently executing. */
  get running(): number {
    return this.inflight
  }

  private pump(): void {
    while (this.inflight < this.max && this.waiting.length > 0) {
      const id = this.waiting.shift()
      if (!id) break
      const task = this.opts.manager.get(id)
      if (!task || task.status !== 'queued') continue // cancelled while waiting
      this.runOne(id)
    }
  }

  private runOne(id: string): void {
    this.inflight++
    this.opts.manager.start(id)
    const ac = new AbortController()
    this.aborts.set(id, ac)
    const started = this.opts.manager.get(id)
    if (started) this.opts.onUpdate?.(started)

    Promise.resolve()
      .then(() => this.opts.run(this.opts.manager.get(id)!, ac.signal))
      .then(result => {
        if (this.opts.manager.get(id)?.status === 'running') this.opts.manager.finish(id, result)
      })
      .catch(e => {
        if (this.opts.manager.get(id)?.status === 'running') {
          this.opts.manager.fail(id, e instanceof Error ? e.message : String(e))
        }
      })
      .finally(() => {
        this.aborts.delete(id)
        this.inflight--
        const done = this.opts.manager.get(id)
        if (done) this.opts.onUpdate?.(done)
        this.pump()
      })
  }
}
