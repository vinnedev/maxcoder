// Max Coder — queue runner: drains the PromptQueue sequentially (single-flight).
// The `run` callback executes one prompt (wired to runAgent in the CLI). Pure control flow → testable.

import type { PromptQueue, QueueItem } from './index.ts'

export interface QueueRunnerOptions {
  queue: PromptQueue
  run: (item: QueueItem) => Promise<string>
  onStart?: (item: QueueItem) => void
  onFinish?: (item: QueueItem, result: string) => void
  onError?: (item: QueueItem, error: unknown) => void
}

// Per-queue single-flight guard: a second concurrent drain on the same queue is a no-op,
// so two callers can never run two items at once (the existing drain will pick up new items).
const draining = new WeakSet<PromptQueue>()

/**
 * Run every currently-pending item one at a time, in order, until the queue is drained or paused.
 * Each item is marked running → done/error. Single-flight per queue. Returns the number processed.
 */
export async function drainQueue(opts: QueueRunnerOptions): Promise<number> {
  if (draining.has(opts.queue)) return 0
  draining.add(opts.queue)
  let count = 0
  try {
    for (let item = opts.queue.takeNext(); item; item = opts.queue.takeNext()) {
      opts.onStart?.(item)
      try {
        const result = await opts.run(item)
        opts.queue.complete(item.id, result)
        opts.onFinish?.(item, result)
      } catch (e) {
        opts.queue.fail(item.id, e instanceof Error ? e.message : String(e))
        opts.onError?.(item, e)
      }
      count++
    }
  } finally {
    draining.delete(opts.queue)
  }
  return count
}
