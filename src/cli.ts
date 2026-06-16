#!/usr/bin/env bun
// Max Coder — CLI entrypoint. Sessions, context, system prompts, tools/skills/agents/MCP, UI.

import { runAgent, type AgentEvent } from './core/agent/index.ts'
import { banner, c, centeredLogo, NAME, VERSION } from './ui/brand.ts'
import { gitBranch } from './shared/config/index.ts'
import { shell } from './shared/fs/index.ts'
import { baseUrl, defaultModel, listModels, type ChatMessage } from './providers/ollama/index.ts'
import { loadMcpTools } from './tools/mcp/index.ts'
import { cleanOldSessions, listSessions, resumeSession, Session, type SessionSummary } from './sessions/index.ts'
import { loadSkills, registerSkillTool } from './tools/skills/index.ts'
import { loadAgentTypes, registerTaskTool } from './tools/subagent/index.ts'
import { allTools, registerBuiltins } from './tools.ts'
import { Tui } from './ui/tui.ts'
import { formatAssistantHeader, formatEvent, formatShellCommand, formatShellResult, formatUserMessage, helpText, renderEvent, statusLine } from './ui/ui.ts'

const out = (s: string) => process.stdout.write(s)

function numCtx(): number {
  const n = Number.parseInt(process.env.MAXCODER_NUM_CTX || process.env.OLLAMA_NUM_CTX || '', 10)
  return Number.isFinite(n) && n > 0 ? n : 32768
}

interface State {
  model: string
  numCtx: number
  cwd: string
  session: Session
  messages: ChatMessage[]
  lastTokens: number
}

// --------------------------------------------------------------------------- //
// Registry init
// --------------------------------------------------------------------------- //
async function initRegistry(opts: { mcp: boolean }): Promise<string[]> {
  const notes: string[] = []
  registerBuiltins()
  const skills = await registerSkillTool()
  if (skills) notes.push(`${skills} skill(s)`)
  await registerTaskTool()
  try {
    // web_search is ON by default; registerWebTools() self-gates on WEB_SEARCH_ENABLED (default true).
    const { registerWebTools } = await import('./tools/websearch/webSearchTool.ts')
    const web = registerWebTools()
    if (web.registered) notes.push(`${web.registered} web tool(s) [${web.provider}]`)
  } catch (e) {
    notes.push(`${c.red}web_search unavailable: ${e instanceof Error ? e.message : e}${c.reset}`)
  }
  if (opts.mcp) {
    const r = await loadMcpTools()
    if (r.tools) notes.push(`${r.tools} MCP tool(s) from ${r.servers} server(s)`)
    for (const e of r.errors) notes.push(`${c.red}MCP ${e}${c.reset}`)
  }
  return notes
}

// --------------------------------------------------------------------------- //
// Running
// --------------------------------------------------------------------------- //
function makeHandler(state: State): (e: AgentEvent) => void {
  let streaming = false
  return e => {
    if (e.type === 'usage') {
      state.lastTokens = e.tokens
      return
    }
    if (e.type === 'stream') {
      if (!streaming) out(`\n${formatAssistantHeader(e.depth)}\n`)
      out(e.text) // live token stream (no newline)
      streaming = true
      return
    }
    if (streaming) {
      out('\n') // close the streamed line before the next event
      streaming = false
      if (e.type === 'final') return // answer text already streamed
    }
    renderEvent(e)
  }
}

function printStatus(state: State) {
  out(statusLine({
    model: state.model,
    tokens: state.lastTokens,
    numCtx: state.numCtx,
    sessionId: state.session.id,
    gitBranch: gitBranch(),
  }) + '\n')
}

async function runTask(state: State, task: string) {
  try {
    if (!process.stdin.isTTY || !process.stdout.isTTY) out(formatUserMessage(task) + '\n')
    await runAgent({
      task,
      model: state.model,
      numCtx: state.numCtx,
      messages: state.messages,
      tools: allTools(),
      session: state.session,
      onEvent: makeHandler(state),
    })
  } catch (e) {
    out(`${c.red}error: ${e instanceof Error ? e.message : e}${c.reset}\n`)
  }
  printStatus(state)
}

