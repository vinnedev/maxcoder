// Max Coder — model adapter factory. Routes a model id to its adapter. Today everything is Ollama;
// future OpenAI/Anthropic-compatible backends register here by id scheme (e.g. "openai:gpt-...").

import { OllamaAdapter } from './adapters/ollama/index.ts'
import type { ModelAdapter } from './types.ts'

export type {
  ChatRequest,
  GenerateJsonRequest,
  GenerateJsonResult,
  ModelAdapter,
  ModelCapabilities,
} from './types.ts'

export interface CreateAdapterOptions {
  contextWindow?: number
}

// Lookup table of providers by id-scheme matcher (first match wins). Default → Ollama.
const PROVIDERS: Array<{ match: (id: string) => boolean; create: (id: string, o: CreateAdapterOptions) => ModelAdapter }> = [
  // { match: id => id.startsWith('openai:'), create: ... },     // future (P-later)
  // { match: id => id.startsWith('anthropic:'), create: ... },  // future (P-later)
]

/** Resolve a ModelAdapter for a model id. The agent depends on this, never on a concrete provider. */
export function createAdapter(model: string, opts: CreateAdapterOptions = {}): ModelAdapter {
  const provider = PROVIDERS.find(p => p.match(model))
  if (provider) return provider.create(model, opts)
  return new OllamaAdapter(model, opts.contextWindow)
}
