// Max Coder — Ollama backend client (zero deps; uses global fetch).
// Streams /api/chat, supports native tool_calls and an emulated fallback for
// small models that emit tool calls as text (e.g. qwen2.5-coder:3b).

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: OllamaToolCall[]
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
  emulated: boolean
  promptTokens: number
  evalTokens: number
}

export function baseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '')
}

export function defaultModel(): string {
  return process.env.MAXCODER_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b'
}

function numCtx(): number {
  const n = Number.parseInt(process.env.MAXCODER_NUM_CTX || process.env.OLLAMA_NUM_CTX || '', 10)
  return Number.isFinite(n) && n > 0 ? n : 32768
}

/** Recover a tool call the model emitted as plain text (emulated tool-calling). */
export function parseEmulatedToolCalls(text: string, toolNames: string[]): ToolCall[] {
  if (!text) return []
  const names = new Set(toolNames)
  const candidates: string[] = []
  const reTag = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g
  const reFence = /```(?:json|tool_code)?\s*(\{[\s\S]*?\})\s*```/g
  let m: RegExpExecArray | null
  while ((m = reTag.exec(text))) candidates.push(m[1])
  while ((m = reFence.exec(text))) candidates.push(m[1])
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed)
  if (candidates.length === 0) {
    const first = trimmed.match(/\{[\s\S]*\}/)
    if (first) candidates.push(first[0])
  }
  const calls: ToolCall[] = []
  for (const cand of candidates) {
    let obj: any
    try {
      obj = JSON.parse(cand)
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object') continue
    const name = obj.name ?? obj.tool ?? obj.function
    let args = obj.arguments ?? obj.input ?? obj.parameters
    if (typeof name === 'string' && (names.size === 0 || names.has(name))) {
      if (!args || typeof args !== 'object') args = {}
      calls.push({ name, args })
    }
  }
  return calls
}

export interface ChatOpts {
  model: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  temperature?: number
  onText?: (delta: string) => void
  signal?: AbortSignal
}

export async function chat(opts: ChatOpts): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    options: { num_ctx: numCtx(), temperature: opts.temperature ?? 0.1 },
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (e) {
    throw new Error(
      `Cannot reach Ollama at ${baseUrl()} (${e instanceof Error ? e.message : e}). ` +
        `Is it running?  Try:  ollama serve`,
    )
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    if (res.status === 404) {
      throw new Error(`Model not found. Try:  ollama pull ${opts.model}\n${detail}`)
    }
    throw new Error(`Ollama error ${res.status}: ${detail}`)
  }

  let text = ''
  // Suppress live streaming once the output looks like an emulated tool call (JSON / <tool_call>),
  // so only real answer text streams to the UI — tool turns render cleanly via the tool events.
  let suppressedStream = false
  const native: OllamaToolCall[] = []
  let promptTokens = 0
  let evalTokens = 0
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let chunk: any
      try {
        chunk = JSON.parse(line)
      } catch {
        continue
      }
      const msg = chunk.message || {}
      if (msg.content) {
        text += msg.content
        if (opts.onText && !suppressedStream) {
          if (/^\s*(\{|<tool_call>)/.test(text)) suppressedStream = true
          else opts.onText(msg.content)
        }
      }
      if (Array.isArray(msg.tool_calls)) native.push(...msg.tool_calls)
      if (chunk.done) {
        promptTokens = chunk.prompt_eval_count || 0
        evalTokens = chunk.eval_count || 0
      }
    }
  }

  let toolCalls: ToolCall[] = native.map(tc => ({
    name: tc.function?.name ?? '',
    args: (tc.function?.arguments as Record<string, unknown>) ?? {},
  }))
  let emulated = false
  if (toolCalls.length === 0 && opts.tools && opts.tools.length > 0) {
    toolCalls = parseEmulatedToolCalls(text, opts.tools.map(t => t.name))
    emulated = toolCalls.length > 0
  }

  return { text, toolCalls, emulated, promptTokens, evalTokens }
}

export interface OllamaModel {
  name: string
}

export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl()}/api/tags`)
    if (!res.ok) return []
    const data = (await res.json()) as { models?: OllamaModel[] }
    return (data.models ?? []).map(m => m.name)
  } catch {
    return []
  }
}
