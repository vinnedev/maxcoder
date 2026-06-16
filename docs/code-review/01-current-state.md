# 01 — Current State Analysis (Max Coder)

Scope: the **`maxcoder/`** project (the runnable product). The leaked `src/` at repo root is
reference-only and out of scope. All findings are from reading the current code (line counts measured).

## ⚠️ Blocker before any large refactor

A **concurrent automated writer** is actively rewriting files in this session (observed: `cli.ts`,
`ui.ts`, `tui.ts`, `fsx.ts`, `session.ts`, `brand.ts`, `tsconfig.json`, `package.json`, and it once
**deleted** `websearch/{config,types,guardrails}.ts` mid-build). A structural refactor (moving files
into modules) **will conflict** with it and can cause regressions — which violates the "don't change
behavior" rule. **This writer must be paused before executing the directory reorg.** Test-relocation,
config centralization, and error normalization are lower-conflict and can start first.

## Current structure (`maxcoder/src/`)

```
src/
  cli.ts (386)         entrypoint: arg parse, REPL, TUI wiring, slash dispatch, shell `!` cmd
  tui.ts (568)         full-screen TUI (render, input, mouse, copy-mode, completion) — GOD FILE
  ui.ts (255)          formatters, status line, badges, diff coloring, help
  agent.ts (155)       the agentic loop
  ollama.ts (188)      Ollama client: chat(), streaming, native + emulated tool parsing, listModels
  tools.ts (235)       Tool interface + registry + 7 builtins (incl. datetime stub wiring)
  datetimeTool.ts(183) date/time + date math (OPERATIONS lookup table)
  session.ts (180)     JSONL session persistence (+ pickSession, cleanOldSessions)
  context.ts (85)      token estimation + auto-compaction
  systemPrompt.ts(113) layered system prompt assembly
  skills.ts (79)       markdown skills + frontmatter parser
  subagent.ts (73)     `task` tool + custom agent types
  mcp.ts (144)         MCP stdio client
  config.ts (51)       paths, ids, git helpers
  fsx.ts (95)          Bun-native fs/process helpers
  brand.ts (80)        name/colors/logo/banner
  websearch/           ★ already well-modularized (the model to follow)
    webSearchTool.ts (204) orchestrator + registration
    guardrails.ts (194)    input validation + SSRF + schema
    ranker.ts (151)        ranking + dedupe
    fetcher.ts (118)       SSRF-hardened fetch
    extractor.ts (79), injection.ts (49), cache.ts (61), citations.ts (14),
    resilience.ts (61), telemetry.ts (37), types.ts (82), config.ts (49)
    providers/ {index,mock,searxng,duckduckgo}.ts
  *.test.ts            ❌ 4 tests living ALONGSIDE src (see Problem #1)
```

## Principal modules (by domain)

| Domain | Files | Notes |
| --- | --- | --- |
| **Agent core** | `agent.ts`, `context.ts`, `systemPrompt.ts` | loop + context mgmt + prompt |
| **Model provider** | `ollama.ts` | only one provider; `chat()` does a lot |
| **Sessions** | `session.ts` | JSONL persistence; cohesive |
| **Tools** | `tools.ts`, `datetimeTool.ts`, `subagent.ts`, `skills.ts`, `mcp.ts`, `websearch/*` | registry + builtins + dynamic |
| **UI** | `cli.ts`, `tui.ts`, `ui.ts`, `brand.ts` | entrypoint + rendering |
| **Infra** | `config.ts`, `fsx.ts` | paths, fs, process |

## Problems found

1. **Tests alongside production code** (`src/core.test.ts`, `src/datetime.test.ts`,
   `src/ollama.test.ts`, `src/websearch/websearch.test.ts`). Violates the required `tests/` mirror
   convention. **Highest-priority structural fix.**
2. **Config not centralized**: `process.env` read in **8 files / 14 sites** (`tui.ts`, `mcp.ts`,
   `cli.ts`, `fsx.ts`, `ollama.ts`, `datetimeTool.ts`, `config.ts`, `websearch/config.ts`). Two separate
   config modules. No single typed config surface (`shared/config`).
3. **No normalized error taxonomy**: 8 `throw new Error(...)`, only 1 custom class
   (`FetchBlockedError`). Missing `ValidationError`, `ProviderError`, `ToolExecutionError`,
   `ConfigurationError`. Errors are stringly-handled (`e instanceof Error ? e.message : …` repeated).
4. **Duplication**: `stripTags` + `decodeEntities` exist in **both** `websearch/extractor.ts` and
   `websearch/providers/duckduckgo.ts`. Repeated `e instanceof Error ? e.message : String(e)` idiom
   across files. Spinner/ANSI constants partly duplicated.
5. **God files / low cohesion**:
   - `tui.ts` (568): rendering + input parsing + completion + mouse + copy-mode + history in one class.
   - `cli.ts` (386): arg parsing + REPL + TUI host + slash table + shell command + status — mixes
     orchestration with presentation.
   - `ollama.ts` `chat()`: builds request + streams + accumulates + native/emulated tool parsing +
     error mapping in one function (multiple responsibilities).
6. **Coupling points**:
   - Tools call `process.cwd()`/env directly instead of receiving from `ToolContext`/config.
   - `cli.ts` imports from ~12 modules (hub); UI rendering coupled to agent event shapes.
   - `tools.ts` mixes the `Tool` interface, the registry singleton, and concrete builtins (3 concerns).
7. **Testability gaps (no tests)**: `agent.ts` (loop, loop-guard, subagent recursion), `ollama.ts`
   (`parseEmulatedToolCalls` has tests via core.test? partial), `session.ts` (persist/rehydrate/
   pickSession/cleanOldSessions), `context.ts` (compaction), `systemPrompt.ts`, `mcp.ts`,
   `fetcher.ts`/`extractor.ts`, `skills.ts`/`subagent.ts` frontmatter, `tui.ts` pure helpers
   (`completeInput` tested; render/wrap not). Web-search has good coverage; the **core agent path does
   not**.
8. **Typing**: mostly strong, but some `any`/`as` casts (e.g. `args as Parameters<…>[0]`, event
   narrowing via `as Extract<…>`), and `Record<string, unknown>` tool args without per-tool schemas.
9. **Switch/case**: already addressed last task (all 5 → lookup tables). ✔ No action needed.
10. **`process.cwd()` as hidden global**: read in several tools/config functions → hard to test in
    isolation; should be injected.

## Most critical files (change carefully)

- `cli.ts`, `tui.ts` — entrypoint + UI; **actively rewritten by the concurrent writer** → highest
  regression risk.
- `agent.ts` — the loop; behavior-critical, **untested** → must get tests *before* any refactor (TDD).
- `tools.ts` — registry powering everything.
- `ollama.ts` — the only model path.

## Regression risks

- Moving files breaks the **many relative imports** (`./x.ts`) + tsconfig `include`; the compiled
  binary (`bun build src/cli.ts`) and Bun's test discovery must keep working.
- The **concurrent writer** clobbering refactors mid-flight (top risk).
- Auto-compaction / session rehydrate / streaming tool parsing are subtle and untested → easy to break
  silently. TDD (characterization tests first) is mandatory here.

## What is already good (preserve / use as the model)

- `websearch/` is cleanly modular (schema/guardrails/provider/ranker/service split) — the target shape
  for the rest.
- Switches already converted to lookup tables; `datetimeTool` operations are a clean dispatch table.
- Bun-native I/O isolated in `fsx.ts`.
