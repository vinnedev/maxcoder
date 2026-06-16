# Max Coder — Local Code-Agent Architecture (tiny-model-first)

Target: a code agent that runs on `qwen2.5-coder:3b` via Ollama and gets its reliability from the
**system around the model** (decomposition, tools, schemas, retrieval, verification, memory,
deterministic rules), not from raw model intelligence. Scales up cleanly to larger Ollama models and,
later, external providers via adapters. See [[ecosystem-over-model-size]] premise.

---

## 1. Diagnosis — current architecture

**What already exists (and is good):**
- Agentic loop `src/core/agent/index.ts` (`runAgent`): model→tools→results, streaming, loop guards,
  subagent recursion (depth ≤ 2), read-only allow-list enforced.
- Orchestration `src/core/orchestration/*`: planner → bounded-parallel scheduler (pure DAG) →
  synthesizer → reviewer; defensive plan parse w/ inline fallback; shared model `Semaphore`.
- Routing `router.ts` + `complexity.ts`: heuristic + LLM-judge, suggest-and-confirm in the CLI.
- Tasks `src/core/tasks/*`: `TaskManager` (pure) + `BackgroundRunner` (cooperative, bounded) + `/bg`,
  `/orchestrate`, `/tasks`, `/cancel`.
- Tools `src/tools.ts`: uniform `Tool` registry (`builtin|skill|agent|mcp|web`), `read_file`,
  `write_file`, `edit_file`, `list_dir`, `grep`, `run_bash`, `datetime`, `web_search`, `task`, skills.
- Context `src/core/context`: token estimate + auto-compaction. Sessions `src/sessions` (JSONL).
- Provider `src/providers/ollama`: `chat()` streaming, native + emulated tool calls, `listModels()`.
- Shared `src/shared/{config,fs,errors,html,async}`. Tests mirror `src/` under `tests/`; 121 passing.

**Architectural shape:** a modular monolith, domain-oriented, already close to the desired layout.

## 2. Gaps for a tiny-model-first code agent

| # | Gap | Impact on a 3B model |
| - | --- | --- |
| G1 | No **model adapter layer** — `chat()` is imported directly; no `generateJson`, no capability flags | Can't swap models or enforce JSON-mode; tight coupling |
| G2 | No **effort control** — every task uses the same budget | No cheap path for trivial asks; no deep path for risky ones |
| G3 | No **effort auto-classifier** with deterministic floors | Can't size effort by risk/scope |
| G4 | No **intent router** (route→prompt/tools/effort/validation) | One generic prompt for everything; weak model under-performs |
| G5 | No **planning persistence** (`.maxcoder/plans`) / no plan gate for risky work | Dangerous edits without a plan |
| G6 | No **repository intelligence** (`project-map.json`) | Model guesses stack/test cmds/structure |
| G7 | No **repo RAG / context retrieval** — context is whole-message | Tiny context window wasted; irrelevant tokens |
| G8 | Tool registry lacks **schemas/permissions/risk/timeout/retry/confirm** metadata | No structured safety; emulated calls fragile |
| G9 | **Safety guardrails** are coarse (only `mutating` flag) | No critical-file / destructive-command policy |
| G10 | ReAct loop is implicit; the model decides freely (not **constrained JSON action**) | Malformed/looping actions on a weak model |
| G11 | No separated **Planner/Executor/Critic/Verifier/Summarizer** roles outside orchestration | No verification on normal turns |
| G12 | No **Reflexion memory** (`.maxcoder/memory`) | Repeats past mistakes; re-derives test cmds |
| G13 | No **constrained/JSON-mode generation** (Ollama `format`) | Defensive parser does heavy lifting |
| G14 | No **telemetry/evals** for the agent itself | No observability/regression safety |

## 3. Risks

- **Behavior regression** while refactoring the agent loop / tools → mitigate with characterization
  tests first (TDD), additive changes, diff-minimal edits.
- **Latency** on a tiny model if every turn adds classifier+critic+retrieval calls → effort budgets
  gate the extra calls; `low` stays a single pass.
- **Over-engineering** → ship in vertical slices, each independently testable and shippable.
- **Coupling** to Ollama → introduce the adapter additively (wrap `chat()`), migrate callers gradually.
- **Tiny-model JSON fragility** → JSON-mode + deterministic parse + one retry-with-feedback + fallback.

## 4. Proposed final architecture

```
Intent Router ─┬─► Effort Controller (level | auto → Classifier w/ deterministic floors)
               │
               ▼
        Planning Mode (persisted plan for risky/high-effort work)
               │
               ▼
   Controlled ReAct loop  ──►  Tool Registry (schemas) ──► Safety Guardrails
   (constrained-JSON action)        │
               │                    ▼
        Repo Intelligence + RAG (small, relevant context)
               │
               ▼
     Roles: Planner · Executor · Critic · Verifier · Summarizer
               │
               ▼
        Reflexion Memory + Telemetry/Evals
               │
        Model Adapter Layer (Ollama now; OpenAI/Anthropic later)
```

Everything model-facing goes through the **Model Adapter**. Effort budgets gate how much of the
pipeline runs. Deterministic rules sit **above** the model's opinion at every decision point.

## 5. Implementation plan (vertical slices, each TDD + tsc + tests + build)

- **P1 — Effort system + project config** ✅ (this PR): `EffortLevel`/`EFFORT_PROFILES`, deterministic
  classifier (+injectable LLM, JSON schema) with risk floors, `EffortController`, `.maxcoder/config.json`,
  `/effort` (show/low/medium/high/max/auto/explain). *Foundational, self-contained, user-facing.*
