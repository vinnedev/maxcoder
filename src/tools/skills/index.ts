// Max Coder — skills: markdown files with frontmatter, exposed via a `skill` tool (Bun-native I/O).
// Analog of src/skills/* (simplified). Skills live in ~/.maxcoder/skills/*.md (or */SKILL.md).

import * as path from 'node:path'
import { skillsDir } from '../../shared/config/index.ts'
import { listDir, readText } from '../../shared/fs/index.ts'
import { registerTool } from '../../tools.ts'

export interface Frontmatter {
  meta: Record<string, string>
  body: string
}

export function parseFrontmatter(text: string): Frontmatter {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: text.trim() }
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return { meta, body: m[2].trim() }
}

export interface Skill {
  name: string
  description: string
  body: string
}

function skillFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of listDir(dir)) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = listDir(full).find(x => !x.isDirectory() && x.name.toLowerCase() === 'skill.md')
      if (nested) out.push(path.join(full, nested.name))
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

export async function loadSkills(): Promise<Skill[]> {
  const out: Skill[] = []
  for (const file of skillFiles(skillsDir())) {
    const raw = await readText(file)
    if (raw === null) continue
    const { meta, body } = parseFrontmatter(raw)
    const fallback = path.basename(file).replace(/\.md$/i, '')
    const name = meta.name || (fallback.toLowerCase() === 'skill' ? path.basename(path.dirname(file)) : fallback)
    out.push({ name, description: meta.description || '(no description)', body })
  }
  return out
}

/** Register a single `skill` tool that returns a skill's instructions on demand. */
export async function registerSkillTool(): Promise<number> {
  const skills = await loadSkills()
  if (skills.length === 0) return 0
  registerTool({
    name: 'skill',
    source: 'skill',
    mutating: false,
    description:
      'Load detailed instructions for a named skill, then follow them. Available skills: ' +
      skills.map(s => `${s.name} (${s.description})`).join('; '),
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', enum: skills.map(s => s.name) } },
      required: ['name'],
    },
    run: args => {
      const s = skills.find(x => x.name === args.name)
      return s ? s.body : `ERROR: unknown skill "${args.name}". Available: ${skills.map(s => s.name).join(', ')}`
    },
  })
  return skills.length
}
