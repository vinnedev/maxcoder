// Max Coder — EffortController: resolves the active effort budget for a task.
// Fixed level → that profile directly. `auto` → the classifier picks (deterministic floors + model).
// Pure orchestration over config + classifier + profiles; persistence is the caller's job.

import type { EffortSetting, MaxcoderConfig } from '../config/index.ts'
import { assessEffort, type ClassifierDeps, type EffortAssessment } from './classifier.ts'
import { EFFORT_PROFILES, type EffortLevel, type EffortProfile } from './profiles.ts'

export interface ResolvedEffort {
  level: EffortLevel
  profile: EffortProfile
  auto: boolean
  assessment?: EffortAssessment // present only in auto mode
}

export class EffortController {
  private lastAssessment: EffortAssessment | null = null

  constructor(
    private cfg: MaxcoderConfig,
    private deps: ClassifierDeps = {},
  ) {}

  get setting(): EffortSetting {
    return this.cfg.effort
  }

  /** Change the active setting in memory (caller persists via saveConfig). */
  setSetting(setting: EffortSetting): void {
    this.cfg.effort = setting
    if (setting !== 'auto') this.lastAssessment = null
  }

  /** Resolve the effort budget for a task. Runs the classifier only in `auto` mode. */
  async resolve(task: string): Promise<ResolvedEffort> {
    if (this.cfg.effort === 'auto') {
      const assessment = await assessEffort(task, this.deps)
      this.lastAssessment = assessment
      return { level: assessment.effort, profile: EFFORT_PROFILES[assessment.effort], auto: true, assessment }
    }
    return { level: this.cfg.effort, profile: EFFORT_PROFILES[this.cfg.effort], auto: false }
  }

  /** Human explanation of why the current effort is what it is. */
  explain(): string {
    if (this.cfg.effort !== 'auto') return `effort is set manually to "${this.cfg.effort}".`
    if (!this.lastAssessment) return 'effort is "auto" — no task classified yet.'
    const a = this.lastAssessment
    return `auto → "${a.effort}" · type=${a.task_type} · risk=${a.risk} · ${a.reason}`
  }
}