function runShellCommand(state: State, input: string, p: (s: string) => void = out): void {
  const command = input.slice(1).trim()
  if (!command) {
    p(`${c.yellow}usage:${c.reset} !<shell command>\n`)
    return
  }
  p(formatShellCommand(command) + '\n')
  const result = shell(command, { cwd: state.cwd, timeout: 60_000 })
  p(formatShellResult(result) + '\n')
}

// --------------------------------------------------------------------------- //
// Slash commands (REPL)
// --------------------------------------------------------------------------- //
// Slash-command dispatch table (replaces a switch). A handler returning `false` ends the REPL.
type SlashHandler = (state: State, arg: string, p: (s: string) => void) => boolean | void | Promise<boolean | void>

function formatSessionSummary(s: SessionSummary, index: number, currentId: string): string {
  const marker = s.id === currentId ? `${c.green}*${c.reset}` : ' '
  const when = new Date(s.updatedAt).toISOString().slice(0, 16).replace('T', ' ')
  const model = s.model ? ` ${c.gray}${s.model}${c.reset}` : ''
  return `${marker} ${c.cyan}${String(index + 1).padStart(2, ' ')}.${c.reset} ${c.bold}${s.id.slice(0, 8)}${c.reset} ${c.gray}${when} · ${s.messageCount} msgs${c.reset}${model}\n    ${s.firstPrompt}\n`
}

async function printSessions(state: State, p: (s: string) => void): Promise<void> {
  const list = await listSessions(state.cwd)
  if (!list.length) {
    p(`${c.gray}(no sessions yet)${c.reset}\n`)
    return
  }
  p(`${c.bold}Sessions${c.reset} ${c.gray}(${list.length})${c.reset}\n`)
  for (let i = 0; i < list.length; i++) p(formatSessionSummary(list[i], i, state.session.id))
  p(`${c.gray}Use /sessions <number|id> to resume. /sessions clean removes old sessions.${c.reset}\n`)
}

async function resumeSessionSelection(state: State, selector: string, p: (s: string) => void): Promise<void> {
  const s = await resumeSession(state.model, selector || 'latest', state.cwd)
  if (!s) {
    p(`${c.red}no matching session${c.reset}\n`)
    return
  }
  state.session = s
  state.model = s.model
  state.messages = await Session.rehydrate(s.file)
  state.lastTokens = 0
  p(`${c.green}resumed #${s.id.slice(0, 8)}${c.reset} ${c.gray}(${state.messages.length} messages)${c.reset}\n`)
}

async function cleanSessionsCommand(state: State, arg: string, p: (s: string) => void): Promise<void> {
  const all = arg.split(/\s+/).includes('--all')
  const r = await cleanOldSessions(state.cwd, all ? undefined : state.session.id)
  const kept = r.kept ? ` ${c.gray}kept current: ${r.kept}${c.reset}` : ''
  p(`${c.green}cleaned ${r.deleted} old session${r.deleted === 1 ? '' : 's'}${c.reset}${kept}\n`)
  for (const e of r.errors) p(`${c.red}failed:${c.reset} ${e.file} ${c.gray}${e.message}${c.reset}\n`)
}

const SLASH_COMMANDS: Record<string, SlashHandler> = {
  help: (_s, _a, p) => void p(helpText() + '\n'),
  exit: () => false,
  quit: () => false,
  model: (state, arg, p) => {
    if (arg) {
      state.model = arg
      p(`${c.green}model → ${arg}${c.reset}\n`)
    } else p(`model: ${c.cyan}${state.model}${c.reset}\n`)
  },
  clear: (state, _a, p) => {
    state.session = new Session({ model: state.model })
    state.messages = []
    state.lastTokens = 0
    p(`${c.green}new session #${state.session.id.slice(0, 8)}${c.reset}\n`)
  },
  compact: async (state, _a, p) => {
    const { compact } = await import('./core/context/index.ts')
    const r = await compact(state.messages, state.model, state.numCtx)
    state.messages.splice(0, state.messages.length, ...r.messages)
    state.session.recordCompaction(r.summary)
    p(`${c.green}compacted ${r.before} → ${r.after} tokens${c.reset}\n`)
  },
  sessions: async (state, arg, p) => {
    const trimmed = arg.trim()
    if (!trimmed) return printSessions(state, p)
    if (trimmed === 'clean' || trimmed.startsWith('clean ')) return cleanSessionsCommand(state, trimmed, p)
    return resumeSessionSelection(state, trimmed, p)
  },
  resume: async (state, arg, p) => {
    await resumeSessionSelection(state, arg, p)
  },
  clean: async (state, arg, p) => {
    await cleanSessionsCommand(state, arg, p)
  },
  tools: (_state, _a, p) => {
    for (const t of allTools()) p(`  ${c.blue}${t.name}${c.reset} ${c.gray}[${t.source}] ${t.description.slice(0, 80)}${c.reset}\n`)
  },
  skills: async (_state, _a, p) => {
    const sk = await loadSkills()
    if (!sk.length) p(`${c.gray}(no skills in ~/.maxcoder/skills)${c.reset}\n`)
    for (const s of sk) p(`  ${c.magenta}${s.name}${c.reset} ${c.gray}${s.description}${c.reset}\n`)
  },
  agents: async (_state, _a, p) => {
    const ag = await loadAgentTypes()
    if (!ag.length) p(`${c.gray}(no agent types in ~/.maxcoder/agents)${c.reset}\n`)
    for (const a of ag) p(`  ${c.magenta}${a.name}${c.reset} ${c.gray}${a.description}${c.reset}\n`)
  },
  cost: (state, _a, p) => {
    p(`tokens in context: ${c.cyan}${state.lastTokens}${c.reset} / ${state.numCtx} (${Math.round((state.lastTokens / state.numCtx) * 100)}%)\n`)
  },
}

