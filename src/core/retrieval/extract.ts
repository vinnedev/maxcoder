// Max Coder — deterministic symbol/import extraction for repo RAG (P4). Regex-based (no AST/native
// deps), TS/JS-focused with broadened forms (per review): named/default/async exports, export lists,
// `export type`, re-exports, `import`/`import type`/side-effect/dynamic imports. Lossy by design.

export interface FileFacts {
  symbols: string[] // exported/declared identifiers
  imports: string[] // module specifiers this file depends on
}

// Direct declarations: export [default] [async] function|class|const|let|var|interface|type|enum NAME
const DECL = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
// Export lists: export { a, b as c }  /  export type { T }
const EXPORT_LIST = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g
// Any import/export-from specifier, incl. `import type`, side-effect `import 'x'`, dynamic import('x')
const FROM = /\b(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT = /\bimport\s+['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))]
}

/** Extract exported/declared symbol names from source text. */
export function extractSymbols(content: string): string[] {
  const names: string[] = []
  for (const m of content.matchAll(DECL)) names.push(m[1])
  for (const m of content.matchAll(EXPORT_LIST)) {
    for (const part of m[1].split(',')) {
      // `a`, `a as b`, `default as X` → take the exported (local) name before `as`, else the name
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name)
    }
  }
  return dedupe(names)
}

/** Extract module specifiers this file imports/re-exports from. */
export function extractImports(content: string): string[] {
  const specs: string[] = []
  for (const re of [FROM, BARE_IMPORT, DYNAMIC_IMPORT]) {
    for (const m of content.matchAll(re)) specs.push(m[1])
  }
  return dedupe(specs)
}

export function extractFacts(content: string): FileFacts {
  return { symbols: extractSymbols(content), imports: extractImports(content) }
}
