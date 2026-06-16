// Max Coder — rich date/time utility used by the `datetime` builtin tool.
// Pure + deterministic given a clock. Two concerns kept separate:
//   • now/convert  → instant-aware (timezone, localized time).
//   • diff/until/add → CALENDAR-date math on YYYY-MM-DD keys (DST-safe, no off-by-one for bare dates,
//     no hallucination — all arithmetic is done in JS, the model only reports the numbers).

/** Detect the user's BCP-47 locale from the environment (LC_ALL/LC_TIME/LANG), else Intl. */
export function systemLocale(): string {
  const raw = process.env.LC_ALL || process.env.LC_TIME || process.env.LANG || ''
  const m = raw.match(/^([a-z]{2})[_-]([A-Z]{2})/i)
  if (m) return `${m[1].toLowerCase()}-${m[2].toUpperCase()}`
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US'
  } catch {
    return 'en-US'
  }
}

export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function resolveTimezone(tz?: string): string {
  if (!tz) return systemTimezone()
  const t = tz.trim()
  if (/^(gmt|utc|z|zulu)$/i.test(t)) return 'UTC'
  return t
}

/** 'YYYY-MM-DD' for the calendar day an instant falls on in `tz`. */
function dateKeyInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Resolve an input (undefined=now, bare YYYY-MM-DD=as-is, or full date) to a calendar key in `tz`. */
export function dateKeyOf(s: string | undefined, tz: string, now: Date): string {
  if (!s) return dateKeyInTz(now, tz)
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`)
  return dateKeyInTz(d, tz)
}

/** Signed whole-day difference between two YYYY-MM-DD keys (a→b). */
export function diffKeys(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function addKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + Math.trunc(days) * 86_400_000).toISOString().slice(0, 10)
}

function gmtOffset(d: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d)
    return parts.find(p => p.type === 'timeZoneName')?.value || 'GMT'
  } catch {
    return 'GMT'
  }
}

export interface InstantDescription {
  iso: string
  unix: number
  timezone: string
  locale: string
  gmt_offset: string
  date: string
  weekday: string
  time: string
  formatted: string
  datetime_human: string
}

export function describeInstant(d: Date, tz: string, locale: string): InstantDescription {
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }).format(d)
  const formatted = fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const time = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return {
    iso: d.toISOString(),
    unix: Math.floor(d.getTime() / 1000),
    timezone: tz,
    locale,
    gmt_offset: gmtOffset(d, tz),
    date: dateKeyInTz(d, tz),
    weekday: fmt({ weekday: 'long' }),
    time,
    formatted,
    datetime_human: `${formatted}, ${time}`,
  }
}

/** Localized description of a bare calendar date (anchored at noon UTC for a stable weekday). */
export function describeDateKey(key: string, locale: string) {
  const d = new Date(`${key}T12:00:00Z`)
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }).format(d)
  return { date: key, weekday: fmt({ weekday: 'long' }), formatted: fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) }
}

export interface DatetimeArgs {
  operation?: 'now' | 'convert' | 'diff' | 'add' | 'until'
  date?: string
  to?: string
  days?: number
  timezone?: string
  locale?: string
}

interface DtCtx {
  args: DatetimeArgs
  tz: string
  locale: string
  now: Date
}

// Operation dispatch table (replaces a switch). Each handler returns the result object.
const OPERATIONS: Record<string, (c: DtCtx) => Record<string, unknown>> = {
  now: ({ now, tz, locale }) => ({ operation: 'now', ...describeInstant(now, tz, locale) }),

  convert: ({ args, tz, locale, now }) => {
    const d = args.date ? new Date(args.date) : now
    if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${args.date}`)
    return { operation: 'convert', ...describeInstant(d, tz, locale) }
  },

  diff: ({ args, tz, now }) => {
    const from = dateKeyOf(args.date, tz, now)
    const to = dateKeyOf(args.to, tz, now)
    const days = diffKeys(from, to)
    return { operation: 'diff', from, to, days, days_abs: Math.abs(days), note: `${Math.abs(days)} day(s) between ${from} and ${to}` }
  },

  add: ({ args, tz, locale, now }) => {
    const base = dateKeyOf(args.date, tz, now)
    const result = addKey(base, args.days ?? 0)
    return { operation: 'add', base, days: Math.trunc(args.days ?? 0), result, ...describeDateKey(result, locale) }
  },

  until: ({ args, tz, locale, now }) => {
    const today = dateKeyOf(undefined, tz, now)
    const target = dateKeyOf(args.date, tz, now)
    const days = diffKeys(today, target)
    return { operation: 'until', today, target, days_until: days, ...describeDateKey(target, locale), note: days > 0 ? `${days} day(s) remaining` : days < 0 ? `${-days} day(s) ago` : 'today' }
  },
}

/** Tool entrypoint — returns a JSON string (the tool result). */
export function datetimeTool(args: DatetimeArgs, clock: () => Date = () => new Date()): string {
  const handler = OPERATIONS[args.operation || 'now']
  if (!handler) return JSON.stringify({ error: `unknown operation: ${args.operation}` })
  try {
    const tz = resolveTimezone(args.timezone)
    const locale = args.locale?.trim() || systemLocale()
    return JSON.stringify(handler({ args, tz, locale, now: clock() }))
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'datetime error' })
  }
}

export const DATETIME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operation: { type: 'string', enum: ['now', 'convert', 'diff', 'add', 'until'], description: "What to do. 'now' (default)=current date/time; 'convert'=show a date/time in a timezone; 'diff'=days between date and to; 'add'=date plus days; 'until'=days from today to date." },
    date: { type: 'string', description: 'A date (YYYY-MM-DD) or date-time (ISO). Defaults to now.' },
    to: { type: 'string', description: "Second date for 'diff' (defaults to today)." },
    days: { type: 'integer', description: "Days to add for 'add' (negative subtracts)." },
    timezone: { type: 'string', description: 'IANA timezone (e.g. America/Sao_Paulo) or UTC/GMT. Defaults to the user system timezone.' },
    locale: { type: 'string', description: 'BCP-47 locale (e.g. pt-BR). Defaults to the user system locale.' },
  },
  required: [],
}

export const DATETIME_DESCRIPTION =
  'Get the current date/time or do correct date math: convert timezones (incl. GMT/UTC), days ' +
  'between two dates, add/subtract days, or days until a target date. Returns localized, ' +
  "user-friendly fields — use the `formatted`/`datetime_human`/`weekday` fields in the user's " +
  'language. Use this for ANY date/time question — compute, never guess or read files.'
