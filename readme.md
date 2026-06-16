# Max Coder (`maxcoder/`)

The Max Coder CLI — a local-first AI coding agent. Zero runtime dependencies; built and compiled with
[Bun](https://bun.sh).

> **New to Max Coder?** Start with [Developer Quick Start](./docs/quickstart.md) for a fast introduction.

## Run from source

```bash
bun run src/cli.ts doctor
bun run src/cli.ts "list the files here and summarize the project"
```

## Build a standalone binary

```bash
bun run build                 # -> dist/maxcoder (no Bun needed to run it)
./dist/maxcoder --version
```

## Documentation

**📖 Start here:**
- [**Developer Quick Start**](./docs/quickstart.md) — 5-minute overview and common tasks (recommended)
- [**Documentation Index**](./docs/index.md) — Navigation guide for all documentation

**📊 System Design:**
- [**Architecture Overview**](./docs/architecture.md) — High-level system design with Mermaid diagrams
- [**Module Documentation**](./docs/modules.md) — Overview of all modules organized by function

### 🔧 Core Modules
- [**Agent Loop**](./docs/modules/agent.md) — Main reasoning loop (think → act → observe)
- [**Context Management**](./docs/modules/context.md) — Token counting and auto-compaction
- [**Sessions**](./docs/modules/sessions.md) — JSONL-based conversation persistence and resumption
- [**System Prompt**](./docs/modules/prompt.md) — Layered prompt assembly from multiple sources

### 🎯 Orchestration & Task Management
- [**Orchestration System**](./docs/modules/orchestration.md) — Request routing, planning, and scheduling
- [**Queue & Tasks**](./docs/modules/queue-tasks.md) — Task queuing and execution management

### 🛠️ Tools & Integrations
- [**Tools System**](./docs/modules/tools.md) — Tool registry and execution framework
- [**WebSearch Integration**](./docs/modules/websearch.md) — Multi-provider web search with guardrails
- [**Ollama Provider**](./docs/modules/ollama.md) — Local LLM integration (streaming, tool calling)

### 💻 User Interface & Shared Utilities
- [**CLI & UI**](./docs/modules/ui.md) — Terminal interface, commands, and rendering
- [**Shared Utilities**](./docs/modules/shared.md) — Configuration, error handling, async utilities

---

## Quick Reference

### Layout

| Directory | Purpose |
| --- | --- |
| `src/core/` | Agent loop, context, sessions, prompts, orchestration |
| `src/tools/` | WebSearch, Subagent, Skills, MCP, DateTime |
| `src/providers/` | Ollama and other LLM providers |
| `src/ui/` | CLI, TUI, branding, UI utilities |
| `src/shared/` | Configuration, errors, async, fs, html utilities |
| `tests/` | Unit and integration tests (mirrors `src/` structure) |
| `docs/` | System design documentation with Mermaid diagrams |

### How Tool Calling Works

1. Tools are sent to Ollama in its native `tools` format.
2. If the model returns native `message.tool_calls`, those are used directly.
3. If not (common for small models that emit the call as text), emulated tool calling recovers
   the call from `<tool_call>{…}</tool_call>`, fenced ```json blocks, or a bare JSON object.

**See**: [Ollama Provider](./docs/modules/ollama.md#tool-calling-support)

### Configuration

Max Coder uses a hierarchical configuration system (CLI flags override environment variables override config files):

```bash
# Using CLI flags
maxcoder --model qwen2.5-coder:7b --temperature 0.7 "query"

# Using environment variables
MAXCODER_MODEL=qwen2.5-coder:7b MAXCODER_TEMPERATURE=0.7 maxcoder "query"

# Using config file (~/.maxcoder/config.json)
{
  "agent": {
    "model": "qwen2.5-coder:7b",
    "temperature": 0.7
  }
}
```

**See**: [Configuration Module](./docs/modules/shared.md#configuration-module)

### Slash Commands (REPL Mode)

```
/help              Show available commands
/model LIST        List available models
/model USE <name>  Switch model
/clear             Clear context
/sessions          List sessions
/resume [ID]       Resume session
/continue <q>      Continue session with query
/cost              Show session cost estimate
/tools             List available tools
/skills            List available skills
/exit              Exit REPL
```

**See**: [CLI & UI](./docs/modules/ui.md#slash-commands)

## Notes

- Mutating tools (`write_file`, `edit_file`, `bash`) run automatically in one-shot mode and prompt
  for confirmation in the REPL unless `--yolo` / `MAXCODER_YOLO=1`.
- Pick a capable model for real work: `--model qwen2.5-coder:7b`.
- Sessions are auto-saved to `~/.maxcoder/sessions/` in JSONL format.
- Use `--resume` to continue a previous session.
- Enable debug logging with `--debug agent,context,websearch` for development.
