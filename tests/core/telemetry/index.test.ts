// tests/core/telemetry/index.test.ts  ←mirrors→  src/core/telemetry/index.ts
import { afterAll, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { jsonlSink, logsDir, RunRecorder, type TelemetryEvent } from '../../../src/core/telemetry/index.ts'

function fixedClock(times: number[]): () => number {
  let i = 0
  return () => times[Math.min(i++, times.length - 1)]
}

test('records run_start, tools, and a run_end summary with duration', () => {
  const events: TelemetryEvent[] = []
  // clock order: constructor(1000) → tool(1100) → end(1500)
  const rec = new RunRecorder(e => events.push(e), { model: 'qwen2.5-coder:3b', effort: 'auto', task: 'fix the bug' }, fixedClock([1000, 1100, 1500]))
  rec.turn()
  rec.tool('read_file', true)
  rec.tokens(42)
  const summary = rec.end(true)

  expect(events[0].kind).toBe('run_start')
  expect(events.some(e => e.kind === 'tool')).toBe(true)
  expect(summary.ok).toBe(true)
  expect(summary.tools).toBe(1)
  expect(summary.turns).toBe(1)
  expect(summary.tokens).toBe(42)
  expect(summary.ms).toBe(500) // 1500 - 1000
  expect(events.at(-1)?.kind).toBe('run_end')
})

test('captures failure with an error and the peak token count', () => {
  const events: TelemetryEvent[] = []
  const rec = new RunRecorder(e => events.push(e), { model: 'm', task: 't' }, fixedClock([0, 10]))
  rec.tokens(10)
  rec.tokens(5) // lower → peak stays 10
  const summary = rec.end(false, 'boom')
  expect(summary.ok).toBe(false)
  expect(summary.error).toBe('boom')
  expect(summary.tokens).toBe(10)
})

test('jsonlSink writes one JSON line per event to .maxcoder/logs', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-tlm-'))
  const sink = jsonlSink(root)
  sink({ kind: 'tool', at: 1, name: 'read_file', ok: true })
  sink({ kind: 'tool', at: 2, name: 'write_file', ok: false })
  const text = readFileSync(path.join(logsDir(root), 'runs.jsonl'), 'utf8')
  const lines = text.trim().split('\n')
  expect(lines.length).toBe(2)
  expect(JSON.parse(lines[0]).name).toBe('read_file')
  rmSync(root, { recursive: true, force: true })
})

test('long task descriptions are truncated in events', () => {
  const events: TelemetryEvent[] = []
  const rec = new RunRecorder(e => events.push(e), { model: 'm', task: 'x'.repeat(500) }, fixedClock([0]))
  rec.end(true)
  const start = events[0]
  if (start.kind === 'run_start') expect(start.task.length).toBeLessThanOrEqual(201)
})
