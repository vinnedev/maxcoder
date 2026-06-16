// Max Coder — project-local config persisted to `.maxcoder/config.json`.
// Distinct from src/shared/config (global ~/.claude paths + git): this is per-project agent settings.

import * as path from 'node:path'
import { ensureDir, readJSON, writeText } from '../../shared/fs/index.ts'
import type { EffortLevel } from '../effort/profiles.ts'

export type EffortSetting = EffortLevel | 'auto'

export interface MaxcoderConfig {
  effort: EffortSetting
  defaultModel: string
  maxToolCalls: number
  requireTestsOnCodeChange: boolean
  requirePlanForHighRisk: boolean
}

export const DEFAULT_CONFIG: MaxcoderConfig = {
  effort: 'auto',
  defaultModel: 'qwen2.5-coder:3b',
  maxToolCalls: 20,
  requireTestsOnCodeChange: true,
  requirePlanForHighRisk: true,
}

const VALID_EFFORT: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'max', 'auto'])

export function maxcoderDir(cwd = process.cwd()): string {
  return path.join(cwd, '.maxcoder')
}

export function configPath(cwd = process.cwd()): string {
  return path.join(maxcoderDir(cwd), 'config.json')
}

/** Merge a partial (possibly corrupt) on-disk object onto defaults, validating each field. */
export function normalizeConfig(raw: unknown): MaxcoderConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    effort: typeof o.effort === 'string' && VALID_EFFORT.has(o.effort) ? (o.effort as EffortSetting) : DEFAULT_CONFIG.effort,
    defaultModel: typeof o.defaultModel === 'string' && o.defaultModel ? o.defaultModel : DEFAULT_CONFIG.defaultModel,
    maxToolCalls: typeof o.maxToolCalls === 'number' && Number.isFinite(o.maxToolCalls) && o.maxToolCalls >= 1 ? Math.floor(o.maxToolCalls) : DEFAULT_CONFIG.maxToolCalls,
    requireTestsOnCodeChange: typeof o.requireTestsOnCodeChange === 'boolean' ? o.requireTestsOnCodeChange : DEFAULT_CONFIG.requireTestsOnCodeChange,
    requirePlanForHighRisk: typeof o.requirePlanForHighRisk === 'boolean' ? o.requirePlanForHighRisk : DEFAULT_CONFIG.requirePlanForHighRisk,
  }
}

/** Load config, tolerating a missing or corrupt file (falls back to defaults). */
export async function loadConfig(cwd = process.cwd()): Promise<MaxcoderConfig> {
  const raw = await readJSON(configPath(cwd))
  return normalizeConfig(raw)
}

/** Persist config to `.maxcoder/config.json` (creates the dir). */
export async function saveConfig(cfg: MaxcoderConfig, cwd = process.cwd()): Promise<void> {
  ensureDir(maxcoderDir(cwd))
  await writeText(configPath(cwd), JSON.stringify(cfg, null, 2) + '\n')
}
