# Max Coder — System Architecture

## Overview

Max Coder is a **local-first AI coding agent** designed to provide Claude Code-level capabilities with zero cloud dependencies. The system is built on a modular, plugin-based architecture that supports extensibility through tools, skills, agents, and MCP integrations.

## High-Level System Architecture

```mermaid
graph TB
    subgraph CLI ["CLI & User Interface"]
        CLI_ENTRY["CLI Entry Point<br/>src/cli.ts"]
        UI_TUI["TUI/UI Layer<br/>src/ui/"]
    end
    
    subgraph ORCHESTRATION ["Orchestration & Planning"]
        ROUTER["Router<br/>orchestration/router.ts"]
        PLANNER["Planner<br/>orchestration/planner.ts"]
        SCHEDULER["Scheduler<br/>orchestration/scheduler.ts"]
        COMPLEXITY["Complexity Analyzer<br/>orchestration/complexity.ts"]
        ORCHESTRATOR["Orchestrator<br/>orchestration/orchestrator.ts"]
    end
    
    subgraph CORE ["Core Agent System"]
        AGENT["Agent Loop<br/>core/agent/"]
        CONTEXT["Context Manager<br/>core/context/"]
        SESSION["Session Manager<br/>core/sessions/"]
        PROMPT["System Prompt<br/>core/prompt/"]
    end
    
    subgraph QUEUE ["Task Queue & Execution"]
        QUEUE_MGR["Queue Manager<br/>core/queue/"]
        QUEUE_RUNNER["Queue Runner<br/>core/queue/runner.ts"]
    end
    
    subgraph TASK_MGMT ["Task Management"]
        TASK_MGR["Task Manager<br/>core/tasks/manager.ts"]
        TASK_RUNNER["Task Runner<br/>core/tasks/runner.ts"]
    end
    
    subgraph TOOLS ["Tools & Integrations"]
        TOOL_REGISTRY["Tool Registry<br/>src/tools.ts"]
        BUILTIN_TOOLS["Built-in Tools<br/>datetime, fs, bash"]
        WEBSEARCH["WebSearch Tool<br/>tools/websearch/"]
        SUBAGENT_TOOL["Subagent Tool<br/>tools/subagent/"]
        SKILLS_TOOL["Skills Tool<br/>tools/skills/"]
        MCP_TOOL["MCP Client<br/>tools/mcp/"]
    end
    
    subgraph PROVIDERS ["LLM Providers"]
        OLLAMA["Ollama Provider<br/>providers/ollama/"]
        TOOL_CALLING["Tool Calling Handler<br/>Native & Emulated"]
    end
    
    subgraph SHARED ["Shared Utilities"]
        CONFIG["Configuration<br/>shared/config/"]
        ERRORS["Error Handling<br/>shared/errors/"]
        ASYNC["Async Utils<br/>shared/async/"]
        FS["File System<br/>shared/fs/"]
        HTML["HTML Parser<br/>shared/html/"]
    end

    CLI_ENTRY -->|Controls| UI_TUI
    UI_TUI -->|Commands| ORCHESTRATOR
    ORCHESTRATOR -->|Routes| ROUTER
    ROUTER -->|Analyzes| COMPLEXITY
    ROUTER -->|Plans| PLANNER
    ROUTER -->|Schedules| SCHEDULER
    ROUTER -->|Manages| QUEUE_MGR
    
    QUEUE_MGR -->|Executes| QUEUE_RUNNER
    QUEUE_RUNNER -->|Spawns| TASK_MGR
    TASK_MGR -->|Runs| TASK_RUNNER
    TASK_RUNNER -->|Drives| AGENT
    
    AGENT -->|Uses| CONTEXT
    AGENT -->|Loads| SESSION
    AGENT -->|Assembles| PROMPT
    AGENT -->|Calls| TOOL_REGISTRY
    
    TOOL_REGISTRY -->|Uses| BUILTIN_TOOLS
    TOOL_REGISTRY -->|Uses| WEBSEARCH
    TOOL_REGISTRY -->|Uses| SUBAGENT_TOOL
    TOOL_REGISTRY -->|Uses| SKILLS_TOOL
    TOOL_REGISTRY -->|Uses| MCP_TOOL
    
    TOOL_REGISTRY -->|Sends to| OLLAMA
    OLLAMA -->|Handles| TOOL_CALLING
    OLLAMA -->|Returns| AGENT
    
    AGENT -->|Accesses| SHARED
    AGENT -->|Uses| CONFIG
    AGENT -->|Uses| ERRORS
    
    style CLI fill:#e1f5ff
    style ORCHESTRATION fill:#f3e5f5
    style CORE fill:#fff3e0
    style QUEUE fill:#fce4ec
    style TASK_MGMT fill:#f1f8e9
    style TOOLS fill:#e0f2f1
    style PROVIDERS fill:#ede7f6
    style SHARED fill:#f5f5f5
```

