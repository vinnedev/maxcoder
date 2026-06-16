export type SourceType = 'official' | 'news' | 'docs' | 'paper' | 'forum' | 'blog' | 'unknown'

export interface WebSearchArgs {
  query: string
  reason: string
  max_results: number
  recency_days?: number | null
  include_domains?: string[]
  exclude_domains?: string[]
  language?: string | null
  country?: string | null
  safe_search?: boolean
}

export interface NormalizedWebSearchArgs {
  query: string
  reason: string
  max_results: number
  recency_days: number | null
  include_domains: string[]
  exclude_domains: string[]
  language: string | null
  country: string | null
  safe_search: boolean
}

export interface ProviderSearchResult {
  title: string
  url: string
  snippet?: string
  published_at?: string | null
}

export interface ScoredSearchResult {
  title: string
  url: string
  display_url: string
  domain: string
  snippet: string
  published_at: string | null
  retrieved_at: string
  source_type: SourceType
  reliability_score: number
  relevance_score: number
  freshness_score: number
  content_quality_score: number
  final_score: number
  citation_id: string
  quote_or_snippet: string
  prompt_injection_detected?: boolean
  injection_patterns?: string[]
}

export interface Citation {
  citation_id: string
  title: string
  url: string
  domain: string
  retrieved_at: string
  quote_or_snippet: string
}

export interface BlockedUrl {
  url: string
  reason: string
}

export interface WebSearchResponse {
  query: string
  searched_at: string
  provider: string
  results: ScoredSearchResult[]
  citations: Citation[]
  warnings: string[]
  blocked: BlockedUrl[]
  cached?: boolean
}

export interface SearchProvider {
  name: string
  search(args: NormalizedWebSearchArgs, signal?: AbortSignal): Promise<ProviderSearchResult[]>
}
