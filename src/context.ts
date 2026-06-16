// Max Coder — context management: token estimation + auto-compaction.
// Simplified analog of src/services/compact/* and src/query/tokenBudget.ts.

import { chat, type ChatMessage } from './ollama.ts'

const KEEP_RECENT = 6 // messages kept verbatim after a compaction
const COMPACT_THRESHOLD = 0.75 // compact when estimated usage exceeds this fraction of num_ctx

export function estimateTokens(text: string): number {
  // Rough heuristic (~4 chars/token), matching Claude Code's rough estimator.
  return Math.ceil(text.length / 4)
}

export function messageTokens(m: ChatMessage): number {
  let t = estimateTokens(m.content || '') + 4
  if (m.tool_calls) t += estimateTokens(JSON.stringify(m.tool_calls))
  return t
}

export function contextTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0)
}

export interface ContextUsage {
  tokens: number
  numCtx: number
  pct: number
}

export function usage(messages: ChatMessage[], numCtx: number): ContextUsage {
  const tokens = contextTokens(messages)
  return { tokens, numCtx, pct: numCtx > 0 ? tokens / numCtx : 0 }
}

export function shouldCompact(messages: ChatMessage[], numCtx: number): boolean {
  return usage(messages, numCtx).pct >= COMPACT_THRESHOLD && messages.length > KEEP_RECENT + 2
}

const COMPACT_SYSTEM =
  'You are a context-compaction assistant. Summarize the conversation so the agent can continue ' +
  'without the full history. Capture: the user goal, key decisions, files read/edited and their ' +
  'relevant contents, tool results that matter, and open next steps. Be dense and factual. ' +
  'Output only the summary text.'

export interface CompactResult {
  messages: ChatMessage[]
  summary: string
  before: number
  after: number
}

/**
 * Summarize older messages via the model, keeping the most recent ones verbatim.
 * Returns the new (compacted) active message list plus the summary to persist.
 */
export async function compact(
  messages: ChatMessage[],
  model: string,
  numCtx: number,
): Promise<CompactResult> {
  const before = contextTokens(messages)
  let keepFrom = Math.max(0, messages.length - KEEP_RECENT)
  // Don't begin the kept window on an orphan tool result.
  while (keepFrom < messages.length && messages[keepFrom].role === 'tool') keepFrom++
  const older = messages.slice(0, keepFrom)
  const recent = messages.slice(keepFrom)

  const transcript = older
    .map(m => `${m.role.toUpperCase()}: ${m.content}${m.tool_calls ? ' ' + JSON.stringify(m.tool_calls) : ''}`)
    .join('\n')

  const res = await chat({
    model,
    messages: [
      { role: 'system', content: COMPACT_SYSTEM },
      { role: 'user', content: `Summarize this conversation:\n\n${transcript}` },
    ],
  })
  const summary = res.text.trim() || '(summary unavailable)'
  const newMessages: ChatMessage[] = [
    { role: 'user', content: `[Earlier conversation summary]\n${summary}` },
    ...recent,
  ]
  return { messages: newMessages, summary, before, after: contextTokens(newMessages) }
}
