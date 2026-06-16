// Max Coder — lexical retrieval over the repo index (P4). No embeddings: scores files by query-term
// overlap against symbols (weighted highest), path, and summary. Pure; budget-bounded context bundle.

export interface IndexedFile {
  path: string
  mtimeMs: number
  size: number
  symbols: string[]
  imports: string[]
  summary: string
  pathTokens: string[]
  symbolTokens: string[]
  summaryTokens: string[]
}

export interface RepoIndex {
  files: Record<string, IndexedFile>
  generatedAt: number
}

/** Split identifiers/paths into lowercased terms (camelCase, snake/kebab, path separators). */
export function tokenize(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 2)
}

/** Lexical relevance of a file to query terms. Symbols weigh most, then path, then summary. */
export function scoreFile(queryTerms: string[], file: IndexedFile): number {
  if (queryTerms.length === 0) return 0
  const symbolExact = new Set(file.symbols.map(s => s.toLowerCase()))
  const symbolTokens = new Set(file.symbolTokens)
  const pathTokens = new Set(file.pathTokens)
  const summaryTokens = new Set(file.summaryTokens)
  let score = 0
  for (const t of queryTerms) {
    if (symbolExact.has(t)) score += 5
    else if (symbolTokens.has(t)) score += 3
    if (pathTokens.has(t)) score += 2
    if (summaryTokens.has(t)) score += 1
  }
  return score
}

export interface SymbolHit {
  path: string
  symbols: string[]
  score: number
}

/** Find files whose symbols match the query (substring on tokens). */
export function searchSymbols(index: RepoIndex, query: string, limit = 20): SymbolHit[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []
  return Object.values(index.files)
    .map(f => {
      const matched = f.symbols.filter(s => {
        const low = s.toLowerCase()
        return terms.some(t => low.includes(t))
      })
      return { path: f.path, symbols: matched, score: matched.length * 2 + scoreFile(terms, f) }
    })
    .filter(h => h.symbols.length > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
}

export interface ContextItem {
  path: string
  summary: string
  symbols: string[]
  score: number
}

export interface ContextBundle {
  items: ContextItem[]
  estTokens: number
  truncated: boolean
}

export interface BuildContextOptions {
  maxFiles?: number
  budgetTokens?: number
}

/** Rank files for a query and return a budget-bounded bundle of summaries (model then read_files them). */
export function buildContext(index: RepoIndex, query: string, opts: BuildContextOptions = {}): ContextBundle {
  const terms = tokenize(query)
  const maxFiles = Math.max(1, opts.maxFiles ?? 8)
  const budget = opts.budgetTokens ?? 4_000 // the top hit is always returned even if it exceeds budget

  const ranked = Object.values(index.files)
    .map(f => ({ f, score: scoreFile(terms, f) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path))

  const items: ContextItem[] = []
  let estTokens = 0
  let truncated = false
  for (const { f, score } of ranked) {
    if (items.length >= maxFiles) {
      truncated = ranked.length > items.length
      break
    }
    const itemTokens = Math.ceil((f.summary.length + f.symbols.join(' ').length) / 4) + 8
    if (estTokens + itemTokens > budget && items.length > 0) {
      truncated = true
      break
    }
    items.push({ path: f.path, summary: f.summary, symbols: f.symbols.slice(0, 20), score })
    estTokens += itemTokens
  }
  return { items, estTokens, truncated }
}
