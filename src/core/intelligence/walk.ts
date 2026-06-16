// Max Coder — deterministic repo file walker for repository intelligence (P4).
// Respects a default ignore set + a basic .gitignore, skips secret files, caps file size / count,
// and returns files in a stable order. No model; cheap; the foundation for project-map + indexes.

import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import * as path from 'node:path'
import { isSecretPath } from '../../safety/index.ts'

export interface WalkedFile {
  path: string // relative to root, POSIX separators
  mtimeMs: number
  size: number
}

export interface WalkOptions {
  maxFileBytes?: number // skip files larger than this (default 256 KiB)
  maxFiles?: number // hard cap on returned files (default 5000)
  extraIgnores?: string[] // extra directory/file names to skip
}

// Directories never worth indexing.
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', '.maxcoder', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '.cache', 'out', 'vendor', 'target', '.venv', '__pycache__', '.turbo', '.svelte-kit',
])

const DEFAULT_MAX_FILE_BYTES = 256 * 1024
const DEFAULT_MAX_FILES = 5000

/** Parse a .gitignore into a simple set of names/prefixes (no negation/nested/glob semantics). */
export function loadGitignore(root: string): Set<string> {
  const out = new Set<string>()
  try {
    const text = readFileSync(path.join(root, '.gitignore'), 'utf8')
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || line.startsWith('!')) continue // skip comments + negations
      if (line.includes('*')) continue // skip globs in this basic implementation
      out.add(line.replace(/^\/+/, '').replace(/\/+$/, ''))
    }
  } catch {
    // no .gitignore — fine
  }
  return out
}

/** Walk the repo, returning indexable files (relative paths) in deterministic order. */
export function walkRepo(root: string, opts: WalkOptions = {}): WalkedFile[] {
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES
  const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...(opts.extraIgnores ?? [])])
  const ignored = loadGitignore(root)
  const files: WalkedFile[] = []

  const walk = (dir: string): void => {
    if (files.length >= maxFiles) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[]
    } catch {
      return
    }
    // Stable, deterministic order.
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
    for (const e of sorted) {
      if (files.length >= maxFiles) return
      if (e.name.startsWith('.git') && e.name !== '.github') continue
      if (ignoreDirs.has(e.name) || ignored.has(e.name)) continue
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (isSecretPath(rel) || isSecretPath(e.name)) continue // never index secrets
      if (e.isDirectory()) {
        walk(abs)
      } else if (e.isFile()) {
        let st: ReturnType<typeof statSync> | undefined
        try {
          st = statSync(abs)
        } catch {
          continue
        }
        if (!st || st.size > maxBytes) continue
        files.push({ path: rel, mtimeMs: st.mtimeMs, size: st.size })
      }
    }
  }

  walk(root)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}
