// Max Coder — memory tools. Markdown wiki is authoritative; SQLite/FTS is derived.

import { registerTools, type Tool } from '../../tools.ts'
import {
  MemoryApprovalQueue,
  MemoryIndexer,
  MemoryStore,
  type DurableMemoryType,
  type MemoryCategory,
  memoryCategories,
  recall,
  remember,
} from '../../core/memory/index.ts'

const CATEGORIES = memoryCategories()
const DURABLE_TYPES: DurableMemoryType[] = ['decision', 'gotcha', 'procedure', 'concept', 'rule', 'note']

function asCategory(v: unknown): MemoryCategory | null {
  return typeof v === 'string' && (CATEGORIES as string[]).includes(v) ? (v as MemoryCategory) : null
}

function asDurableType(v: unknown): DurableMemoryType | null {
  return typeof v === 'string' && (DURABLE_TYPES as string[]).includes(v) ? (v as DurableMemoryType) : null
}

function evidenceFrom(v: unknown) {
  return Array.isArray(v)
    ? v
        .filter(e => e && typeof e === 'object')
        .map(e => {
          const o = e as Record<string, unknown>
          return {
            kind: typeof o.kind === 'string' ? o.kind as 'session' : 'session',
            ref: typeof o.ref === 'string' ? o.ref : 'unknown',
            quote: typeof o.quote === 'string' ? o.quote : undefined,
          }
        })
    : []
}

const memoryTools: Tool[] = [
  {
    name: 'memory_search',
    description:
      'Search the long-term project memory wiki before relevant decisions, bug fixes, refactors, tools/router/model-adapter changes, safety work, or memory work.',
    mutating: false,
    source: 'builtin',
    policy: { readOnly: true, risk: 'safe' },
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        scope: { type: 'string', enum: ['current_project', 'workspace', 'all'] },
        types: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
    run: async (args, ctx) => {
      const query = typeof args.query === 'string' ? args.query : ''
      const limit = typeof args.limit === 'number' ? args.limit : 10
      const types = Array.isArray(args.types) ? args.types.map(String) : undefined
      const results = await new MemoryIndexer(ctx.cwd).search(query, { types, limit })
      return JSON.stringify({ results }, null, 2)
    },
  },
  {
    name: 'memory_write',
    description:
      'Write a durable memory page to the Markdown wiki. Requires evidence. Use for decisions, gotchas, procedures, concepts, rules, and notes; never save secrets or transient failures.',
    mutating: true,
    source: 'builtin',
    policy: { altersDisk: true, risk: 'low' },
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: DURABLE_TYPES },
        title: { type: 'string' },
        body: { type: 'string' },
        evidence: { type: 'array', items: { type: 'object' } },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        pinned: { type: 'boolean' },
      },
      required: ['type', 'title', 'body', 'evidence', 'confidence'],
    },
    run: async (args, ctx) => {
      const type = asDurableType(args.type)
      if (!type) return `ERROR: type must be one of ${DURABLE_TYPES.join(', ')}`
      if (typeof args.title !== 'string' || !args.title.trim()) return 'ERROR: missing title'
      if (typeof args.body !== 'string' || !args.body.trim()) return 'ERROR: missing body'
      const confidence = args.confidence === 'low' || args.confidence === 'medium' || args.confidence === 'high' ? args.confidence : 'medium'
      const path = await new MemoryStore(ctx.cwd).writeMemory({
        type,
        title: args.title,
        body: args.body,
        evidence: evidenceFrom(args.evidence),
        confidence,
        pinned: args.pinned === true,
      })
      await new MemoryIndexer(ctx.cwd).indexPage(path)
      return JSON.stringify({ saved: true, path }, null, 2)
    },
  },
  {
    name: 'memory_rebuild_index',
    description: 'Rebuild the derived SQLite/FTS index from the Markdown memory wiki.',
    mutating: true,
    source: 'builtin',
    policy: { altersDisk: true, risk: 'low' },
    parameters: { type: 'object', properties: {}, required: [] },
    run: async (_args, ctx) => JSON.stringify(await new MemoryIndexer(ctx.cwd).rebuildIndex(), null, 2),
  },
  {
    name: 'memory_pending',
    description: 'List pending auto-improve memory proposals awaiting approval.',
    mutating: false,
    source: 'builtin',
    policy: { readOnly: true, risk: 'safe' },
    parameters: { type: 'object', properties: {}, required: [] },
    run: async (_args, ctx) => JSON.stringify({ pending: await new MemoryApprovalQueue(ctx.cwd).list() }, null, 2),
  },
  {
    name: 'memory_apply',
    description: 'Apply an approved pending memory proposal by id after validation.',
    mutating: true,
    source: 'builtin',
    policy: { altersDisk: true, risk: 'low' },
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (args, ctx) => {
      if (typeof args.id !== 'string' || !args.id.trim()) return 'ERROR: missing id'
      const path = await new MemoryApprovalQueue(ctx.cwd).apply(args.id)
      return JSON.stringify({ applied: true, path }, null, 2)
    },
  },
  {
    name: 'reflect',
    description:
      'Legacy shortcut: persist a short reusable lesson. Prefer memory_write for durable wiki pages. ' +
      `category: ${CATEGORIES.join(' | ')}.`,
    mutating: false,
    source: 'builtin',
    policy: { risk: 'low' },
    parameters: {
      type: 'object',
      properties: { category: { type: 'string', enum: CATEGORIES }, note: { type: 'string' } },
      required: ['category', 'note'],
    },
    run: async (args, ctx) => {
      const category = asCategory(args.category)
      if (!category) return `ERROR: category must be one of ${CATEGORIES.join(', ')}`
      if (typeof args.note !== 'string' || !args.note.trim()) return 'ERROR: missing "note"'
      const r = await remember(ctx.cwd, category, args.note)
      if (!r.saved) return `not saved: ${r.reason}`
      return `remembered (${category})${r.redacted ? ' — secrets redacted' : ''}`
    },
  },
  {
    name: 'recall_memory',
    description: `Legacy shortcut: read old Reflexion notes. Prefer memory_search. Optional category: ${CATEGORIES.join(' | ')}.`,
    mutating: false,
    source: 'builtin',
    policy: { readOnly: true, risk: 'safe' },
    parameters: { type: 'object', properties: { category: { type: 'string', enum: CATEGORIES } }, required: [] },
    run: async (args, ctx) => {
      const category = asCategory(args.category) ?? undefined
      const text = await recall(ctx.cwd, category)
      return text.trim() || '(no memory recorded yet)'
    },
  },
]

export function registerMemoryTools(): void {
  registerTools(memoryTools)
}
