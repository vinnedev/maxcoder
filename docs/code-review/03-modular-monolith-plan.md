# 03 — Modular Monolith Reorg Plan (Max Coder)

Goal: reorganize `maxcoder/src` semantically by domain (modular monolith) — e.g. `src/tools/websearch`,
`src/tools/datetime` — without changing behavior. `tests/` mirrors the new `src/` paths.

## Target structure

```
src/
  cli.ts                      # thin entrypoint (arg parse → ui)
  core/
    agent/index.ts            # ← agent.ts
    context/index.ts          # ← context.ts (token + compaction)
    prompt/index.ts           # ← systemPrompt.ts
  providers/
    ollama/index.ts           # ← ollama.ts
  sessions/index.ts           # ← session.ts
  tools/
    registry.ts               # ← Tool interface + registry (split from tools.ts)
    builtins/index.ts         # ← file/shell/grep/list builtins (split from tools.ts)
    datetime/index.ts         # ← datetimeTool.ts
    subagent/index.ts         # ← subagent.ts
    skills/index.ts           # ← skills.ts
    mcp/index.ts              # ← mcp.ts
    websearch/                # ← src/websearch/* (move whole dir)
  ui/
    cli.ts | repl.ts | tui.ts | render.ts | brand.ts   # ← cli/tui/ui/brand split
  shared/
    config/index.ts           # NEW (centralize env)
    errors/index.ts           # ✅ done
    html/index.ts             # ✅ done
    fs/index.ts               # ← fsx.ts
```

## Import-fix strategy (the risky part)

Moving a file changes its **relative** imports. Two classes:
- **Whole-dir move** (`src/websearch` → `src/tools/websearch`): internal imports (`./x`, `./providers/x`)
  stay valid; only imports that point **outside** the dir change (`../tools.ts` → `../../tools/registry.ts`,
  `../shared/html` → `../../shared/html`). And external references to it change
  (`cli.ts: ./websearch/webSearchTool.ts` → `./tools/websearch/...`).
- **Single-file move** (`datetimeTool.ts` → `tools/datetime/index.ts`): fix its own imports + every
  importer (`tools.ts` imports it).

Discipline: **one domain per step**, run `bunx tsc --noEmit` + `bun test` + `bun build` after each, and
update the mirrored test path. `tsc` is the safety net that catches every broken import.

## Order (low → high blast radius)

1. `shared/fs` (move `fsx.ts`; many importers — do with a codemod of `./fsx.ts`).
2. `tools/datetime`, `tools/skills`, `tools/subagent`, `tools/mcp` (few importers each).
3. `tools/websearch` (whole-dir move; fix the ~4 outward imports + cli reference).
4. `tools/registry` + `tools/builtins` (split `tools.ts` — also satisfies SRP / god-file concern).
5. `core/{agent,context,prompt}`, `providers/ollama`, `sessions`.
6. `ui/*` split (`cli.ts`/`tui.ts`/`ui.ts`/`brand.ts`) — largest; do last.
7. Update `tsconfig`/`package.json` build entry if `cli.ts` moves.

## Why incremental (not big-bang)

A single mega-move of ~25 files + ~120 import edits is unverifiable in one shot and conflicts with any
concurrent writer. Per-domain steps keep the build green continuously (tests + tsc as the gate) and each
step is independently revertible.

## Acceptance per step

`bunx tsc --noEmit` clean · `bun test` green · `bun build src/<entry>.ts --compile` OK · tool registry
unchanged (`doctor` shows same tools) · Codex cross-check on the moved domain.

## Risk / rollback

- Risk: a missed import → `tsc` catches it immediately (now that typecheck is wired).
- Rollback: each domain move is one logical step; revert that step's file moves + import edits.
