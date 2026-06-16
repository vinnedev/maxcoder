// Max Coder — full-screen terminal UI (alt-screen, scrollback, input box, spinner).
// Zero-dependency, Bun-native. opencode / Claude-Code-style layout:
//
//   ┌ header ───────────────────────────────────────────┐
//   │ conversation transcript (scrollable)               │
//   │ ...                                                │
//   ├ suggestions / status ──────────────────────────────┤
//   │ framed input box (line editor, history)            │
//   └────────────────────────────────────────────────────┘
//
// Keys: Enter submit · Esc interrupt/clear · Ctrl-C quit · ←→ Home End move ·
//       Backspace · Tab complete · ↑↓ history · PageUp/PageDown / Ctrl-U/D scroll transcript.
//       Ctrl-O copy mode enables native text selection while wheel/↑↓ scroll the transcript.

import { c, centeredLogo, NAME, VERSION } from './brand.ts'
import { CLI_OPTIONS, SLASH_COMMANDS, formatUserMessage, statusLine } from './ui.ts'

const ALT_ON = '\x1b[?1049h'
const ALT_OFF = '\x1b[?1049l'
const ALT_SCROLL_OFF = '\x1b[?1007l'
const ALT_SCROLL_ON = '\x1b[?1007h'
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h'
const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l'
const CURSOR_SHOW = '\x1b[?25h'
const CLEAR_EOL = '\x1b[K'
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const ANSI = /\x1b\[[0-9;]*m/g

export function visibleLen(s: string): number {
  return s.replace(ANSI, '').length
}

function repeatToWidth(ch: string, width: number): string {
  return width > 0 ? ch.repeat(width) : ''
}

function paddedCenter(line: string, width: number, minPad = 2): string {
  const innerWidth = Math.max(1, width - minPad * 2)
  const clipped = visibleLen(line) > innerWidth ? line : line
  const pad = Math.max(minPad, Math.floor((width - visibleLen(clipped)) / 2))
  return `${' '.repeat(pad)}${clipped}`
}

export interface CompletionState {
  input: string
  cursor: number
  suggestions: string[]
  completed: boolean
}

function completionToken(input: string, cursor: number): { tokenStart: number; token: string; suggestions: string[] } {
  const before = input.slice(0, cursor)
  const tokenStart = before.lastIndexOf(' ') + 1
  const token = before.slice(tokenStart)
  const firstToken = tokenStart === 0
  const canComplete =
    token.startsWith('/') ||
    token.startsWith('-') ||
    (firstToken && token.length > 0 && 'doctor'.startsWith(token))

  if (!canComplete) return { tokenStart, token, suggestions: [] }

  const pool = token.startsWith('/') ? SLASH_COMMANDS : token.startsWith('-') ? CLI_OPTIONS.filter(x => x.startsWith('-')) : ['doctor']
  const suggestions = pool.filter(item => item.startsWith(token))
  return { tokenStart, token, suggestions }
}

export function suggestInput(input: string, cursor: number): string[] {
  return completionToken(input, cursor).suggestions
}

export function completeInput(input: string, cursor: number, cycle = 0): CompletionState {
  const { tokenStart, suggestions } = completionToken(input, cursor)
  if (!suggestions.length) return { input, cursor, suggestions, completed: false }

  const picked = suggestions[Math.abs(cycle) % suggestions.length]
  const suffix = suggestions.length === 1 ? ' ' : ''
  const nextInput = input.slice(0, tokenStart) + picked + suffix + input.slice(cursor)
  return {
    input: nextInput,
    cursor: tokenStart + picked.length + suffix.length,
    suggestions,
    completed: true,
  }
}

/** Hard-wrap a styled string to `width` visible columns (ANSI codes pass through). */
function wrapStyled(s: string, width: number): string[] {
  const w = Math.max(2, width)
  const lines: string[] = []
  let cur = ''
  let vis = 0
  let i = 0
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i))
      if (m) {
        cur += m[0]
        i += m[0].length
        continue
      }
    }
    cur += s[i]
    vis++
    i++
    if (vis >= w) {
      lines.push(cur + c.reset)
      cur = ''
      vis = 0
    }
  }
  if (cur.length || lines.length === 0) lines.push(cur)
  return lines
}

