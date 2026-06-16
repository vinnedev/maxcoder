// Max Coder — Model Adapter Layer types. The agent talks to models ONLY through this interface,
// so swapping Ollama for a larger model (or a future OpenAI/Anthropic-compatible backend) is additive.
// Message/tool/result shapes are the OpenAI-style ones already used across the codebase.

import type { ChatMessage, ChatResult, ToolDef } from '../providers/ollama/index.ts'
import type { EffortLevel } from '../core/effort/profiles.ts'

export type { ChatMessage, ChatResult, ToolDef }

export interface ModelCapabilities {
  supportsTools: boolean
  supportsJsonMode: boolean
  contextWindow: number
  modelSize?: string // e.g. "3b", "7b" (best-effort, parsed from the id)
  recommendedEffortProfile: EffortLevel
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ToolDef[]
  temperature?: number
  signal?: AbortSignal
  onText?: (delta: string) => void
}

export interface GenerateJsonRequest {
  messages: ChatMessage[]
  /** Optional JSON schema to constrain the output; omitted → plain JSON-mode. */
  schema?: Record<string, unknown>
  temperature?: number
  signal?: AbortSignal
}

export interface GenerateJsonResult<T = unknown> {
  data: T | null // null when the model produced no valid JSON
  raw: string
}

/** Uniform model interface. Implementations bind a specific model id. */
export interface ModelAdapter {
  readonly id: string
  readonly capabilities: ModelCapabilities
  chat(req: ChatRequest): Promise<ChatResult>
  stream(req: ChatRequest): Promise<ChatResult> // streams via req.onText, returns the final result
  generateJson<T = unknown>(req: GenerateJsonRequest): Promise<GenerateJsonResult<T>>
  countTokens(text: string): number // best-effort estimate when the backend exposes no tokenizer
}
