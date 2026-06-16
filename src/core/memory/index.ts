// Max Coder — local long-term memory wiki.
//
// Markdown is the source of truth under `.maxcoder/memory/wiki`; SQLite/FTS is only a derived
// index that can be deleted and rebuilt. The legacy Reflexion helpers at the bottom are kept for
// compatibility, but new code should use MemoryStore/MemoryIndexer/MemoryApprovalQueue.

import { Database } from 'bun:sqlite'
import * as path from 'node:path'
import { appendLine, ensureDir, exists, listDir, readJSON, readText, removeFile, writeText } from '../../shared/fs/index.ts'
import { maxcoderDir } from '../config/index.ts'

export type MemoryPageType =
  | 'session'
  | 'decision'
  | 'gotcha'
  | 'procedure'
  | 'concept'
  | 'rule'
  | 'note'
  | 'slot'
  | 'pending'
  | 'audit'
  | 'handoff'

export type DurableMemoryType = 'decision' | 'gotcha' | 'procedure' | 'concept' | 'rule' | 'note'
export type ProposalType = DurableMemoryType | 'slot_update'
export type Confidence = 'low' | 'medium' | 'high'

export interface Evidence {
  kind: 'session' | 'file' | 'command' | 'test' | 'user_instruction'
  ref: string
  quote?: string
}

export interface MemorySearchFilters {
  types?: MemoryPageType[] | DurableMemoryType[] | string[]
  limit?: number
}

export interface MemorySearchResult {
  path: string
  title: string
  summary: string
  relevance: number
  excerpt: string
  type: MemoryPageType
}

export interface MemoryWriteInput {
  type: DurableMemoryType
  title: string
  body: string
  evidence: Evidence[]
  confidence: Confidence
  pinned?: boolean
}

export interface MemoryProposal {
  id?: string
  type: ProposalType
  path: string
  title: string
  body: string
  evidence: Evidence[]
  confidence: Confidence
  reason?: string
  should_require_approval?: boolean
}

export interface ProposalValidationResult {
  approved: boolean
  requires_human_review: boolean
  issues: string[]
  normalized_path: string
  normalized_body: string
  reason: string
}

export interface MemoryConfig {
  autoImprove: {
    enabled: boolean
    schedulerEnabled: boolean
    requireApproval: boolean
    minSessionAgeMinutes: number
    minConfidence: Confidence
    autoApproveTypes: ProposalType[]
    manualApprovalTypes: ProposalType[]
  }
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  autoImprove: {
    enabled: true,
    schedulerEnabled: true,
    requireApproval: true,
    minSessionAgeMinutes: 10,
    minConfidence: 'medium',
    autoApproveTypes: ['concept', 'procedure', 'note', 'slot_update'],
    manualApprovalTypes: ['rule', 'decision', 'gotcha'],
  },
}

const WIKI_DIRS = [
  'sessions',
  'decisions',
  'gotchas',
  'procedures',
  'concepts',
  'notes',
  '_rules',
  '_slots',
  '_pending/auto-improve',
  '_audit/revisions',
]

const TYPE_DIR: Record<DurableMemoryType, string> = {
  decision: 'decisions',
  gotcha: 'gotchas',
  procedure: 'procedures',
  concept: 'concepts',
  rule: '_rules',
  note: 'notes',
}

const DIR_TYPE: [string, MemoryPageType][] = [
  ['sessions/', 'session'],
  ['decisions/', 'decision'],
  ['gotchas/', 'gotcha'],
  ['procedures/', 'procedure'],
  ['concepts/', 'concept'],
  ['notes/', 'note'],
  ['_rules/', 'rule'],
  ['_slots/', 'slot'],
  ['_pending/', 'pending'],
  ['_audit/', 'audit'],
  ['../handoffs/', 'handoff'],
]

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }
const ALLOWED_TOP = new Set(['index.md', 'log.md', ...WIKI_DIRS.map(d => d.split('/')[0])])

// Patterns that look like secrets. Wiki writes reject matches; the legacy remember() API redacts.
const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_?KEY)\s*[=:]\s*\S+/gi,
]

export function memoryDir(cwd = process.cwd()): string {
  return path.join(maxcoderDir(cwd), 'memory')
}

export function memoryWikiDir(cwd = process.cwd()): string {
  return path.join(memoryDir(cwd), 'wiki')
}

export function memoryIndexDir(cwd = process.cwd()): string {
  return path.join(memoryDir(cwd), 'index')
}

export function memoryDbPath(cwd = process.cwd()): string {
  return path.join(memoryIndexDir(cwd), 'memory.sqlite')
}

export function handoffsDir(cwd = process.cwd()): string {
  return path.join(memoryDir(cwd), 'handoffs')
}

export function slugifyTitle(title: string): string {
  const s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s || `memory-${Date.now()}`
}

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false
  let out = text
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, m => {
      redacted = true
      const eq = m.match(/^([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_?KEY)\s*[=:]\s*)/i)
      return eq ? `${eq[1]}[REDACTED]` : '[REDACTED]'
    })
  }
  return { text: out, redacted }
}

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some(re => {
    re.lastIndex = 0
    return re.test(text)
  })
}