async function handleSlash(state: State, input: string, p: (s: string) => void = out): Promise<boolean> {
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/)
  const handler = SLASH_COMMANDS[cmd]
  if (!handler) {
    p(`${c.red}unknown command: /${cmd}${c.reset}  (try /help)\n`)
    return true
  }
  const result = await handler(state, rest.join(' '), p)
  return result !== false
}

// --------------------------------------------------------------------------- //
// REPL
// --------------------------------------------------------------------------- //
async function repl(state: State) {
  out(banner(state.model, baseUrl()))
  out(`${c.dim}Type a task. Slash commands: /help. Ctrl-C to exit.${c.reset}\n`)
  printStatus(state)
  out(`${c.magenta}maxcoder${c.reset} ${c.gray}›${c.reset} `)
  for await (const line of console) {
    const input = line.trim()
    if (!input) {
      out(`${c.magenta}maxcoder${c.reset} ${c.gray}›${c.reset} `)
      continue
    }
    if (input.startsWith('/')) {
      const keep = await handleSlash(state, input)
      if (!keep) break
    } else if (input.startsWith('!')) {
      runShellCommand(state, input)
    } else {
      await runTask(state, input)
    }
    out(`${c.magenta}maxcoder${c.reset} ${c.gray}›${c.reset} `)
  }
}

// --------------------------------------------------------------------------- //
// Full-screen TUI
// --------------------------------------------------------------------------- //
async function tui(state: State, notes: string[]) {
  let currentAbort: AbortController | null = null
  const ui = new Tui({
    status: () => ({
      model: state.model,
      tokens: state.lastTokens,
      numCtx: state.numCtx,
      sessionId: state.session.id,
      gitBranch: gitBranch(),
    }),
    onInterrupt: () => currentAbort?.abort(),
    onSubmit: async (text, t) => {
      if (text.startsWith('/')) {
        const keep = await handleSlash(state, text, s => t.print(s.replace(/\n+$/, '')))
        if (!keep) {
          t.stop()
          process.exit(0)
        }
        return
      }
      if (text.startsWith('!')) {
        runShellCommand(state, text, s => t.print(s.replace(/\n+$/, '')))
        return
      }
      const ac = new AbortController()
      currentAbort = ac
      try {
        await runAgent({
          task: text,
          model: state.model,
          numCtx: state.numCtx,
          messages: state.messages,
          tools: allTools(),
          session: state.session,
          signal: ac.signal,
          onEvent: e => {
            if (e.type === 'usage') {
              state.lastTokens = e.tokens
              return
            }
            if (e.type === 'stream') {
              t.streamDelta(e.text, e.depth)
              return
            }
            if (e.type === 'final') {
              if (!t.finishStream(e.text, e.depth)) {
                const s = formatEvent(e)
                if (s) t.print(s)
              }
              return
            }
            t.endStream() // close any open stream before a tool/info block
            const s = formatEvent(e)
            if (s) t.print(s)
          },
        })
      } finally {
        currentAbort = null
      }
    },
  })
  if (notes.length) ui.print(`${c.gray}loaded: ${notes.join(' · ')}${c.reset}`)
  ui.start()
  await new Promise<void>(() => {}) // keep alive until /exit or Ctrl-C (process.exit)
}

