// web_search — SourceRanker: classify sources, score relevance/reliability/freshness/quality,
// dedupe, apply domain filters. Spec weights: 0.40 / 0.30 / 0.20 / 0.10.

import { displayUrl, domainOf } from './guardrails.ts'
import type { NormalizedWebSearchArgs, ProviderSearchResult, ScoredSearchResult, SourceType } from './types.ts'

const OFFICIAL_DOCS = ['nodejs.org', 'go.dev', 'python.org', 'postgresql.org', 'kernel.org', 'w3.org', 'ietf.org', 'rust-lang.org', 'kubernetes.io', 'docker.com', 'mozilla.org', 'developer.mozilla.org']
const PAPER_DOMAINS = ['arxiv.org', 'doi.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'ieee.org', 'acm.org', 'nature.com', 'sciencedirect.com', 'springer.com', 'semanticscholar.org']
const NEWS_DOMAINS = ['reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'g1.globo.com', 'folha.uol.com.br', 'estadao.com.br']
const FORUM_DOMAINS = ['reddit.com', 'quora.com', 'stackoverflow.com', 'stackexchange.com', 'news.ycombinator.com', 'discourse.org']
const BLOG_DOMAINS = ['medium.com', 'dev.to', 'substack.com', 'hashnode.dev', 'blogspot.com', 'wordpress.com']
const LOW_PRIORITY = new Set(['reddit.com', 'quora.com', 'medium.com'])

const SEO_MARKERS = /\b(buy now|subscribe|click here|sign up|limited offer|best deal|affiliate|sponsored)\b/i

function endsWithDomain(domain: string, list: string[]): boolean {
  return list.some(d => domain === d || domain.endsWith(`.${d}`))
}

export function classifySource(domain: string): SourceType {
  if (!domain) return 'unknown'
  if (domain.endsWith('.gov') || domain.includes('.gov.') || domain.endsWith('.mil') || domain.includes('.gob.') || domain.includes('.gouv.') || domain.endsWith('.fazenda.gov.br')) return 'official'
  if (endsWithDomain(domain, PAPER_DOMAINS)) return 'paper'
  if (endsWithDomain(domain, OFFICIAL_DOCS) || domain.startsWith('docs.') || domain.includes('.readthedocs.')) return 'docs'
  if (endsWithDomain(domain, NEWS_DOMAINS)) return 'news'
  if (endsWithDomain(domain, FORUM_DOMAINS)) return 'forum'
  if (endsWithDomain(domain, BLOG_DOMAINS)) return 'blog'
  return 'unknown'
}

export function reliabilityScore(sourceType: SourceType, domain: string, wantsCommunity: boolean): number {
  const base: Record<SourceType, number> = { official: 0.95, docs: 0.9, paper: 0.9, news: 0.75, forum: 0.45, blog: 0.4, unknown: 0.5 }
  let s = base[sourceType]
  if (LOW_PRIORITY.has(domain.replace(/^.*\.(?=[^.]+\.[^.]+$)/, '')) || [...LOW_PRIORITY].some(d => domain.endsWith(d))) {
    s = wantsCommunity ? Math.max(s, 0.55) : Math.min(s, 0.35)
  }
  return s
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9áéíóúâêôãõç]+/i).filter(t => t.length > 1)
}

export function relevanceScore(query: string, title: string, snippet: string): number {
  const terms = new Set(tokenize(query))
  if (terms.size === 0) return 0
  const titleTokens = new Set(tokenize(title))
  const snippetTokens = new Set(tokenize(snippet))
  let hit = 0
  for (const t of terms) {
    if (titleTokens.has(t)) hit += 1
    else if (snippetTokens.has(t)) hit += 0.5
  }
  let score = hit / terms.size
  if (title.toLowerCase().includes(query.toLowerCase())) score = Math.min(1, score + 0.2)
  return Math.max(0, Math.min(1, score))
}

export function freshnessScore(publishedAt: string | null, recencyDays: number | null, now: number): number {
  if (!publishedAt) return 0.3 // penalize missing date
  const t = Date.parse(publishedAt)
  if (Number.isNaN(t)) return 0.3
  const ageDays = (now - t) / 86_400_000
  if (ageDays < 0) return 0.7
  const horizon = recencyDays ?? 365
  const score = 1 - ageDays / (horizon * 2)
  return Math.max(0.05, Math.min(1, score))
}

export function contentQualityScore(title: string, snippet: string): number {
  let s = 0.6
  const len = snippet.trim().length
  if (len >= 60 && len <= 400) s += 0.2
  if (len < 20) s -= 0.2
  if (SEO_MARKERS.test(`${title} ${snippet}`)) s -= 0.3
  if (/(.)\1{4,}/.test(snippet)) s -= 0.1
  return Math.max(0, Math.min(1, s))
}

function dedupeKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

export function dedupe(results: ProviderSearchResult[]): ProviderSearchResult[] {
  const seen = new Set<string>()
  const out: ProviderSearchResult[] = []
  for (const r of results) {
    const key = dedupeKey(r.url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

const COMMUNITY_INTENT = /\b(opinion|opinião|review|reviews|experience|experiência|community|comunidade|reddit|forum|fórum)\b/i

export function rankResults(args: NormalizedWebSearchArgs, raw: ProviderSearchResult[], now: number = Date.now()): ScoredSearchResult[] {
  const wantsCommunity = COMMUNITY_INTENT.test(args.query) || COMMUNITY_INTENT.test(args.reason)
  const retrievedAt = new Date(now).toISOString()

  let items = dedupe(raw)
  if (args.include_domains.length) items = items.filter(r => endsWithDomain(domainOf(r.url), args.include_domains))
  if (args.exclude_domains.length) items = items.filter(r => !endsWithDomain(domainOf(r.url), args.exclude_domains))

  const scored = items.map(r => {
    const domain = domainOf(r.url)
    const sourceType = classifySource(domain)
    const snippet = (r.snippet ?? '').trim()
    const relevance = relevanceScore(args.query, r.title, snippet)
    const reliability = reliabilityScore(sourceType, domain, wantsCommunity)
    const freshness = freshnessScore(r.published_at ?? null, args.recency_days, now)
    const quality = contentQualityScore(r.title, snippet)
    // Authority bonus so official/primary sources outrank high-relevance blogs/forums
    // (spec: "fonte oficial tem prioridade").
    const authorityBonus: Record<SourceType, number> = { official: 0.12, docs: 0.08, paper: 0.08, news: 0.02, unknown: 0, forum: -0.04, blog: -0.06 }
    const final = Math.max(0, Math.min(1, relevance * 0.4 + reliability * 0.3 + freshness * 0.2 + quality * 0.1 + authorityBonus[sourceType]))
    const result: ScoredSearchResult = {
      title: r.title,
      url: r.url,
      display_url: displayUrl(r.url),
      domain,
      snippet,
      published_at: r.published_at ?? null,
      retrieved_at: retrievedAt,
      source_type: sourceType,
      reliability_score: round(reliability),
      relevance_score: round(relevance),
      freshness_score: round(freshness),
      content_quality_score: round(quality),
      final_score: round(final),
      citation_id: '',
      quote_or_snippet: snippet,
    }
    return result
  })

  scored.sort((a, b) => b.final_score - a.final_score)
  const top = scored.slice(0, args.max_results)
  top.forEach((r, i) => (r.citation_id = `src_${i + 1}`))
  return top
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