export interface TuiStatus {
  model: string
  tokens: number
  numCtx: number
  sessionId: string
  gitBranch?: string
}

export interface TuiHost {
  onSubmit: (text: string, tui: Tui) => Promise<void>
  onInterrupt: () => void
  status: () => TuiStatus
}

export class Tui {
  private cols = process.stdout.columns || 80
  private rows = process.stdout.rows || 24
  private mouseEnabled = process.env.MAXCODER_MOUSE !== '0'
  private blocks: string[] = [] // raw styled content blocks (may contain \n)
  private streamOpen = false
  private streamIdx = -1
  private lines: string[] = [] // wrapped display rows
  private scroll = 0 // rows scrolled up from the bottom (0 = follow latest)
  private input = ''
  private cursor = 0
  private history: string[] = []
  private histIdx = -1
  private draft = ''
  private busy = false
  private spin = 0
  private spinTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private completionStart = -1
  private completionCycle = 0
  private completionSuggestions: string[] = []
  private headerCount = 0
  private copyMode = false

  constructor(private host: TuiHost) {}

  start(): void {
    process.stdout.write(ALT_ON + ALT_SCROLL_OFF + (this.mouseEnabled ? MOUSE_ON : '') + CURSOR_SHOW)
    try {
      process.stdin.setRawMode?.(true)
    } catch {
      /* not a tty */
    }
    process.stdin.resume()
    process.stdin.on('data', d => this.onData(Buffer.from(d)))
    process.stdout.on('resize', () => {
      this.cols = process.stdout.columns || 80
      this.rows = process.stdout.rows || 24
      this.refreshHeader()
      this.reflow()
      this.render()
    })
    process.on('exit', () => this.restore())

    this.refreshHeader()
    this.reflow()
    this.render()
  }

  stop(): void {
    this.stopped = true
    this.restore()
  }

  private restore(): void {
    if (this.spinTimer) clearInterval(this.spinTimer)
    try {
      process.stdin.setRawMode?.(false)
    } catch {
      /* ignore */
    }
    process.stdout.write(MOUSE_OFF + ALT_SCROLL_ON + ALT_OFF + CURSOR_SHOW)
  }

  // ---- content ----

  /** Append a content block (may be multi-line / styled) to the transcript. */
  print(block: string): void {
    this.blocks.push(block)
    this.reflow()
    if (this.scroll === 0) this.render()
    else this.render() // keep simple: always render
  }

  /** Append a live token delta into the current streaming answer block. */
  streamDelta(text: string): void {
    if (!this.streamOpen) {
      this.blocks.push(c.green)
      this.streamIdx = this.blocks.length - 1
      this.streamOpen = true
    }
    this.blocks[this.streamIdx] += text
    this.reflow()
    this.render()
  }

  /** Close the streaming block. Returns true if a stream was open (text already shown). */
  endStream(): boolean {
    if (!this.streamOpen) return false
    this.blocks[this.streamIdx] += c.reset
    this.streamOpen = false
    this.streamIdx = -1
    this.reflow()
    this.render()
    return true
  }

  setBusy(b: boolean): void {
    if (b === this.busy) return
    this.busy = b
    if (b) {
      this.spinTimer = setInterval(() => {
        if (this.copyMode) return
        this.spin = (this.spin + 1) % SPINNER.length
        this.render()
      }, 90)
    } else if (this.spinTimer) {
      clearInterval(this.spinTimer)
      this.spinTimer = null
    }
    this.render()
  }

