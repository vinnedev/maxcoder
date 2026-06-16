// tests/core/queue/index.test.ts  ←mirrors→  src/core/queue/index.ts
import { expect, test } from 'bun:test'
import { PromptQueue } from '../../../src/core/queue/index.ts'

// Deterministic queue: incrementing ids + fixed clock.
function makeQueue() {
  let n = 0
  return new PromptQueue(() => `id${++n}`, () => 1000)
}

test('enqueue keeps order and exposes pending', () => {
  const q = makeQueue()
  expect(q.enqueue('a')).toBe('id1')
  q.enqueue('b')
  expect(q.list().map(i => i.text)).toEqual(['a', 'b'])
  expect(q.pending()).toHaveLength(2)
  expect(q.get('id1')?.status).toBe('pending')
})

test('edit only affects pending items', () => {
  const q = makeQueue()
  q.enqueue('a')
  expect(q.edit('id1', 'a2')).toBe(true)
  expect(q.get('id1')?.text).toBe('a2')
  q.takeNext() // id1 -> running
  expect(q.edit('id1', 'nope')).toBe(false) // can't edit a running item
})

test('takeNext dequeues in order and respects paused', () => {
  const q = makeQueue()
  q.enqueue('a')
  q.enqueue('b')
  const first = q.takeNext()
  expect(first?.text).toBe('a')
  expect(first?.status).toBe('running')
  q.paused = true
  expect(q.takeNext()).toBeUndefined()
  q.paused = false
  expect(q.takeNext()?.text).toBe('b')
})

test('remove cancels a pending item; clear cancels all pending', () => {
  const q = makeQueue()
  q.enqueue('a')
  q.enqueue('b')
  expect(q.remove('id1')).toBe(true)
  expect(q.get('id1')?.status).toBe('cancelled')
  expect(q.pending().map(i => i.text)).toEqual(['b'])
  q.clear()
  expect(q.pending()).toHaveLength(0)
})

test('move reorders pending items', () => {
  const q = makeQueue()
  q.enqueue('a')
  q.enqueue('b')
  q.enqueue('c')
  expect(q.move('id3', 0)).toBe(true) // c to front
  expect(q.pending().map(i => i.text)).toEqual(['c', 'a', 'b'])
})

test('complete and fail set terminal status + payload', () => {
  const q = makeQueue()
  q.enqueue('a')
  const item = q.takeNext()!
  q.complete(item.id, 'done!')
  expect(q.get(item.id)?.status).toBe('done')
  expect(q.get(item.id)?.result).toBe('done!')

  q.enqueue('b')
  const b = q.takeNext()!
  q.fail(b.id, 'boom')
  expect(q.get(b.id)?.status).toBe('error')
  expect(q.get(b.id)?.error).toBe('boom')
})

test('list/get return copies (no external mutation of internal state)', () => {
  const q = makeQueue()
  q.enqueue('a')
  const snapshot = q.list()
  snapshot[0].text = 'mutated'
  expect(q.get('id1')?.text).toBe('a')
})
