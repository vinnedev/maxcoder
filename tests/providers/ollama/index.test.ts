// Unit tests for the emulated tool-call parser (the trickiest pure logic).
// Run: `bun test`  (from maxcoder/)

import { expect, test } from 'bun:test'
import { parseEmulatedToolCalls } from '../../../src/providers/ollama/index.ts'

const names = ['read_file', 'write_file', 'edit_file']

test('parses a <tool_call> tag', () => {
  const out = parseEmulatedToolCalls(
    'sure<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>',
    names,
  )
  expect(out).toEqual([{ name: 'read_file', args: { path: 'a.ts' } }])
})

test('parses a fenced ```json block', () => {
  const out = parseEmulatedToolCalls(
    'Here:\n```json\n{"name":"write_file","arguments":{"path":"b","content":"x"}}\n```',
    names,
  )
  expect(out).toEqual([{ name: 'write_file', args: { path: 'b', content: 'x' } }])
})

test('parses a bare JSON object', () => {
  const out = parseEmulatedToolCalls('{"name":"read_file","arguments":{"path":"c"}}', names)
  expect(out).toEqual([{ name: 'read_file', args: { path: 'c' } }])
})

test('accepts tool/input aliases and defaults missing args to {}', () => {
  const out = parseEmulatedToolCalls('{"tool":"list_dir"}', [])
  expect(out).toEqual([{ name: 'list_dir', args: {} }])
})

test('ignores a name not in the provided tool set', () => {
  expect(parseEmulatedToolCalls('{"name":"rm_rf","arguments":{}}', names)).toEqual([])
})

test('returns [] when there is no tool call', () => {
  expect(parseEmulatedToolCalls('just a normal answer, no tools here', names)).toEqual([])
})

test('handles multiple <tool_call> tags', () => {
  const out = parseEmulatedToolCalls(
    '<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>' +
      '<tool_call>{"name":"read_file","arguments":{"path":"b"}}</tool_call>',
    names,
  )
  expect(out).toHaveLength(2)
  expect(out[1]).toEqual({ name: 'read_file', args: { path: 'b' } })
})
