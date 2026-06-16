# Max Coder — Roadmap to "Claude Code level"

Tracking the build-out requested: robust sessions, full context management, real system prompts,
agents/skills/tools/MCP (create + customize), and a Claude-Code/opencode-style UI.

Legend: ✅ done · 🟡 partial/minimal · ⬜ planned

## v0.2 — Foundation (this milestone)

- ✅ **M1 Session management** — JSONL transcripts per project, `sessionId`, append-only persistence,
  `--resume` (latest / pick), `--continue`, list sessions, `/sessions` `/resume` slash commands.
  Model: `src/session.ts`. Mirrors `src/utils/sessionStorage.ts` (simplified, robust).
- ✅ **M2 Context management** — token estimation, context-window tracking, **auto-compaction**
  (LLM summary of old turns) near the limit, continuous REPL history. Model: `src/context.ts`.
  Mirrors `src/services/compact/*` + `src/query/tokenBudget.ts`.
- ✅ **M3 System prompts** — layered prompt (identity · environment · behavior · tools · project
  memory from `MAXCODER.md`/`AGENTS.md`/`CLAUDE.md` cwd-walk), assembled per turn. Model:
  `src/systemPrompt.ts`. Mirrors `src/context.ts` + `src/utils/api.ts` prompt assembly.
- ✅ **M4 Extensible registry** — a `Tool` interface + registry so tools/skills/agents/MCP all plug
  in uniformly (the "create + customize" backbone). Model: `src/tools.ts`, `src/registry.ts`.
- ✅ **M5 Agents (subagents)** — a `task` tool that spawns a focused nested agent with its own
  context + restricted tools. Custom agent types from `~/.maxcoder/agents/*.md`. Model: `src/subagent.ts`.
- ✅ **M6 Skills** — load `~/.maxcoder/skills/*.md` (frontmatter + body); a `skill` tool injects them.
  Model: `src/skills.ts`. Mirrors `src/skills/*`.
- ✅ **M7 UI/UX upgrade** — banner, live status line (model · context % · tokens · session · git),
  slash commands (`/help /model /clear /compact /sessions /resume /tools /skills /agents /cost`),
  boxed tool rendering, streaming output. ANSI (no Ink dependency). Model: `src/ui.ts`.

## v0.3 — MCP + customization depth

- 🟡 **M8 MCP client** — stdio JSON-RPC client; `~/.maxcoder/mcp.json` config; discover + wrap MCP
  tools into the registry (`mcp__server__tool`). Minimal working client this milestone; elicitation,
  resources, SSE/HTTP transports next. Model: `src/mcp.ts`. Mirrors `src/services/mcp/*`.
- ⬜ **M9 Permissions** — allow/deny/ask rules, per-tool, persisted in settings; replace the simple
  y/N confirm. Mirrors `src/utils/permissions/*`.
- ⬜ **M10 Custom tools** — user-defined tools via a manifest (command-backed) loaded from
  `~/.maxcoder/tools/*.json`. Safe execution + schema validation.

## v0.4 — Rich TUI (opencode/Claude-Code-style)

- ⬜ **M11 Full-screen TUI** — alternate screen, scrollback, message list, input box with history,
  spinners, diff rendering, keybindings. Likely needs a TUI lib or a focused ANSI renderer
  (the leak uses a custom Ink; opencode uses a Go TUI). Scoped as its own milestone.

## v0.5 — Provider breadth

- ⬜ **M12 OpenAI-compatible provider** (OpenAI/Groq/OpenRouter/LM Studio/MLX) — reuse the adapter
  design in `docs/09`. Multi-provider selection + per-model capabilities.

---

### What "Claude Code level" means here vs. what we simplify

We match the **behavior and shape** of Claude Code's subsystems (JSONL sessions, auto-compaction,
layered prompts, native+emulated tool calling, MCP, subagents, skills) with clean, dependency-light
code. We intentionally **do not** replicate cloud-only concerns (OAuth, Statsig/growthbook flags,
billing/telemetry, Bedrock/Vertex/Foundry, prompt-cache breakpoints) — those are Anthropic-infra
specific and irrelevant to a local-first agent.
