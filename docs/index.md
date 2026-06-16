# Documentation Index

Welcome to the Max Coder system documentation! This index helps you navigate the complete system design.

## 📚 Documentation Structure

### Quick Start
- **[README](../readme.md)** — Quick start, build instructions, basic usage
- **[Architecture Overview](./architecture.md)** — System design, layer overview, data flow

### Deep Dives

#### Core Agent System
The heart of Max Coder - how queries become actions:
1. [Agent Loop](./modules/agent.md) — Where reasoning happens
2. [Context Management](./modules/context.md) — Memory and token management
3. [Sessions](./modules/sessions.md) — Conversation persistence
4. [System Prompt](./modules/prompt.md) — Instruction assembly

#### Orchestration & Planning
How requests flow through the system:
- [Orchestration System](./modules/orchestration.md) — Router, planner, scheduler
- [Queue & Tasks](./modules/queue-tasks.md) — Task execution

#### Tools & Extensions
What the agent can do:
- [Tools System](./modules/tools.md) — Tool registry, built-in tools
- [WebSearch](./modules/websearch.md) — Internet access with security
- [Ollama Provider](./modules/ollama.md) — LLM integration

#### User Interface
How you interact with Max Coder:
- [CLI & UI](./modules/ui.md) — Commands, REPL, terminal rendering

#### Foundation
Utilities used everywhere:
- [Shared Utilities](./modules/shared.md) — Config, errors, async, file system

### Reference
- [Module Documentation Index](./modules.md) — Organized by functional area

---

## 🗺️ Finding What You Need

### By Task

**I want to understand how...**

