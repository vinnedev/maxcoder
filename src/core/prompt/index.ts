// Max Coder — layered system prompt (identity · environment · behavior · tools · memory).
// Bun-native I/O via fsx. Analog of src/context.ts (getSystemContext/getUserContext) + src/utils/api.ts.

import * as os from 'node:os'
import * as path from 'node:path'
import { gitStatusShort } from '../../shared/config/index.ts'
import { readText } from '../../shared/fs/index.ts'
import { recallForPrompt } from '../memory/index.ts'

const MEMORY_FILES = [
  ['maxcoder.md', 'MAXCODER.md'],
  ['agents.md', 'AGENTS.md'],
  ['claude.md', 'CLAUDE.md'],
]
const MAX_MEMORY_BYTES = 20_000

/** Walk up from cwd collecting project memory files (closest first). */
export async function loadProjectMemory(cwd = process.cwd()): Promise<string> {
  const chunks: string[] = []
  let dir = cwd
  const home = os.homedir()
  let budget = MAX_MEMORY_BYTES
  for (let i = 0; i < 20 && budget > 0; i++) {
    for (const names of MEMORY_FILES) {
      const found = await firstReadable(dir, names)
      if (!found) continue
      const { name, p, text } = found
      if (text) {
        const slice = text.slice(0, budget)
        budget -= slice.length
        chunks.push(`# From ${path.relative(cwd, p) || name}\n${slice}`)
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir || dir === home) break
    dir = parent
  }
  return chunks.join('\n\n')
}

async function firstReadable(dir: string, names: string[]): Promise<{ name: string; p: string; text: string } | null> {
  for (const name of names) {
    const p = path.join(dir, name)
    const text = await readText(p)
    if (text) return { name, p, text }
  }
  return null
}

export interface ToolInfo {
  name: string
  description: string
}

export interface SystemPromptInput {
  cwd?: string
  model: string
  tools: ToolInfo[]
  includeGitStatus?: boolean
  agentRole?: string
}

export async function buildSystemPrompt(input: SystemPromptInput): Promise<string> {
  const cwd = input.cwd ?? process.cwd()
  const blocks: string[] = []

  blocks.push(
    input.agentRole ??
      `You are Max Coder, a local-first AI software-engineering agent running on the user's machine.
You complete coding tasks by reading and editing files and running commands, working autonomously
and verifying your work. You are precise, concise, and you prefer minimal, correct changes.`,
  )

  const now = new Date()
  let tz = 'local'
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  } catch {
    /* keep default */
  }
  const env: string[] = [
    `Working directory: ${cwd}`,
    `Platform: ${process.platform} (${os.arch()})`,
    `Current date & time: ${now.toString()} [${tz}]`,
    `Current date (ISO): ${now.toISOString()}`,
    `Model: ${input.model}`,
  ]
  if (input.includeGitStatus !== false) {
    const status = gitStatusShort(cwd)
    if (status) env.push(`Git status:\n${status}`)
  }
  blocks.push(`<environment>\n${env.join('\n')}\n</environment>`)

  blocks.push(
    `<behavior>
- For the current date, time, weekday, or date math (days between / days until): use the \`datetime\`
  tool. It is ONLY for date/time — NEVER use it for facts like software versions, prices, or news.
- For anything that changes over time or that you are not certain is current — the latest/current
  version, release, price, exchange rate, news, or recent events — you MUST use the \`web_search\`
  tool and cite the sources it returns. Do NOT answer these from memory (your knowledge may be stale)
  and do NOT guess. If web_search returns no usable sources, say you could not verify.
- For greetings and stable general knowledge you are confident about, reply directly with no tool call.
- Never call a tool on a path you are guessing — only on paths you have seen via list_dir/grep or
  that the user gave you. Do not repeat the same tool call.
- Work step by step: call one tool, read its result, then decide the next step.
- Explore before editing (read_file / list_dir / grep). Prefer edit_file over rewriting whole files.
- Keep responses short. Do not narrate routine actions; let tool calls speak.
- When the task is done, reply with a brief plain-text summary and NO tool call.
- Never invent file contents — read them. Never output placeholder text such as [hora atual],
  [TODO], or [valor]; if you do not have a value, say so plainly.
</behavior>`,
  )

  blocks.push(
    `<tools>
You can call these tools. Use native tool calling if supported; otherwise emit ONE tool call as a
single JSON object wrapped as <tool_call>{"name":"<tool>","arguments":{...}}</tool_call> with no prose.
${input.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}
</tools>`,
  )

  const memory = await loadProjectMemory(cwd)
  if (memory) {
    blocks.push(`<project_memory>\nThe following project instructions take precedence:\n\n${memory}\n</project_memory>`)
  }

  const learned = await recallForPrompt(cwd)
  if (learned) {
    blocks.push(`<learned_memory>\nLearned from past sessions (apply when relevant):\n\n${learned}\n</learned_memory>`)
  }

  return blocks.join('\n\n')
}
