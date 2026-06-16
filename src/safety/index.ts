// Max Coder — tool safety guardrails. Pure (no IO). Applied at the executeTool chokepoint so every
// path — main loop, subagents, background/orchestrated tasks — is protected the same way.
//   block   → never execute (destructive shell, reading secrets)
//   confirm → execute only after explicit user confirmation (editing critical/build files)
//   allow   → proceed
// Deterministic rules; reads of secret files are blocked unless the user explicitly opts in.

import type { Tool } from '../tools.ts'

export type GuardAction = 'allow' | 'block' | 'confirm'
export interface GuardDecision {
  action: GuardAction
  reason?: string
}

export interface GuardOptions {
  allowSecrets?: boolean // user explicitly permitted secret-file access
}

const ALLOW: GuardDecision = { action: 'allow' }

// Catastrophic / destructive shell commands — blocked by default.
const DESTRUCTIVE: Array<{ re: RegExp; why: string }> = [
  { re: /\brm\s+(-\w*r\w*f|-\w*f\w*r|--recursive\s+--force|--force\s+--recursive)\b/i, why: 'recursive force-delete (rm -rf)' },
  { re: /\bsudo\b/i, why: 'privilege escalation (sudo)' },
  { re: /\bmkfs\b/i, why: 'filesystem format (mkfs)' },
  { re: /\bdd\b[^\n]*\bof=\/dev\//i, why: 'raw write to a device (dd of=/dev/…)' },
  { re: /:\s*\(\s*\)\s*\{.*\}\s*;/, why: 'fork bomb' },
  { re: /\bchmod\s+-R\s+0?777\b/i, why: 'world-writable recursive chmod' },
  { re: /\bchown\s+-R\b/i, why: 'recursive ownership change' },
  { re: />\s*\/dev\/(sd|nvme|disk|hd)/i, why: 'overwrite a block device' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, why: 'system power command' },
  { re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, why: 'pipe a remote script straight to a shell' },
  { re: /\bgit\s+push\b[^\n]*\s(--force\b|-f\b)/i, why: 'force-push (rewrites remote history)' },
]

// Files whose contents are secrets — access blocked unless explicitly allowed.
const SECRET_PATH = /(^|\/)(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|\.git-credentials|credentials(\.json)?|id_(rsa|dsa|ecdsa|ed25519)|[\w.-]*\.(pem|key|p12|pfx|keystore))$/i
const SECRET_DIR = /(^|\/)\.(ssh|aws|gnupg)(\/|$)/i

// Build/infra/critical files — edits should go through a plan, so they require confirmation.
const CRITICAL_PATH = /(^|\/)(package\.json|package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|go\.(mod|sum)|wails\.json|tsconfig[\w.-]*\.json|vite\.config\.[jt]s|webpack\.config\.[jt]s|rollup\.config\.[jt]s|Dockerfile|docker-compose[\w.-]*\.ya?ml|[\w.-]+\.tf|schema\.prisma)$/i
const CRITICAL_DIR = /(^|\/)(migrations?|terraform)(\/|$)|\.github\/workflows\//i

export function isSecretPath(p: string): boolean {
  return SECRET_PATH.test(p) || SECRET_DIR.test(p)
}

/** Whether a shell command references a secret file as one of its tokens. */
function commandTouchesSecret(command: string): boolean {
  return command
    .split(/[\s=;|&><()'"`]+/)
    .filter(Boolean)
    .some(token => isSecretPath(token))
}

export function isCriticalPath(p: string): boolean {
  return CRITICAL_PATH.test(p) || CRITICAL_DIR.test(p)
}

/** Inspect a shell command for destructive operations or secret-file access. */
export function inspectCommand(command: string, opts: GuardOptions = {}): GuardDecision {
  for (const d of DESTRUCTIVE) {
    if (d.re.test(command)) return { action: 'block', reason: `destructive command: ${d.why}` }
  }
  if (!opts.allowSecrets && commandTouchesSecret(command)) {
    return { action: 'block', reason: 'command references a secret file (.env / key / credentials)' }
  }
  return ALLOW
}

/** Inspect a filesystem path for a read/write operation. */
export function inspectPath(path: string, op: 'read' | 'write', opts: GuardOptions = {}): GuardDecision {
  if (!opts.allowSecrets && isSecretPath(path)) {
    return { action: 'block', reason: `secret file access blocked: ${path} (override with explicit permission)` }
  }
  if (op === 'write' && isCriticalPath(path)) {
    return { action: 'confirm', reason: `editing a critical/build file: ${path} — confirm; prefer a plan` }
  }
  return ALLOW
}

/** Decide whether a tool call may proceed, based on its policy and arguments. */
export function evaluateToolCall(tool: Tool, args: Record<string, unknown>, opts: GuardOptions = {}): GuardDecision {
  const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : undefined
  if ((tool.policy?.executesCommand || tool.name === 'run_bash') && command) {
    const d = inspectCommand(command, opts)
    if (d.action !== 'allow') return d
  }

  const pathArg = typeof args.path === 'string' ? args.path : typeof args.file === 'string' ? args.file : undefined
  if (pathArg) {
    const op: 'read' | 'write' = tool.policy?.altersDisk || tool.mutating ? 'write' : 'read'
    const d = inspectPath(pathArg, op, opts)
    if (d.action !== 'allow') return d
  }
  return ALLOW
}
