// tests/tools/markdown-loaders.test.ts  ←mirrors→  src/tools/{skills,subagent}/index.ts
import { afterEach, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { loadAgentTypes } from '../../src/tools/subagent/index.ts'
import { loadSkills } from '../../src/tools/skills/index.ts'

let previousConfigDir: string | undefined
let tmp: string | null = null

function tempConfig(): string {
  previousConfigDir = process.env.MAXCODER_CONFIG_DIR
  tmp = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-md-loaders-'))
  process.env.MAXCODER_CONFIG_DIR = tmp
  return tmp
}

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.MAXCODER_CONFIG_DIR
  else process.env.MAXCODER_CONFIG_DIR = previousConfigDir
  previousConfigDir = undefined
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

test('loads skill files regardless of .md extension case', async () => {
  const root = tempConfig()
  const dir = path.join(root, 'skills')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'Review.MD'), '---\nname: review\ndescription: Review code\n---\nReview instructions.')

  const skills = await loadSkills()

  expect(skills.map(s => s.name)).toContain('review')
  expect(skills.find(s => s.name === 'review')?.body).toContain('Review instructions')
})

test('loads directory skills from skill.md or SKILL.md', async () => {
  const root = tempConfig()
  const dir = path.join(root, 'skills', 'planner')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'skill.md'), '---\ndescription: Planning\n---\nPlan carefully.')

  const skills = await loadSkills()

  expect(skills).toContainEqual(expect.objectContaining({ name: 'planner', description: 'Planning' }))
})

test('loads subagent files regardless of .md extension case', async () => {
  const root = tempConfig()
  const dir = path.join(root, 'agents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'Research.MD'), '---\nname: research\ndescription: Research agent\n---\nResearch role.')

  const agents = await loadAgentTypes()

  expect(agents).toContainEqual(expect.objectContaining({ name: 'research', description: 'Research agent' }))
})
