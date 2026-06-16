// tests/core/tasks/manager.test.ts  ←mirrors→  src/core/tasks/manager.ts
import { expect, test } from 'bun:test'
import { TaskManager } from '../../../src/core/tasks/manager.ts'

function mk() {
  let n = 0
  let now = 1000
  const tm = new TaskManager(() => `t${++n}`, () => (now += 1))
  return tm
}

test('create registers a queued task and returns a copy', () => {
  const tm = mk()
  const t = tm.create('do the thing')
  expect(t.id).toBe('t1')
  expect(t.status).toBe('queued')
  expect(t.kind).toBe('background')
  expect(tm.get('t1')?.goal).toBe('do the thing')
})

test('list is oldest-first; get/list return copies', () => {
  const tm = mk()
  tm.create('a')
  tm.create('b')
  expect(tm.list().map(t => t.goal)).toEqual(['a', 'b'])
  const snap = tm.list()
  snap[0].goal = 'mutated'
  expect(tm.get('t1')?.goal).toBe('a')
})

test('lifecycle: start → finish, with timestamps and terminal-state guards', () => {
  const tm = mk()
  tm.create('x')
  expect(tm.start('t1')).toBe(true)
  expect(tm.get('t1')?.status).toBe('running')
  expect(tm.get('t1')?.startedAt).toBeGreaterThan(0)
  expect(tm.start('t1')).toBe(false) // can't start a running task
  expect(tm.finish('t1', 'result text')).toBe(true)
  expect(tm.get('t1')?.status).toBe('done')
  expect(tm.get('t1')?.result).toBe('result text')
  expect(tm.finish('t1', 'again')).toBe(false) // already terminal
})

test('fail and cancel transitions', () => {
  const tm = mk()
  tm.create('x')
  expect(tm.fail('t1', 'boom')).toBe(true)
  expect(tm.get('t1')?.status).toBe('error')
  expect(tm.get('t1')?.error).toBe('boom')

  tm.create('y')
  expect(tm.cancel('t2')).toBe(true)
  expect(tm.get('t2')?.status).toBe('cancelled')
  expect(tm.cancel('t2')).toBe(false) // already terminal
})

test('active() returns queued+running; children() filters by parentId', () => {
  const tm = mk()
  tm.create('root') // t1
  tm.start('t1')
  tm.create('child', 'orchestrated', 't1') // t2
  tm.create('done-one') // t3
  tm.finish('t3', 'r')
  expect(tm.active().map(t => t.id).sort()).toEqual(['t1', 't2'])
  expect(tm.children('t1').map(t => t.goal)).toEqual(['child'])
})

test('update patches progress only', () => {
  const tm = mk()
  tm.create('x')
  expect(tm.update('t1', { progress: '50%' })).toBe(true)
  expect(tm.get('t1')?.progress).toBe('50%')
  expect(tm.update('nope', { progress: 'x' })).toBe(false)
})
