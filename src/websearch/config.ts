import { configDir } from '../config.ts'

export interface WebSearchConfig {
  enabled: boolean
  provider: 'searxng' | 'mock' | 'duckduckgo'
  baseUrl: string
  timeoutMs: number
  maxResults: number
  cacheTtlSeconds: number
  safeSearch: boolean
  allowPrivateNetwork: boolean
  userAgent: string
  maxFetchBytes: number
  debug: boolean
  logPath: string
  cachePath: string
}

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function webSearchConfig(): WebSearchConfig {
  const dir = configDir()
  const p = process.env.WEB_SEARCH_PROVIDER
  const provider = p === 'mock' ? 'mock' : p === 'searxng' ? 'searxng' : 'duckduckgo'
  return {
    enabled: boolEnv('WEB_SEARCH_ENABLED', true),
    provider,
    baseUrl: (process.env.WEB_SEARCH_BASE_URL || 'http://localhost:8080').replace(/\/+$/, ''),
    timeoutMs: intEnv('WEB_SEARCH_TIMEOUT_MS', 10_000, 500, 60_000),
    maxResults: intEnv('WEB_SEARCH_MAX_RESULTS', 10, 1, 10),
    cacheTtlSeconds: intEnv('WEB_SEARCH_CACHE_TTL_SECONDS', 3600, 0, 86_400),
    safeSearch: boolEnv('WEB_SEARCH_SAFE_SEARCH', true),
    allowPrivateNetwork: boolEnv('WEB_SEARCH_ALLOW_PRIVATE_NETWORK', false),
    userAgent: process.env.WEB_SEARCH_USER_AGENT || 'MaxCoderBot/0.1 (+local)',
    maxFetchBytes: intEnv('WEB_SEARCH_MAX_FETCH_BYTES', 2_000_000, 10_000, 20_000_000),
    debug: boolEnv('WEB_SEARCH_DEBUG', false),
    logPath: `${dir}/websearch.log`,
    cachePath: `${dir}/websearch-cache.json`,
  }
}
