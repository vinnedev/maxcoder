// Max Coder — defensive JSON extraction from free-form model text.
// Tiny models wrap JSON in prose/code fences or truncate it; this pulls out the first balanced
// object or array and parses it, returning null on failure (callers decide the fallback).

/** Extract and parse the first balanced JSON object or array from text. Null if none/invalid. */
export function extractJsonValue<T = unknown>(raw: string): T | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const objAt = text.indexOf('{')
  const arrAt = text.indexOf('[')
  const candidates = [objAt, arrAt].filter(i => i >= 0)
  if (candidates.length === 0) return null
  const start = Math.min(...candidates)
  const open = text[start]
  const close = open === '{' ? '}' : ']'

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}
