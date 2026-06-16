// web_search — CitationBuilder: normalize ranked results into citeable sources.

import type { Citation, ScoredSearchResult } from './types.ts'

export function buildCitations(results: ScoredSearchResult[]): Citation[] {
  return results.map(r => ({
    citation_id: r.citation_id,
    title: r.title,
    url: r.url,
    domain: r.domain,
    retrieved_at: r.retrieved_at,
    quote_or_snippet: r.quote_or_snippet.slice(0, 300),
  }))
}
