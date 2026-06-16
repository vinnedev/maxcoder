// tests/models/adapters/ollama/index.test.ts  ←mirrors→  src/models/adapters/ollama/index.ts
import { expect, mock, test } from 'bun:test'

// Capture calls into the provider chat() so we can assert JSON-mode is requested. Spread the real
// module so other exports survive (mock.module is process-wide in Bun) — override only `chat`.
import * as ollamaReal from '../../../../src/providers/ollama/index.ts'
const calls: Array<Record<string, unknown>> = []
mock.module('../../../../src/providers/ollama/index.ts', () => ({
  ...ollamaReal,
  chat: async (opts: Record<string, unknown>) => {
    calls.push(opts)
    return { text: 'noise {"effort":"high"} tail', toolCalls: [], emulated: false, promptTokens: 0, evalTokens: 0 }
  },
}))

const { OllamaAdapter, parseModelSize, recommendedEffort } = await import('../../../../src/models/adapters/ollama/index.ts')
const { createAdapter } = await import('../../../../src/models/index.ts')

test('parseModelSize reads the parameter size from the id', () => {
  expect(parseModelSize('qwen2.5-coder:3b')).toBe('3b')
  expect(parseModelSize('llama3.1:8b')).toBe('8b')
  expect(parseModelSize('mistral')).toBeUndefined()
})

test('recommendedEffort: smaller model → more system effort', () => {
  expect(recommendedEffort('3b')).toBe('high')
  expect(recommendedEffort('7b')).toBe('medium')
  expect(recommendedEffort('70b')).toBe('low')
  expect(recommendedEffort(undefined)).toBe('medium')
})

test('capabilities reflect the model and context window', () => {
  const a = new OllamaAdapter('qwen2.5-coder:3b', 16384)
  expect(a.id).toBe('qwen2.5-coder:3b')
  expect(a.capabilities.supportsTools).toBe(true)
  expect(a.capabilities.supportsJsonMode).toBe(true)
  expect(a.capabilities.contextWindow).toBe(16384)
  expect(a.capabilities.modelSize).toBe('3b')
  expect(a.capabilities.recommendedEffortProfile).toBe('high')
})

test('countTokens returns a positive estimate', () => {
  const a = new OllamaAdapter('qwen2.5-coder:3b')
  expect(a.countTokens('hello world')).toBeGreaterThan(0)
})

test('generateJson requests JSON-mode and parses the result', async () => {
  calls.length = 0
  const a = new OllamaAdapter('qwen2.5-coder:3b')
  const r = await a.generateJson<{ effort: string }>({ messages: [{ role: 'user', content: 'assess' }] })
  expect(r.data).toEqual({ effort: 'high' })
  expect(calls[0].format).toBe('json') // JSON-mode requested
  expect(calls[0].model).toBe('qwen2.5-coder:3b')
})

test('createAdapter returns an Ollama adapter by default', () => {
  const a = createAdapter('qwen2.5-coder:3b', { contextWindow: 8192 })
  expect(a).toBeInstanceOf(OllamaAdapter)
  expect(a.capabilities.contextWindow).toBe(8192)
})
