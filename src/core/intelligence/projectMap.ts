// Max Coder — repository intelligence: a deterministic project map (P4). No model.
// Detects stack, package managers, entrypoints, test/build commands, source/test dirs, critical files,
// and factual conventions. Pure builder (`buildProjectMap`) + thin IO wrapper (`scanProject`).

import * as path from 'node:path'
import { ensureDir, readJSON, writeText } from '../../shared/fs/index.ts'
import { isCriticalPath } from '../../safety/index.ts'
import { maxcoderDir } from '../config/index.ts'
import { walkRepo } from './walk.ts'

export interface ProjectMap {
  stack: string[]
  packageManagers: string[]
  entrypoints: string[]
  testCommands: string[]
  buildCommands: string[]
  criticalFiles: string[]
  sourceDirs: string[]
  testDirs: string[]
  detectedConventions: string[]
  fileCount: number
  generatedAt: number
}

interface PackageJson {
  main?: string
  module?: string
  bin?: string | Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.go': 'Go', '.py': 'Python', '.rs': 'Rust',
  '.rb': 'Ruby', '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.php': 'PHP', '.cs': 'C#',
}
const FRAMEWORK_BY_DEP: Record<string, string> = {
  react: 'React', vue: 'Vue', svelte: 'Svelte', next: 'Next.js', nuxt: 'Nuxt', express: 'Express',
  fastify: 'Fastify', '@wailsapp/runtime': 'Wails', solid: 'Solid', astro: 'Astro',
}
const LOCKFILES: Array<[string, string]> = [
  ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm'], ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'], ['go.sum', 'go'], ['Cargo.lock', 'cargo'], ['Gemfile.lock', 'bundler'],
  ['poetry.lock', 'poetry'],
]
const SOURCE_DIR_NAMES = new Set(['src', 'lib', 'app', 'packages', 'internal', 'cmd', 'pkg'])
const TEST_DIR_NAMES = new Set(['tests', 'test', '__tests__', 'spec', 'e2e'])

const uniq = (xs: string[]): string[] => [...new Set(xs)].sort()
const topDir = (p: string): string => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '')

/** Build a project map from a list of repo-relative file paths + an optional parsed package.json. */
export function buildProjectMap(files: string[], pkg: PackageJson | null, now = 0): ProjectMap {
  const set = new Set(files)
  const has = (name: string) => set.has(name)

  const stack: string[] = []
  for (const f of files) {
    const lang = LANG_BY_EXT[path.extname(f).toLowerCase()]
    if (lang) stack.push(lang)
  }
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  for (const [dep, label] of Object.entries(FRAMEWORK_BY_DEP)) if (deps[dep]) stack.push(label)

  const packageManagers = LOCKFILES.filter(([file]) => has(file)).map(([, pm]) => pm)
  const pm = packageManagers[0] ?? (has('package.json') ? 'npm' : '')

  const scripts = pkg?.scripts ?? {}
  const runner = pm === 'bun' ? 'bun run' : pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : 'npm run'
  const testCommands: string[] = []
  const buildCommands: string[] = []
  for (const name of Object.keys(scripts)) {
    if (name === 'test' || name.startsWith('test:')) testCommands.push(`${runner} ${name}`)
    if (name === 'build' || name.startsWith('build:')) buildCommands.push(`${runner} ${name}`)
  }

  const entrypoints: string[] = []
  for (const e of [pkg?.main, pkg?.module, typeof pkg?.bin === 'string' ? pkg?.bin : undefined]) {
    if (e && has(e.replace(/^\.\//, ''))) entrypoints.push(e.replace(/^\.\//, ''))
  }
  if (typeof pkg?.bin === 'object') for (const b of Object.values(pkg.bin)) if (has(b.replace(/^\.\//, ''))) entrypoints.push(b.replace(/^\.\//, ''))
  for (const guess of ['src/cli.ts', 'src/index.ts', 'src/main.ts', 'main.go', 'src/main.py']) if (has(guess)) entrypoints.push(guess)

  const dirs = new Set(files.map(topDir).filter(Boolean))
  const sourceDirs = [...dirs].filter(d => SOURCE_DIR_NAMES.has(d)).sort()
  const testDirs = [...dirs].filter(d => TEST_DIR_NAMES.has(d)).sort()
  const criticalFiles = files.filter(isCriticalPath).sort()

  const conventions: string[] = []
  if (has('tsconfig.json')) conventions.push('TypeScript project (tsconfig.json)')
  if (sourceDirs.includes('src') && files.some(f => f.startsWith('src/core/'))) conventions.push('src/core/ domain layout')
  if (testDirs.includes('tests') && files.some(f => f.startsWith('tests/'))) conventions.push('tests/ tree mirrors src/')
  if (files.some(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))) conventions.push('*.test.ts / *.spec.ts test files')

  return {
    stack: uniq(stack),
    packageManagers: uniq(packageManagers),
    entrypoints: uniq(entrypoints),
    testCommands: uniq(testCommands),
    buildCommands: uniq(buildCommands),
    criticalFiles,
    sourceDirs,
    testDirs,
    detectedConventions: conventions,
    fileCount: files.length,
    generatedAt: now,
  }
}

export function projectMapPath(cwd = process.cwd()): string {
  return path.join(maxcoderDir(cwd), 'project-map.json')
}

/** Scan the repo and build its map (no persistence). */
export async function scanProject(cwd = process.cwd(), now = Date.now()): Promise<ProjectMap> {
  const files = walkRepo(cwd).map(f => f.path)
  const pkg = await readJSON<PackageJson>(path.join(cwd, 'package.json'))
  return buildProjectMap(files, pkg, now)
}

/** Scan + persist to `.maxcoder/project-map.json`. */
export async function writeProjectMap(cwd = process.cwd(), now = Date.now()): Promise<ProjectMap> {
  const map = await scanProject(cwd, now)
  ensureDir(maxcoderDir(cwd))
  await writeText(projectMapPath(cwd), JSON.stringify(map, null, 2) + '\n')
  return map
}
