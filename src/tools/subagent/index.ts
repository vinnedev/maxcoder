// Max Coder — subagents: a `task` tool that delegates to a focused nested agent (Bun-native I/O).
// Custom agent types from ~/.maxcoder/agents/*.md (frontmatter: name, description, tools; body = role).
// Analog of src/tools/AgentTool/* (simplified).

import * as path from 'node:path'
import { agentsDir } from '../../shared/config/index.ts'
import { listDir, readText } from '../../shared/fs/index.ts'
import { parseFrontmatter } from '../skills/index.ts'
import { registerTool } from '../../tools.ts'

export interface AgentType {
  name: string
  description: string
  role: string
  tools?: string[]
}

export async function loadAgentTypes(): Promise<AgentType[]> {
  const out: AgentType[] = []
  for (const entry of listDir(agentsDir())) {
    if (entry.isDirectory() || !entry.name.endsWith('.md')) continue
    const raw = await readText(path.join(agentsDir(), entry.name))
    if (raw === null) continue
    const { meta, body } = parseFrontmatter(raw)
    out.push({
      name: meta.name || entry.name.replace(/\.md$/, ''),
      description: meta.description || '(no description)',
      role: body || `You are the ${meta.name || entry.name} subagent.`,
      tools: meta.tools ? meta.tools.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    })
  }
  return out
}

export async function getAgentType(name?: string): Promise<AgentType | undefined> {
  if (!name) return undefined
  return (await loadAgentTypes()).find(a => a.name === name)
}

export const MAX_SUBAGENT_DEPTH = 2

/** Register the `task` tool. The nested run is provided via ctx.runSubAgent (wired in agent.ts). */
export async function registerTaskTool(): Promise<void> {
  const agents = await loadAgentTypes()
  const typeList = agents.length
    ? ` Available agent_type values: ${agents.map(a => `${a.name} (${a.description})`).join('; ')}.`
    : ''
  registerTool({
    name: 'task',
    source: 'agent',
    mutating: true,
    description:
      'Delegate a self-contained subtask to a subagent that has its own fresh context and reports ' +
      'back a final result. Good for focused research or multi-step subtasks.' + typeList,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'the complete instructions for the subagent' },
        agent_type: { type: 'string', description: 'optional named agent type' },
      },
      required: ['prompt'],
    },
    run: async (args, ctx) => {
      if (!ctx.runSubAgent) return 'ERROR: subagents are not available in this context.'
      if (ctx.depth >= MAX_SUBAGENT_DEPTH) return 'ERROR: maximum subagent depth reached.'
      const prompt = typeof args.prompt === 'string' ? args.prompt : ''
      if (!prompt) return 'ERROR: "prompt" is required.'
      return ctx.runSubAgent(prompt, {
        agentType: typeof args.agent_type === 'string' ? args.agent_type : undefined,
      })
    },
  })
}