| Question | Read |
|----------|------|
| The overall system works | [Architecture](./architecture.md) + [Modules](./modules.md) |
| A user query becomes a result | [Agent Loop](./modules/agent.md) + [Orchestration](./modules/orchestration.md) |
| Sessions and resumption work | [Sessions](./modules/sessions.md) + [Context](./modules/context.md) |
| Tools are executed | [Tools System](./modules/tools.md) + [Agent Loop](./modules/agent.md) |
| Web search works | [WebSearch](./modules/websearch.md) |
| The CLI works | [CLI & UI](./modules/ui.md) |
| Configuration works | [Shared Utilities](./modules/shared.md#configuration-module) |
| Error handling works | [Shared Utilities](./modules/shared.md#error-handling-module) |

### By Module

| Module | Purpose | Documentation |
|--------|---------|---|
| **core/agent** | Reasoning loop | [Agent Loop](./modules/agent.md) |
| **core/context** | Memory management | [Context](./modules/context.md) |
| **core/sessions** | Persistence | [Sessions](./modules/sessions.md) |
| **core/prompt** | Instruction assembly | [System Prompt](./modules/prompt.md) |
| **core/orchestration** | Request routing | [Orchestration](./modules/orchestration.md) |
| **core/queue** | Task queuing | [Queue & Tasks](./modules/queue-tasks.md) |
| **core/tasks** | Task execution | [Queue & Tasks](./modules/queue-tasks.md) |
| **src/tools** | Tool registry | [Tools System](./modules/tools.md) |
| **tools/websearch** | Web search | [WebSearch](./modules/websearch.md) |
| **providers/ollama** | LLM provider | [Ollama](./modules/ollama.md) |
| **src/ui** | User interface | [CLI & UI](./modules/ui.md) |
| **src/cli** | CLI entry point | [CLI & UI](./modules/ui.md) |
| **shared/** | Utilities | [Shared Utilities](./modules/shared.md) |

---

## 🔄 Data Flow Examples

### Simple Query

```
User Input: "What files exist?"
    ↓
CLI Parser (src/cli.ts)
    ↓
Orchestrator (routes as simple query)
    ↓
Agent Loop (runs with all tools)
    ↓
LLM Call (Ollama provider)
    ↓
Tool Execution (list_files)
    ↓
Response Streaming (UI)
    ↓
Session Save (JSONL append)
    ↓
Output Display
```

### Complex Task

```
User Input: "Review all files for security issues"
    ↓
Orchestrator (analyzes complexity)
    ↓
Planner (creates task plan)
    ↓
Scheduler (orders tasks)
    ↓
Queue Manager (enqueues tasks)
    ↓
Task Runner (spawns agents)
    ↓
Multiple Agents (parallel/sequential)
    ↓
Results Aggregation
    ↓
Session Save
    ↓
Final Output
```

### Session Resumption

```
User: "maxcoder --resume"
    ↓
CLI Parser (detects --resume flag)
    ↓
Session Manager (loads latest session)
    ↓
Context Manager (loads messages from JSONL)
    ↓
System Prompt (reassembled)
    ↓
Agent Ready (continues from where it left off)
    ↓
New Query Processing
```

---

## 🏗️ Architecture Layers

```
┌─────────────────────────────────────────────────┐
│ 🖥️  User Interface Layer                        │
│ CLI parsing, REPL, terminal rendering          │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ 🎯 Orchestration Layer                         │
│ Router, Planner, Scheduler, Queue Manager      │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ 🤖 Agent Core Layer                            │
│ Agent Loop, Context Manager, Sessions, Prompts │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ 🛠️  Tools Layer                                 │
│ Registry, WebSearch, Subagent, Skills, MCP      │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ 🧠 LLM Provider Layer                          │
│ Ollama: Streaming, Tool Calling                │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ 🔧 Shared Utilities Layer                      │
│ Config, Errors, Async, FS, HTML                │
└─────────────────────────────────────────────────┘
```

Each layer depends only on layers below it. No circular dependencies.

---

## 📖 How to Read the Documentation

### For Quick Understanding
1. Start with [README](../readme.md)
2. Read [Architecture Overview](./architecture.md)
3. Skim [Modules Overview](./modules.md)

### For Specific Module
1. Go to [Modules Overview](./modules.md)
2. Find your module
3. Read the detailed module documentation
4. Follow cross-references as needed

### For Implementation Details
1. Find the relevant module documentation
2. Look at code examples in the doc
3. Reference the source code (`src/...`)
4. Check tests (`tests/...`) for real usage

### For System Design Understanding
1. Read [Architecture Overview](./architecture.md)
2. Study the dependency graph in [Modules](./modules.md)
3. Trace a request through [data flow diagrams](./architecture.md)
4. Read individual module docs for deep dives

---

## 🔍 Key Concepts

### Execution Flow
- **Request** → User query to CLI
- **Routing** → Determine query type and strategy
- **Planning** → Break into subtasks if complex
- **Scheduling** → Determine execution order
- **Execution** → Agent loop runs tasks
- **Output** → Display and save results

### State Management
- **Context** → Current conversation state (messages, tokens)
- **Session** → Persistent conversation record (JSONL file)
- **Configuration** → System settings (CLI flags, env vars, config files)
- **Task** → Individual work unit with status and results

### Tool Execution
- **Registry** → Tool discovery and metadata
- **Validation** → Parameter checking
- **Execution** → Actual tool call
- **Error Handling** → Recovery and reporting
- **Results** → Return to agent for next iteration

---

## 📚 Diagrams Throughout Documentation

All module documentation includes Mermaid diagrams showing:
- **Data Flow** — How information moves through systems
- **Sequence Diagrams** — Interaction between components
- **State Diagrams** — Lifecycle and transitions
- **Architecture Diagrams** — Component relationships

---

## 🎯 Learning Paths

### Path 1: Understand How Queries Work
1. [CLI & UI](./modules/ui.md) — Input handling
2. [Orchestration](./modules/orchestration.md) — Routing
3. [Agent Loop](./modules/agent.md) — Execution
4. [Tools](./modules/tools.md) — Tool execution
5. [Ollama](./modules/ollama.md) — LLM calls

### Path 2: Understand Memory Management
1. [Context](./modules/context.md) — Token management
2. [Sessions](./modules/sessions.md) — Persistence
3. [System Prompt](./modules/prompt.md) — Instruction assembly
4. [Shared - Config](./modules/shared.md#configuration-module) — Settings

### Path 3: Understand Tool System
1. [Tools System](./modules/tools.md) — Registry
2. [WebSearch](./modules/websearch.md) — Example tool
3. [Agent Loop](./modules/agent.md) — How tools are called
4. [Ollama](./modules/ollama.md) — Tool definitions

### Path 4: Deep Dive - Entire System
Read in this order:
1. [Architecture](./architecture.md)
2. [Modules Overview](./modules.md)
3. All module docs (alphabetical or by layer)
4. Reference [README](../readme.md) for quick facts

---

## 🔗 Cross-References

Each module documentation includes:
- **"See Also"** section with related modules
- Links to dependent/dependency modules
- Related concepts and patterns

Follow these for deeper understanding of interactions.

---

## 📝 Notes

- **Consistency**: All diagrams use consistent colors and styles
- **Examples**: Code examples show actual patterns from the system
- **Accuracy**: Documentation reflects current implementation (v0.2+)
- **Completeness**: All major modules are documented
- **Accessibility**: Diagrams have text descriptions

---

## 🔄 Keeping Documentation Updated

When code changes:
1. Update relevant module documentation
2. Check "See Also" sections in related modules
3. Update diagrams if architecture changes
4. Update examples if implementation changes
5. Consider updating the index if new concepts emerge

---

Last updated: 2024-01-16
Documentation version: 1.0
Max Coder version: 0.2.0+
