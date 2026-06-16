// Max Coder — a minimal async counting semaphore.
// Bounds concurrent access to a scarce resource. The orchestrator uses one shared instance
// (capacity 2) to cap total in-flight model calls against the single local Ollama backend,
// regardless of how many orchestrated tasks fan out at once.

export class Semaphore {
  private permits: number
  private waiters: Array<() => void> = []

  constructor(capacity: number) {
    this.permits = Math.max(1, Math.floor(capacity))
  }

  /** Acquire a permit, waiting (FIFO) if none are free. */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }
    await new Promise<void>(resolve => this.waiters.push(resolve))
  }

  /** Return a permit — hands it straight to the next waiter if any, else back to the pool. */
  release(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.permits++
  }

  /** Run `fn` while holding a permit; always releases, even on throw. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  /** Free permits currently available (for tests/observability). */
  get available(): number {
    return this.permits
  }

  /** Callers currently blocked on acquire() (for tests/observability). */
  get queued(): number {
    return this.waiters.length
  }
}
