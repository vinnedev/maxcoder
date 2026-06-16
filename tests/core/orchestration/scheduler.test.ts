// tests/core/orchestration/scheduler.test.ts  ←mirrors→  src/core/orchestration/scheduler.ts
import { expect, test } from 'bun:test'
import { runDag } from '../../../src/core/orchestration/scheduler.ts'
import type { DagNode } from '../../../src/core/orchestration/types.ts'

test('runs independent nodes and returns outcomes in input order', async () => {
  const nodes: DagNode[] = [{ id: 'a', goal: 'A' }, { id: 'b', goal: 'B' }]
  const out = await runDag(nodes, async n => `did ${n.goal}`)
  expect(out.map(o => o.status)).toEqual(['done', 'done'])
  expect(out.map(o => (o.status === 'done' ? o.result : ''))).toEqual(['did A', 'did B'])
})

test('respects dependencies and passes dependency results to the worker', async () => {
  const order: string[] = []
  const nodes: DagNode[] = [
    { id: 'a', goal: 'A' },
    { id: 'b', goal: 'B', dependsOn: ['a'] },
  ]
  const out = await runDag(nodes, async (n, deps) => {
    order.push(n.id)
    return n.id === 'b' ? `B saw {${Object.keys(deps).join(',')}}=${deps.a}` : 'A-result'
  })
  expect(order).toEqual(['a', 'b']) // a before b
  expect(out[1].status === 'done' && out[1].result).toBe('B saw {a}=A-result')
})

test('honors the concurrency cap', async () => {
  let active = 0
  let peak = 0
  const nodes: DagNode[] = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, goal: `${i}` }))
  await runDag(
    nodes,
    async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return 'ok'
    },
    { concurrency: 2 },
  )
  expect(peak).toBe(2)
})

test('a failed dependency skips its dependents but independents still run', async () => {
  const nodes: DagNode[] = [
    { id: 'a', goal: 'A' },
    { id: 'b', goal: 'B', dependsOn: ['a'] }, // depends on the failing node
    { id: 'c', goal: 'C' }, // independent
  ]
  const out = await runDag(nodes, async n => {
    if (n.id === 'a') throw new Error('a failed')
    return `ok ${n.id}`
  })
  const byId = Object.fromEntries(out.map(o => [o.id, o]))
  expect(byId.a.status).toBe('error')
  expect(byId.b.status).toBe('skipped')
  expect(byId.c.status).toBe('done')
})

test('rejects cycles and unknown dependencies', async () => {
  await expect(runDag([
    { id: 'a', goal: 'A', dependsOn: ['b'] },
    { id: 'b', goal: 'B', dependsOn: ['a'] },
  ], async () => 'x')).rejects.toThrow(/cycle/)

  await expect(runDag([
    { id: 'a', goal: 'A', dependsOn: ['ghost'] },
  ], async () => 'x')).rejects.toThrow(/unknown id/)
})

test('empty graph returns empty', async () => {
  expect(await runDag([], async () => 'x')).toEqual([])
})
