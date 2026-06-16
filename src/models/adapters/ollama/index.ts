// Max Coder — OllamaAdapter: the local backend behind the ModelAdapter interface.
// Wraps the existing provider `chat()` additively (same behaviour), and adds JSON-mode via `format`.

import { chat, type ChatResult } from '../../../providers/ollama/index.ts'
import { extractJsonValue } from '../../../shared/json/index.ts'
import type { EffortLevel } from '../../../core/effort/profiles.ts'
import type {
  ChatRequest,
  GenerateJsonRequest,
  GenerateJsonResult,
  ModelAdapter,
  ModelCapabilities,
} from '../../types.ts'

/** Parse a parameter size like "3b"/"7b" from a model id (best-effort). */
export function parseModelSize(id: string): string | undefined {
  const m = id.match(/[:\-/](\d+(?:\.\d+)?)b\b/i)
  return m ? `${m[1]}b` : undefined
}

/** Smaller models get a higher recommended effort — the system compensates for the weaker model. */
export function recommendedEffort(size?: string): EffortLevel {
  const n = size ? Number.parseFloat(size) : Number.NaN
  if (!Number.isFinite(n)) return 'medium'
  if (n <= 3) return 'high'
  if (n <= 13) return 'medium'
  return 'low'
}

export class OllamaAdapter implements ModelAdapter {
  readonly id: string
  readonly capabilities: ModelCapabilities

  constructor(id: string, contextWindow = 8192) {
    this.id = id
    const modelSize = parseModelSize(id)
    this.capabilities = {
      supportsTools: true, // native tool-calls + emulated fallback in the provider
      supportsJsonMode: true,
      contextWindow,
      modelSize,
      recommendedEffortProfile: recommendedEffort(modelSize),
    }
  }

  chat(req: ChatRequest): Promise<ChatResult> {
    return chat({ model: this.id, ...req })
  }

  /** Streaming is driven by req.onText; identical call, named for intent. */
  stream(req: ChatRequest): Promise<ChatResult> {
    return chat({ model: this.id, ...req })
  }

  async generateJson<T = unknown>(req: GenerateJsonRequest): Promise<GenerateJsonResult<T>> {
    const res = await chat({
      model: this.id,
      messages: req.messages,
      temperature: req.temperature ?? 0,
      format: req.schema ?? 'json',
      signal: req.signal,
    })
    return { data: extractJsonValue<T>(res.text), raw: res.text }
  }

  /** No public Ollama tokenizer here → rough estimate (~4 chars/token). */
  countTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }
}
