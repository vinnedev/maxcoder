// Max Coder — Bun-native file/process helpers.
//
// Per Bun's docs (https://bun.com/docs/runtime/file-io), Bun.file/Bun.write are the idiomatic way
// to read/write files, and Bun.spawn(Sync) is the way to run processes. Bun deliberately does NOT
// provide native directory listing / append; its docs point you to `node:fs` for those. So this is
// the ONE module that touches `node:fs`, limited to: mkdir, readdir, append, stat. Everything else
// uses Bun-native APIs.

import { appendFileSync, mkdirSync, readdirSync, unlinkSync, type Dirent } from 'node:fs'

// ---- files (Bun-native) ----

/** Read a file as text, or null if it doesn't exist. */
export async function readText(p: string): Promise<string | null> {
  const f = Bun.file(p)
  return (await f.exists()) ? await f.text() : null
}

/** Read+parse JSON, or null. */
export async function readJSON<T = unknown>(p: string): Promise<T | null> {
  const f = Bun.file(p)
  if (!(await f.exists())) return null
  try {
    return (await f.json()) as T
  } catch {
    return null
  }
}

/** Write a whole file (Bun.write creates parent directories automatically). */
export async function writeText(p: string, data: string): Promise<void> {
  await Bun.write(p, data)
}

export async function exists(p: string): Promise<boolean> {
  return Bun.file(p).exists()
}

/** Last-modified time in ms (Bun-native BunFile.lastModified). */
export function lastModified(p: string): number {
  return Bun.file(p).lastModified
}

// ---- directories / append (node:fs — Bun has no native equivalent) ----

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true })
}

export function listDir(p: string): Dirent[] {
  try {
    return readdirSync(p, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Append a line to a JSONL transcript (Bun has no native append; this is the documented exception). */
export function appendLine(p: string, line: string): void {
  appendFileSync(p, line, { encoding: 'utf-8', mode: 0o600 })
}

export function removeFile(p: string): void {
  unlinkSync(p)
}

// ---- processes (Bun-native Bun.spawnSync) ----

export interface ShResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Run a command (argv array — no shell, no quoting pitfalls). Bun-native. */
export function sh(cmd: string[], opts: { cwd?: string; timeout?: number; env?: Record<string, string> } = {}): ShResult {
  const r = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    ...(opts.timeout ? { timeout: opts.timeout } : {}),
  })
  return {
    stdout: r.stdout ? r.stdout.toString() : '',
    stderr: r.stderr ? r.stderr.toString() : '',
    exitCode: r.exitCode ?? (r.success ? 0 : 1),
  }
}

/** Run a shell command line (when you genuinely need shell features). */
export function shell(commandLine: string, opts: { cwd?: string; timeout?: number } = {}): ShResult {
  return sh(['bash', '-lc', commandLine], opts)
}