export async function initMemoryWorkspace(cwd = process.cwd()): Promise<void> {
  ensureDir(memoryDir(cwd))
  ensureDir(memoryWikiDir(cwd))
  ensureDir(memoryIndexDir(cwd))
  ensureDir(path.join(memoryIndexDir(cwd), 'fts'))
  ensureDir(path.join(memoryIndexDir(cwd), 'embeddings'))
  ensureDir(handoffsDir(cwd))
  ensureDir(path.join(memoryDir(cwd), 'plans'))
  ensureDir(path.join(memoryDir(cwd), 'logs/sessions'))
  ensureDir(path.join(memoryDir(cwd), 'evals'))
  for (const d of WIKI_DIRS) ensureDir(path.join(memoryWikiDir(cwd), d))

  const config = path.join(memoryDir(cwd), 'config.json')
  if (!(await readText(config))) await writeText(config, JSON.stringify(DEFAULT_MEMORY_CONFIG, null, 2) + '\n')
  const index = path.join(memoryWikiDir(cwd), 'index.md')
  if (!(await readText(index))) {
    await writeText(index, '# Memory Wiki\n\nMarkdown is the source of truth. SQLite/FTS indexes are derived and rebuildable.\n')
  }
  const log = path.join(memoryWikiDir(cwd), 'log.md')
  if (!(await readText(log))) await writeText(log, '# Memory Log\n\n')
  const focus = path.join(memoryWikiDir(cwd), '_slots/current-focus.md')
  if (!(await readText(focus))) await writeText(focus, '# Current Focus\n\n_No active focus recorded._\n')
}

export async function loadMemoryConfig(cwd = process.cwd()): Promise<MemoryConfig> {
  const raw = await readJSON<Partial<MemoryConfig>>(path.join(memoryDir(cwd), 'config.json'))
  return {
    autoImprove: {
      ...DEFAULT_MEMORY_CONFIG.autoImprove,
      ...(raw?.autoImprove && typeof raw.autoImprove === 'object' ? raw.autoImprove : {}),
    },
  }
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '')
}

function pageTypeForPath(rel: string): MemoryPageType {
  const n = normalizeRel(rel)
  for (const [prefix, type] of DIR_TYPE) {
    if (n.startsWith(prefix)) return type
  }
  return n === 'log.md' || n === 'index.md' ? 'note' : 'note'
}

function titleFromBody(body: string, fallback: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(fallback).replace(/\.md$/, '')
}

