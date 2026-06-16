// tests/core/agent/index.test.ts  ←mirrors→  src/core/agent/index.ts
// Regression test for the read-only allow-list: a fabricated/hallucinated tool call
// to a tool that is NOT in `p.tools` must be rejected and must never reach the global
// registry (otherwise a read-only background task could call a mutating tool).
import { afterAll, expect, mock, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { existsSync, rmSync } from 'node:fs'

// The agent imports `chat` from the ollama provider at module load. Replace it with a
// scripted fake BEFORE dynamically importing runAgent, so no network call happens.
let chatCalls = 0
let scripted: Array<{ text: string; toolCalls: Array<{ name: string; args: Record<string, unknown> }> }> = []
mock.module('../../../src/providers/ollama/index.ts', () => ({
  chat: async () => {
    const r = scripted[Math.min(chatCalls, scripted.length - 1)]
    chatCalls++
    return { text: r.text, toolCalls: r.toolCalls, emulated: false, promptTokens: 0, evalTokens: 0 }
  },
}))

const { runAgent } = await import('../../../src/core/agent/index.ts')
const { allTools } = await import('../../../src/tools.ts')

const tmpFile = path.join(os.tmpdir(), `maxcoder-allowlist-${process.pid}.txt`)
afterAll(() => { if (existsSync(tmpFile)) rmSync(tmpFile) })

test('rejects a tool call absent from the allow-list without touching the global registry', async () => {
  chatCalls = 0
  // 1st turn: model fabricates a write_file call (a real, registered, mutating tool).
  // 2nd turn: model "gives up" and produces a final answer so the loop terminates.
  scripted = [
    { text: '', toolCalls: [{ name: 'write_file', args: { path: tmpFile, content: 'PWNED' } }] },
    { text: 'done', toolCalls: [] },
  ]

  // Read-only context: exclude every mutating tool, exactly like `/bg` does.
  const readOnly = allTools().filter(t => !t.mutating)
  expect(readOnly.some(t => t.name === 'write_file')).toBe(false)

  const events: Array<{ type: string; name?: string; result?: string }> = []
  await runAgent({
    task: 'write a file',
    model: 'test-model',
    numCtx: 8192,
    messages: [],
    tools: readOnly,
    onEvent: e => events.push(e as never),
  })

  const toolResult = events.find(e => e.type === 'tool_result' && e.name === 'write_file')
  expect(toolResult?.result).toBe('ERROR: tool "write_file" is not available in this context.')
  // The mutating tool never ran, so its side effect (the file) must not exist.
  expect(existsSync(tmpFile)).toBe(false)
})
