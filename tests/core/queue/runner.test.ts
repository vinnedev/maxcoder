// tests/core/queue/runner.test.ts  ←mirrors→  src/core/queue/runner.ts
import { expect, test } from 'bun:test'
import { PromptQueue } from '../../../src/core/queue/index.ts'
import { drainQueue } from '../../../src/core/queue/runner.ts'

function makeQueue() {
  let n = 0
  return new PromptQueue(() => `id${++n}`, () => 1000)
}

test('drains pending items in order, single-flight, marking them done', async () => {
  const q = makeQueue()
  q.enqueue('a')
  q.enqueue('b')
  const ran: string[] = []
  const processed = await drainQueue({ queue: q, run: async item => { ran.push(item.text); return `done:${item.text}` } })
  expect(processed).toBe(2)
  expect(ran).toEqual(['a', 'b'])
  expect(q.get('id1')?.status).toBe('done')
  expect(q.get('id1')?.result).toBe('done:a')
})

test('a failing run marks the item errored and continues with the rest', async () => {
  const q = makeQueue()
  q.enqueue('a')
  q.enqueue('b')
  const errors: string[] = []
  await drainQueue({
    queue: q,
    run: async item => {
      if (item.text === 'a') throw new Error('boom')
      return 'ok'
    },
    onError: (item, e) => errors.push(`${item.text}:${(e as Error).message}`),
  })
  expect(q.get('id1')?.status).toBe('error')
  expect(q.get('id1')?.error).toBe('boom')
  expect(q.get('id2')?.status).toBe('done')
  expect(errors).toEqual(['a:boom'])
})

test('respects paused (drains nothing while paused)', async () => {
  const q = makeQueue()
  q.enqueue('a')
  q.paused = true
  const processed = await drainQueue({ queue: q, run: async () => 'x' })
  expect(processed).toBe(0)
  expect(q.pending()).toHaveLength(1)
})

test('empty queue drains zero', async () => {
  const q = makeQueue()
  expect(await drainQueue({ queue: q, run: async () => 'x' })).toBe(0)
})

test('concurrent drains are single-flight (each item runs exactly once)', async () => {
  const q = makeQueue()
  q.enqueue('a')
  q.enqueue('b')
  const ran: string[] = []
  const run = async (item: { text: string }) => {
    await new Promise(r => setTimeout(r, 5))
    ran.push(item.text)
    return 'ok'
  }
  const [c1, c2] = await Promise.all([drainQueue({ queue: q, run }), drainQueue({ queue: q, run })])
  expect(ran.sort()).toEqual(['a', 'b']) // each processed once, not twice
  expect(c1 + c2).toBe(2)
})
