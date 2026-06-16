# Max Coder — Module Documentation

Complete reference for all system modules organized by functional area.

## 📑 Table of Contents

- [Core Agent System](#core-agent-system)
- [Orchestration & Planning](#orchestration--planning)
- [Task Management](#task-management)
- [Tools & Integrations](#tools--integrations)
- [Providers](#providers)
- [User Interface](#user-interface)
- [Shared Utilities](#shared-utilities)

---

## Core Agent System

### `core/agent/` — The Agentic Loop

**Purpose**: Implements the main reasoning loop that processes user queries and generates responses.

**Key Responsibilities**:
- Manage the main agent loop (think → decide → act → observe → repeat)
- Call LLM provider with proper tool definitions
- Handle tool execution and result processing
- Manage loop guards and safety limits
- Stream responses to user

**Entry Point**: `src/core/agent/index.ts`

**Interfaces**:
```typescript
interface Agent {
  run(query: string): Promise<void>
  execute(tool: ToolCall): Promise<ToolResult>
  updateContext(turn: Turn): void
  canContinue(): boolean  // Loop guard
}
```

**See**: [Agent Loop Documentation](./modules/agent.md)

---

### `core/context/` — Context & Token Management

**Purpose**: Manages conversation context, token counting, and memory compaction.

**Key Responsibilities**:
- Track token usage and budget
- Implement auto-compaction when approaching token limit
- Maintain message history
- Estimate cost of operations
- Coordinate with session for persistence

**Entry Point**: `src/core/context/index.ts`

**Capabilities**:
- Token counting for different models
- Automatic LLM-based summarization of old turns
- Context window awareness
- Streaming output token estimation

**See**: [Context Management Documentation](./modules/context.md)

---

### `core/sessions/` — Session Persistence

**Purpose**: Manages conversation history with JSONL-based persistence.

**Key Responsibilities**:
- Create and maintain session files (JSONL format)
- Load session history from disk
- Append new turns to session
- Resume and continue sessions
- Session discovery and listing

**Entry Point**: `src/sessions/index.ts`

**Format**: 
```jsonl
{"role":"user","content":"query","timestamp":"2024-01-01T00:00:00Z","toolCalls":[]}
{"role":"assistant","content":"response","timestamp":"2024-01-01T00:00:01Z"}
```

**See**: [Sessions Documentation](./modules/sessions.md)

---

### `core/prompt/` — System Prompt Assembly

**Purpose**: Assembles layered system prompts from multiple sources.

**Key Responsibilities**:
- Combine identity, environment, and behavior layers
- Load project memory from `maxcoder.md`, `agents.md`, `claude.md`
- Inject tool definitions and descriptions
- Load skill definitions dynamically
- Respect role-based customization

**Entry Point**: `src/core/prompt/index.ts`

**Prompt Layers**:
1. **Identity**: Who the agent is
2. **Environment**: System information and capabilities
3. **Behavior**: How to behave in different scenarios
4. **Tools**: Available tool definitions
5. **Memory**: Project-specific context

**See**: [System Prompt Documentation](./modules/prompt.md)

---

## Orchestration & Planning

### `core/orchestration/` — Request Routing & Scheduling

**Purpose**: Routes requests, analyzes complexity, plans tasks, and schedules execution.

**Modules**:

#### `orchestrator.ts` — Main Orchestrator
- Coordinates router, planner, and scheduler
- Manages overall request flow
- Handles error recovery

#### `router.ts` — Request Router
- Analyzes incoming requests
- Routes to appropriate handler
- Detects command vs. query

#### `planner.ts` — Task Planner
- Breaks down complex requests into subtasks
- Estimates required tools and resources
- Determines execution strategy

#### `scheduler.ts` — Task Scheduler
- Determines optimal execution order
- Handles dependencies
- Manages parallelization

#### `complexity.ts` — Complexity Analyzer
- Analyzes task complexity level
- Determines resource requirements
- Selects appropriate strategies

#### `roles.ts` — Role Management
- Defines agent roles and capabilities
- Role-based prompt selection
- Permission validation

**See**: [Orchestration Documentation](./modules/orchestration.md)

---

## Task Management

### `core/queue/` — Task Queue & Execution

**Purpose**: Manages asynchronous task queuing and execution.

**Modules**:

#### `index.ts` — Queue Manager
- Maintains task queue
- Task priority management
- Queue state tracking

#### `runner.ts` — Queue Runner
- Executes queued tasks sequentially
- Handles backpressure
- Reports execution status

**Features**:
- FIFO queue with priority support
- Async task execution
- Error handling and retry logic
- Progress reporting

**See**: [Queue Documentation](./modules/queue-tasks.md)

---

### `core/tasks/` — Task Management

**Purpose**: Creates, manages, and executes individual tasks.

**Modules**:

#### `manager.ts` — Task Manager
- Creates tasks from requests
- Tracks task state
- Manages task lifecycle

#### `runner.ts` — Task Runner
- Executes individual tasks
- Spawns agents for task execution
- Handles task-level errors
- Returns results

**Task Structure**:
```typescript
interface Task {
  id: string
  type: 'query' | 'skill' | 'subagent' | 'tool'
  query: string
  priority: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  context: TaskContext
  result?: any
}
```

**See**: [Tasks Documentation](./modules/queue-tasks.md)

---

## Tools & Integrations

### `src/tools.ts` — Tool Registry

**Purpose**: Central registry for all available tools.

**Key Responsibilities**:
- Register tools and skills
- Tool discovery and listing
- Tool validation and execution coordination
- Schema generation for LLM

**Tool Types**:
- **Built-in**: datetime, filesystem, bash
- **Web**: WebSearch
- **Extensible**: Skills, Subagent, MCP

**See**: [Tools Registry Documentation](./modules/tools.md)

---

### `tools/websearch/` — Web Search Integration

**Purpose**: Provides web search capabilities with multiple providers.

**Features**:
- Multiple provider support (DuckDuckGo, Searxng, Mock)
- Result ranking and filtering
- Citation tracking
- Security/guardrails validation
- Prompt injection detection
- Result caching

**Architecture**:
```
websearch/
├── webSearchTool.ts      # Main tool interface
├── fetcher.ts            # HTTP fetching
├── extractor.ts          # Result extraction
├── ranker.ts             # Result ranking
├── citator.ts            # Citation handling
├── guardrails.ts         # Safety checks
├── injection.ts          # Prompt injection detection
├── cache.ts              # Caching layer
├── config.ts             # Configuration
├── providers/            # Provider implementations
│   ├── duckduckgo.ts
│   ├── searxng.ts
│   └── mock.ts
```

**See**: [WebSearch Documentation](./modules/websearch.md)

---

### `tools/subagent/` — Subagent Tool

**Purpose**: Spawns focused child agents for subtask execution.

**Key Responsibilities**:
- Create isolated agent instances
- Pass restricted tool context
- Manage agent lifecycle
- Collect and return results

**Features**:
- Resource isolation
- Tool filtering
- Context reduction
- Error boundary

**See**: [Subagent Documentation](./modules/tools.md#subagent-tool)

---

### `tools/skills/` — Skills System

**Purpose**: Loads and manages custom behaviors from markdown files.

**Format**:
```markdown
---
name: skill-name
description: What this skill does
tools: [list, of, tools]
---

# Behavior Instructions
Instructions on how to use this skill...
```

**Loading**:
- From `~/.maxcoder/skills/*.md`
- From project `.maxcoder/skills/*.md`
- Frontmatter parsing (name, description, tools list)

**See**: [Skills Documentation](./modules/tools.md#skills-tool)

---

### `tools/mcp/` — MCP Client

**Purpose**: Model Context Protocol client for standard server communication.

**Key Responsibilities**:
- JSON-RPC 2.0 over stdio
- Tool discovery and wrapping
- MCP server lifecycle management
- Configuration from `~/.maxcoder/mcp.json`

**Features**:
- Server process management
- Tool schema translation
- Error handling and recovery
- Telemetry integration

**See**: [MCP Documentation](./modules/tools.md#mcp-tool)

---

### `tools/datetime/` — DateTime Tool

**Purpose**: Provides current date/time information to agent.

**Capabilities**:
- Get current date and time
- Format customization
- Timezone support
- Relative time calculations

---

## Providers

### `providers/ollama/` — Ollama LLM Provider

**Purpose**: Integration with Ollama for local LLM inference.

**Key Responsibilities**:
- Streaming chat API calls
- Tool call handling (native + emulated)
- Model capability detection
- Error recovery and retry

**Architecture**:
- Native tool calling for capable models
- Emulated tool calling for text-based models
- Tool call extraction from multiple formats
  - `<tool_call>{...}</tool_call>` tags
  - Markdown JSON blocks
  - Bare JSON objects

**See**: [Ollama Provider Documentation](./modules/ollama.md)

---

## User Interface

### `src/ui/` — User Interface Layer

**Modules**:

#### `cli.ts` — CLI Entry Point
- Argument parsing
- REPL loop
- One-shot mode
- `doctor` command
- Help and version display

#### `tui.ts` — Terminal UI
- Status display
- Progress rendering
- Message formatting
- Boxed output
- Streaming rendering

#### `ui.ts` — Utilities
- ANSI formatting
- Spinner animations
- Table rendering
- Input prompting

#### `brand.ts` — Branding
- Application name and version
- Banner rendering
- Color scheme
- Logo

**See**: [UI Documentation](./modules/ui.md)

---

## Shared Utilities

### `shared/config/` — Configuration Management

**Purpose**: Centralized, typed configuration from all sources.

**Features**:
- Environment variable loading
- CLI flag parsing
- Config file resolution
- Type-safe defaults
- Validation

**Priority Order**:
1. CLI flags (highest)
2. Environment variables
3. Project config (`.maxcoder/`)
4. User config (`~/.maxcoder/`)
5. Defaults (lowest)

**See**: [Configuration Documentation](./modules/shared.md#configuration-module)

---

### `shared/errors/` — Error Handling

**Purpose**: Normalized error types and handling.

**Error Types**:
- `ValidationError` — Input validation failed
- `ProviderError` — LLM provider error
- `ToolExecutionError` — Tool call failed
- `ConfigurationError` — Config/setup issue
- `SessionError` — Session persistence issue

**Features**:
- Structured error context
- Stack trace preservation
- Error recovery suggestions
- User-friendly messages

**See**: [Error Handling Documentation](./modules/shared.md#error-handling-module)

---

### `shared/async/` — Async Utilities

**Purpose**: Async/concurrency helpers.

**Utilities**:
- `Semaphore` — Rate limiting and concurrency control
- `Backoff` — Exponential backoff retry
- `Timeout` — Promise timeout wrapper
- `Pool` — Worker pool for parallel execution

**See**: [Async Utilities Documentation](./modules/shared.md#async-utilities-module)

---

### `shared/fs/` — File System Utilities

**Purpose**: File system operations with safety checks.

**Utilities**:
- Safe file reading (with path validation)
- Safe file writing (with backup)
- Directory traversal (with symlink detection)
- Config file discovery
- Gitignore-aware filtering

**See**: [File System Documentation](./modules/shared.md#file-system-module)

---

### `shared/html/` — HTML Processing

**Purpose**: HTML parsing and text extraction.

**Utilities**:
- HTML entity decoding
- HTML tag stripping
- Text node extraction
- Link extraction
- Metadata parsing

**See**: [HTML Utilities Documentation](./modules/shared.md#html-utilities-module)

---

## Module Interaction Patterns

### Pattern 1: Request Processing Flow
```
CLI Input → Router → Planner → Scheduler → Queue → Agent → Tools → LLM → Response
```

### Pattern 2: Context Refresh
```
Session Load → Context Manager → Token Count → Check Compaction → Compact if needed
```

### Pattern 3: Tool Execution
```
Tool Call → Registry Lookup → Execution → Error Handling → Return Result
```

### Pattern 4: Provider Adaptation
```
Tool Definition → Provider Format → LLM Call → Response Parse → Native/Emulated Handler
```

---

## Cross-Module Dependencies

**Strictly One-Directional**:
- Higher layers depend on lower layers only
- No circular dependencies
- Clear inversion of control via interfaces

**Dependency Layers** (top to bottom):
1. CLI/UI
2. Orchestration
3. Agent Core
4. Tools & Sessions
5. Providers
6. Shared Utilities

---

## Module Testing

Each module has corresponding tests in `tests/`:
- Unit tests for isolated functionality
- Integration tests for interaction patterns
- Fixture-based tests for WebSearch providers
- Mock provider for testing tool calling

**Running Tests**:
```bash
bun test
```

---

## Configuration per Module

Each module respects the configuration hierarchy:

```
environment → CLI flags → project config → user config → defaults
```

Module-specific config lives in:
- `~/.maxcoder/config.json` — Global config
- `.maxcoder/config.json` — Project config
- `~/.maxcoder/mcp.json` — MCP server config
- Environment variables — Runtime overrides

---

## Performance Characteristics

| Module | Complexity | Latency | Memory | Notes |
|--------|-----------|---------|--------|-------|
| Router | O(n tools) | <1ms | minimal | Hash lookup |
| Planner | O(n tasks) | <10ms | task plan size | Dependency analysis |
| Context | O(n tokens) | <100ms | token count | Compaction may require LLM call |
| Agent Loop | O(turns) | 100ms-1s | growing | Per-turn overhead |
| WebSearch | I/O bound | 500ms-5s | result count | Network dependent |
| MCP Client | Protocol overhead | 100ms+ | MCP server size | Process communication |

---

## See Also

- [System Architecture](./architecture.md) — High-level system design
- Individual module documentation in `./modules/`
- [README](../readme.md) — Quick start and overview