  private refreshHeader(): void {
    const subtitle =
      this.cols < 64
        ? `${c.bold}${NAME}${c.reset} ${c.gray}v${VERSION} · /help · Tab${c.reset}`
        : `${c.bold}${NAME}${c.reset} ${c.gray}v${VERSION} · local-first coding agent · ` +
          `type a task · /help · Tab completes · Ctrl-O copy mode${c.reset}`
    const next = [centeredLogo(this.cols, 1, 1), paddedCenter(subtitle, this.cols, this.cols < 64 ? 2 : 4)]
    if (this.headerCount > 0) this.blocks.splice(0, this.headerCount, ...next)
    else this.blocks.unshift(...next)
    this.headerCount = next.length
  }

  private reflow(): void {
    const wrapW = this.cols
    this.lines = []
    for (const b of this.blocks) {
      for (const logical of b.split('\n')) {
        for (const wl of wrapStyled(logical, wrapW)) this.lines.push(wl)
      }
    }
  }

  // ---- rendering ----

  private render(): void {
    if (this.stopped) return
    const viewH = this.transcriptHeight()
    const total = this.lines.length
    const maxStart = Math.max(0, total - viewH)
    const start = Math.max(0, maxStart - this.scroll)
    const view = this.lines.slice(start, start + viewH)

    let f = '\x1b[H'
    for (let r = 0; r < viewH; r++) f += (view[r] ?? '') + CLEAR_EOL + '\r\n'

    f += CLEAR_EOL + '\r\n'
    f += this.suggestionLine() + CLEAR_EOL + '\r\n'

    // status line
    const st = this.host.status()
    f += statusLine({ ...st, width: this.cols, spinner: this.busy ? SPINNER[this.spin] : undefined }) + CLEAR_EOL + '\r\n'

    // framed input box (with horizontal scroll around the cursor)
    f += this.inputFrameTop() + CLEAR_EOL + '\r\n'
    const prompt = `${c.gray}│${c.reset} ${c.cyan}>${c.reset} `
    const pvis = visibleLen(prompt)
    const right = `${c.gray} │${c.reset}`
    const rvis = visibleLen(right)
    const avail = Math.max(4, this.cols - pvis - rvis)
    let viewStart = 0
    if (this.cursor > avail - 1) viewStart = this.cursor - (avail - 1)
    const shown = this.input.slice(viewStart, viewStart + avail)
    const pad = repeatToWidth(' ', Math.max(0, avail - visibleLen(shown)))
    f += prompt + shown + pad + right + CLEAR_EOL + '\r\n'
    f += this.inputFrameBottom() + CLEAR_EOL
    const curCol = pvis + (this.cursor - viewStart) + 1
    f += `\x1b[${this.rows - 1};${curCol}H`

    process.stdout.write(f)
  }

  private transcriptHeight(): number {
    return Math.max(1, this.rows - 6) // spacer + suggestions + status + 3-line input box take 6 rows
  }

  private suggestionLine(): string {
    const suggestions = suggestInput(this.input, this.cursor)
    const scrollHint = this.scroll > 0 ? `${c.yellow}  viewing history ↑${this.scroll}${c.reset}` : ''
    if (this.copyMode) {
      return `${c.yellow}    copy mode${c.reset}${c.gray}: select text normally · wheel/↑↓/PageUp/PageDown scroll transcript · Esc returns${c.reset}${scrollHint}`
    }
    if (!suggestions.length) {
      return `${c.gray}    commands: / actions, ! shell, -- flags, ↑↓ prompts, PageUp transcript, Ctrl-O copy${c.reset}${scrollHint}`
    }
    const maxItems = Math.max(1, Math.floor((this.cols - 24) / 14))
    const shown = suggestions.slice(0, maxItems)
    const more = suggestions.length > shown.length ? `${c.gray} +${suggestions.length - shown.length} more${c.reset}` : ''
    const prefix = this.cols < 56 ? `${c.gray}    suggest ${c.reset}` : `${c.gray}    suggestions ${c.reset}`
    const suffix = this.cols < 56 ? `${c.gray}  Tab${c.reset}` : `${c.gray}  Tab accepts${c.reset}`
    return `${prefix}${shown.map(s => `${c.cyan}${s}${c.reset}`).join(`${c.gray}  ${c.reset}`)}${more}${suffix}${scrollHint}`
  }

