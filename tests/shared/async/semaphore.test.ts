// tests/shared/async/semaphore.test.ts  ←mirrors→  src/shared/async/semaphore.ts
import { expect, test } from 'bun:test'
import { Semaphore } from '../../../src/shared/async/semaphore.ts'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

test('capacity bounds concurrency: only N run at once, the rest queue', async () => {
  const sem = new Semaphore(2)
  const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
  let active = 0
  let peak = 0
  const started: number[] = []

  const launch = (i: number) =>
    sem.run(async () => {
      started.push(i)
      active++
      peak = Math.max(peak, active)
      await gates[i].promise
      active--
    })

  const all = [launch(0), launch(1), launch(2)]
  await new Promise(r => setTimeout(r, 0))

  expect(started).toEqual([0, 1]) // 3rd is queued
  expect(sem.queued).toBe(1)

  gates[0].resolve()
  await new Promise(r => setTimeout(r, 0))
  expect(started).toEqual([0, 1, 2]) // a permit freed → 3rd started

  gates[1].resolve()
  gates[2].resolve()
  await Promise.all(all)
  expect(peak).toBe(2) // never more than capacity ran together
  expect(sem.available).toBe(2) // all permits returned
})

test('release returns a permit even when the task throws', async () => {
  const sem = new Semaphore(1)
  await expect(sem.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
  expect(sem.available).toBe(1) // not leaked
})

test('capacity is clamped to at least 1', () => {
  expect(new Semaphore(0).available).toBe(1)
  expect(new Semaphore(-5).available).toBe(1)
})
