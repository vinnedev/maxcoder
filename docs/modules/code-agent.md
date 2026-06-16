# Code Agent — tiny-model-first subsystems

These subsystems make a small local model (qwen2.5-coder:3b) reliable by building intelligence into the
**system around the model**: deterministic rules, schemas, retrieval, verification, and memory. Full
roadmap + phase status: [code-agent-architecture.md](../code-agent-architecture.md).

## Model Adapter Layer — `src/models/`
The agent talks to models **only** through `ModelAdapter` (`chat` · `stream` · `generateJson` ·
`countTokens` · `capabilities`). `OllamaAdapter` wraps the provider and adds **JSON-mode** (Ollama
`format`) for reliable structured output. `createAdapter(model)` is a lookup-table factory, ready for
`openai:` / `anthropic:` schemes. Swapping/upgrading models is additive — the whole ecosystem scales.

## Effort system — `src/core/effort/` + `src/core/config/`
`/effort low|medium|high|max|auto|explain` controls how much of the pipeline runs (model calls, files,
plan steps, critique cycles, tool calls, context budget, Tree-of-Thoughts, reflection). `auto` uses a
**deterministic classifier with risk FLOORS above the model's opinion** (critical files → `max`;
command/core-agent/refactor → `high`). The model is consulted only for genuinely ambiguous tasks.
Config persists to `.maxcoder/config.json`.

## Intent router — `src/core/intent/`
Classifies a task into an intent (`bug_fix`, `refactor`, `code_review`, `architecture_plan`,
`create_tests`, `project_scan`, `execute_plan`, …) and resolves a **Route** (lookup table, no switch):
allowed tools, minimum effort, output format, fallback. Read-only intents are restricted to
non-mutating tools. Shown in the auto-mode prompt; loop-level enforcement lands in P6.

## Safety guardrails — `src/safety/`
Applied at the `executeTool` chokepoint, so **every** path (main loop, subagents, background/orchestrated
tasks) is protected. Hard-blocks destructive shell (`rm -rf`, `sudo`, fork bomb, `curl|sh`, force-push)
and secret-file access (`.env`, keys, `.ssh/`, credentials) unless `ctx.allowSecrets`; flags
critical/build files for confirmation. Tools carry a `policy` (`readOnly/altersDisk/executesCommand/
risk/timeoutMs/maxRetries/requiresConfirm`).

## Repository intelligence + RAG — `src/core/intelligence/` + `src/core/retrieval/`
Gives the model a **small, relevant** slice instead of the whole repo:
- `walk.ts` — deterministic walker (ignore set + basic `.gitignore`, size/count caps, skips secrets).
- `projectMap.ts` — `.maxcoder/project-map.json` (stack, package managers, test/build commands,
  entrypoints, critical files, `detectedConventions`).
- `extract.ts` — regex symbol/import extraction (broadened TS/JS forms).
- `indexer.ts` — incremental index cached by `{mtimeMs,size}`, drops deleted files; persists
  `index.json` + `symbols/dependency-map/file-summaries/recent-changes` under `.maxcoder/context/`.
- `retriever.ts` — **lexical** scoring (no embeddings): symbol ≫ path ≫ summary; budget-bounded
  `buildContext`.
- Tools: `repo_map`, `search_symbols`, `find_context` (read-only).

## Memory — `src/core/memory/`
A **Markdown wiki is the source of truth**; a derived SQLite/FTS index makes it searchable.
Durable pages (`decision`, `gotcha`, `procedure`, `concept`, `rule`, `note`) require **evidence +
confidence**; an **approval queue** gates auto-improve proposals. Tools: `memory_search`,
`memory_write`, `memory_rebuild_index`, `memory_pending`, `memory_apply`, plus legacy `reflect` /
`recall_memory` (append-only category lessons with **secret redaction**). Relevant memory is consulted
per task (`memoryContextForTask`) and folded into the system prompt (`<relevant_memory>` +
`<memory_policy>`). The `/memory` command manages it. **Secrets are never persisted.**

## Telemetry — `src/core/telemetry/`
`RunRecorder` + JSONL `jsonlSink` write structured run logs to `.maxcoder/logs/runs.jsonl` (model,
effort, tools, tokens, duration, outcome) for observability. Local-only; never logs secrets.

## `.maxcoder/` layout (gitignored)
```
.maxcoder/
  config.json          # effort + agent settings
  project-map.json     # repository intelligence
  context/             # index.json + symbols/deps/summaries/recent-changes
  memory/              # reflexion lessons (markdown)
  logs/                # telemetry (runs.jsonl)
  plans/               # planning mode (P7)
```
