// tests/core/tasks/runner.test.ts  ←mirrors→  src/core/tasks/runner.ts
import { expect, test } from 'bun:test'
import { TaskManager } from '../../../src/core/tasks/manager.ts'
import { BackgroundRunner } from '../../../src/core/tasks/runner.ts'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mkManager() {
  let n = 0
  let now = 0
  return new TaskManager(() => `t${++n}`, () => (now += 1))
}

test('starts a task, runs it, and marks it done with the result', async () => {
  const manager = mkManager()
  const runner = new BackgroundRunner({ manager, run: async t => `result of ${t.goal}` })
  const id = runner.start('build the thing')
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
  expect(manager.get(id)?.status).toBe('done')
  expect(manager.get(id)?.result).toBe('result of build the thing')
})

test('bounded concurrency: max 2 run at once, the rest wait', async () => {
  const manager = mkManager()
  const gates = [deferred<string>(), deferred<string>(), deferred<string>()]
  let order = 0
  const startOrder: number[] = []
  const runner = new BackgroundRunner({
    manager,
    maxConcurrent: 2,
    run: t => {
      startOrder.push(++order)
      return gates[Number(t.goal)].promise
    },
  })
  runner.start('0')
  runner.start('1')
  runner.start('2')
  await new Promise(r => setTimeout(r, 0))
  expect(runner.running).toBe(2) // only 2 in flight
  expect(startOrder).toEqual([1, 2]) // 3rd hasn't started

  gates[0].resolve('done0')
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
  expect(startOrder).toEqual([1, 2, 3]) // a slot freed → 3rd started
  gates[1].resolve('x')
  gates[2].resolve('x')
})

test('a throwing run marks the task errored', async () => {
  const manager = mkManager()
  const runner = new BackgroundRunner({ manager, run: async () => { throw new Error('boom') } })
  const id = runner.start('x')
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
  expect(manager.get(id)?.status).toBe('error')
  expect(manager.get(id)?.error).toBe('boom')
})

test('cancel aborts the run signal and marks cancelled', async () => {
  const manager = mkManager()
  let sawAbort = false
  const gate = deferred<string>()
  const runner = new BackgroundRunner({
    manager,
    run: (_t, signal) => {
      signal.addEventListener('abort', () => {
        sawAbort = true
        gate.resolve('aborted')
      })
      return gate.promise
    },
  })
  const id = runner.start('x')
  await new Promise(r => setTimeout(r, 0))
  expect(runner.cancel(id)).toBe(true)
  expect(sawAbort).toBe(true)
  expect(manager.get(id)?.status).toBe('cancelled')
})
