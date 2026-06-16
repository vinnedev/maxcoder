// Max Coder — repository intelligence tools (P4). Read-only tools the agent calls in its ReAct loop
// to get a SMALL, RELEVANT slice of the repo instead of the whole thing — the key lift for a 3B model.
//   repo_map       → deterministic project map (stack, commands, critical files, conventions)
//   search_symbols → files exporting/declaring symbols matching a query
//   find_context   → ranked, budget-bounded bundle of file summaries for a task (then read_file them)

import { registerTools, type Tool } from '../../tools.ts'
import { writeProjectMap, type ProjectMap } from '../../core/intelligence/projectMap.ts'
import { ensureIndex } from '../../core/retrieval/indexer.ts'
import { buildContext, searchSymbols } from '../../core/retrieval/retriever.ts'

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`missing/invalid string argument "${key}"`)
  return v.trim()
}

function formatMap(m: ProjectMap): string {
  const line = (label: string, xs: string[]) => (xs.length ? `${label}: ${xs.join(', ')}` : '')
  return [
    line('stack', m.stack),
    line('package managers', m.packageManagers),
    line('test', m.testCommands),
    line('build', m.buildCommands),
    line('entrypoints', m.entrypoints),
    m.sourceDirs.length || m.testDirs.length ? `source dirs: ${m.sourceDirs.join(', ') || '-'} · test dirs: ${m.testDirs.join(', ') || '-'}` : '',
    line('conventions', m.detectedConventions),
    m.criticalFiles.length ? `critical files (${m.criticalFiles.length}): ${m.criticalFiles.slice(0, 12).join(', ')}` : '',
    `files indexed: ${m.fileCount}`,
  ].filter(Boolean).join('\n')
}

const repoTools: Tool[] = [
  {
    name: 'repo_map',
    description: 'Summarize the project: stack, package managers, test/build commands, entrypoints, critical files, conventions. Call this first to orient on an unfamiliar repo.',
    mutating: false,
    source: 'builtin',
    policy: { readOnly: true, risk: 'safe' },
    parameters: { type: 'object', properties: {}, required: [] },
    run: async (_args, ctx) => formatMap(await writeProjectMap(ctx.cwd)),
  },
  {
    name: 'search_symbols',
    description: 'Find files that export/declare symbols (functions, classes, types) matching a query. Returns file paths and matching symbol names.',
    mutating: false,
    source: 'builtin',
    policy: { readOnly: true, risk: 'safe' },
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: async (args, ctx) => {
      const index = await ensureIndex(ctx.cwd)
      const hits = searchSymbols(index, str(args, 'query'), 25)
      if (hits.length === 0) return '(no matching symbols)'
      return hits.map(h => `${h.path}: ${h.symbols.slice(0, 8).join(', ')}`).join('\n')
    },
  },
  {
    name: 'find_context',
    description: 'Retrieve a small, ranked set of relevant files for a task (path + summary + key symbols). Use to locate where to work, then read_file the ones you need.',
    mutating: false,
    source: 'builtin',
    policy: { readOnly: true, risk: 'safe' },
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, max_files: { type: 'number' } },
      required: ['query'],
    },
    run: async (args, ctx) => {
      const index = await ensureIndex(ctx.cwd)
      const maxFiles = typeof args.max_files === 'number' ? args.max_files : 8
      const bundle = buildContext(index, str(args, 'query'), { maxFiles })
      if (bundle.items.length === 0) return '(no relevant files found)'
      const lines = bundle.items.map(i => `- ${i.path}${i.summary ? ` — ${i.summary}` : ''}`)
      const note = bundle.truncated ? '\n(more matches omitted — narrow the query)' : ''
      return `${bundle.items.length} relevant file(s):\n${lines.join('\n')}\n(use read_file to open the ones you need)${note}`
    },
  },
]

export function registerRepoTools(): void {
  registerTools(repoTools)
}
