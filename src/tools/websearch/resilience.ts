// web_search — resilience: timeout, bounded retry, circuit breaker, rate limiter.

export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  outer?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
  }
}

export async function retry<T>(fn: () => Promise<T>, opts: { retries: number; baseDelayMs?: number } = { retries: 1 }): Promise<T> {
  const base = opts.baseDelayMs ?? 250
  let lastErr: unknown
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (attempt < opts.retries) await new Promise(r => setTimeout(r, base * 2 ** attempt))
    }
  }
  throw lastErr
}

/** Opens after `threshold` consecutive failures; half-opens after `cooldownMs`. */
export class CircuitBreaker {
  private failures = 0
  private openedAt = 0
  constructor(private threshold = 5, private cooldownMs = 30_000, private now: () => number = Date.now) {}

  get open(): boolean {
    if (this.failures < this.threshold) return false
    if (this.now() - this.openedAt > this.cooldownMs) return false // half-open: allow a trial
    return true
  }

  success(): void {
    this.failures = 0
  }
  failure(): void {
    this.failures++
    if (this.failures >= this.threshold) this.openedAt = this.now()
  }
}

/** Minimum interval between calls. */
export class RateLimiter {
  private last = 0
  constructor(private minIntervalMs: number, private now: () => number = Date.now) {}

  async wait(): Promise<void> {
    const elapsed = this.now() - this.last
    if (elapsed < this.minIntervalMs) await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed))
    this.last = this.now()
  }
}
