// Unit tests for the datetime tool's date math + localization. Run: `bun test`.

import { expect, test } from 'bun:test'
import { addKey, dateKeyOf, datetimeTool, diffKeys, resolveTimezone } from '../../../src/tools/datetime/index.ts'

const clock = () => new Date('2026-06-16T06:50:00Z') // 03:50 in America/Sao_Paulo (UTC-3)

test('resolveTimezone maps GMT/UTC aliases', () => {
  expect(resolveTimezone('GMT')).toBe('UTC')
  expect(resolveTimezone('utc')).toBe('UTC')
  expect(resolveTimezone('America/Sao_Paulo')).toBe('America/Sao_Paulo')
})

test('now is localized to user locale/timezone (pt-BR)', () => {
  const r = JSON.parse(datetimeTool({ operation: 'now', timezone: 'America/Sao_Paulo', locale: 'pt-BR' }, clock))
  expect(r.date).toBe('2026-06-16')
  expect(r.weekday).toBe('terça-feira')
  expect(r.formatted).toContain('junho')
  expect(r.timezone).toBe('America/Sao_Paulo')
  expect(r.gmt_offset).toMatch(/GMT-0?3/)
})

test('diffKeys / diff counts calendar days correctly', () => {
  expect(diffKeys('2026-06-16', '2026-12-25')).toBe(192)
  expect(diffKeys('2026-01-01', '2026-12-31')).toBe(364) // 2026 is not a leap year
  const r = JSON.parse(datetimeTool({ operation: 'diff', date: '2026-01-01', to: '2026-12-31' }, clock))
  expect(r.days).toBe(364)
})

test('until: days remaining has no off-by-one in a negative-offset timezone', () => {
  const r = JSON.parse(datetimeTool({ operation: 'until', date: '2026-12-25', timezone: 'America/Sao_Paulo', locale: 'pt-BR' }, clock))
  expect(r.today).toBe('2026-06-16')
  expect(r.target).toBe('2026-12-25')
  expect(r.days_until).toBe(192) // not 191 — bare dates are treated as calendar dates
  expect(r.formatted).toContain('dezembro')
})

test('add / subtract days', () => {
  expect(addKey('2026-06-16', 10)).toBe('2026-06-26')
  expect(addKey('2026-03-01', -1)).toBe('2026-02-28')
  const r = JSON.parse(datetimeTool({ operation: 'add', date: '2026-06-16', days: 10, locale: 'pt-BR' }, clock))
  expect(r.result).toBe('2026-06-26')
})

test('dateKeyOf resolves bare dates as-is and now in tz', () => {
  expect(dateKeyOf('2026-12-25', 'America/Sao_Paulo', clock())).toBe('2026-12-25')
  expect(dateKeyOf(undefined, 'America/Sao_Paulo', clock())).toBe('2026-06-16')
  expect(dateKeyOf(undefined, 'UTC', clock())).toBe('2026-06-16')
})

test('invalid input returns a clean error (no throw)', () => {
  const r = JSON.parse(datetimeTool({ operation: 'until', date: 'not-a-date' }, clock))
  expect(r.error).toMatch(/invalid date/)
})
