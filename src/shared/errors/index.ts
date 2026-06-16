// Max Coder — normalized error taxonomy (shared). Replaces ad-hoc `throw new Error(...)`.
// Additive: nothing imports this yet; wiring into call sites is a later, reviewed step.

export abstract class AppError extends Error {
  abstract readonly code: string
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = new.target.name
  }
}

/** Invalid/rejected input (schema, guardrails, arguments). */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION'
}

/** Bad or missing configuration / environment. */
export class ConfigurationError extends AppError {
  readonly code = 'CONFIGURATION'
}

/** A model/search provider failed (network, HTTP, protocol). */
export class ProviderError extends AppError {
  readonly code = 'PROVIDER'
  constructor(readonly provider: string, message: string, cause?: unknown) {
    super(message, cause)
  }
}

/** A tool failed while executing. */
export class ToolExecutionError extends AppError {
  readonly code = 'TOOL_EXECUTION'
  constructor(readonly tool: string, message: string, cause?: unknown) {
    super(message, cause)
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}

/** Normalize any thrown value into a safe string message. Replaces the repeated inline idiom. */
export function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}