- **P2 — Model Adapter Layer** ✅ (this PR): `ModelAdapter` interface (`chat/stream/generateJson/
  countTokens/capabilities{supportsTools,supportsJsonMode,contextWindow,modelSize,recommendedEffortProfile}`)
  in `src/models/`; `OllamaAdapter` wraps `chat()` additively + JSON-mode via Ollama `format`; `createAdapter`
  factory (lookup table, ready for openai:/anthropic: schemes). Migrated `runAgent`, `compact()`, and the
  CLI judge/assess (now `generateJson`) — nothing calls the provider directly anymore except the adapter.
  Shared `extractJsonValue` (`src/shared/json`). Tests: `tests/models/*`, `tests/shared/json/*`. Live-validated.
- **P3 — Tool Registry v2 + Safety** ✅ (this PR): `Tool` extended with optional `policy`
  (`readOnly/altersDisk/executesCommand/risk/timeoutMs/maxRetries/requiresConfirm`) + `outputSchema`;
  builtins annotated. `src/safety/index.ts` (pure): blocks destructive shell (`rm -rf`, `sudo`, fork
  bomb, `curl|sh`, force-push, …) and secret-file access (`.env`, keys, `.ssh/`, credentials) unless
  `allowSecrets`; flags critical/build files (package.json, lockfiles, Dockerfile, migrations, CI, …)
  for confirmation. Enforced at the `executeTool` chokepoint (covers main loop, subagents, background) +
  surfaced in the agent loop. Diffs already shown by write/edit. Tests: `tests/safety/*` + executeTool
  block test. Live-validated.
- **P4 — Repo Intelligence + RAG** ✅ (this PR): deterministic walker (`src/core/intelligence/walk.ts`:
  ignore set + basic .gitignore, size/count caps, skips secrets, stable order) → `project-map.json`
  (`projectMap.ts`: stack/PM/commands/entrypoints/dirs/criticalFiles/`detectedConventions`). Repo RAG
  (`src/core/retrieval/`): regex symbol/import `extract.ts` (broadened TS/JS forms), incremental
  `indexer.ts` (cache keyed by `{mtimeMs,size}`, drops deleted files, heuristic summaries, persists
  index.json + symbols/dependency-map/file-summaries/recent-changes under `.maxcoder/context/`), and
  lexical `retriever.ts` (NO embeddings: symbol≫path≫summary term overlap + budget-bounded `buildContext`).
  Read-only tools `repo_map` / `search_symbols` / `find_context`. Tests: `tests/core/intelligence/*`,
  `tests/core/retrieval/*`, `tests/tools/repo/*`. Live-validated on the real repo (120 files, ~20ms).
- **P5 — Intent Router (lookup table)**: route → prompt/tools/min-effort/output-format/validation/fallback.
- **P6 — Controlled ReAct + roles**: constrained-JSON action step (`validate_json` + retry), separated
  Planner/Executor/Critic/Verifier/Summarizer prompts.
- **P7 — Planning Mode persistence**: `.maxcoder/plans/{name}.md`, plan gate for high-risk work.
- **P8 — Reflexion memory + Telemetry** ✅ (done, out of order, per request): `src/core/memory/index.ts`
  — append-only lessons in `.maxcoder/memory/{project-lessons,failed-attempts,tool-errors,user-preferences,
  architecture-decisions}.md` with **secret redaction**; `reflect` + `recall_memory` tools; user
  preferences + lessons folded into the system prompt (`<learned_memory>`). `src/core/telemetry/index.ts`
  — `RunRecorder` + JSONL `jsonlSink` to `.maxcoder/logs/runs.jsonl` (model, effort, tools, tokens,
  duration, outcome), wired into the CLI run loop. Tests: `tests/core/memory/*`, `tests/core/telemetry/*`.
  Test-harness (item 13) is satisfied by the 195-test suite (classification, effort, routing, tool
  schemas, dangerous-command blocking, JSON recovery, retrieval). Live-validated.

## 6. Target folder structure (delta from today)

```
src/core/{effort,config,router(→ from orchestration),planner,executor,verifier,memory,context,intelligence}/
src/models/adapters/{ollama,openai-compatible}/   # P2
src/tools/{registry,filesystem,shell,git,search}/  # P3 (split from tools.ts)
src/prompts/{planner,executor,critic,verifier,summarizer}/  # P6
src/safety/  src/telemetry/                         # P3/P8
tests/{core,models,tools,safety,prompts}/           # mirrors src/
.maxcoder/{plans,memory,context,logs,evals,config.json}
```

## 7. Modules to create / refactor

- **Create:** effort/*, config (project-local), models/adapters/*, tools/registry+safety, intelligence,
  context-retrieval, prompts/roles, memory, telemetry, intent-router metadata.
- **Refactor (additive, behavior-preserving):** `tools.ts` → registry split + richer `Tool`; `agent/
  index.ts` → constrained ReAct + adapter; `orchestration/router.ts` → general intent router; provider
  call sites → adapter.

## 8. Tests required (mirror `src/`)

Effort profiles & floors, auto-classifier JSON, controller persistence, intent routing, tool schemas,
dangerous-command blocking, invalid-JSON recovery, context retrieval, plan create/execute, diff
verification, prompt regression. All under `tests/`, never beside `src/`.

## 9. Acceptance criteria (from the brief) — tracking

Ollama adapter · effort controller · `/effort auto` · intent router · tool registry w/ schemas ·
plans in `.maxcoder/plans` · memory in `.maxcoder/memory` · repo context retrieval · controlled ReAct ·
critic/verifier · dangerous-command blocking · tests in `./tests` · minimal diffs · usage docs · real
`qwen2.5-coder:3b` examples. **P1 delivers:** effort controller, `/effort auto`, config persistence,
deterministic floors, tests.
```