## Request Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as CLI/UI
    participant Orchestrator
    participant Agent
    participant Queue
    participant Tools
    participant LLM as Ollama/LLM
    
    User->>CLI: Command Input
    CLI->>Orchestrator: Route Command
    Orchestrator->>Queue: Enqueue Task
    Queue->>Agent: Execute Task
    
    Agent->>Agent: Load Context<br/>Load Session<br/>Assemble Prompt
    Agent->>LLM: Send Prompt + Tools
    LLM->>Agent: Response with Tool Calls
    
    Agent->>Tools: Execute Tool Calls
    Tools->>Tools: Process Each Tool
    Tools->>Agent: Return Results
    
    Agent->>Agent: Update Context<br/>Save Session
    Agent->>LLM: Send Results + Continue
    LLM->>Agent: Response (more tools or final)
    
    Agent->>CLI: Stream Output
    CLI->>User: Display Results
```

## Data Flow — Context & Sessions

```mermaid
graph LR
    subgraph INPUT ["Input"]
        USER["User Query"]
        HISTORY["Session History<br/>JSONL"]
        CONFIG_FILES["Config Files<br/>.maxcoder/**"]
    end
    
    subgraph PROCESSING ["Processing"]
        CONTEXT_MGR["Context Manager<br/>Token Counting"]
        COMPACTION["Auto-Compaction<br/>LLM Summary"]
        PROMPT_ASSEMBLY["Prompt Assembly<br/>Layered"]
    end
    
    subgraph OUTPUT ["Output"]
        AGENT_INPUT["Agent System<br/>Prompt"]
        SESSION_APPEND["Append to<br/>Session JSONL"]
    end
    
    USER -->|Current Turn| CONTEXT_MGR
    HISTORY -->|Load Past| CONTEXT_MGR
    CONFIG_FILES -->|Memory/Tools| PROMPT_ASSEMBLY
    
    CONTEXT_MGR -->|Token Analysis| COMPACTION
    COMPACTION -->|Summarize Old| CONTEXT_MGR
    CONTEXT_MGR -->|Final Context| PROMPT_ASSEMBLY
    
    PROMPT_ASSEMBLY -->|Identity + Behavior| AGENT_INPUT
    PROMPT_ASSEMBLY -->|Tools & Skills| AGENT_INPUT
    
    AGENT_INPUT -->|Processed| SESSION_APPEND
```

## Module Dependencies Graph

```mermaid
graph TB
    SHARED["shared/<br/>config, errors, async, fs, html"]
    CONFIG["shared/config"]
    ERRORS["shared/errors"]
    
    SESSION["sessions/"]
    CONTEXT["core/context"]
    PROMPT["core/prompt"]
    AGENT["core/agent"]
    
    REGISTRY["src/tools"]
    WEBSEARCH["tools/websearch"]
    SUBAGENT["tools/subagent"]
    SKILLS["tools/skills"]
    MCP["tools/mcp"]
    
    QUEUE["core/queue"]
    TASKS["core/tasks"]
    
    ORCH["core/orchestration"]
    ORCHESTRATOR["orchestration/orchestrator"]
    ROUTER["orchestration/router"]
    PLANNER["orchestration/planner"]
    COMPLEXITY["orchestration/complexity"]
    SCHEDULER["orchestration/scheduler"]
    
    OLLAMA["providers/ollama"]
    
    CLI["src/cli"]
    UI["src/ui"]
    
    CONFIG -->|Used by| SESSION
    CONFIG -->|Used by| CONTEXT
    ERRORS -->|Used by| SESSION
    ERRORS -->|Used by| CONTEXT
    
    SESSION -->|Loads| CONTEXT
    SESSION -->|Feeds| AGENT
    
    CONTEXT -->|Manages| PROMPT
    PROMPT -->|Assembles| AGENT
    
    AGENT -->|Uses| REGISTRY
    REGISTRY -->|Coordinates| WEBSEARCH
    REGISTRY -->|Coordinates| SUBAGENT
    REGISTRY -->|Coordinates| SKILLS
    REGISTRY -->|Coordinates| MCP
    
    AGENT -->|Calls| OLLAMA
    OLLAMA -->|Returns| AGENT
    
    AGENT -->|Managed by| TASKS
    TASKS -->|Queued in| QUEUE
    QUEUE -->|Managed by| ORCHESTRATOR
    ORCHESTRATOR -->|Routes via| ROUTER
    ROUTER -->|Uses| PLANNER
    ROUTER -->|Analyzes| COMPLEXITY
    ROUTER -->|Schedules| SCHEDULER
    
    ORCHESTRATOR -->|Controlled by| CLI
    CLI -->|Renders| UI
    
    SHARED -->|Foundation| CONTEXT
    SHARED -->|Foundation| SESSION
    
    style SHARED fill:#f5f5f5,stroke:#333,stroke-width:2px
    style CONFIG fill:#f5f5f5
    style ERRORS fill:#f5f5f5
    style AGENT fill:#fff3e0,stroke:#333,stroke-width:2px
    style CONTEXT fill:#fff3e0
    style SESSION fill:#fff3e0
    style PROMPT fill:#fff3e0
    style REGISTRY fill:#e0f2f1,stroke:#333,stroke-width:2px
    style ORCHESTRATOR fill:#f3e5f5,stroke:#333,stroke-width:2px
