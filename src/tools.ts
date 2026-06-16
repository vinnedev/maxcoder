// Max Coder — extensible tool registry + built-in tools (Bun-native I/O via fsx).
// A uniform Tool interface so built-ins, skills, subagents, and MCP all plug in the same way
// (the "create + customize" backbone). Analog of src/Tool.ts + src/tools.ts (simplified).

import * as path from 'node:path'
import { exists, listDir, readText, sh, shell, writeText } from './shared/fs/index.ts'
import type { ToolDef } from './providers/ollama/index.ts'
import { DATETIME_DESCRIPTION, DATETIME_SCHEMA, datetimeTool } from './tools/datetime/index.ts'

export interface ToolContext {
  cwd: string
  model: string
  signal?: AbortSignal
  depth: number // subagent recursion depth (0 = main)
  runSubAgent?: (task: string, opts: { agentType?: string }) => Promise<string>
}

export type ToolSource = 'builtin' | 'skill' | 'agent' | 'mcp' | 'web'

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  mutating: boolean
  source: ToolSource
  run: (args: Record<string, unknown>, ctx: ToolContext) => string | Promise<string>
}

const REGISTRY = new Map<string, Tool>()

export function registerTool(t: Tool): void {
  REGISTRY.set(t.name, t)
}
export function registerTools(ts: Tool[]): void {
  ts.forEach(registerTool)
}
export function allTools(): Tool[] {
  return [...REGISTRY.values()]
}
export function getTool(name: string): Tool | undefined {
  return REGISTRY.get(name)
}
export function toolDefs(tools: Tool[] = allTools()): ToolDef[] {
  return tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }))
}
export function toolInfos(tools: Tool[] = allTools()) {
  return tools.map(t => ({ name: t.name, description: t.description }))
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tool = REGISTRY.get(name)
  if (!tool) return `ERROR: unknown tool "${name}". Available: ${allTools().map(t => t.name).join(', ')}`
  try {
    return await tool.run(args, ctx)
  } catch (e) {
    return `ERROR running ${name}: ${e instanceof Error ? e.message : e}`
  }
}

// --------------------------------------------------------------------------- //
// Built-in tools (Bun-native)
// --------------------------------------------------------------------------- //
const MAX_READ_CHARS = 100_000
const MAX_DIFF_LINES = 160

function abs(ctx: ToolContext, p: string): string {
  return path.resolve(ctx.cwd, p)
}
function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string') throw new Error(`missing/invalid string argument "${key}"`)
  return v
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.replace(/\r\n/g, '\n').split('\n')
}

function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return ''
  const a = splitLines(before)
  const b = splitLines(after)
  const max = Math.max(a.length, b.length)
  const lines = [`--- ${file}`, `+++ ${file}`]
  let shown = 0

  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue
    const start = Math.max(0, i - 2)
    const end = Math.min(max, i + 3)
    lines.push(`@@ -${start + 1},${Math.max(0, end - start)} +${start + 1},${Math.max(0, end - start)} @@`)
    for (let j = start; j < end; j++) {
      if (a[j] === b[j]) {
        if (a[j] !== undefined) lines.push(` ${a[j]}`)
      } else {
        if (a[j] !== undefined) lines.push(`-${a[j]}`)
        if (b[j] !== undefined) lines.push(`+${b[j]}`)
      }
      shown++
      if (shown >= MAX_DIFF_LINES) {
        lines.push('... [diff truncated]')
        return lines.join('\n')
      }
    }
    i = end - 1
  }

  return lines.join('\n')
}

function writeSummary(action: string, file: string, before: string, after: string): string {
  const diff = unifiedDiff(file, before, after)
  const bytes = Buffer.byteLength(after)
  return diff ? `${action} ${file} (${bytes} bytes)\n\n${diff}` : `${action} ${file} (${bytes} bytes, no changes)`
}

const BUILTINS: Tool[] = [
  {
    name: 'datetime',
    description: DATETIME_DESCRIPTION,
    mutating: false,
    source: 'builtin',
    parameters: DATETIME_SCHEMA,
    run: args => datetimeTool(args as Parameters<typeof datetimeTool>[0]),
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file and return its contents (truncated if large).',
    mutating: false,
    source: 'builtin',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async (args, ctx) => {
      const p = abs(ctx, str(args, 'path'))
      const text = await readText(p)
      if (text === null) return `ERROR: file not found: ${p}`
      return text.length > MAX_READ_CHARS ? text.slice(0, MAX_READ_CHARS) + '\n... [truncated]' : text
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file with the given content.',
    mutating: true,
    source: 'builtin',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    run: async (args, ctx) => {
      const p = abs(ctx, str(args, 'path'))
      const content = str(args, 'content')
      const original = (await readText(p)) ?? ''
      await writeText(p, content) // Bun.write creates parent dirs
      return writeSummary('wrote', p, original, content)
    },
  },
  {
    name: 'edit_file',
    description: 'Replace the first exact occurrence of old_string with new_string in a file.',
    mutating: true,
    source: 'builtin',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
      required: ['path', 'old_string', 'new_string'],
    },
    run: async (args, ctx) => {
      const p = abs(ctx, str(args, 'path'))
      const original = await readText(p)
      if (original === null) return `ERROR: file not found: ${p}`
      const oldS = str(args, 'old_string')
      if (!original.includes(oldS)) return `ERROR: old_string not found in ${p}`
      const next = original.replace(oldS, str(args, 'new_string'))
      await writeText(p, next)
      return writeSummary('edited', p, original, next)
    },
  },
  {
    name: 'list_dir',
    description: 'List files and directories at a path (default ".").',
    mutating: false,
    source: 'builtin',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] },
    run: async (args, ctx) => {
      const rel = typeof args.path === 'string' && args.path ? args.path : '.'
      const p = abs(ctx, rel)
      if (!(await exists(p))) return `ERROR: not found: ${p}`
      const entries = listDir(p)
      if (entries.length === 0) return '(empty)'
      return entries
        .map(e => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join('\n')
    },
  },
  {
    name: 'grep',
    description: 'Search file contents for a pattern (recursive).',
    mutating: false,
    source: 'builtin',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' }, path: { type: 'string' } },
      required: ['pattern'],
    },
    run: (args, ctx) => {
      const pattern = str(args, 'pattern')
      const target = typeof args.path === 'string' && args.path ? args.path : '.'
      const r = sh(['grep', '-rnI', '--color=never', '-e', pattern, target], { cwd: ctx.cwd, timeout: 20_000 })
      if (r.exitCode === 1) return '(no matches)'
      if (r.exitCode > 1) return `ERROR: ${r.stderr || 'grep failed'}`
      return r.stdout.split('\n').slice(0, 200).join('\n') || '(no matches)'
    },
  },
  {
    name: 'run_bash',
    description: 'Run a shell command in the working directory and return its output.',
    mutating: true,
    source: 'builtin',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    run: (args, ctx) => {
      const r = shell(str(args, 'command'), { cwd: ctx.cwd, timeout: 60_000 })
      const body = (r.stdout + r.stderr).trim()
      return r.exitCode === 0 ? body || '(no output)' : `exit ${r.exitCode}\n${body}`
    },
  },
]

export function registerBuiltins(): void {
  registerTools(BUILTINS)
}