  private inputFrameTop(): string {
    const label = ` ${NAME} `
    const left = `${c.gray}╭─${c.reset}${c.bold}${label}${c.reset}`
    const used = 2 + label.length + 1
    return `${left}${c.gray}${repeatToWidth('─', Math.max(0, this.cols - used))}╮${c.reset}`
  }

  private inputFrameBottom(): string {
    return `${c.gray}╰${repeatToWidth('─', Math.max(0, this.cols - 2))}╯${c.reset}`
  }

  // ---- input handling ----

  private onData(buf: Buffer): void {
    const s = buf.toString('utf-8')
    let i = 0
    while (i < s.length) {
      const ch = s[i]
      // Control bytes
      if (ch === '\x03') return this.quit() // Ctrl-C
      if (this.copyMode) {
        i = this.handleCopyModeInput(s, i)
        continue
      }
      if (ch === '\r' || ch === '\n') {
        this.submit()
        i++
        continue
      }
      if (ch === '\x7f' || ch === '\b') {
        if (this.cursor > 0) {
          this.resetCompletion()
          this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor)
          this.cursor--
          this.render()
        }
        i++
        continue
      }
      if (ch === '\t') {
        this.complete()
        i++
        continue
      }
      if (ch === '\x15') {
        this.scrollBy(Math.floor(this.transcriptHeight() / 2))
        i++
        continue
      } // Ctrl-U
      if (ch === '\x04') {
        this.scrollBy(-Math.floor(this.transcriptHeight() / 2))
        i++
        continue
      } // Ctrl-D
      if (ch === '\x0f') {
        this.enterCopyMode()
        i++
        continue
      } // Ctrl-O
      if (ch === '\x1b') {
        const seq = s.slice(i)
        const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(seq)
        if (mouse) {
          this.handleMouse(Number(mouse[1]))
          i += mouse[0].length
          continue
        }
        const m = /^\x1b\[([0-9;]*)([A-Z~])/.exec(seq)
        if (!m) {
          // bare Esc: interrupt if busy, else clear input
          if (this.busy) this.host.onInterrupt()
          else {
            this.input = ''
            this.cursor = 0
            this.render()
          }
          i++
          continue
        }
        this.handleCsi(m[2], m[1])
        i += m[0].length
        continue
      }
      if (ch >= ' ') {
        this.resetCompletion()
        this.input = this.input.slice(0, this.cursor) + ch + this.input.slice(this.cursor)
        this.cursor++
        this.render()
      }
      i++
    }
  }

