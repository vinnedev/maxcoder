# 01 — Project Tooling Map (Phase 1)

How Max Coder's tool system works and the safest place to add `web_search`.

## Stack

- **Language/runtime:** TypeScript on **Bun** (zero-dep, Bun-native I/O). Compiles to a single binary.
- **Agent:** `maxcoder/src/agent.ts` (`runAgent`) — model → tool calls → tool results → loop.
- **Model backend:** local **Ollama** via `maxcoder/src/ollama.ts` (native + emulated tool calling).

## Current tool flow

```
runAgent (agent.ts)
  → chat({ model, messages, tools: toolDefs(p.tools) })        ollama.ts
  → model returns tool_calls (native) or text → parseEmulatedToolCalls (fallback)
  → for each call: executeTool(name, args, ctx)                 tools.ts
  → tool.run(args, ctx) returns a STRING (the tool_result)
  → pushed as { role: 'tool', content: <string> } into messages
  → persisted to the JSONL session                              session.ts
```

## Where tools are registered

`maxcoder/src/tools.ts` — a uniform registry:

- `interface Tool { name; description; parameters /* JSON Schema */; mutating; source; run(args, ctx) }`
- `registerTool(t)` / `allTools()` / `toolDefs()` (schema sent to the model) / `executeTool()`.
- `ToolContext { cwd; model; signal?; depth; runSubAgent? }`.
- Sources today: `builtin` (read/write/edit/list/grep/run_bash), `skill`, `agent` (task), `mcp`.
- Registration happens in `maxcoder/src/cli.ts → initRegistry()` at startup.

So **the registry is the extension point** — `web_search` registers exactly like any other tool, with
a JSON-schema `parameters` and a `run()` returning a string (we return structured JSON as a string).

## Tool schema / result format

- Schema: plain JSON Schema object on `tool.parameters` (no Zod). Already supports `strict`-style shapes.
- Result: a **string** tool_result. `web_search` returns a JSON string (structured result), which the
  model reads as data — never as instructions.

## Config, logs, tests

- **Config:** env vars + `maxcoder/src/config.ts` (paths under `~/.maxcoder`). We add `WEB_SEARCH_*`.
- **Logs:** stderr (debug-gated). We add a redacting `WebSearchTelemetry`.
- **Tests:** `bun test` with `*.test.ts` next to sources. We add `src/websearch/*.test.ts` + fixtures
  under `maxcoder/tests/fixtures/websearch/`.
- **MCP/registry/adapter:** yes — registry (tools.ts) + MCP client (mcp.ts). `web_search` uses the
  registry; its `SearchProvider` is its own adapter layer (mock / SearxNG / generic HTTP).

## Risks / safest path

- **Risk:** a tool that fetches the web introduces SSRF, prompt-injection, and data-exfil surface.
- **Safest path:** keep `web_search` **off by default** (`WEB_SEARCH_ENABLED` gate), implement it in
  isolated layers under `src/websearch/`, never couple to Ollama, treat all web content as untrusted
  **data**, and register it only when enabled. Nothing in the current agent changes when it's off.

## Extension points used

| Need | Hook |
| --- | --- |
| Register the tool | `registerTool()` in `tools.ts`, called from `initRegistry()` (`cli.ts`) |
| Send schema to model | `toolDefs()` (already) |
| Return result to context | `tool.run()` returns string → `{role:'tool'}` message (already) |
| Per-provider search | new `SearchProvider` adapter (`src/websearch/providers/*`) |
| Config | `WEB_SEARCH_*` env via `src/websearch/config.ts` |
