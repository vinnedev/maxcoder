// Max Coder — effort profiles. Each level is a fixed budget that gates how much of the agent
// pipeline runs, so a tiny model spends effort in proportion to task risk/scope. Pure data + lookup.

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

/** A fixed resource/behaviour budget for one effort level. */
export interface EffortProfile {
  level: EffortLevel
  maxModelCalls: number // hard ceiling on model invocations for the task
  maxFiles: number // files retrieved into context
  maxPlanSteps: number // 0 = no explicit plan
  critiqueCycles: number // self-refine / critic→revise iterations
  maxToolCalls: number
  contextBudgetTokens: number // soft budget for retrieved context
  allowTests: boolean // may run tests
  allowMultiPath: boolean // may explore multiple solutions
  useTreeOfThoughts: boolean // controlled multi-path exploration
  useReflection: boolean // read/write Reflexion memory
}

// Ordered low→max so callers can compare/raise levels.
export const EFFORT_ORDER: readonly EffortLevel[] = ['low', 'medium', 'high', 'max'] as const

export const EFFORT_PROFILES: Record<EffortLevel, EffortProfile> = {
  low: {
    level: 'low',
    maxModelCalls: 2,
    maxFiles: 2,
    maxPlanSteps: 0,
    critiqueCycles: 0,
    maxToolCalls: 3,
    contextBudgetTokens: 2_000,
    allowTests: false,
    allowMultiPath: false,
    useTreeOfThoughts: false,
    useReflection: false,
  },
  medium: {
    level: 'medium',
    maxModelCalls: 5,
    maxFiles: 5,
    maxPlanSteps: 4,
    critiqueCycles: 1,
    maxToolCalls: 8,
    contextBudgetTokens: 4_000,
    allowTests: true,
    allowMultiPath: false,
    useTreeOfThoughts: false,
    useReflection: false,
  },
  high: {
    level: 'high',
    maxModelCalls: 10,
    maxFiles: 12,
    maxPlanSteps: 8,
    critiqueCycles: 2,
    maxToolCalls: 20,
    contextBudgetTokens: 8_000,
    allowTests: true,
    allowMultiPath: true,
    useTreeOfThoughts: false,
    useReflection: true,
  },
  max: {
    level: 'max',
    maxModelCalls: 20,
    maxFiles: 25,
    maxPlanSteps: 16,
    critiqueCycles: 3,
    maxToolCalls: 40,
    contextBudgetTokens: 16_000,
    allowTests: true,
    allowMultiPath: true,
    useTreeOfThoughts: true,
    useReflection: true,
  },
}

/** Rank of a level (low=0 … max=3) — for floor/ceiling comparisons. */
export function effortRank(level: EffortLevel): number {
  return EFFORT_ORDER.indexOf(level)
}

/** The higher (more effort) of two levels. */
export function maxEffort(a: EffortLevel, b: EffortLevel): EffortLevel {
  return effortRank(a) >= effortRank(b) ? a : b
}