  private handleCopyModeInput(s: string, i: number): number {
    const ch = s[i]
    if (ch === '\x03') {
      this.quit()
      return i + 1
    }
    if (ch === '\x1b') {
      const seq = s.slice(i)
      const m = /^\x1b\[([0-9;]*)([A-Z~])/.exec(seq)
      if (!m) {
        this.exitCopyMode()
        return i + 1
      }
      this.handleCopyModeCsi(m[2], m[1])
      return i + m[0].length
    }
    if (ch === '\x0f') {
      this.exitCopyMode()
      return i + 1
    }
    if (ch === '\x15') {
      this.scrollBy(Math.floor(this.transcriptHeight() / 2))
      return i + 1
    }
    if (ch === '\x04') {
      this.scrollBy(-Math.floor(this.transcriptHeight() / 2))
      return i + 1
    }
    return i + 1
  }

  private handleCsi(code: string, _param: string): void {
    if (code === 'S') return this.scrollBy(3)
    if (code === 'T') return this.scrollBy(-3)
    this.resetCompletion()
    // CSI dispatch table (replaces a switch); arrows capture `this`.
    const actions: Record<string, () => void> = {
      D: () => {
        if (this.cursor > 0) this.cursor-- // left
      },
      C: () => {
        if (this.cursor < this.input.length) this.cursor++ // right
      },
      A: () => this.historyPrev(), // up — history
      B: () => this.historyNext(), // down — history
      H: () => {
        this.cursor = 0 // home
      },
      F: () => {
        this.cursor = this.input.length // end
      },
      '~': () => {
        // PageUp(5) / PageDown(6)
        if (_param === '5') this.scrollBy(this.transcriptHeight())
        else if (_param === '6') this.scrollBy(-this.transcriptHeight())
      },
    }
    actions[code]?.()
    this.render()
  }

  private handleCopyModeCsi(code: string, param: string): void {
    if (code === 'A' || code === 'S') this.scrollBy(3)
    else if (code === 'B' || code === 'T') this.scrollBy(-3)
    else if (code === '~' && param === '5') this.scrollBy(this.transcriptHeight())
    else if (code === '~' && param === '6') this.scrollBy(-this.transcriptHeight())
    else this.render()
  }

  private enterCopyMode(): void {
    this.copyMode = true
    process.stdout.write(MOUSE_OFF + ALT_SCROLL_ON)
    this.render()
  }

  private exitCopyMode(): void {
    this.copyMode = false
    process.stdout.write(ALT_SCROLL_OFF + (this.mouseEnabled ? MOUSE_ON : ''))
    this.render()
  }

  private scrollBy(delta: number): void {
    const viewH = this.transcriptHeight()
    const maxScroll = Math.max(0, this.lines.length - viewH)
    this.scroll = Math.min(maxScroll, Math.max(0, this.scroll + delta))
    this.render()
  }

  private handleMouse(code: number): void {
    if (code === 64) this.scrollBy(3)
    else if (code === 65) this.scrollBy(-3)
  }

  private historyPrev(): void {
    if (this.history.length === 0) return
    if (this.histIdx === -1) {
      this.draft = this.input
      this.histIdx = this.history.length - 1
    } else if (this.histIdx > 0) this.histIdx--
    this.input = this.history[this.histIdx]
    this.cursor = this.input.length
  }

  private historyNext(): void {
    if (this.histIdx === -1) return
    if (this.histIdx < this.history.length - 1) {
      this.histIdx++
      this.input = this.history[this.histIdx]
    } else {
      this.histIdx = -1
      this.input = this.draft
    }
    this.cursor = this.input.length
  }

  private submit(): void {
    const text = this.input.trim()
    if (this.busy || !text) return
    this.history.push(text)
    this.histIdx = -1
    this.draft = ''
    this.input = ''
    this.cursor = 0
    this.scroll = 0
    if (!text.startsWith('!')) this.print(formatUserMessage(text))
    this.setBusy(true)
    Promise.resolve(this.host.onSubmit(text, this))
      .catch(e => this.print(`${c.red}error: ${e instanceof Error ? e.message : e}${c.reset}`))
      .finally(() => this.setBusy(false))
  }

  private resetCompletion(): void {
    this.completionStart = -1
    this.completionCycle = 0
    this.completionSuggestions = []
  }

  private complete(): void {
    const before = this.input.slice(0, this.cursor)
    const tokenStart = before.lastIndexOf(' ') + 1
    const token = before.slice(tokenStart)
    const stillCycling =
      this.completionStart === tokenStart &&
      this.completionSuggestions.length > 1 &&
      this.completionSuggestions.includes(token)

    if (stillCycling) {
      this.completionCycle++
      const picked = this.completionSuggestions[this.completionCycle % this.completionSuggestions.length]
      this.input = this.input.slice(0, tokenStart) + picked + this.input.slice(this.cursor)
      this.cursor = tokenStart + picked.length
      this.render()
      return
    } else {
      this.completionStart = tokenStart
      this.completionCycle = 0
    }

    const next = completeInput(this.input, this.cursor, this.completionCycle)
    if (!next.completed) {
      this.render()
      return
    }

    this.input = next.input
    this.cursor = next.cursor
    this.completionSuggestions = next.suggestions
    this.render()
  }

  private quit(): void {
    this.stop()
    process.exit(0)
  }
}
