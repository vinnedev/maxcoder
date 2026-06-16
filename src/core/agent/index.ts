// Max Coder — the agentic loop. Wires the model, tool registry, session persistence,
// context auto-compaction, layered system prompt, and subagent recursion.
// Analog of src/query.ts (drastically simplified).

import { compact, shouldCompact, usage } from '../context/index.ts'
import { chat, type ChatMessage, type ToolCall } from '../../providers/ollama/index.ts'
import type { Session } from '../../sessions/index.ts'
import { getAgentType } from '../../tools/subagent/index.ts'
import { buildSystemPrompt } from '../prompt/index.ts'
import { executeTool, toolDefs, toolInfos, type Tool, type ToolContext } from '../../tools.ts'

export type AgentEvent =
  | { type: 'stream'; text: string; depth: number }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; emulated: boolean; depth: number }
  | { type: 'tool_result'; name: string; result: string; depth: number }
  | { type: 'final'; text: string; depth: number }
  | { type: 'info'; text: string }
  | { type: 'usage'; tokens: number; pct: number }
  | { type: 'turn'; n: number }

export interface RunAgentParams {
  task: string
  model: string
  numCtx: number
  messages: ChatMessage[] // running context (mutated in place)
  tools: Tool[]
  session?: Session // persistence (main loop only; subagents pass undefined)
  onEvent: (e: AgentEvent) => void
  confirm?: (c: ToolCall) => boolean | Promise<boolean>
  depth?: number
  agentRole?: string
  maxTurns?: number
  signal?: AbortSignal
}

export async function runAgent(p: RunAgentParams): Promise<string> {
  const depth = p.depth ?? 0
  const maxTurns = p.maxTurns ?? 16
  const systemPrompt = await buildSystemPrompt({
    model: p.model,
    tools: toolInfos(p.tools),
    agentRole: p.agentRole,
  })

  const ctx: ToolContext = {
    cwd: process.cwd(),
    model: p.model,
    depth,
    signal: p.signal,
    runSubAgent: async (subTask, opts) => {
      const at = await getAgentType(opts.agentType)
      const subTools = at?.tools ? p.tools.filter(t => at.tools!.includes(t.name)) : p.tools
      return runAgent({
        task: subTask,
        model: p.model,
        numCtx: p.numCtx,
        messages: [],
        tools: subTools,
        onEvent: p.onEvent,
        depth: depth + 1,
        agentRole:
          at?.role ??
          'You are a focused Max Coder subagent. Complete the delegated task autonomously and ' +
          'report a concise final result. You cannot ask the user questions.',
        signal: p.signal,
      })
    },
  }

  const userMsg: ChatMessage = { role: 'user', content: p.task }
  p.messages.push(userMsg)
  p.session?.record(userMsg)

  const callCounts = new Map<string, number>()
  const nameCounts = new Map<string, number>()

  for (let turn = 0; turn < maxTurns; turn++) {
    if (p.signal?.aborted) return ''

    // Auto-compaction (main loop only).
    if (p.session && shouldCompact(p.messages, p.numCtx)) {
      const r = await compact(p.messages, p.model, p.numCtx)
      p.messages.splice(0, p.messages.length, ...r.messages)
      p.session.recordCompaction(r.summary)
      p.onEvent({ type: 'info', text: `auto-compacted context: ${r.before} → ${r.after} tokens` })
    }

    const res = await chat({
      model: p.model,
      messages: [{ role: 'system', content: systemPrompt }, ...p.messages],
      tools: toolDefs(p.tools),
      signal: p.signal,
      onText: delta => p.onEvent({ type: 'stream', text: delta, depth }),
    })

    const u = usage(p.messages, p.numCtx)
    p.onEvent({ type: 'usage', tokens: u.tokens, pct: u.pct })

    if (res.toolCalls.length === 0) {
      const text = res.text.trim()
      const assistant: ChatMessage = { role: 'assistant', content: res.text }
      p.messages.push(assistant)
      p.session?.record(assistant)
      p.onEvent({ type: 'final', text, depth })
      return text
    }

    const assistant: ChatMessage = {
      role: 'assistant',
      content: res.text,
      tool_calls: res.toolCalls.map(tc => ({ function: { name: tc.name, arguments: tc.args } })),
    }
    p.messages.push(assistant)
    p.session?.record(assistant)

    for (const call of res.toolCalls) {
      const tool = p.tools.find(t => t.name === call.name)
      p.onEvent({ type: 'tool_call', name: call.name, args: call.args, emulated: res.emulated, depth })

      const sig = call.name + ':' + JSON.stringify(call.args)
      const seen = (callCounts.get(sig) ?? 0) + 1
      callCounts.set(sig, seen)
      if (seen >= 3) {
        p.onEvent({
          type: 'info',
          text: `Repeated the same ${call.name} call ${seen}× — stopping to avoid a loop. ` +
            `Try a stronger model, e.g. --model qwen2.5-coder:7b.`,
        })
        return ''
      }
      const nameSeen = (nameCounts.get(call.name) ?? 0) + 1
      nameCounts.set(call.name, nameSeen)
      if (nameSeen >= 6) {
        p.onEvent({
          type: 'info',
          text: `Called ${call.name} ${nameSeen}× without converging — stopping. ` +
            `This usually means the model is too small; try --model qwen2.5-coder:7b.`,
        })
        return ''
      }

      let result: string
      if (tool?.mutating && p.confirm && !(await p.confirm(call))) {
        result = '(denied by user)'
      } else {
        result = await executeTool(call.name, call.args, ctx)
      }
      p.onEvent({ type: 'tool_result', name: call.name, result, depth })
      const toolMsg: ChatMessage = { role: 'tool', content: result }
      p.messages.push(toolMsg)
      p.session?.record(toolMsg)
    }
  }

  p.onEvent({ type: 'info', text: `Reached max turns (${maxTurns}).` })
  return ''
}
