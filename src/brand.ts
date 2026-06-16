// Max Coder — branding + version constants.

export const NAME = 'Max Coder'
export const BIN = 'maxcoder'
export const VERSION = '0.1.0'

export const TAGLINE = 'local-first AI coding agent'

// Small ANSI helpers (no deps).
export const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgGray: '\x1b[100m',
}

const LOGO = [
  '███╗   ███╗ █████╗ ██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗██████╗ ',
  '████╗ ████║██╔══██╗╚██╗██╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗',
  '██╔████╔██║███████║ ╚███╔╝ ██║     ██║   ██║██║  ██║█████╗  ██████╔╝',
  '██║╚██╔╝██║██╔══██║ ██╔██╗ ██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗',
  '██║ ╚═╝ ██║██║  ██║██╔╝ ██╗╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║',
  '╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝',
]

const COMPACT_LOGO = [
  '█████╗  █████╗ ██╗  ██╗',
  '██╔═██╗██╔═██╗╚██╗██╔╝',
  '██║ ██║███████║ ╚███╔╝ ',
  '██║ ██║██╔═██║ ██╔██╗ ',
  '█████╔╝██║ ██║██╔╝ ██╗',
  '╚════╝ ╚═╝ ╚═╝╚═╝  ╚═╝',
  '      MAX CODER       ',
]

const ANSI = /\x1b\[[0-9;]*m/g

function visibleLen(s: string): number {
  return s.replace(ANSI, '').length
}

function centerLine(line: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - visibleLen(line)) / 2))
  return `${' '.repeat(pad)}${line}`
}

function logoLines(width: number): string[] {
  const largeWidth = Math.max(...LOGO.map(visibleLen))
  return width >= largeWidth + 2 ? LOGO : COMPACT_LOGO
}

export function logo(width = 90): string {
  return logoLines(width).map(line => `${c.cyan}${line}${c.reset}`).join('\n')
}

export function centeredLogo(width = 90, top = 1, bottom = 1): string {
  const body = logo(width)
    .split('\n')
    .map(line => centerLine(line, width))
    .join('\n')
  return `${'\n'.repeat(top)}${body}${'\n'.repeat(bottom)}`
}

export function banner(model: string, baseUrl: string): string {
  return [
    centeredLogo(),
    centerLine(`${c.bold}${NAME}${c.reset} ${c.gray}v${VERSION} · ${TAGLINE}${c.reset}`, 90),
    centerLine(`${c.gray}model ${c.reset}${c.cyan}${model}${c.reset}  ${c.gray}backend ${c.reset}${baseUrl}`, 90),
    '',
  ].join('\n')
}
