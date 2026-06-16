# Plan — Prompt Queue, Execution Order & Request Editing (Max Coder)

## Does it exist today? — No.

Max Coder runs **one task at a time**. In the TUI/REPL you submit a prompt, it runs to completion
(`runAgent`), then you can submit the next. While a task is running, new input is **ignored** (the TUI
sets `busy` and drops submits). There is **no queue**, no reordering, no editing/cancelling of pending
requests, no pause/resume. This plan adds that.

## Goals

1. **Enqueue** prompts (typing while a task runs adds to a queue instead of being dropped).
2. **Execution order**: strict FIFO by default, sequential (one agent loop, shared conversation).
3. **Edit** a pending prompt before it runs.
4. **Reorder / move** pending items.
5. **Cancel / remove** a pending item; **clear** the queue.
6. **Pause / resume** the queue; **interrupt** the running item (Esc already does this).
7. Visible **queue state** (ids, status, position).

## Design

### `src/queue.ts` — `PromptQueue` (pure data structure)
```ts
type QueueStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'error'
interface QueueItem { id: string; text: string; status: QueueStatus; createdAt: number; result?: string; error?: string }

class PromptQueue {
  enqueue(text): string            // returns id; status 'pending'
  list(): QueueItem[]              // ordered
  pending(): QueueItem[]
  get(id): QueueItem | undefined
  edit(id, text): boolean         // only if 'pending'
  remove(id): boolean             // only if 'pending' -> 'cancelled'
  move(id, toIndex): boolean      // reorder pending
  clear(): void                   // drop all pending
  takeNext(): QueueItem | undefined  // first pending -> 'running'
  complete(id, result): void
  fail(id, error): void
  paused: boolean
}
```
Pure + fully unit-testable (`src/queue.test.ts`): enqueue/order, edit-only-pending, remove, move,
takeNext order, pause gating, can't-edit-running.

### `src/queueRunner.ts` — sequential executor
A loop: while `!paused` and a pending item exists → `takeNext()` → `runAgent({task, …shared state})`
→ `complete()`; emit events so the UI can render progress + queue changes. Single-flight (preserves
order; shared `messages`/`session` so the queue is one continuing conversation). Interrupt (Esc)
aborts only the running item; the rest stay queued.

### UI integration
- **TUI** (`tui.ts`): while `busy`, Enter → `queue.enqueue(text)` (don't drop). Render a compact
  **queue panel** above the input (`▸ 3 queued`), and on demand the list. New keys / slash commands:
  `/queue` (list), `/qedit <id> <text>`, `/qrm <id>`, `/qmv <id> <pos>`, `/qclear`, `/pause`, `/resume`.
- **Plain REPL** (`cli.ts`): same slash commands; since the REPL blocks on input, the queue mainly
  matters when commands are piped or when a task is interrupted.

### Persistence (optional, phase 5)
Persist pending items to the session JSONL (`type:'queue'` entries) so a queue survives restart/resume.

## Phases (incremental, each shippable + tested)

- [ ] **P1** `PromptQueue` + `queue.test.ts` (pure; no UI). 
- [ ] **P2** `queueRunner` sequential executor wired to `runAgent`; unit test with a stub runner.
- [ ] **P3** TUI: enqueue-while-busy + queue panel + slash commands (edit/rm/mv/clear/pause/resume).
- [ ] **P4** Plain REPL slash commands.
- [ ] **P5** (optional) persist queue to session; restore on resume.

## Risks / decisions

- **Shared context**: queued items run in the same conversation (sequential), so later items see
  earlier results — intended; documented. (A future "isolated"/parallel mode is out of scope.)
- **Editing the running item**: disallowed (it's executing); only `pending` items are mutable.
- **Ordering vs. interrupt**: Esc aborts the running item but keeps the queue; `/pause` stops dequeuing
  without losing items.
- **No parallelism in v1**: strictly one-at-a-time to keep the model context coherent and cheap.

## Rollback

All additive (`queue.ts`, `queueRunner.ts`, tests + small UI hooks). Removing the files + the UI hooks
reverts to today's single-task behavior. No change to the agent loop, sessions, tools, or web_search.

## Follow-up (separate task, already requested)

Refactor `switch` statements → lookup tables / dispatch maps. Candidates:
`cli.ts handleSlash`, `datetimeTool` operation switch, `providers/index.ts createProvider`,
`ui.ts formatEvent`, Ollama error mapping. Each becomes a `Record<key, handler>` dispatch.
