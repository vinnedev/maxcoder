// Max Coder — Reflexion memory tools (P8). Let the agent persist and recall reusable lessons across
// sessions: correct test commands, recurring errors, conventions, user preferences, decisions.
// Writes only to .maxcoder/memory/ (never the user's source); secrets are redacted on save.

import { registerTools, type Tool } from '../../tools.ts'
import { memoryCategories, recall, remember, type MemoryCategory } from '../../core/memory/index.ts'

const CATEGORIES = memoryCategories()

function asCategory(v: unknown): MemoryCategory | null {
  return typeof v === 'string' && (CATEGORIES as string[]).includes(v) ? (v as MemoryCategory) : null
}

const memoryTools: Tool[] = [
  {
    name: 'reflect',
    description:
      'Persist a short, reusable lesson for future sessions. Use after discovering something durable — ' +
      `the correct test command, a recurring error, a convention, a user preference, a decision. category: ${CATEGORIES.join(' | ')}.`,
    mutating: false, // writes only to .maxcoder/memory, not the user's project
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
    description: `Read previously learned notes. Optional category to filter: ${CATEGORIES.join(' | ')}.`,
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
