// tests/shared/errors/index.test.ts  ←mirrors→  src/shared/errors/index.ts
import { expect, test } from 'bun:test'
import {
  AppError,
  ConfigurationError,
  isAppError,
  ProviderError,
  ToolExecutionError,
  toMessage,
  ValidationError,
} from '../../../src/shared/errors/index.ts'

test('error classes extend Error and AppError with a stable code + name', () => {
  const v = new ValidationError('bad input')
  expect(v).toBeInstanceOf(Error)
  expect(v).toBeInstanceOf(AppError)
  expect(v.code).toBe('VALIDATION')
  expect(v.name).toBe('ValidationError')
  expect(v.message).toBe('bad input')

  expect(new ConfigurationError('no key').code).toBe('CONFIGURATION')
})

test('ProviderError / ToolExecutionError carry context + cause', () => {
  const cause = new Error('socket hang up')
  const p = new ProviderError('ollama', 'unreachable', cause)
  expect(p.provider).toBe('ollama')
  expect(p.code).toBe('PROVIDER')
  expect(p.cause).toBe(cause)

  const t = new ToolExecutionError('web_search', 'timeout')
  expect(t.tool).toBe('web_search')
  expect(t.code).toBe('TOOL_EXECUTION')
})

test('isAppError distinguishes app errors from plain errors', () => {
  expect(isAppError(new ValidationError('x'))).toBe(true)
  expect(isAppError(new Error('x'))).toBe(false)
  expect(isAppError('x')).toBe(false)
})

test('toMessage normalizes any thrown value', () => {
  expect(toMessage(new Error('boom'))).toBe('boom')
  expect(toMessage('raw string')).toBe('raw string')
  expect(toMessage({ a: 1 })).toBe('{"a":1}')
  expect(toMessage(42)).toBe('42')
})