// --------------------------------------------------------------------------- //
// Doctor / help / args
// --------------------------------------------------------------------------- //
async function doctor(model: string) {
  out(`${centeredLogo()}\n${c.bold}Max Coder doctor${c.reset}\n  backend: ${baseUrl()}\n`)
  const models = await listModels()
  if (!models.length) {
    out(`  ${c.red}✗ Ollama not reachable.${c.reset} Start it:  ollama serve\n`)
    process.exitCode = 1
    return
  }
  out(`  ${c.green}✓ Ollama up${c.reset} — ${models.join(', ')}\n`)
  out(
    models.includes(model)
      ? `  ${c.green}✓ model "${model}" available${c.reset}\n`
      : `  ${c.yellow}! model "${model}" not pulled${c.reset} — run:  ollama pull ${model}\n`,
  )
  const notes = await initRegistry({ mcp: true })
  out(`  ${c.green}✓ registry${c.reset} — ${allTools().length} tools${notes.length ? ' · ' + notes.join(' · ') : ''}\n`)
}

function printHelp() {
  out(`${centeredLogo()}
${c.bold}${NAME}${c.reset} v${VERSION} — local-first AI coding agent (Ollama)

${c.bold}Usage${c.reset}
  maxcoder "<task>"          run a one-shot task
  maxcoder                   full-screen TUI (continuous context, /commands)
  maxcoder --plain           plain line-based REPL instead of the TUI
  maxcoder -c "<task>"       continue the latest session
  maxcoder --resume [id]     resume a session
  maxcoder "!pwd"            run shell command in the startup directory
  maxcoder doctor            check backend + registry

${c.bold}Flags${c.reset}  --model <name>  -c/--continue  --resume [id]  --plain  --no-mcp
       -p/--print  -i/--interactive  --help  --version
${c.bold}TUI${c.reset}    Type /, !, or -- for commands. Tab accepts/cycles matches.
       Ctrl-O copy mode lets you select text; wheel/PageUp scrolls, Esc returns.
${c.bold}Env${c.reset}    MAXCODER_MODEL · OLLAMA_BASE_URL · MAXCODER_NUM_CTX · MAXCODER_CONFIG_DIR
`)
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = { model: defaultModel(), mcp: true, resume: undefined as string | undefined, cont: false, plain: false }
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') return printHelp()
    else if (a === '--version' || a === '-v') return void out(`${NAME} v${VERSION}\n`)
    else if (a === 'doctor') return doctor(flags.model)
    else if (a === '--model' || a === '-m') flags.model = argv[++i] ?? flags.model
    else if (a === '--no-mcp') flags.mcp = false
    else if (a === '--plain') flags.plain = true
    else if (a === '--resume') {
      flags.resume = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : 'latest'
    } else if (a === '-c' || a === '--continue') flags.cont = true
    else if (a === '-p' || a === '--print' || a === '-i' || a === '--interactive') {} // accepted
    else rest.push(a)
  }

  const notes = await initRegistry({ mcp: flags.mcp })

  // Resolve session (resume / continue / new).
  let session: Session | null = null
  let messages: ChatMessage[] = []
  if (flags.resume || flags.cont) {
    session = await resumeSession(flags.model, flags.resume ?? 'latest')
    if (session) messages = await Session.rehydrate(session.file)
  }
  if (!session) session = new Session({ model: flags.model })

  const state: State = { model: flags.model, numCtx: numCtx(), cwd: process.cwd(), session, messages, lastTokens: 0 }

  if (rest.length) {
    out(banner(state.model, baseUrl()))
    if (notes.length) out(`${c.gray}loaded: ${notes.join(' · ')}${c.reset}\n`)
    const input = rest.join(' ')
    if (input.startsWith('!')) runShellCommand(state, input)
    else await runTask(state, input)
    return
  }
  if (!flags.plain && process.stdin.isTTY && process.stdout.isTTY) {
    await tui(state, notes)
  } else {
    if (notes.length) out(`${c.gray}loaded: ${notes.join(' · ')}${c.reset}\n`)
    await repl(state)
  }
}

await main()
