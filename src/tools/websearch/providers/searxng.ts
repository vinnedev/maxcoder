// web_search — SearxNG provider (local/self-hosted metasearch, JSON API). No API key, no paid service.
// GET {baseUrl}/search?q=...&format=json — see https://docs.searxng.org

import type { NormalizedWebSearchArgs, ProviderSearchResult, SearchProvider } from '../types.ts'

function timeRange(recencyDays: number | null): string | undefined {
  if (recencyDays == null) return undefined
  if (recencyDays <= 1) return 'day'
  if (recencyDays <= 7) return 'week'
  if (recencyDays <= 31) return 'month'
  if (recencyDays <= 365) return 'year'
  return undefined
}

export class SearxngProvider implements SearchProvider {
  readonly name = 'searxng'
  constructor(private baseUrl: string, private userAgent: string) {}

  async search(args: NormalizedWebSearchArgs, signal?: AbortSignal): Promise<ProviderSearchResult[]> {
    const params = new URLSearchParams({ q: args.query, format: 'json', safesearch: args.safe_search ? '1' : '0' })
    if (args.language) params.set('language', args.language)
    const tr = timeRange(args.recency_days)
    if (tr) params.set('time_range', tr)

    const res = await fetch(`${this.baseUrl}/search?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
      signal,
    })
    if (!res.ok) throw new Error(`searxng_http_${res.status}`)

    const data = (await res.json()) as { results?: any[] }
    const results = Array.isArray(data.results) ? data.results : []
    return results
      .filter(r => r && typeof r.url === 'string' && typeof r.title === 'string')
      .map(r => ({
        title: String(r.title),
        url: String(r.url),
        snippet: typeof r.content === 'string' ? r.content : '',
        published_at: typeof r.publishedDate === 'string' ? r.publishedDate : null,
      }))
  }
}
