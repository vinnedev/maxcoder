// web_search — WebSearchTelemetry: safe, redacted logging. Never logs cookies, headers, tokens,
// full HTML, or large page content. Query is logged only after guardrails cleared it as non-secret.

import { appendLine } from '../../shared/fs/index.ts'
import type { WebSearchConfig } from './config.ts'

export interface SearchLogEvent {
  event: 'web_search' | 'web_fetch'
  provider?: string
  query?: string
  durationMs?: number
  resultCount?: number
  blockedCount?: number
  domains?: string[]
  cache?: 'hit' | 'miss' | 'disabled'
  guardrail?: string
  injection?: boolean
  errorKind?: string
}

const MAX_LOGGED_QUERY = 200

export function logSearchEvent(config: WebSearchConfig, ev: SearchLogEvent): void {
  const safe = {
    ts: new Date().toISOString(),
    ...ev,
    query: ev.query ? ev.query.slice(0, MAX_LOGGED_QUERY) : undefined,
    domains: ev.domains?.slice(0, 12),
  }
  const line = JSON.stringify(safe)
  try {
    appendLine(config.logPath, line + '\n')
  } catch {
    /* logging must never throw */
  }
  if (config.debug) process.stderr.write(`[web_search] ${line}\n`)
}