```

## Execution Layers

```mermaid
graph TB
    subgraph LAYER1 ["🖥️  Layer 1: User Interface"]
        CLI_L["CLI Entry Point"]
        REPL_L["REPL Loop"]
        STATUS_L["Status Display"]
    end
    
    subgraph LAYER2 ["🎯 Layer 2: Orchestration"]
        ROUTE_L["Request Routing"]
        PLAN_L["Task Planning"]
        QUEUE_L["Task Queueing"]
        SCHEDULE_L["Execution Scheduling"]
    end
    
    subgraph LAYER3 ["🤖 Layer 3: Agent Core"]
        SESSION_L["Session Management"]
        CONTEXT_L["Context Management"]
        PROMPT_L["Prompt Assembly"]
        LOOP_L["Agent Loop"]
    end
    
    subgraph LAYER4 ["🛠️  Layer 4: Tools & Integrations"]
        TOOL_L["Tool Registry"]
        WS_L["WebSearch"]
        SA_L["Subagent"]
        SK_L["Skills"]
        MCP_L["MCP"]
    end
    
    subgraph LAYER5 ["🧠 Layer 5: LLM Provider"]
        CHAT_L["Streaming Chat API"]
        PARSE_L["Tool Call Parser"]
        EMULATE_L["Emulation Handler"]
    end
    
    CLI_L -->|Receives| LAYER2
    REPL_L -->|Drives| LAYER2
    
    ROUTE_L -->|Orchestrates| LAYER3
    QUEUE_L -->|Manages| LAYER3
    
    CONTEXT_L -->|Uses| LAYER4
    LOOP_L -->|Executes| LAYER4
    
    TOOL_L -->|Calls| LAYER5
    
    PARSE_L -->|Returns to| LAYER3
    EMULATE_L -->|Supports| LAYER4
    
    style LAYER1 fill:#e1f5ff
    style LAYER2 fill:#f3e5f5
    style LAYER3 fill:#fff3e0
    style LAYER4 fill:#e0f2f1
    style LAYER5 fill:#ede7f6
```

## Key Design Principles

### 1. **Modularity**
- Each module has a single responsibility
- Clear interfaces between modules
- Minimal cross-module dependencies
- Plugin-based tool and skill system

### 2. **Zero Runtime Dependencies**
- Built with Bun (no external runtime)
- Compiled to standalone binary
- All core functionality self-contained
- Optional integrations (Ollama, MCP) via configuration

### 3. **Local-First**
- JSONL-based session persistence
- File system for configuration
- No cloud connectivity required
- Offline capability for core operations

### 4. **Extensibility**
- Tool registry for custom tools
- Skill system for behavior customization
- MCP client for standard protocol support
- Custom agent types via markdown

### 5. **Robustness**
- Context-aware auto-compaction
- Session resumption and continuation
- Tool call error handling (native + emulated)
- Stream interruption recovery

## Configuration Hierarchy

```mermaid
graph TD
    ENV["Environment Variables<br/>.env / process.env"]
    CLI_FLAGS["CLI Flags<br/>--model, --temp, etc"]
    USER_CONFIG["User Config<br/>~/.maxcoder/"]
    PROJECT_CONFIG["Project Config<br/>.maxcoder/"]
    
    EFFECTIVE["Effective Configuration"]
    
    ENV -->|Base| EFFECTIVE
    CLI_FLAGS -->|Override| EFFECTIVE
    PROJECT_CONFIG -->|Local| EFFECTIVE
    USER_CONFIG -->|User| EFFECTIVE
    
    EFFECTIVE -->|Provides| AGENT
    EFFECTIVE -->|Provides| OLLAMA
    EFFECTIVE -->|Provides| TOOLS
    
    style EFFECTIVE fill:#c8e6c9,stroke:#333,stroke-width:2px
```

## See Also

- [Module Documentation](./modules.md) — Detailed breakdown of each module
- [Orchestration System](./modules/orchestration.md) — Request routing and task scheduling
- [Agent Loop](./modules/agent.md) — Core agentic loop and tool calling
- [Context Management](./modules/context.md) — Token counting and auto-compaction
- [Sessions](./modules/sessions.md) — JSONL persistence and resumption
- [Tools System](./modules/tools.md) — Tool registry and execution
- [WebSearch Integration](./modules/websearch.md) — Web search capabilities
- [MCP Client](./modules/tools.md#mcp-tool) — Model Context Protocol support
