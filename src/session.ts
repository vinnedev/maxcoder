// Max Coder — session management: append-only JSONL transcripts per project.
// Bun-native I/O via fsx. Simplified-but-robust analog of src/utils/sessionStorage.ts.

import * as path from 'node:path'
import { newId, projectDir } from './config.ts'
import { appendLine, lastModified, listDir, readText, removeFile } from './fsx.ts'
import type { ChatMessage } from './ollama.ts'

export interface TranscriptLine {
  uuid: string
  parentUuid: string | null
  timestamp: string
  kind: 'message' | 'compaction'
  message?: ChatMessage
  summary?: string
  replacedThrough?: string
  sessionId?: string
  cwd?: string
  model?: string
}

export class Session {
  readonly id: string
  readonly file: string
  readonly cwd: string
  model: string
  private lastUuid: string | null = null
  private firstPromptSeen = false

  constructor(opts: { id?: string; cwd?: string; model: string; file?: string }) {
    this.cwd = opts.cwd ?? process.cwd()
    this.id = opts.id ?? newId()
    this.model = opts.model
    this.file = opts.file ?? path.join(projectDir(this.cwd), `${this.id}.jsonl`)
  }

  private append(line: TranscriptLine) {
    appendLine(this.file, JSON.stringify(line) + '\n')
    this.lastUuid = line.uuid
  }

  /** Persist a conversation message (user/assistant/tool). System messages are not stored. */
  record(message: ChatMessage) {
    if (message.role === 'system') return
    const stampMeta = !this.firstPromptSeen && message.role === 'user'
    this.append({
      uuid: newId(),
      parentUuid: this.lastUuid,
      timestamp: new Date().toISOString(),
      kind: 'message',
      message,
      ...(stampMeta ? { sessionId: this.id, cwd: this.cwd, model: this.model } : {}),
    })
    if (stampMeta) this.firstPromptSeen = true
  }

  /** Mark a compaction boundary: messages up to the current tail are summarized. */
  recordCompaction(summary: string) {
    this.append({
      uuid: newId(),
      parentUuid: this.lastUuid,
      timestamp: new Date().toISOString(),
      kind: 'compaction',
      summary,
      replacedThrough: this.lastUuid ?? undefined,
    })
  }

  /** Rebuild the ACTIVE message list (post last compaction boundary + the summary). */
  static async rehydrate(file: string): Promise<ChatMessage[]> {
    const lines = await readLines(file)
    let lastCompactionIdx = -1
    for (let i = 0; i < lines.length; i++) if (lines[i].kind === 'compaction') lastCompactionIdx = i
    const out: ChatMessage[] = []
    if (lastCompactionIdx >= 0) {
      out.push({ role: 'user', content: `[Earlier conversation summary]\n${lines[lastCompactionIdx].summary ?? ''}` })
    }
    for (let i = lastCompactionIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (l.kind === 'message' && l.message) out.push(l.message)
    }
    return out
  }
}

async function readLines(file: string): Promise<TranscriptLine[]> {
  const raw = await readText(file)
  if (!raw) return []
  const out: TranscriptLine[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      out.push(JSON.parse(s))
    } catch {
      /* skip torn line */
    }
  }
  return out
}

export interface SessionSummary {
  id: string
  file: string
  updatedAt: number
  messageCount: number
  firstPrompt: string
  model?: string
}

export async function listSessions(cwd = process.cwd()): Promise<SessionSummary[]> {
  const dir = projectDir(cwd)
  const out: SessionSummary[] = []
  for (const entry of listDir(dir)) {
    if (entry.isDirectory() || !entry.name.endsWith('.jsonl')) continue
    const full = path.join(dir, entry.name)
    const lines = await readLines(full)
    if (lines.length === 0) continue
    const firstUser = lines.find(l => l.kind === 'message' && l.message?.role === 'user')
    out.push({
      id: entry.name.replace(/\.jsonl$/, ''),
      file: full,
      updatedAt: lastModified(full),
      messageCount: lines.filter(l => l.kind === 'message').length,
      firstPrompt: firstUser?.message?.content?.slice(0, 80) ?? '(no prompt)',
      model: lines.find(l => l.model)?.model,
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function pickSession(sessions: SessionSummary[], selector?: string): SessionSummary | null {
  const wanted = (selector || 'latest').trim()
  if (!wanted || wanted === 'latest') return sessions[0] ?? null

  const index = Number.parseInt(wanted, 10)
  if (/^\d+$/.test(wanted) && index >= 1 && index <= sessions.length) return sessions[index - 1]

  return sessions.find(s => s.id === wanted || s.id.startsWith(wanted)) ?? null
}

export async function resumeSession(
  model: string,
  idOrLatest?: string,
  cwd = process.cwd(),
): Promise<Session | null> {
  const sessions = await listSessions(cwd)
  if (sessions.length === 0) return null
  const picked = pickSession(sessions, idOrLatest)
  if (!picked) return null
  return new Session({ id: picked.id, cwd, model: picked.model ?? model, file: picked.file })
}

export interface CleanSessionsResult {
  deleted: number
  kept: number
  errors: { file: string; message: string }[]
}

export async function cleanOldSessions(cwd = process.cwd(), keepId?: string): Promise<CleanSessionsResult> {
  const sessions = await listSessions(cwd)
  const errors: CleanSessionsResult['errors'] = []
  let deleted = 0
  let kept = 0

  for (const s of sessions) {
    if (keepId && s.id === keepId) {
      kept++
      continue
    }
    try {
      removeFile(s.file)
      deleted++
    } catch (e) {
      errors.push({ file: s.file, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return { deleted, kept, errors }
}
