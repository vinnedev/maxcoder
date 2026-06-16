# Plan — Task Execution, Agents & Background Orchestration (Max Coder)

Companion to [queue-system-plan.md](queue-system-plan.md). The queue handles **foreground, sequential**
turns; this plan adds **background execution** and **multi-agent orchestration** for **complex** tasks.

## Current state

- `runAgent` runs one task to completion in the foreground.
- Subagents exist via the `task` tool (nested `runAgent`, sequential, depth ≤ 2, fresh context).
- **Missing**: background execution, complexity-based routing, parallel orchestration, a task registry,
  progress/observability, cancel/prioritize.

## Goals

1. Long/complex tasks run in the **background** so the TUI/REPL stays responsive; notify on completion.
2. **Complexity routing**: simple → inline; long → background; multi-step/multi-file → orchestrate.
3. **Orchestration**: decompose a goal → run independent subtasks in **bounded parallel** → aggregate →
   verify.
4. Reuse **agent roles** (planner, researcher+web_search, coder, reviewer, synthesizer).
5. **Observability/control**: `/tasks`, `/task <id>`, `/cancel <id>`, `/bg`, `/orchestrate`.

## Architecture

### `src/tasks/taskManager.ts` — registry
```ts
type TaskKind = 'inline' | 'background' | 'orchestrated'
type TaskStatus = 'queued' | 'running' | 'blocked' | 'done' | 'error' | 'cancelled'
interface TaskRecord { id; goal; kind: TaskKind; status: TaskStatus; parentId?; children?: string[];
  progress?: string; result?: string; error?: string; createdAt; startedAt?; endedAt?; tokens?: number }
class TaskManager { create(goal, kind, parentId?): id; get(id); list(); update(id, patch);
  cancel(id); children(id) }
```
Persistable to the session JSONL (`type:'task'`).

### `src/tasks/backgroundRunner.ts` — cooperative background execution
Single-process Bun CLI: a "background" task is an **async run tracked by TaskManager**, stepped on the
event loop so the input loop stays responsive (model/web calls are I/O-bound, so cooperative async
already yields real responsiveness). Emits progress events + a **completion notification**. True
parallelism (Bun `Worker` threads) is a later phase for CPU-bound work.

### `src/tasks/complexity.ts` — routing
Heuristic classifier (cheap) + optional LLM-judge for ambiguity. Signals: implied step count,
multiple files/subsystems, verbs (`refactor/audit/migrate/build feature/investigate`), explicit
"use agents/background/depois", estimated tokens. Output: `inline | background | orchestrate`.
**Always overridable** via `/bg <task>` and `/orchestrate <task>`.

### `src/tasks/orchestrator.ts` — coordinator (for complex tasks)
1. **Decompose**: a *planner* agent emits a subtask list/DAG (`{id, goal, dependsOn[]}`).
2. **Schedule**: independent subtasks run in **bounded parallel** (`min(cpuCores-2, 4)`); dependents
   wait on their inputs. Each subagent gets a **fresh context** + a focused role.
3. **Aggregate**: a *synthesizer* agent merges subtask results into the final answer.
4. **Verify**: a *reviewer* agent checks the result (adversarial), optionally loops once.

This is the fan-out / pipeline pattern, native to Max Coder (reuses `runAgent` + the registry).

### Concurrency & isolation
- Independent subagents run concurrently (bounded). Reads share the filesystem; **writes are
  serialized** OR each writer subagent runs in a **git worktree** (isolated copy) to avoid conflicts —
  mirrors the Agent-tool worktree option in Claude Code.
- Limits: depth ≤ 2, bounded fan-out, per-task token budget, circuit breaker — prevent runaway/cost.

## Routing rules (default; user can override)

| Task shape | Route |
| --- | --- |
| single read/edit/answer/search | **inline** |
| long-running (broad search, full build/test) or "do this in background" | **background** |
| multi-file refactor, audit, migration, "build feature X", "use agents" | **orchestrate** |

## Observability & control

`/tasks` (list: id·kind·status·progress) · `/task <id>` (detail/result) · `/cancel <id>` ·
`/bg <task>` (force background) · `/orchestrate <task>` (force decomposition). Completion → notification
line in the TUI. Task records persisted to the session.

## Composition with the queue

- **PromptQueue** (foreground, sequential interactive turns) and **TaskManager** (background /
  orchestrated) are complementary: a foreground turn can **spawn** a background/orchestrated task (via a
  `background_task` tool or `/bg`) and immediately return control to the user.

## Phases

- [x] **P1** TaskManager + status model + `/tasks` (+ unit tests). *(src/core/tasks/manager.ts)*
- [x] **P2** Background runner (cooperative async) + `/bg <task>` + completion notifications +
  `/cancel`. *(src/core/tasks/runner.ts; read-only allow-list enforced in the agent loop)*
- [x] **P3** Complexity classifier (heuristic) + `/orchestrate` override. *(src/core/orchestration/complexity.ts;
  auto-routing intentionally left OFF — `/bg` and `/orchestrate` are the explicit entry points.)*
- [x] **P4** Orchestrator: planner → bounded-parallel subagents → synthesizer → reviewer.
  *(src/core/orchestration/{orchestrator,scheduler,planner,roles}.ts + shared Semaphore model gate.
  Defensive plan parse → falls back to a single inline agent when decomposition isn't useful.
  Verified live against Ollama qwen2.5-coder:3b.)*
- [ ] **P5** Worker-thread parallelism + git-worktree isolation for parallel file edits
  (subagents are read-only until then).
- [ ] **P6** Persist tasks to session; restore/resume; prioritization. Wire the complexity
  classifier to opt-in auto-routing.

## Risks

- **Parallel writes** → conflicts: worktree isolation or serialized writes.
- **Cost/runaway**: bounded concurrency + depth + per-task token budgets + circuit breaker.
- **Local model quality**: decomposition/synthesis quality tracks the model — allow a larger model for
  planner/synthesizer/reviewer roles (`--model` override per role).
- **Misclassification**: always allow explicit `/bg` / `/orchestrate` override.

## Files (new, additive)

`src/tasks/{taskManager,backgroundRunner,complexity,orchestrator}.ts` + tests; UI hooks
(`/tasks`, `/task`, `/bg`, `/orchestrate`, `/cancel`). No change to the existing agent loop, sessions,
tools, or web_search until wired.
