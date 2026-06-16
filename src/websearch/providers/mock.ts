// web_search — mock provider (offline, deterministic). Used for tests and as a safe default.
// Returns a small curated dataset filtered by query tokens, including authoritative AND low-quality
// sources so ranking / dedup / penalties can be exercised.

import type { NormalizedWebSearchArgs, ProviderSearchResult, SearchProvider } from '../types.ts'

const DATASET: ProviderSearchResult[] = [
  { title: 'Node.js — Download | Releases', url: 'https://nodejs.org/en/download', snippet: 'Node.js current and LTS releases with version numbers and schedule.', published_at: '2026-05-01' },
  { title: 'Node.js Release Working Group', url: 'https://github.com/nodejs/release', snippet: 'Official release schedule and LTS codenames for Node.js.', published_at: '2026-04-20' },
  { title: 'Node 22 is the new LTS — random blog', url: 'https://some-blog.example.com/node-22', snippet: 'My take on the latest node release and why you should upgrade.', published_at: null },
  { title: 'What Node version should I use? - r/node', url: 'https://www.reddit.com/r/node/comments/abc', snippet: 'Community discussion about node versions.', published_at: '2026-03-02' },
  { title: 'The Go Programming Language — Release History', url: 'https://go.dev/doc/devel/release', snippet: 'Official list of Go releases and changes per version.', published_at: '2026-05-10' },
  { title: 'Go 1.x Release Notes', url: 'https://go.dev/doc/go1.24', snippet: 'Changes to the language, runtime, and standard library in Go.', published_at: '2026-02-11' },
  { title: 'PostgreSQL: Documentation — GIN Indexes', url: 'https://www.postgresql.org/docs/current/gin.html', snippet: 'GIN stands for Generalized Inverted Index. Use cases and operators.', published_at: '2026-01-15' },
  { title: 'Understanding GIN indexes - Medium', url: 'https://medium.com/@someone/gin-indexes', snippet: 'A blog post explaining GIN indexes with examples.', published_at: '2025-09-01' },
  { title: 'Cotação do dólar hoje — Banco Central do Brasil', url: 'https://www.bcb.gov.br/estabilidadefinanceira/cotacoes', snippet: 'Cotações de câmbio oficiais publicadas pelo Banco Central.', published_at: '2026-06-16' },
  { title: 'Portal da NF-e — Documentação oficial', url: 'https://www.nfe.fazenda.gov.br/portal', snippet: 'Documentação oficial sobre Nota Fiscal Eletrônica (NF-e) no Brasil.', published_at: '2026-04-01' },
  { title: 'arXiv: Retrieval-Augmented Generation', url: 'https://arxiv.org/abs/2005.11401', snippet: 'Paper introducing retrieval-augmented generation for NLP.', published_at: '2020-05-22' },
]

export class MockSearchProvider implements SearchProvider {
  readonly name = 'mock'
  constructor(private dataset: ProviderSearchResult[] = DATASET) {}

  async search(args: NormalizedWebSearchArgs): Promise<ProviderSearchResult[]> {
    const terms = args.query.toLowerCase().split(/\s+/).filter(t => t.length > 1)
    const scored = this.dataset
      .map(r => {
        const hay = `${r.title} ${r.snippet ?? ''} ${r.url}`.toLowerCase()
        const hits = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
        return { r, hits }
      })
      .filter(x => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .map(x => x.r)
    return (scored.length ? scored : this.dataset).slice(0, Math.max(args.max_results * 2, args.max_results))
  }
}
