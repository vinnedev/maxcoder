// Max Coder — UI helpers shared by the plain REPL and the full-screen TUI.

import { c } from './brand.ts'
import type { AgentEvent } from '../core/agent/index.ts'

const out = (s: string) => process.stdout.write(s)

export const SLASH_COMMANDS = [
  '/help',
  '/model',
  '/sessions',
  '/resume',
  '/compact',
  '/clear',
  '/clean',
  '/tools',
  '/skills',
  '/agents',
  '/cost',
  '/exit',
  '/quit',
]

export const CLI_OPTIONS = [
  '--model',
  '-m',
  '--resume',
  '-c',
  '--continue',
  '--plain',
  '--no-mcp',
  '--help',
  '-h',
  '--version',
  '-v',
  '-p',
  '--print',
  '-i',
  '--interactive',
  'doctor',
]

const MAX_SHELL_OUTPUT = 12_000

export function oneLine(s: string, max = 160): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function ctxBar(pct: number, width = 10): string {
  const filled = Math.min(width, Math.max(0, Math.round(pct * width)))
  const color = pct > 0.85 ? c.red : pct > 0.6 ? c.yellow : c.green
  return `${color}${'█'.repeat(filled)}${c.gray}${'░'.repeat(width - filled)}${c.reset}`
}

export interface StatusParts {
  model: string
  tokens: number
  numCtx: number
  sessionId: string
  gitBranch?: string
  spinner?: string
  width?: number
}

const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

export function statusLine(p: StatusParts): string {
  const pct = p.numCtx > 0 ? p.tokens / p.numCtx : 0
  const width = p.width ?? 120
  const model = width < 72 ? oneLine(p.model, 24) : p.model
  const session = width >= 72 ? `  ${c.gray}session:${p.sessionId.slice(0, 8)}${c.reset}` : ''
  const branch = p.gitBranch && width >= 92 ? `  ${c.gray}git:${p.gitBranch}${c.reset}` : ''
  return (
    (p.spinner ? `${c.yellow}${p.spinner}${c.reset} ` : `${c.gray}· ${c.reset}`) +
    `${c.bold}${c.cyan}${model}${c.reset}` +
    `  ${ctxBar(pct, width < 56 ? 6 : 12)} ${c.gray}${kfmt(p.tokens)}/${kfmt(p.numCtx)} ${Math.round(pct * 100)}%${c.reset}` +
    branch +
    session
  )
}

const indent = (depth: number) => (depth > 0 ? c.gray + '│ '.repeat(depth) + c.reset : '')
const badge = (label: string, color: string) => `${c.gray}[${c.reset}${color}${label}${c.reset}${c.gray}]${c.reset}`

export function formatUserMessage(text: string): string {
  return `\n${badge('user', c.magenta)}\n${text}`
}

export function formatAssistantHeader(depth = 0): string {
  return `${indent(depth)}${badge(depth > 0 ? 'subagent' : 'assistant', depth > 0 ? c.cyan : c.green)}`
}

export function formatShellCommand(command: string): string {
  return `${badge('shell', c.yellow)} ${c.gray}$${c.reset} ${command}`
}

export function formatShellResult(result: { stdout: string; stderr: string; exitCode: number }): string {
  const body = (result.stdout + (result.stderr ? `${result.stdout ? '\n' : ''}${result.stderr}` : '')).trim()
  const shown = body.length > MAX_SHELL_OUTPUT ? `${body.slice(0, MAX_SHELL_OUTPUT)}\n... [truncated]` : body
  const status = result.exitCode === 0 ? `${c.green}exit 0${c.reset}` : `${c.red}exit ${result.exitCode}${c.reset}`
  return `${badge('shell', c.yellow)} ${status}${shown ? `\n${shown}` : ` ${c.gray}(no output)${c.reset}`}`
}

function styleInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, `${c.yellow}$1${c.reset}`)
    .replace(/\*\*([^*]+)\*\*/g, `${c.bold}$1${c.reset}`)
    .replace(/__([^_]+)__/g, `${c.bold}$1${c.reset}`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${c.cyan}$1${c.reset}${c.gray} ($2)${c.reset}`)
}

export function formatAssistantText(text: string, depth = 0): string {
  const pad = indent(depth)
  const out: string[] = []
  let inCode = false
  let codeLang = ''

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const fence = raw.match(/^```(\S*)?/)
    if (fence) {
      inCode = !inCode
      codeLang = inCode ? fence[1] || '' : ''
      out.push(inCode ? `${pad}${c.gray}╭─ code${codeLang ? ` ${codeLang}` : ''}${c.reset}` : `${pad}${c.gray}╰─${c.reset}`)
      continue
    }
    if (inCode) {
      out.push(`${pad}${c.gray}│${c.reset} ${c.dim}${raw}${c.reset}`)
      continue
    }

    const heading = raw.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      out.push(`${pad}${c.bold}${c.cyan}${heading[2]}${c.reset}`)
      continue
    }

    const bullet = raw.match(/^(\s*)[-*]\s+(.+)$/)
    if (bullet) {
      out.push(`${pad}${bullet[1]}${c.gray}•${c.reset} ${styleInlineMarkdown(bullet[2])}`)
      continue
    }

    const numbered = raw.match(/^(\s*)\d+[.)]\s+(.+)$/)
    if (numbered) {
      out.push(`${pad}${numbered[1]}${c.gray}›${c.reset} ${styleInlineMarkdown(numbered[2])}`)
      continue
    }

    out.push(raw.trim() ? `${pad}${styleInlineMarkdown(raw)}` : '')
  }

  return out.join('\n')
}

