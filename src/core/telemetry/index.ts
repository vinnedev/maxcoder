// Max Coder — telemetry (P8). Structured, append-only run logs under .maxcoder/logs/ for observability
// (AI-engineering): what ran, which tools, tokens, duration, outcome. Local-only; never logs secrets.
// Pure recorder with an injectable sink + clock so it is fully testable; the CLI wires a JSONL sink.

import * as path from 'node:path'
import { appendLine, ensureDir } from '../../shared/fs/index.ts'
import { maxcoderDir } from '../config/index.ts'

export type TelemetryEvent =
  | { kind: 'run_start'; at: number; model: string; effort?: string; task: string }
  | { kind: 'tool'; at: number; name: string; ok: boolean }
  | { kind: 'run_end'; at: number; ok: boolean; turns: number; tools: number; tokens: number; ms: number; error?: string }

export interface RunSummary {
  model: string
  effort?: string
  task: string
  ok: boolean
  turns: number
  tools: number
  tokens: number
  ms: number
  error?: string
}

export type TelemetrySink = (event: TelemetryEvent) => void

/** Records one agent run. `sink` persists events; `clock` supplies timestamps (both injectable). */
export class RunRecorder {
  private startedAt: number
  private toolCount = 0
  private turnCount = 0
  private lastTokens = 0

  constructor(
    private sink: TelemetrySink,
    private meta: { model: string; effort?: string; task: string },
    private clock: () => number = Date.now,
  ) {
    this.startedAt = this.clock()
    this.sink({ kind: 'run_start', at: this.startedAt, model: meta.model, effort: meta.effort, task: truncate(meta.task) })
  }

  turn(): void {
    this.turnCount++
  }

  tool(name: string, ok = true): void {
    this.toolCount++
    this.sink({ kind: 'tool', at: this.clock(), name, ok })
  }

  tokens(n: number): void {
    if (n > this.lastTokens) this.lastTokens = n
  }

  /** Close the run, emit the run_end event, and return the summary. */
  end(ok: boolean, error?: string): RunSummary {
    const at = this.clock()
    const summary: RunSummary = {
      model: this.meta.model,
      effort: this.meta.effort,
      task: truncate(this.meta.task),
      ok,
      turns: this.turnCount,
      tools: this.toolCount,
      tokens: this.lastTokens,
      ms: at - this.startedAt,
      error,
    }
    this.sink({ kind: 'run_end', at, ok, turns: summary.turns, tools: summary.tools, tokens: summary.tokens, ms: summary.ms, error })
    return summary
  }
}

function truncate(s: string, max = 200): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

export function logsDir(cwd = process.cwd()): string {
  return path.join(maxcoderDir(cwd), 'logs')
}

/** A sink that appends each event as one JSON line to .maxcoder/logs/<file>. */
export function jsonlSink(cwd = process.cwd(), file = 'runs.jsonl'): TelemetrySink {
  const dir = logsDir(cwd)
  const target = path.join(dir, file)
  return event => {
    ensureDir(dir)
    appendLine(target, JSON.stringify(event) + '\n')
  }
}
