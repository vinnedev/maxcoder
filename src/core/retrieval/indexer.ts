// Max Coder — repo index builder (P4). Walks the repo, extracts symbols/imports + a heuristic summary,
// and caches per file keyed by {mtimeMs,size} so only changed files are re-read. Deleted/renamed files
// drop out (the index is rebuilt from the current walk). Persisted under .maxcoder/context/.

import * as path from 'node:path'
import { ensureDir, readJSON, readText, writeText } from '../../shared/fs/index.ts'
import { maxcoderDir } from '../config/index.ts'
import { extractFacts } from './extract.ts'
import { tokenize, type IndexedFile, type RepoIndex } from './retriever.ts'
import { walkRepo, type WalkOptions } from '../intelligence/walk.ts'

// Only index text/code files (symbol extraction matters for TS/JS; others get path/summary signals).
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.go', '.py', '.rs', '.rb', '.java', '.kt', '.swift',
  '.php', '.cs', '.c', '.h', '.cpp', '.md', '.json', '.txt', '.yml', '.yaml', '.toml', '.css', '.html',
])

export function contextDir(cwd = process.cwd()): string {
  return path.join(maxcoderDir(cwd), 'context')
}
export function indexPath(cwd = process.cwd()): string {
  return path.join(contextDir(cwd), 'index.json')
}

const EMPTY: RepoIndex = { files: {}, generatedAt: 0 }

/** Build a heuristic, model-free summary: leading doc-comment lines + a few exported symbols. */
function summarize(content: string, symbols: string[]): string {
  const lead = content
    .split('\n')
    .slice(0, 8)
    .map(l => l.trim())
    .filter(l => l.startsWith('//') || l.startsWith('*') || l.startsWith('/*'))
    .map(l => l.replace(/^(\/\/+|\*+|\/\*+)\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 200)
  const ex = symbols.slice(0, 8).join(', ')
  return [lead, ex && `exports: ${ex}`].filter(Boolean).join(' — ')
}

function makeEntry(relPath: string, content: string, mtimeMs: number, size: number): IndexedFile {
  const { symbols, imports } = extractFacts(content)
  const summary = summarize(content, symbols)
  return {
    path: relPath,
    mtimeMs,
    size,
    symbols,
    imports,
    summary,
    pathTokens: tokenize(relPath),
    symbolTokens: [...new Set(symbols.flatMap(tokenize))],
    summaryTokens: tokenize(summary),
  }
}

export async function loadIndex(cwd = process.cwd()): Promise<RepoIndex> {
  const raw = await readJSON<RepoIndex>(indexPath(cwd))
  return raw && raw.files ? raw : { ...EMPTY }
}

/**
 * Build the index incrementally: reuse cached entries whose {mtimeMs,size} are unchanged, re-read the
 * rest, and drop files no longer present. Returns the fresh index (not persisted).
 */
export async function buildIndex(cwd = process.cwd(), opts: WalkOptions = {}, now = Date.now()): Promise<RepoIndex> {
  const prev = await loadIndex(cwd)
  const walked = walkRepo(cwd, opts).filter(f => TEXT_EXT.has(path.extname(f.path).toLowerCase()))
  const files: Record<string, IndexedFile> = {}

  for (const f of walked) {
    const cached = prev.files[f.path]
    if (cached && cached.mtimeMs === f.mtimeMs && cached.size === f.size) {
      files[f.path] = cached
      continue
    }
    const content = await readText(path.join(cwd, f.path))
    if (content === null) continue
    files[f.path] = makeEntry(f.path, content, f.mtimeMs, f.size)
  }
  return { files, generatedAt: now }
}

/** Persist the working index + spec-named projections (symbols/deps/summaries/recent-changes). */
export async function saveIndex(index: RepoIndex, cwd = process.cwd()): Promise<void> {
  const dir = contextDir(cwd)
  ensureDir(dir)
  const entries = Object.values(index.files)
  const symbols: Record<string, string[]> = {}
  const deps: Record<string, string[]> = {}
  const summaries: Record<string, string> = {}
  for (const f of entries) {
    symbols[f.path] = f.symbols
    deps[f.path] = f.imports
    summaries[f.path] = f.summary
  }
  const recent = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 20).map(f => f.path)
  await Promise.all([
    writeText(indexPath(cwd), JSON.stringify(index)),
    writeText(path.join(dir, 'symbols.json'), JSON.stringify(symbols, null, 2)),
    writeText(path.join(dir, 'dependency-map.json'), JSON.stringify(deps, null, 2)),
    writeText(path.join(dir, 'file-summaries.json'), JSON.stringify(summaries, null, 2)),
    writeText(path.join(dir, 'recent-changes.json'), JSON.stringify(recent, null, 2)),
  ])
}

/** Build + persist in one call (lazy callers use this on first retrieval). */
export async function ensureIndex(cwd = process.cwd(), opts: WalkOptions = {}, now = Date.now()): Promise<RepoIndex> {
  const index = await buildIndex(cwd, opts, now)
  await saveIndex(index, cwd)
  return index
}