export function formatAssistantMessage(text: string, depth = 0): string {
  return `\n${formatAssistantHeader(depth)}\n${formatAssistantText(text, depth)}`
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (key === 'content' || key === 'old_string' || key === 'new_string') {
      parts.push(`${key}:${typeof value === 'string' ? `${value.length} chars` : typeof value}`)
    } else if (typeof value === 'string') {
      parts.push(`${key}:${JSON.stringify(truncate(value, 72))}`)
    } else {
      parts.push(`${key}:${JSON.stringify(value)}`)
    }
  }
  return parts.join(' ')
}

function colorizeDiff(diff: string, depth: number): string {
  const pad = indent(depth) + c.gray + '  │ ' + c.reset
  return diff
    .split('\n')
    .map(line => {
      if (line.startsWith('+++') || line.startsWith('---')) return `${pad}${c.gray}${line}${c.reset}`
      if (line.startsWith('@@')) return `${pad}${c.cyan}${line}${c.reset}`
      if (line.startsWith('+')) return `${pad}${c.green}${line}${c.reset}`
      if (line.startsWith('-')) return `${pad}${c.red}${line}${c.reset}`
      if (line.startsWith('...')) return `${pad}${c.yellow}${line}${c.reset}`
      return `${pad}${c.dim}${line}${c.reset}`
    })
    .join('\n')
}

function formatToolResult(name: string, result: string, depth: number): string {
  const lines = result.split('\n')
  const diffAt = lines.findIndex(line => line.startsWith('--- '))
  const summary = lines[0] ? oneLine(lines[0], 180) : '(no output)'
  const head = `${indent(depth)}${badge('tool', c.blue)} ${c.green}done${c.reset} ${c.bold}${name}${c.reset} ${c.gray}${summary}${c.reset}`

  if (diffAt >= 0) {
    return `${head}\n${indent(depth)}${c.gray}  diff${c.reset}\n${colorizeDiff(lines.slice(diffAt).join('\n'), depth)}`
  }

  if (name === 'read_file' || name === 'grep' || name === 'list_dir') {
    const count = result === '(no matches)' || result === '(empty)' ? result : `${lines.length} line${lines.length === 1 ? '' : 's'}`
    return `${indent(depth)}${badge('tool', c.blue)} ${c.green}done${c.reset} ${c.bold}${name}${c.reset} ${c.gray}${count}${c.reset}`
  }

  return head
}

// Event formatter dispatch table (replaces a switch). Handlers narrow the discriminated union.
type EventFormatter = (e: AgentEvent) => string | null
const EVENT_FORMATTERS: Partial<Record<AgentEvent['type'], EventFormatter>> = {
  tool_call: ev => {
    const e = ev as Extract<AgentEvent, { type: 'tool_call' }>
    const tag = e.emulated ? `${c.dim}(emulated)${c.reset} ` : ''
    return `\n${indent(e.depth)}${badge('tool', c.blue)} ${c.bold}${e.name}${c.reset} ${tag}${c.gray}${summarizeArgs(e.args)}${c.reset}`
  },
  tool_result: ev => {
    const e = ev as Extract<AgentEvent, { type: 'tool_result' }>
    return formatToolResult(e.name, e.result, e.depth)
  },
  final: ev => {
    const e = ev as Extract<AgentEvent, { type: 'final' }>
    return formatAssistantMessage(e.text, e.depth)
  },
  info: ev => {
    const e = ev as Extract<AgentEvent, { type: 'info' }>
    return `${badge('system', c.yellow)} ${c.gray}${e.text}${c.reset}`
  },
}

/** Format an agent event into a styled string (or null to ignore). Used by both UIs. */
export function formatEvent(e: AgentEvent): string | null {
  return EVENT_FORMATTERS[e.type]?.(e) ?? null
}

/** Plain-mode renderer (writes straight to stdout). */
export function renderEvent(e: AgentEvent): void {
  const s = formatEvent(e)
  if (s !== null) out(s + '\n')
}

export function helpText(): string {
  return `${c.bold}Commands${c.reset}
  ${c.cyan}/help${c.reset}        show this help
  ${c.cyan}/model${c.reset}       show or switch the local model
  ${c.cyan}/sessions${c.reset}    list all project sessions
  ${c.cyan}/sessions 2${c.reset}  resume a session by number or id
  ${c.cyan}/resume${c.reset}      resume a session, latest by default
  ${c.cyan}/compact${c.reset}     summarize and shrink context now
  ${c.cyan}/clear${c.reset}       start a fresh conversation
  ${c.cyan}/clean${c.reset}       delete old sessions, keeping the current one
  ${c.cyan}/tools${c.reset}       list available tools
  ${c.cyan}/skills${c.reset}      list loaded skills
  ${c.cyan}/agents${c.reset}      list custom agent types
  ${c.cyan}/cost${c.reset}        show context usage
  ${c.cyan}/exit${c.reset}        quit
  ${c.yellow}!cmd${c.reset}        run a shell command in the startup directory

${c.gray}Type /, !, or -- for commands. Tab accepts or cycles matches.
Ctrl-O enters copy mode: select text normally, wheel/PageUp scrolls, Esc returns.${c.reset}`
}
