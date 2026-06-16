// tests/session.test.ts  ←mirrors→  src/session.ts
// Characterization tests: lock in current persistence/rehydrate behavior before refactor.
import { expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { pickSession, Session, type SessionSummary } from '../../src/sessions/index.ts'

process.env.MAXCODER_CONFIG_DIR = path.join(os.tmpdir(), `maxcoder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

test('records messages and rehydrates them (system messages are dropped)', async () => {
  const s = new Session({ model: 'test-model', cwd: '/tmp/proj-a' })
  s.record({ role: 'user', content: 'hi' })
  s.record({ role: 'assistant', content: 'hello', tool_calls: [{ function: { name: 'x', arguments: {} } }] })
  s.record({ role: 'tool', content: 'result' })
  s.record({ role: 'system', content: 'should be dropped' })

  const msgs = await Session.rehydrate(s.file)
  expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'tool'])
  expect(msgs[1].tool_calls?.[0].function.name).toBe('x')
})

test('compaction boundary: rehydrate keeps the summary + messages after it', async () => {
  const s = new Session({ model: 'm', cwd: '/tmp/proj-b' })
  s.record({ role: 'user', content: 'old1' })
  s.record({ role: 'assistant', content: 'old2' })
  s.recordCompaction('THE SUMMARY')
  s.record({ role: 'user', content: 'new1' })

  const msgs = await Session.rehydrate(s.file)
  expect(msgs[0].role).toBe('user')
  expect(msgs[0].content).toContain('THE SUMMARY')
  expect(msgs[msgs.length - 1].content).toBe('new1')
  expect(msgs.some(m => m.content === 'old1')).toBe(false) // pre-boundary dropped from active context
})

test('pickSession selects latest, by 1-based index, or by id prefix', () => {
  const list: SessionSummary[] = [
    { id: 'aaaa1111', file: 'a', updatedAt: 3, messageCount: 1, firstPrompt: '' },
    { id: 'bbbb2222', file: 'b', updatedAt: 2, messageCount: 1, firstPrompt: '' },
  ]
  expect(pickSession(list, 'latest')?.id).toBe('aaaa1111')
  expect(pickSession(list, undefined)?.id).toBe('aaaa1111')
  expect(pickSession(list, '2')?.id).toBe('bbbb2222')
  expect(pickSession(list, 'bbbb')?.id).toBe('bbbb2222')
  expect(pickSession(list, 'zzz')).toBeNull()
  expect(pickSession([], 'latest')).toBeNull()
})
