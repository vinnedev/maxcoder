// Max Coder — paths, ids, environment helpers (Bun-native via fsx).

import * as os from 'node:os'
import * as path from 'node:path'
import { ensureDir, sh } from './fsx.ts'

export function configDir(): string {
  const base = process.env.MAXCODER_CONFIG_DIR || path.join(os.homedir(), '.maxcoder')
  ensureDir(base)
  return base
}

export function projectsDir(): string {
  const d = path.join(configDir(), 'projects')
  ensureDir(d)
  return d
}

export function skillsDir(): string {
  return path.join(configDir(), 'skills')
}

export function agentsDir(): string {
  return path.join(configDir(), 'agents')
}

export function mcpConfigPath(): string {
  return path.join(configDir(), 'mcp.json')
}

/** Per-project transcript directory, keyed by a sanitized cwd (like Claude Code). */
export function projectDir(cwd = process.cwd()): string {
  const safe = cwd.replace(/[/\\]/g, '-').replace(/^-+/, '')
  const d = path.join(projectsDir(), safe || 'root')
  ensureDir(d)
  return d
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

export function gitBranch(cwd = process.cwd()): string | undefined {
  const r = sh(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  return r.exitCode === 0 && r.stdout.trim() ? r.stdout.trim() : undefined
}

export function gitStatusShort(cwd = process.cwd()): string | undefined {
  const r = sh(['git', 'status', '--short', '--branch'], { cwd })
  return r.exitCode === 0 && r.stdout.trim() ? r.stdout.trim().slice(0, 2000) : undefined
}
