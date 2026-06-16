import type { BlockedUrl, NormalizedWebSearchArgs } from './types.ts'

const MAX_QUERY_CHARS = 500
const MAX_REASON_CHARS = 500
const FORBIDDEN_PROTOCOLS = new Set(['file:', 'ftp:', 'gopher:', 'data:', 'javascript:'])
const LOCAL_HOSTS = new Set(['localhost', 'ip6-localhost', 'ip6-loopback', '0.0.0.0'])

const SECRET_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{20,})\b/,
  /\b(ghp_[A-Za-z0-9_]{20,})\b/,
  /\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/,
  /\b(AKIA[0-9A-Z]{16})\b/,
  /\b(?:api[_-]?key|secret|password|passwd|token|credential|bearer)\s*[:=]\s*["']?[A-Za-z0-9_.\-]{8,}/i,
]

const SECRET_INTENT = /\b(?:find|search|look\s*up|buscar|procure|vazad[oa]s?|leaked?)\b.*\b(?:secret|token|password|senha|credential|api\s*key|apikey)\b/i

export interface GuardrailResult {
  ok: boolean
  args?: NormalizedWebSearchArgs
  warnings: string[]
  blocked: BlockedUrl[]
  error?: string
}

export function normalizeDomain(value: string): string | null {
  const raw = value.trim().toLowerCase()
  if (!raw) return null
  try {
    const u = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    if (/^[a-z0-9.-]+$/i.test(raw)) return raw.replace(/^www\./, '')
    return null
  }
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 120)
  } catch {
    return url.slice(0, 120)
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  )
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')
}

export function validatePublicUrl(url: string, allowPrivateNetwork = false): { ok: boolean; reason?: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
  if (FORBIDDEN_PROTOCOLS.has(parsed.protocol) || !['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'blocked_protocol' }
  }
  const host = parsed.hostname.toLowerCase()
  if (!allowPrivateNetwork) {
    if (host === '169.254.169.254') return { ok: false, reason: 'metadata_endpoint' }
    if (LOCAL_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) return { ok: false, reason: 'private_network' }
    if (isPrivateIPv4(host) || isPrivateIPv6(host)) return { ok: false, reason: 'private_network' }
  }
  return { ok: true }
}

function urlsInText(text: string): string[] {
  return text.match(/\b(?:https?|file|ftp|gopher|data):\/\/[^\s"'<>]+/gi) ?? []
}

function hasSensitiveData(text: string): boolean {
  return SECRET_PATTERNS.some(re => re.test(text)) || SECRET_INTENT.test(text)
}

export function validateSearchArgs(input: Record<string, unknown>, maxConfiguredResults: number, safeDefault: boolean): GuardrailResult {
  const warnings: string[] = []
  const blocked: BlockedUrl[] = []
  const extra = Object.keys(input).filter(k => ![
    'query',
    'reason',
    'max_results',
    'recency_days',
    'include_domains',
    'exclude_domains',
    'language',
    'country',
    'safe_search',
  ].includes(k))
  if (extra.length) return { ok: false, warnings, blocked, error: `unknown argument(s): ${extra.join(', ')}` }

  const query = typeof input.query === 'string' ? input.query.trim().replace(/\s+/g, ' ') : ''
  const reason = typeof input.reason === 'string' ? input.reason.trim().replace(/\s+/g, ' ') : ''
  if (!query) return { ok: false, warnings, blocked, error: 'query is required' }
  if (!reason) return { ok: false, warnings, blocked, error: 'reason is required' }
  if (query.length > MAX_QUERY_CHARS) return { ok: false, warnings, blocked, error: `query is too long (max ${MAX_QUERY_CHARS} chars)` }
  if (reason.length > MAX_REASON_CHARS) return { ok: false, warnings, blocked, error: `reason is too long (max ${MAX_REASON_CHARS} chars)` }
  if (hasSensitiveData(query) || hasSensitiveData(reason)) return { ok: false, warnings, blocked, error: 'query appears to contain or request secrets/credentials' }

  for (const url of [...urlsInText(query), ...urlsInText(reason)]) {
    const v = validatePublicUrl(url)
    if (!v.ok) blocked.push({ url, reason: v.reason ?? 'blocked_url' })
  }
  if (blocked.length) return { ok: false, warnings, blocked, error: 'query contains blocked URL(s)' }

  const requested = Number.isInteger(input.max_results) ? Number(input.max_results) : 0
  if (requested < 1) return { ok: false, warnings, blocked, error: 'max_results must be between 1 and 10' }
  const max_results = Math.min(10, Math.max(1, Math.min(requested, maxConfiguredResults)))
  if (requested !== max_results) warnings.push(`max_results clamped to ${max_results}`)

  const recency = input.recency_days == null ? null : Number(input.recency_days)
  if (recency != null && (!Number.isInteger(recency) || recency < 1 || recency > 3650)) {
    return { ok: false, warnings, blocked, error: 'recency_days must be null or between 1 and 3650' }
  }

  const domainArray = (v: unknown, max: number, name: string): string[] | string => {
    if (v == null) return []
    if (!Array.isArray(v)) return `${name} must be an array`
    if (v.length > max) return `${name} has too many entries`
    
    const out: string[] = []
    for (const item of v) {
      if (typeof item !== 'string') return `${name} entries must be strings`
      const d = normalizeDomain(item)
      if (!d) return `${name} contains invalid domain: ${item}`
      out.push(d)
    }
    return out
  }

  const include = domainArray(input.include_domains, 10, 'include_domains')
  if (typeof include === 'string') return { ok: false, warnings, blocked, error: include }

  const exclude = domainArray(input.exclude_domains, 20, 'exclude_domains')
  if (typeof exclude === 'string') return { ok: false, warnings, blocked, error: exclude }

  return {
    ok: true,
    warnings,
    blocked,
    args: {
      query,
      reason,
      max_results,
      recency_days: recency,
      include_domains: include,
      exclude_domains: exclude,
      language: typeof input.language === 'string' && input.language ? input.language : null,
      country: typeof input.country === 'string' && input.country ? input.country : null,
      safe_search: typeof input.safe_search === 'boolean' ? input.safe_search : safeDefault,
    },
  }
}

export function webSearchSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['query', 'reason', 'max_results'],
    properties: {
      query: { type: 'string', description: 'The search query. Must be specific, neutral, and not include private data.' },
      reason: { type: 'string', description: 'Why web search is needed for this user request.' },
      max_results: { type: 'integer', minimum: 1, maximum: 10 },
      recency_days: { type: ['integer', 'null'], minimum: 1, maximum: 3650 },
      include_domains: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      exclude_domains: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      language: { type: ['string', 'null'], description: 'Preferred language, e.g. pt-BR, en-US.' },
      country: { type: ['string', 'null'], description: 'Preferred country/region for localized search.' },
      safe_search: { type: 'boolean', default: true },
    },
  }
}
