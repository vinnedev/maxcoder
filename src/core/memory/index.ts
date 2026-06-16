// Max Coder — Reflexion memory (P8). Persistent, append-only lessons under .maxcoder/memory/ so the
// agent improves across runs (correct test commands, recurring errors, conventions, user preferences,
// architecture decisions). Secrets are redacted before saving — never persist tokens/keys/.env values.

import * as path from 'node:path'
import { appendLine, ensureDir, readText } from '../../shared/fs/index.ts'
import { maxcoderDir } from '../config/index.ts'

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

export function memoryDir(cwd = process.cwd()): string {
  return path.join(maxcoderDir(cwd), 'memory')
}

// Patterns that look like secrets — masked before anything is written to disk.
const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, // OpenAI-style keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_?KEY)\s*[=:]\s*\S+/gi, // KEY=value env style
]

/** Mask anything that looks like a secret. Returns the redacted text and whether anything changed. */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false
  let out = text
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, m => {
      redacted = true
      // keep the assignment key (e.g. API_KEY=) but mask the value, else mask the whole token
      const eq = m.match(/^([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_?KEY)\s*[=:]\s*)/i)
      return eq ? `${eq[1]}[REDACTED]` : '[REDACTED]'
    })
  }
  return { text: out, redacted }
}

export interface RememberResult {
  saved: boolean
  redacted: boolean
  reason?: string
}

/** Append a single learned note to a category file (creates .maxcoder/memory/). Redacts secrets. */
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
  const dir = memoryDir(cwd)
  ensureDir(dir)
  appendLine(path.join(dir, file), `- [${now.toISOString().slice(0, 10)}] ${text}\n`)
  return { saved: true, redacted }
}

/** Read one category (or all, with headers). Empty string if nothing recorded. */
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

/** A compact slice of memory for the system prompt: user preferences + project lessons. */
export async function recallForPrompt(cwd: string, maxChars = 1_500): Promise<string> {
  const parts: string[] = []
  for (const cat of ['preference', 'lesson'] as MemoryCategory[]) {
    const text = (await readText(path.join(memoryDir(cwd), FILES[cat])) ?? '').trim()
    if (text) parts.push(`${cat === 'preference' ? 'User preferences' : 'Project lessons'}:\n${text}`)
  }
  return parts.join('\n\n').slice(0, maxChars)
}
