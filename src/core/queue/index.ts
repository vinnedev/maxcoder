// Max Coder — PromptQueue: ordered, editable queue of prompts (foundation of the queue feature).
// Pure + deterministic (genId + clock injectable) → fully unit-testable. The runner + UI wiring
// (enqueue-while-busy, /queue commands) build on this. See docs/queue-system-plan.md.

export type QueueStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'error'

export interface QueueItem {
  id: string
  text: string
  status: QueueStatus
  createdAt: number
  result?: string
  error?: string
}

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`

export class PromptQueue {
  private items: QueueItem[] = []
  paused = false

  constructor(
    private genId: () => string = uuid,
    private clock: () => number = Date.now,
  ) {}

  /** Add a prompt to the back of the queue. Returns its id. */
  enqueue(text: string): string {
    const id = this.genId()
    this.items.push({ id, text, status: 'pending', createdAt: this.clock() })
    return id
  }

  list(): QueueItem[] {
    return this.items.map(i => ({ ...i }))
  }

  pending(): QueueItem[] {
    return this.items.filter(i => i.status === 'pending')
  }

  get(id: string): QueueItem | undefined {
    const i = this.items.find(x => x.id === id)
    return i ? { ...i } : undefined
  }

  /** Edit a still-pending prompt. */
  edit(id: string, text: string): boolean {
    const item = this.items.find(i => i.id === id && i.status === 'pending')
    if (!item) return false
    item.text = text
    return true
  }

  /** Cancel a pending prompt (kept as history with status 'cancelled'). */
  remove(id: string): boolean {
    const item = this.items.find(i => i.id === id && i.status === 'pending')
    if (!item) return false
    item.status = 'cancelled'
    return true
  }

  /** Cancel all pending prompts. */
  clear(): void {
    for (const i of this.items) if (i.status === 'pending') i.status = 'cancelled'
  }

  /** Reorder a pending item to the given position among pending items. */
  move(id: string, toIndex: number): boolean {
    const item = this.items.find(i => i.id === id && i.status === 'pending')
    if (!item) return false
    this.items = this.items.filter(i => i !== item)
    const pend = this.pending()
    const clamped = Math.max(0, Math.min(toIndex, pend.length))
    const target = pend[clamped]
    const insertAt = target ? this.items.indexOf(target) : this.items.length
    this.items.splice(insertAt, 0, item)
    return true
  }

  /** Dequeue the first pending prompt for execution (unless paused). */
  takeNext(): QueueItem | undefined {
    if (this.paused) return undefined
    const item = this.items.find(i => i.status === 'pending')
    if (!item) return undefined
    item.status = 'running'
    return { ...item }
  }

  complete(id: string, result: string): void {
    const item = this.items.find(i => i.id === id)
    if (item) {
      item.status = 'done'
      item.result = result
    }
  }

  fail(id: string, error: string): void {
    const item = this.items.find(i => i.id === id)
    if (item) {
      item.status = 'error'
      item.error = error
    }
  }
}