function summaryFromBody(body: string): string {
  const text = body
    .replace(/^# .+$/m, '')
    .replace(/^## .+$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 220)
}

function assertValidWikiPath(rel: string): string {
  const n = normalizeRel(rel)
  if (!n || n.includes('\0')) throw new Error('invalid memory path')
  if (n.startsWith('../') || n.includes('/../') || path.isAbsolute(n)) throw new Error('path traversal blocked')
  if (!n.endsWith('.md')) throw new Error('memory pages must be Markdown files')
  const first = n.split('/')[0]
  if (!ALLOWED_TOP.has(first)) throw new Error(`memory path is outside allowed wiki areas: ${n}`)
  if (/(^|\/)(\.env|id_rsa|id_dsa|credentials|secrets?)(\.|\/|$)/i.test(n)) throw new Error('sensitive memory path blocked')
  return n
}

function validateBody(pathRel: string, body: string): string[] {
  const issues: string[] = []
  const type = pageTypeForPath(pathRel)
  if (containsSecret(body)) issues.push('contains secret-like material')
  if (body.length > 40_000) issues.push('memory page is too large')
  if (!/^#\s+.+/m.test(body)) issues.push('missing H1 title')
  if (type !== 'session' && type !== 'slot' && type !== 'pending' && type !== 'audit' && type !== 'handoff') {
    if (!/## Evidence\b/i.test(body)) issues.push('durable memory requires an Evidence section')
  }
  if (type === 'rule' && !/## Last reviewed\b/i.test(body)) issues.push('rules require Last reviewed')
  return issues
}

function quoteEvidence(evidence: Evidence[]): string {
  return evidence.length
    ? evidence.map(e => `* ${e.kind}: ${e.ref}${e.quote ? ` — "${e.quote.replace(/\s+/g, ' ').slice(0, 180)}"` : ''}`).join('\n')
    : '* none'
}

function appendAudit(cwd: string, event: Record<string, unknown>): void {
  ensureDir(path.join(memoryWikiDir(cwd), '_audit'))
  appendLine(path.join(memoryWikiDir(cwd), '_audit/audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n')
}

async function saveRevision(cwd: string, rel: string, before: string | null): Promise<string | null> {
  if (before === null) return null
  const id = `${Date.now()}-${rel.replace(/[^a-zA-Z0-9_.-]+/g, '__')}`
  const revision = path.join(memoryWikiDir(cwd), '_audit/revisions', id)
  await writeText(revision, before)
  return `wiki/_audit/revisions/${id}`
}

export class MemoryStore {
  constructor(readonly cwd = process.cwd()) {}

  private async ready(): Promise<void> {
    await initMemoryWorkspace(this.cwd)
  }

  resolvePage(pathRel: string): string {
    const rel = assertValidWikiPath(pathRel)
    return path.join(memoryWikiDir(this.cwd), rel)
  }

  async readPage(pathRel: string): Promise<string | null> {
    await this.ready()
    return readText(this.resolvePage(pathRel))
  }

  async writePage(pathRel: string, body: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.ready()
    const rel = assertValidWikiPath(pathRel)
    const issues = validateBody(rel, body)
    if (issues.length) throw new Error(`memory validation failed: ${issues.join('; ')}`)
    const full = this.resolvePage(rel)
    const before = await readText(full)
    const revision = await saveRevision(this.cwd, rel, before)
    await writeText(full, body.endsWith('\n') ? body : body + '\n')
    appendAudit(this.cwd, { action: before === null ? 'create' : 'write', path: rel, revision, metadata })
  }

  async updatePage(pathRel: string, patch: string | ((body: string) => string), metadata: Record<string, unknown> = {}): Promise<void> {
    const before = (await this.readPage(pathRel)) ?? ''
    const next = typeof patch === 'function' ? patch(before) : patch
    await this.writePage(pathRel, next, { ...metadata, updatedFrom: before ? 'existing' : 'empty' })
  }

  async listPages(prefix = ''): Promise<string[]> {
    await this.ready()
    const root = memoryWikiDir(this.cwd)
    const start = path.join(root, normalizeRel(prefix))
    const out: string[] = []
    const walk = (dir: string) => {
      for (const e of listDir(dir)) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name.endsWith('.md')) out.push(normalizeRel(path.relative(root, full)))
      }
    }
    walk(start)
    return out.sort()
  }

  async deletePage(pathRel: string, opts: { manual?: boolean; reason?: string } = {}): Promise<void> {
    if (!opts.manual) throw new Error('deletePage requires explicit manual=true')
    const rel = assertValidWikiPath(pathRel)
    if (pageTypeForPath(rel) === 'session') throw new Error('session logs are append-only; deletion is blocked')
    const full = this.resolvePage(rel)
    const before = await readText(full)
    if (before === null) return
    const revision = await saveRevision(this.cwd, rel, before)
    removeFile(full)
    appendAudit(this.cwd, { action: 'delete', path: rel, revision, reason: opts.reason ?? 'manual delete' })
  }

  async getPageHistory(pathRel: string): Promise<string[]> {
    await this.ready()
    const rel = assertValidWikiPath(pathRel)
    const suffix = rel.replace(/[^a-zA-Z0-9_.-]+/g, '__')
    const revisions = path.join(memoryWikiDir(this.cwd), '_audit/revisions')
    return listDir(revisions)
      .filter(e => !e.isDirectory() && e.name.endsWith(suffix))
      .map(e => `wiki/_audit/revisions/${e.name}`)
      .sort()
  }

  async restorePage(pathRel: string, revision: string): Promise<void> {
    const rel = assertValidWikiPath(pathRel)
    const revRel = revision.replace(/^wiki\//, '')
    const revPath = path.join(memoryWikiDir(this.cwd), assertValidWikiPath(revRel))
    const body = await readText(revPath)
    if (body === null) throw new Error(`revision not found: ${revision}`)
    await this.writePage(rel, body, { restoredFrom: revision })
  }

  async writeMemory(input: MemoryWriteInput): Promise<string> {
    const rel = `${TYPE_DIR[input.type]}/${slugifyTitle(input.title)}.md`
    const body = formatDurableMemory(input)
    await this.writePage(rel, body, { type: input.type, confidence: input.confidence, pinned: !!input.pinned })
    return rel
  }
}

export function formatDurableMemory(input: MemoryWriteInput): string {
  const title = input.title.trim()
  const body = input.body.trim()
  if (input.type === 'decision') {
    return `# Decision: ${title}

## Status

accepted

${body.includes('## Context') ? body : `## Context\n\n${body}\n\n## Decision\n\n${title}\n\n## Rationale\n\n${body}\n\n## Consequences\n\nTo be reviewed as the project evolves.`}

## Evidence

${quoteEvidence(input.evidence)}
`
  }
  if (input.type === 'gotcha') {
    return `# Gotcha: ${title}

${body}

## Evidence

${quoteEvidence(input.evidence)}

## Confidence

${input.confidence}
`
  }
  if (input.type === 'procedure') {
    return `# Procedure: ${title}

${body}

## Evidence

${quoteEvidence(input.evidence)}
`
  }
  if (input.type === 'concept') {
    return `# Concept: ${title}

${body.includes('## Summary') ? body : `## Summary\n\n${body}\n\n## Details\n\n${body}\n\n## Related modules\n\n- TBD\n\n## Related decisions\n\n- TBD`}

## Evidence

${quoteEvidence(input.evidence)}
`
  }
  if (input.type === 'rule') {
    return `# Rule: ${title}

${body}

## Evidence

${quoteEvidence(input.evidence)}

## Last reviewed

${new Date().toISOString().slice(0, 10)}
`
  }
  return `# Note: ${title}

${body}

## Evidence

${quoteEvidence(input.evidence)}

## Confidence

${input.confidence}
`
}

export class MemoryIndexer {
  constructor(readonly cwd = process.cwd()) {}

  private db(): Database {
    ensureDir(memoryIndexDir(this.cwd))
    return new Database(memoryDbPath(this.cwd))
  }

  private init(db: Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        path TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(path UNINDEXED, title, summary, body, type UNINDEXED);
    `)
  }

  async rebuildIndex(): Promise<{ indexed: number }> {
    await initMemoryWorkspace(this.cwd)
    const store = new MemoryStore(this.cwd)
    const db = this.db()
    this.init(db)
    db.exec('DROP TABLE IF EXISTS pages_fts; DELETE FROM pages; CREATE VIRTUAL TABLE pages_fts USING fts5(path UNINDEXED, title, summary, body, type UNINDEXED);')
    let indexed = 0
    for (const rel of await store.listPages()) {
      if (rel.startsWith('_audit/revisions/')) continue
      await this.indexPage(rel, db)
      indexed++
    }
    db.close()
    return { indexed }
  }

  async indexPage(pathRel: string, existingDb?: Database): Promise<void> {
    await initMemoryWorkspace(this.cwd)
    const rel = assertValidWikiPath(pathRel)
    const body = await readText(path.join(memoryWikiDir(this.cwd), rel))
    if (body === null) return
    const db = existingDb ?? this.db()
    this.init(db)
    const title = titleFromBody(body, rel)
    const summary = summaryFromBody(body)
    const type = pageTypeForPath(rel)
    db.query(
      `INSERT INTO pages(path,type,title,summary,body,updated_at)
       VALUES ($path,$type,$title,$summary,$body,$updated)
       ON CONFLICT(path) DO UPDATE SET type=excluded.type,title=excluded.title,summary=excluded.summary,body=excluded.body,updated_at=excluded.updated_at`,
    ).run({ $path: rel, $type: type, $title: title, $summary: summary, $body: body, $updated: Date.now() })
    db.query('DELETE FROM pages_fts WHERE path = $path').run({ $path: rel })
    db.query(
      `INSERT INTO pages_fts(path,title,summary,body,type)
       VALUES ($path,$title,$summary,$body,$type)`,
    ).run({ $path: rel, $title: title, $summary: summary, $body: body, $type: type })
    if (!existingDb) db.close()
  }

  async removePage(pathRel: string): Promise<void> {
    const rel = assertValidWikiPath(pathRel)
    const db = this.db()
    this.init(db)
    db.query('DELETE FROM pages_fts WHERE path = $path').run({ $path: rel })
    db.query('DELETE FROM pages WHERE path = $path').run({ $path: rel })
    db.close()
  }

  async search(query: string, filters: MemorySearchFilters = {}): Promise<MemorySearchResult[]> {
    await initMemoryWorkspace(this.cwd)
    if (!(await exists(memoryDbPath(this.cwd)))) await this.rebuildIndex()
    const db = this.db()
    this.init(db)
    const q = query.trim()
    const limit = Math.max(1, Math.min(filters.limit ?? 10, 50))
    const types = new Set((filters.types ?? []).map(String))
    const rows = q
      ? db.query(
          `SELECT p.path,p.type,p.title,p.summary,
                  snippet(pages_fts, 3, '[', ']', ' ... ', 16) AS excerpt,
                  bm25(pages_fts) AS score
           FROM pages_fts JOIN pages p ON pages_fts.path = p.path
           WHERE pages_fts MATCH $query
           ORDER BY score LIMIT $limit`,
        ).all({ $query: ftsQuery(q), $limit: limit * 3 }) as Record<string, unknown>[]
      : db.query(
          `SELECT path,type,title,summary,summary AS excerpt,0 AS score FROM pages ORDER BY updated_at DESC LIMIT $limit`,
        ).all({ $limit: limit * 3 }) as Record<string, unknown>[]
    db.close()
    return rows
      .filter(r => !types.size || types.has(String(r.type)) || types.has(`${String(r.type)}s`))
      .slice(0, limit)
      .map((r, i) => ({
        path: String(r.path),
        type: String(r.type) as MemoryPageType,
        title: String(r.title),
        summary: String(r.summary),
        excerpt: String(r.excerpt ?? ''),
        relevance: Math.max(0, Math.min(1, 1 - i / Math.max(1, limit))),
      }))
  }

  async findRelatedPages(pathRel: string): Promise<MemorySearchResult[]> {
    const body = await new MemoryStore(this.cwd).readPage(pathRel)
    if (!body) return []
    const terms = titleFromBody(body, pathRel).replace(/^(Decision|Gotcha|Procedure|Concept|Rule|Note):\s*/i, '')
    return this.search(terms, { limit: 8 })
  }

  async getRecentPages(limit = 10): Promise<MemorySearchResult[]> {
    return this.search('', { limit })
  }
}

function ftsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map(t => t.replace(/[^A-Za-z0-9_:-]/g, ''))
    .filter(Boolean)
    .slice(0, 12)
  return terms.length ? terms.map(t => `"${t}"`).join(' OR ') : '""'
}

export function shouldConsultMemory(task: string, effort?: 'low' | 'medium' | 'high' | 'max'): boolean {
  if (effort === 'high' || effort === 'max') return true
  if (effort === 'low') return /\b(history|memory|again|recurring|bug|project|arquitetura|hist[oó]rico|mem[oó]ria)\b/i.test(task)
  return /\b(bug|fix|refactor|architecture|arquitetura|tool|router|adapter|filesystem|shell|safety|memory|mem[oó]ria|mcp|rag|sqlite|ollama)\b/i.test(task)
}

export async function memoryContextForTask(
  cwd: string,
  task: string,
  opts: { effort?: 'low' | 'medium' | 'high' | 'max'; limit?: number } = {},
): Promise<string> {
  if (!shouldConsultMemory(task, opts.effort)) return ''
  try {
    const results = await new MemoryIndexer(cwd).search(task, { limit: opts.limit ?? (opts.effort === 'max' ? 12 : 6) })
    if (!results.length) return ''
    return results
      .map(r => `- ${r.path} (${r.type}): ${r.title}\n  ${r.summary || r.excerpt}`.trimEnd())
      .join('\n')
      .slice(0, opts.effort === 'max' ? 6_000 : 3_000)
  } catch {
    return ''
  }
}

export class MemoryProposalValidator {
  constructor(readonly cwd = process.cwd(), readonly config: MemoryConfig = DEFAULT_MEMORY_CONFIG) {}

  async validate(proposal: MemoryProposal): Promise<ProposalValidationResult> {
    const issues: string[] = []
    const type = proposal.type
    const allowedTypes: ProposalType[] = ['decision', 'gotcha', 'procedure', 'concept', 'rule', 'note', 'slot_update']
    if (!allowedTypes.includes(type)) issues.push('unknown proposal type')
    const normalized_path = this.normalizedPath(proposal)
    try {
      assertValidWikiPath(normalized_path)
    } catch (e) {
      issues.push(e instanceof Error ? e.message : String(e))
    }
    const normalized_body = type === 'slot_update'
      ? proposal.body.trim()
      : formatDurableMemory({
          type: type as DurableMemoryType,
          title: proposal.title,
          body: proposal.body,
          evidence: proposal.evidence,
          confidence: proposal.confidence,
        })
    if (!proposal.evidence?.length) issues.push('evidence is required')
    if (containsSecret(`${proposal.title}\n${proposal.body}\n${JSON.stringify(proposal.evidence)}`)) issues.push('contains secret-like material')
    if (proposal.body.length > 20_000) issues.push('proposal body is too large')
    if (CONF_RANK[proposal.confidence] < CONF_RANK[this.config.autoImprove.minConfidence]) issues.push(`confidence below ${this.config.autoImprove.minConfidence}`)
    if (type === 'rule' && proposal.confidence !== 'high') issues.push('rules require high confidence')
    if (type === 'gotcha' && !hasSections(proposal.body, ['Problem', 'Root cause', 'Fix / mitigation'])) {
      issues.push('gotchas require Problem, Root cause, and Fix / mitigation')
    }
    if (type === 'decision' && !hasSections(proposal.body, ['Context', 'Decision', 'Rationale'])) {
      issues.push('decisions require Context, Decision, and Rationale')
    }
    if (type === 'procedure' && !hasSections(proposal.body, ['Steps', 'Validation'])) {
      issues.push('procedures require Steps and Validation')
    }
    if (/transient|one[- ]off|network down|token expired|dependency missing once/i.test(`${proposal.reason ?? ''}\n${proposal.body}`)) {
      issues.push('looks like a transient failure, not durable memory')
    }
    if (normalized_path.startsWith('sessions/')) issues.push('proposals may not edit session logs')
    const requiresHuman =
      proposal.should_require_approval !== false ||
      this.config.autoImprove.requireApproval ||
      this.config.autoImprove.manualApprovalTypes.includes(type)
    return {
      approved: issues.length === 0,
      requires_human_review: requiresHuman || type === 'rule',
      issues,
      normalized_path,
      normalized_body: normalized_body.endsWith('\n') ? normalized_body : normalized_body + '\n',
      reason: issues.length ? issues.join('; ') : 'proposal is valid',
    }
  }

  normalizedPath(proposal: MemoryProposal): string {
    if (proposal.type === 'slot_update') return '_slots/current-focus.md'
    const type = proposal.type as DurableMemoryType
    const prefix = TYPE_DIR[type] ?? 'notes'
    const p = normalizeRel(proposal.path || `${prefix}/${slugifyTitle(proposal.title)}.md`)
    return p.endsWith('.md') ? p : `${p}.md`
  }
}

function hasSections(body: string, sections: string[]): boolean {
  return sections.every(s => new RegExp(`^##\\s+${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im').test(body))
}

export class MemoryApprovalQueue {
  constructor(readonly cwd = process.cwd()) {}

  private pendingDir(): string {
    return path.join(memoryWikiDir(this.cwd), '_pending/auto-improve')
  }

  async enqueue(proposal: MemoryProposal, validation?: ProposalValidationResult): Promise<string> {
    await initMemoryWorkspace(this.cwd)
    const id = proposal.id ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${slugifyTitle(proposal.title)}`
    const v = validation ?? await new MemoryProposalValidator(this.cwd, await loadMemoryConfig(this.cwd)).validate(proposal)
    const body = `# Pending Memory Proposal: ${id}

## Source session

${proposal.evidence.find(e => e.kind === 'session')?.ref ?? 'unknown'}

## Proposed changes

${proposal.type}: ${proposal.title}

## Diff

\`\`\`md
${v.normalized_body.trim()}
\`\`\`

## Evidence

${quoteEvidence(proposal.evidence)}

## Confidence

${proposal.confidence}

## Validation result

${v.approved ? 'approved' : 'rejected'}${v.issues.length ? `: ${v.issues.join('; ')}` : ''}

## Approval status

pending

## Proposal JSON

\`\`\`json
${JSON.stringify({ ...proposal, id, path: v.normalized_path }, null, 2)}
\`\`\`
`
    await new MemoryStore(this.cwd).writePage(`_pending/auto-improve/${id}.md`, body, { proposal: id })
    return id
  }

  async list(): Promise<string[]> {
    const store = new MemoryStore(this.cwd)
    return (await store.listPages('_pending/auto-improve')).map(p => path.basename(p, '.md'))
  }

  async show(id: string): Promise<string | null> {
    return new MemoryStore(this.cwd).readPage(`_pending/auto-improve/${id}.md`)
  }

  async diff(id: string): Promise<string> {
    const text = await this.show(id)
    return text?.match(/```md\n([\s\S]*?)\n```/)?.[1] ?? '(no diff)'
  }

  async reject(id: string, reason = 'manual rejection'): Promise<void> {
    const rel = `_pending/auto-improve/${id}.md`
    await new MemoryStore(this.cwd).updatePage(rel, body => body.replace(/## Approval status\n\npending/, `## Approval status\n\nrejected\n\n${reason}`), { approval: 'rejected' })
  }

  async approve(id: string): Promise<string> {
    const text = await this.show(id)
    if (!text) throw new Error(`pending proposal not found: ${id}`)
    const proposal = parseProposal(text)
    if (!proposal) throw new Error(`proposal JSON not found: ${id}`)
    const cfg = await loadMemoryConfig(this.cwd)
    const validator = new MemoryProposalValidator(this.cwd, cfg)
    const v = await validator.validate(proposal)
    if (!v.approved) throw new Error(`proposal failed validation: ${v.issues.join('; ')}`)
    await new MemoryStore(this.cwd).writePage(v.normalized_path, v.normalized_body, { appliedProposal: id })
    await this.markApplied(id)
    await new MemoryIndexer(this.cwd).indexPage(v.normalized_path)
    return v.normalized_path
  }

  async apply(id: string): Promise<string> {
    return this.approve(id)
  }

  private async markApplied(id: string): Promise<void> {
    await new MemoryStore(this.cwd).updatePage(`_pending/auto-improve/${id}.md`, body => body.replace(/## Approval status\n\npending/, '## Approval status\n\napproved'), { approval: 'approved' })
  }
}

function parseProposal(text: string): MemoryProposal | null {
  const json = text.match(/```json\n([\s\S]*?)\n```/)?.[1]
  if (!json) return null
  try {
    return JSON.parse(json) as MemoryProposal
  } catch {
    return null
  }
}

export interface SessionEvent {
  type:
    | 'session_started'
    | 'user_prompt'
    | 'assistant_plan_created'
    | 'tool_called'
    | 'tool_result'
    | 'file_read'
    | 'file_changed'
    | 'command_run'
    | 'test_result'
    | 'error_seen'
    | 'decision_made'
    | 'session_ended'
  at?: string
  data?: Record<string, unknown>
}

export class SessionRecorder {
  readonly events: SessionEvent[] = []

  constructor(readonly cwd: string, readonly sessionId: string) {}

  async record(type: SessionEvent['type'], data: Record<string, unknown> = {}): Promise<void> {
    await initMemoryWorkspace(this.cwd)
    const event = { type, at: new Date().toISOString(), data }
    this.events.push(event)
    appendLine(path.join(memoryDir(this.cwd), 'logs/sessions', `${this.sessionId}.jsonl`), JSON.stringify(event) + '\n')
  }

  async finish(summary: { userGoal?: string; outcome?: string; openQuestions?: string[]; candidateLearnings?: string[] } = {}): Promise<string> {
    await this.record('session_ended', { outcome: summary.outcome ?? '' })
    const files = unique(this.events.flatMap(e => typeof e.data?.path === 'string' ? [e.data.path] : []))
    const commands = unique(this.events.flatMap(e => typeof e.data?.command === 'string' ? [e.data.command] : []))
    const tools = this.events.filter(e => e.type === 'tool_called').map(e => String(e.data?.name ?? 'unknown'))
    const errors = this.events.filter(e => e.type === 'error_seen').map(e => String(e.data?.message ?? 'unknown error'))
    const body = `# Session ${this.sessionId}

## Date

${new Date().toISOString()}

## User Goal

${summary.userGoal ?? String(this.events.find(e => e.type === 'user_prompt')?.data?.prompt ?? '')}

## Actions

${tools.length ? tools.map(t => `* tool: ${t}`).join('\n') : '* No tools recorded.'}

## Files touched

${files.length ? files.map(f => `* ${f}`).join('\n') : '* None recorded.'}

## Commands

${commands.length ? commands.map(cmd => `* \`${cmd}\``).join('\n') : '* None recorded.'}

## Errors encountered

${errors.length ? errors.map(e => `* ${e}`).join('\n') : '* None recorded.'}

## Outcome

${summary.outcome ?? 'Session completed.'}

## Open questions

${summary.openQuestions?.length ? summary.openQuestions.map(q => `* ${q}`).join('\n') : '* None recorded.'}

## Candidate learnings

${summary.candidateLearnings?.length ? summary.candidateLearnings.map(q => `* ${q}`).join('\n') : '* None recorded.'}
`
    const rel = `sessions/${this.sessionId}.md`
    await new MemoryStore(this.cwd).writePage(rel, body, { sessionId: this.sessionId })
    await new MemoryIndexer(this.cwd).indexPage(rel)
    return rel
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))]
}

export class HandoffManager {
  constructor(readonly cwd = process.cwd()) {}

  async create(sessionId: string, input: {
    whereWeLeftOff: string
    currentFocus?: string
    filesChanged?: string[]
    testsRun?: string[]
    openQuestions?: string[]
    nextSteps?: string[]
    relevantMemoryPages?: string[]
  }): Promise<string> {
    await initMemoryWorkspace(this.cwd)
    const body = `# Handoff

## Where we left off

${input.whereWeLeftOff}

## Current focus

${input.currentFocus ?? 'No current focus recorded.'}

## Files changed

${input.filesChanged?.length ? input.filesChanged.map(f => `* ${f}`).join('\n') : '* None recorded.'}

## Tests run

${input.testsRun?.length ? input.testsRun.map(t => `* ${t}`).join('\n') : '* None recorded.'}

## Open questions

${input.openQuestions?.length ? input.openQuestions.map(q => `* ${q}`).join('\n') : '* None recorded.'}

## Next recommended steps

${input.nextSteps?.length ? input.nextSteps.map(s => `* ${s}`).join('\n') : '* None recorded.'}

## Relevant memory pages

${input.relevantMemoryPages?.length ? input.relevantMemoryPages.map(p => `* ${p}`).join('\n') : '* None recorded.'}

## Status

pending
`
    const full = path.join(handoffsDir(this.cwd), `${sessionId}.md`)
    if (containsSecret(body)) throw new Error('handoff contains secret-like material')
    await writeText(full, body)
    appendAudit(this.cwd, { action: 'handoff_create', path: `handoffs/${sessionId}.md` })
    return full
  }

  async latestPending(): Promise<{ id: string; path: string; summary: string } | null> {
    await initMemoryWorkspace(this.cwd)
    const files = listDir(handoffsDir(this.cwd))
      .filter(e => !e.isDirectory() && e.name.endsWith('.md'))
      .map(e => e.name)
      .sort()
      .reverse()
    for (const name of files) {
      const full = path.join(handoffsDir(this.cwd), name)
      const text = await readText(full)
      if (text && /## Status\s+pending/i.test(text)) {
        return { id: name.replace(/\.md$/, ''), path: full, summary: text.slice(0, 4_000) }
      }
    }
    return null
  }

  async accept(id: string): Promise<void> {
    // `id` is the handoff filename stem as written by create() / returned by latestPending(); use it
    // directly (slugifying here would not match session ids that aren't already slugs).
    const full = path.join(handoffsDir(this.cwd), `${id}.md`)
    const text = await readText(full)
    if (!text) return
    await writeText(full, text.replace(/## Status\n\npending/, '## Status\n\naccepted'))
    appendAudit(this.cwd, { action: 'handoff_accept', path: `handoffs/${id}.md` })
  }
}

/** Optional model-backed reviewer: turns a completed session into durable memory proposals. */
export type MemoryProposer = (input: {
  session: string
  source: string
  recentMemory: string[]
}) => Promise<{ proposals: MemoryProposal[]; rejected_candidates?: { summary: string; reason: string }[] }>

export interface ReviewOptions {
  propose?: MemoryProposer
}

export class AutoImproveReviewer {
  constructor(readonly cwd = process.cwd()) {}

  async reviewSession(
    sessionPath: string,
    opts: ReviewOptions = {},
  ): Promise<{ proposals: MemoryProposal[]; rejected_candidates: { summary: string; reason: string }[] }> {
    const session = await readText(path.isAbsolute(sessionPath) ? sessionPath : path.join(memoryWikiDir(this.cwd), sessionPath))
    if (!session || session.length < 80) return { proposals: [], rejected_candidates: [{ summary: 'empty session', reason: 'not enough signal' }] }
    const source = normalizeRel(sessionPath).replace(/^.*wiki\//, '')

    // Preferred path: a model reviewer extracts richer, evidence-backed proposals. Everything it emits
    // is still gated by MemoryProposalValidator + the approval queue, so a hallucination cannot persist.
    if (opts.propose) {
      try {
        const recentMemory = (await new MemoryIndexer(this.cwd).getRecentPages(6)).map(r => `${r.path}: ${r.title}`)
        const out = await opts.propose({ session, source, recentMemory })
        const proposals = (Array.isArray(out?.proposals) ? out.proposals : []).map(p => sanitizeProposal(p, source))
        if (proposals.length || (out?.rejected_candidates?.length ?? 0)) {
          return { proposals, rejected_candidates: out.rejected_candidates ?? [] }
        }
      } catch {
        // fall back to the deterministic extractor below
      }
    }

    // Deterministic fallback: promote explicit "Candidate learnings" bullets to notes.
    const rejected_candidates: { summary: string; reason: string }[] = []
    const proposals: MemoryProposal[] = []
    for (const cnd of extractCandidateLearnings(session)) {
      if (/network|timeout|token expired|missing dependency|PATH|one[- ]off/i.test(cnd)) {
        rejected_candidates.push({ summary: cnd, reason: 'transient or local environment signal' })
        continue
      }
      proposals.push({
        type: 'note',
        path: `notes/${slugifyTitle(cnd)}.md`,
        title: cnd.slice(0, 90),
        body: `## Summary\n\n${cnd}\n\n## Details\n\nObserved during a completed development session. Keep this as a note until it is promoted to a concept, procedure, decision, or gotcha with stronger evidence.`,
        evidence: [{ kind: 'session', ref: source, quote: cnd }],
        confidence: 'medium',
        reason: 'candidate learning extracted from session summary',
        should_require_approval: true,
      })
    }
    return { proposals, rejected_candidates }
  }

  async createPendingFromSession(sessionPath: string, opts: ReviewOptions = {}): Promise<string[]> {
    const cfg = await loadMemoryConfig(this.cwd)
    if (!cfg.autoImprove.enabled) return []
    const review = await this.reviewSession(sessionPath, opts)
    const queue = new MemoryApprovalQueue(this.cwd)
    const validator = new MemoryProposalValidator(this.cwd, cfg)
    const ids: string[] = []
    for (const proposal of review.proposals) {
      const validation = await validator.validate(proposal)
      if (!validation.approved) continue
      ids.push(await queue.enqueue(proposal, validation))
    }
    return ids
  }
}

/** Normalize an untrusted (model-emitted) proposal: bounded fields + guaranteed session evidence. */
function sanitizeProposal(p: MemoryProposal, source: string): MemoryProposal {
  const evidence = Array.isArray(p.evidence) ? p.evidence.filter(e => e && typeof e.ref === 'string') : []
  if (!evidence.some(e => e.kind === 'session')) evidence.unshift({ kind: 'session', ref: source })
  return {
    type: p.type,
    path: typeof p.path === 'string' ? p.path : '',
    title: String(p.title ?? '').slice(0, 120),
    body: String(p.body ?? '').slice(0, 20_000),
    evidence,
    confidence: p.confidence === 'low' || p.confidence === 'high' ? p.confidence : 'medium',
    reason: typeof p.reason === 'string' ? p.reason.slice(0, 300) : 'model-proposed durable learning',
    should_require_approval: p.should_require_approval !== false,
  }
}

function extractCandidateLearnings(session: string): string[] {
  const block = session.match(/## Candidate learnings\n([\s\S]*?)(?:\n## |\n?$)/i)?.[1] ?? ''
  return block
    .split('\n')
    .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(line => line && !/^none recorded/i.test(line))
    .slice(0, 8)
}

export class MemoryCurator {
  constructor(readonly cwd = process.cwd()) {}

  async lint(): Promise<string[]> {
    const store = new MemoryStore(this.cwd)
    const issues: string[] = []
    for (const rel of await store.listPages()) {
      if (rel.startsWith('_audit/revisions/')) continue
      const body = await store.readPage(rel)
      if (!body) continue
      for (const issue of validateBody(rel, body)) issues.push(`${rel}: ${issue}`)
    }
    return issues
  }

  async health(): Promise<{ pages: number; issues: number; pending: number }> {
    const store = new MemoryStore(this.cwd)
    const pages = (await store.listPages()).filter(p => !p.startsWith('_audit/revisions/')).length
    const issues = (await this.lint()).length
    const pending = (await new MemoryApprovalQueue(this.cwd).list()).length
    return { pages, issues, pending }
  }

  async curate(now = new Date()): Promise<string> {
    const store = new MemoryStore(this.cwd)
    const issues = await this.lint()
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    for (const rel of await store.listPages()) {
      const body = await store.readPage(rel)
      if (!body) continue
      const title = titleFromBody(body, rel).toLowerCase()
      if (seen.has(title)) duplicates.push(`${seen.get(title)} ↔ ${rel}`)
      else seen.set(title, rel)
    }
    const report = `# Memory Curator Report ${now.toISOString().slice(0, 10)}

## Health

* lint issues: ${issues.length}
* duplicate title candidates: ${duplicates.length}

## Lint issues

${issues.length ? issues.map(i => `* ${i}`).join('\n') : '* None.'}

## Duplicate candidates

${duplicates.length ? duplicates.map(i => `* ${i}`).join('\n') : '* None.'}

## Notes

No page was deleted. Merge, supersession, or archive actions require approval.
`
    const rel = `_audit/curator-${now.toISOString().slice(0, 10)}.md`
    await store.writePage(rel, report, { curator: true })
    return rel
  }
}

export const MEMORY_REVIEWER_PROMPT = `You are a long-term memory reviewer for a coding agent.

Analyze a completed session and identify only durable learnings that will help future agents. Promote
technical decisions, reproducible gotchas with cause and mitigation, repeatable procedures, stable
architecture concepts, explicit project rules, user preferences, and important code patterns.
Reject transient errors, local environment failures, expired tokens, one-off missing dependencies,
isolated smoke tests, whole-session narratives, broad claims without evidence, secrets, .env values,
credentials, and low-utility facts. Reply only with valid JSON in the required proposal schema.`

export const MEMORY_VALIDATOR_PROMPT = `You are a deterministic validator for memory proposals.

Validate allowed path, type/path compatibility, evidence, absence of secrets, no transient claims, no
broad rule without proof, no clear duplication, reasonable size, future utility, and compatible
confidence. Reply with JSON: approved, requires_human_review, issues, normalized_path,
normalized_body, reason.`

// --------------------------------------------------------------------------- //
// Legacy Reflexion API compatibility
// --------------------------------------------------------------------------- //
export type MemoryCategory = 'lesson' | 'failure' | 'tool-error' | 'preference' | 'decision'

const FILES: Record<MemoryCategory, string> = {
  lesson: 'project-lessons.md',
  failure: 'failed-attempts.md',
  'tool-error': 'tool-errors.md',
  preference: 'user-preferences.md',
  decision: 'architecture-decisions.md',
}

export function memoryCategories(): MemoryCategory[] {
  return Object.keys(FILES) as MemoryCategory[]
}

export interface RememberResult {
  saved: boolean
  redacted: boolean
  reason?: string
}

export async function remember(
  cwd: string,
  category: MemoryCategory,
  note: string,
  now: Date = new Date(),
): Promise<RememberResult> {
  const file = FILES[category]
  if (!file) return { saved: false, redacted: false, reason: `unknown category "${category}"` }
  const trimmed = note.trim().replace(/\s+/g, ' ')
  if (!trimmed) return { saved: false, redacted: false, reason: 'empty note' }

  const { text, redacted } = redactSecrets(trimmed)
  ensureDir(memoryDir(cwd))
  appendLine(path.join(memoryDir(cwd), file), `- [${now.toISOString().slice(0, 10)}] ${text}\n`)
  return { saved: true, redacted }
}

export async function recall(cwd: string, category?: MemoryCategory): Promise<string> {
  const dir = memoryDir(cwd)
  if (category) return (await readText(path.join(dir, FILES[category]))) ?? ''
  const parts: string[] = []
  for (const cat of memoryCategories()) {
    const text = await readText(path.join(dir, FILES[cat]))
    if (text && text.trim()) parts.push(`## ${cat}\n${text.trim()}`)
  }
  return parts.join('\n\n')
}

export async function recallForPrompt(cwd: string, maxChars = 1_500): Promise<string> {
  const parts: string[] = []
  for (const cat of ['preference', 'lesson'] as MemoryCategory[]) {
    const text = (await readText(path.join(memoryDir(cwd), FILES[cat])) ?? '').trim()
    if (text) parts.push(`${cat === 'preference' ? 'User preferences' : 'Project lessons'}:\n${text}`)
  }
  return parts.join('\n\n').slice(0, maxChars)
}
