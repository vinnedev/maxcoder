# Max Coder (`maxcoder/`)

The Max Coder CLI — a local-first AI coding agent. Zero runtime dependencies; built and compiled with
[Bun](https://bun.sh).

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

## Layout

| File | Role |
| --- | --- |
| `src/cli.ts` | entrypoint — arg parsing, banner, one-shot + REPL, doctor |
| `src/agent.ts` | the agentic loop + system prompt + loop guard |
| `src/ollama.ts` | Ollama `/api/chat` client: streaming, native + emulated tool calls |
| `src/tools.ts` | built-in tools (read/write/edit/list/grep/bash) |
| `src/brand.ts` | name/version/ANSI helpers |
| `src/ollama.test.ts` | unit tests for the emulated-tool-call parser (`bun test`) |

## How tool calling works

1. Tools are sent to Ollama in its native `tools` format.
2. If the model returns native `message.tool_calls`, those are used directly.
3. If not (common for small models that emit the call as text), `parseEmulatedToolCalls()` recovers
   the call from `<tool_call>{…}</tool_call>`, fenced ```json blocks, or a bare JSON object.

This mirrors the capability-detection / emulation strategy documented in
[`../docs/07-ollama-adapter-plan.md`](../docs/07-ollama-adapter-plan.md).

## Notes

- Mutating tools (`write_file`, `edit_file`, `run_bash`) run automatically in one-shot mode and prompt
  for confirmation in the REPL unless `--yolo` / `MAXCODER_YOLO=1`.
- Pick a capable model for real work: `--model qwen2.5-coder:7b`.
