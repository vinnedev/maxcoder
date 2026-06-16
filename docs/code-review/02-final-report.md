# 02 — Final Report (Code Review & Refactor — increment 1)

Scope of this increment: the **safe, test-backed** items from `maxcoder/plan.md`. The larger
directory reorg + god-file splits are scoped as the next phase (see "Remaining").

## What changed

| Area | Change | Tests |
| --- | --- | --- |
| **Tests location** | Moved all 4 tests from `src/*.test.ts` → `tests/` mirroring `src/`. Zero tests remain in `src/`. | migrated, green |
| **Error taxonomy** | New `src/shared/errors/` — `AppError` base + `ValidationError`/`ConfigurationError`/`ProviderError`/`ToolExecutionError` + `isAppError`/`toMessage`. | `tests/shared/errors/index.test.ts` (4) |
| **Dedup** | New `src/shared/html/` (`decodeEntities`/`stripTags`); removed the duplicate copies from `websearch/extractor.ts` and `providers/duckduckgo.ts` and wired them to the shared module. | `tests/shared/html/index.test.ts` (3) |
| **Characterization** | New tests pinning current behavior of `session.ts` (record/rehydrate/compaction/pickSession) and `tools.ts` (registry + builtin execution + error handling). | `tests/session.test.ts` (3), `tests/tools.test.ts` (5) |
| **Typecheck setup** | `tsc` was broken (no `bun-types`; globals `fetch`/`URL`/`process`/`AbortSignal` unresolved). Installed `bun-types` (dev), restored `tsconfig` `types: ["bun-types"]`, and `include: ["src","tests"]`. | — |
| **Type fixes** | `mcp.ts` `write()` (narrow `FileSink`, early-return) and `ollama.ts` `listModels` (`res.json()` cast). | — |

## Modules reorganized

- `src/shared/errors/` and `src/shared/html/` created (start of the `shared/` layer from the plan).
- `tests/` now mirrors `src/` (`tests/shared/...`, `tests/websearch/...`, flat tests for flat src).

## Patterns applied

- **Tests in `tests/` mirroring `src/`** (was: alongside src — prohibited). ✅
- **Normalized errors** taxonomy created (wiring into all `throw` sites is staged for next increment).
- **Dedup** of HTML helpers into one module. ✅
- **Early return** applied where touched (`mcp.write`). 
- **Lookup tables** (from the previous task) preserved; no switches in `src/`.
- **Dependency injection for testability**: characterization tests drive `Session`/tools via
  `MAXCODER_CONFIG_DIR` + injected `cwd`/`clock` (no hidden globals in the test path).

## Gates (run at end)

- **Typecheck:** `bunx tsc --noEmit` → **exit 0 (clean)** — previously failing.
- **Tests:** `bun test` → **59 pass / 0 fail** (8 files).
- **Build:** `bun build src/cli.ts --compile` → **OK**.
- **Lint:** none configured. Proposed Biome (not installed without approval); `tsc` is the gate today.

## Behavior preserved

No production behavior changed. The only functional delta is `extractor.decodeEntities` now also
handles `&#x27;` (superset) — covered by tests, strictly additive.

## Remaining (next increments — honest scope)

1. **Directory reorg** into `core/ providers/ sessions/ tools/ ui/ shared/` (moving ~25 existing
   files + fixing imports + tsconfig/build). Largest/riskiest → its own focused step (plan task 9).
2. **Centralize config** (`src/shared/config/`) — 14 `process.env` sites across 8 files still direct.
3. **Wire `AppError`** into the remaining `throw new Error`/`e instanceof Error` sites (use `toMessage`).
4. **Split god files**: `tui.ts` (568) → render/input/completion; `cli.ts` (386) → args/repl/host.
5. **Decompose `ollama.chat()`** (request build / stream / tool-parse / error-map).
6. More characterization tests: `context.compact`, `systemPrompt`, `fetcher`/`extractor`, `mcp`.

## Risks remaining

- The directory reorg will touch many imports + the build entry (`bun build src/cli.ts`) — must be done
  in small per-domain steps with the test suite as the safety net (now stronger).
- Concurrent writer: keep paused during the reorg.

## Rollback

Everything this increment is additive or self-contained: delete `src/shared/*` + the new `tests/*`,
revert the 2 type fixes and `tsconfig`/`package.json` (bun-types). No behavior to roll back.
