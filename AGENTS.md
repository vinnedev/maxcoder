# Max Coder Agent Instructions

## Long-Term Memory

- Before relevant architecture, bug-fix, refactor, tool/router/model-adapter, safety, filesystem, shell, MCP, RAG, or memory decisions, consult the project memory.
- Before changing architecture, read relevant pages in `.maxcoder/memory/wiki/decisions/`.
- Before fixing a bug, read relevant pages in `.maxcoder/memory/wiki/gotchas/`.
- Before running a complex workflow, read relevant pages in `.maxcoder/memory/wiki/procedures/`.
- After learning something durable, propose a small memory entry with evidence.
- Do not save transient errors as permanent rules.
- Do not save secrets, tokens, `.env`, credentials, private keys, or sensitive data.
- Prefer memory that is small, objective, reversible, and backed by session/file/command/test evidence.
- Markdown under `.maxcoder/memory/wiki` is the source of truth; SQLite/FTS indexes are derived and rebuildable.
