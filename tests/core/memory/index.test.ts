// tests/core/memory/index.test.ts  ←mirrors→  src/core/memory/index.ts
import { afterAll, expect, test } from 'bun:test'
import * as os from 'node:os'
import * as path from 'node:path'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import {
  AutoImproveReviewer,
  HandoffManager,
  MemoryApprovalQueue,
  MemoryCurator,
  MemoryIndexer,
  MemoryProposalValidator,
  MemoryStore,
  SessionRecorder,
  initMemoryWorkspace,
  memoryCategories,
  memoryDbPath,
  recall,
  recallForPrompt,
  redactSecrets,
  remember,
  shouldConsultMemory,
} from '../../../src/core/memory/index.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'maxcoder-mem-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const at = new Date('2026-06-16T12:00:00Z')

test('categories map to the spec files', () => {
  expect(memoryCategories()).toEqual(['lesson', 'failure', 'tool-error', 'preference', 'decision'])
})

test('remember appends a dated note and recall reads it back', async () => {
  const r = await remember(root, 'lesson', 'The test command is `bun test`.', at)
  expect(r.saved).toBe(true)
  expect(r.redacted).toBe(false)
  expect(existsSync(path.join(root, '.maxcoder/memory/project-lessons.md'))).toBe(true)
  const text = await recall(root, 'lesson')
  expect(text).toContain('2026-06-16')
  expect(text).toContain('bun test')
})

test('redactSecrets masks tokens/keys but keeps the lesson', () => {
  const r = redactSecrets('use API_KEY=sk-abcdef0123456789abcdef to call it')
  expect(r.redacted).toBe(true)
  expect(r.text).not.toContain('sk-abcdef0123456789abcdef')
  expect(r.text).toContain('[REDACTED]')
})

test('remember redacts secrets before saving', async () => {
  const r = await remember(root, 'tool-error', 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 failed', at)
  expect(r.redacted).toBe(true)
  const text = await recall(root, 'tool-error')
  expect(text).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
})

test('empty/invalid input is rejected', async () => {
  expect((await remember(root, 'lesson', '   ', at)).saved).toBe(false)
  // @ts-expect-error invalid category
  expect((await remember(root, 'bogus', 'x', at)).saved).toBe(false)
})

test('multiple notes in a category are stored as separate lines', async () => {
  await remember(root, 'decision', 'chose Bun over Node', at)
  await remember(root, 'decision', 'lexical retrieval, no embeddings', at)
  const text = await recall(root, 'decision')
  expect(text.split('\n').filter(Boolean).length).toBe(2)
})

test('recallForPrompt returns preferences + lessons only, bounded', async () => {
  await remember(root, 'preference', 'Prefers concise answers.', at)
  const p = await recallForPrompt(root)
  expect(p).toContain('User preferences')
  expect(p).toContain('Project lessons')
  expect(p).not.toContain('tool-error') // not included in the prompt slice
})

test('initializes the markdown wiki structure and current focus slot', async () => {
  await initMemoryWorkspace(root)
  expect(existsSync(path.join(root, '.maxcoder/memory/wiki/index.md'))).toBe(true)
  expect(existsSync(path.join(root, '.maxcoder/memory/wiki/_slots/current-focus.md'))).toBe(true)
  expect(existsSync(path.join(root, '.maxcoder/memory/index/fts'))).toBe(true)
  expect(existsSync(path.join(root, '.maxcoder/memory/handoffs'))).toBe(true)
})

test('MemoryStore creates, reads, audits, restores, and blocks unsafe writes', async () => {
  const store = new MemoryStore(root)
  const rel = await store.writeMemory({
    type: 'concept',
    title: 'Memory wiki is source of truth',
    body: 'Markdown pages are canonical and SQLite is rebuildable.',
    evidence: [{ kind: 'user_instruction', ref: 'test', quote: 'Markdown is the source of truth' }],
    confidence: 'high',
  })
  expect(rel).toBe('concepts/memory-wiki-is-source-of-truth.md')
  expect(await store.readPage(rel)).toContain('# Concept:')
  await store.writePage(rel, (await store.readPage(rel))!.replace('canonical', 'authoritative'), { test: true })
  const history = await store.getPageHistory(rel)
  expect(history.length).toBeGreaterThan(0)
  await store.restorePage(rel, history.at(-1)!)
  expect(await store.readPage(rel)).toContain('canonical')
  expect(await Bun.file(path.join(root, '.maxcoder/memory/wiki/_audit/audit.jsonl')).text()).toContain('"action"')
  await expect(store.writePage('../escape.md', '# Nope\n')).rejects.toThrow(/traversal/)
  await expect(store.writePage('notes/token-note.md', '# Note: token\n\nAPI_KEY=sk-abcdef0123456789abcdef\n\n## Evidence\n\n* test')).rejects.toThrow(/secret/)
})

test('MemoryIndexer rebuilds derived SQLite/FTS and searches pages', async () => {
  const indexer = new MemoryIndexer(root)
  const r = await indexer.rebuildIndex()
  expect(r.indexed).toBeGreaterThan(0)
  expect(existsSync(memoryDbPath(root))).toBe(true)
  const results = await indexer.search('SQLite rebuildable', { types: ['concept'], limit: 5 })
  expect(results.some(x => x.path.includes('memory-wiki-is-source-of-truth'))).toBe(true)
})

test('proposal validator enforces evidence, schemas, confidence, and negative filters', async () => {
  const validator = new MemoryProposalValidator(root)
  const ok = await validator.validate({
    type: 'procedure',
    path: 'procedures/run-tests.md',
    title: 'Run tests',
    body: '## When to use\n\nBefore shipping code.\n\n## Steps\n\n1. Run `bun test`.\n\n## Validation\n\nAll tests pass.',
    evidence: [{ kind: 'command', ref: 'bun test', quote: '0 fail' }],
    confidence: 'medium',
  })
  expect(ok.approved).toBe(true)
  const badRule = await validator.validate({
    type: 'rule',
    path: '_rules/no-network.md',
    title: 'Never use network',
    body: '## Rule\n\nNever use network because one timeout happened.',
    evidence: [{ kind: 'session', ref: 's1', quote: 'network timeout' }],
    confidence: 'medium',
  })
  expect(badRule.approved).toBe(false)
  expect(badRule.issues.join(' ')).toMatch(/high confidence|transient/i)
})

test('approval queue supports pending, diff, rejection, and manual apply', async () => {
  const queue = new MemoryApprovalQueue(root)
  const id = await queue.enqueue({
    type: 'note',
    path: 'notes/qwen-small-model-memory.md',
    title: 'Qwen small model memory',
    body: '## Summary\n\nQwen 3B benefits from short retrieved memory.\n\n## Details\n\nKeep retrieved memory concise.',
    evidence: [{ kind: 'user_instruction', ref: 'test', quote: 'models pequenos' }],
    confidence: 'medium',
    should_require_approval: true,
  })
  expect(await queue.list()).toContain(id)
  expect(await queue.diff(id)).toContain('Qwen')
  await queue.reject(id, 'covered elsewhere')
  expect(await queue.show(id)).toContain('rejected')

  const applyId = await queue.enqueue({
    type: 'note',
    path: 'notes/manual-approval-note.md',
    title: 'Manual approval note',
    body: '## Summary\n\nManual approvals validate memory.\n\n## Details\n\nPending proposals are applied through MemoryStore.',
    evidence: [{ kind: 'user_instruction', ref: 'test', quote: 'aprovar/rejeitar' }],
    confidence: 'medium',
  })
  const applied = await queue.apply(applyId)
  expect(applied).toBe('notes/manual-approval-note.md')
  expect(await new MemoryStore(root).readPage(applied)).toContain('Manual approvals')
})

test('SessionRecorder writes session memory and AutoImproveReviewer creates evidence-backed proposals', async () => {
  const recorder = new SessionRecorder(root, 'session-rich')
  await recorder.record('session_started', { model: 'qwen2.5-coder:3b' })
  await recorder.record('user_prompt', { prompt: 'implement memory' })
  await recorder.record('tool_called', { name: 'read_file', path: 'src/core/memory/index.ts' })
  const sessionRel = await recorder.finish({
    userGoal: 'implement memory',
    outcome: 'memory implemented',
    candidateLearnings: ['Memory writes must keep Markdown as the source of truth.'],
  })
  expect(await new MemoryStore(root).readPage(sessionRel)).toContain('Candidate learnings')
  const ids = await new AutoImproveReviewer(root).createPendingFromSession(sessionRel)
  expect(ids.length).toBeGreaterThan(0)
  expect(await new MemoryApprovalQueue(root).show(ids[0])).toContain('Markdown as the source of truth')

  const empty = await new AutoImproveReviewer(root).reviewSession('sessions/does-not-exist.md')
  expect(empty.proposals).toEqual([])
})

test('handoff generation and current-focus slot update are supported', async () => {
  const handoff = await new HandoffManager(root).create('handoff-test', {
    whereWeLeftOff: 'Memory layer is implemented.',
    currentFocus: 'Run tests.',
    filesChanged: ['src/core/memory/index.ts'],
    testsRun: ['bun test'],
    nextSteps: ['Review pending proposals'],
    relevantMemoryPages: ['concepts/memory-wiki-is-source-of-truth.md'],
  })
  expect(existsSync(handoff)).toBe(true)
  const latest = await new HandoffManager(root).latestPending()
  expect(latest?.summary).toContain('Memory layer')

  const validator = new MemoryProposalValidator(root)
  const v = await validator.validate({
    type: 'slot_update',
    path: '_slots/current-focus.md',
    title: 'Current focus',
    body: '# Current Focus\n\nRun memory tests and review pending proposals.',
    evidence: [{ kind: 'session', ref: 'handoff-test', quote: 'Run tests' }],
    confidence: 'medium',
  })
  expect(v.approved).toBe(true)
  await new MemoryStore(root).writePage(v.normalized_path, v.normalized_body, { slot: true })
  expect(await new MemoryStore(root).readPage('_slots/current-focus.md')).toContain('Run memory tests')
})

test('curator/lint reports health without deleting pages', async () => {
  const curator = new MemoryCurator(root)
  const health = await curator.health()
  expect(health.pages).toBeGreaterThan(0)
  const report = await curator.curate(new Date('2026-06-16T00:00:00Z'))
  expect(report).toBe('_audit/curator-2026-06-16.md')
  expect(await new MemoryStore(root).readPage(report)).toContain('No page was deleted')
})

test('memory consultation policy follows effort integration rules', () => {
  expect(shouldConsultMemory('fix recurring parser bug', 'low')).toBe(true)
  expect(shouldConsultMemory('say hello', 'low')).toBe(false)
  expect(shouldConsultMemory('change model adapter', 'medium')).toBe(true)
  expect(shouldConsultMemory('anything', 'high')).toBe(true)
  expect(shouldConsultMemory('anything', 'max')).toBe(true)
})

test('AutoImproveReviewer uses an injected model proposer, validator-gated', async () => {
  const sessionRel = await new SessionRecorder(root, 'session-llm').finish({ userGoal: 'wire memory reviewer', outcome: 'done' })
  const propose = async (input: { source: string }) => ({
    proposals: [
      {
        type: 'concept' as const,
        path: 'concepts/model-reviewer.md',
        title: 'Model reviewer proposes durable memory',
        body: '## Summary\n\nThe reviewer turns sessions into evidence-backed proposals.\n\n## Details\n\nEverything is validator-gated.',
        evidence: [{ kind: 'session' as const, ref: input.source, quote: 'wire memory reviewer' }],
        confidence: 'high' as const,
        should_require_approval: true,
      },
    ],
    rejected_candidates: [],
  })
  const ids = await new AutoImproveReviewer(root).createPendingFromSession(sessionRel, { propose })
  expect(ids.length).toBe(1)
  expect(await new MemoryApprovalQueue(root).show(ids[0])).toContain('Model reviewer proposes')
})

test('a throwing proposer falls back to deterministic candidate-learning extraction', async () => {
  const sessionRel = await new SessionRecorder(root, 'session-fallback').finish({
    userGoal: 'x',
    outcome: 'y',
    candidateLearnings: ['The suite runs with bun test.'],
  })
  const propose = async () => { throw new Error('model offline') }
  const ids = await new AutoImproveReviewer(root).createPendingFromSession(sessionRel, { propose })
  expect(ids.length).toBeGreaterThan(0) // deterministic fallback still produced a proposal
})

test('HandoffManager.accept marks the matching handoff accepted (id, not slug)', async () => {
  const hm = new HandoffManager(root)
  await hm.create('session-accept-1', { whereWeLeftOff: 'mid-task' })
  await hm.accept('session-accept-1')
  const text = readFileSync(path.join(root, '.maxcoder/memory/handoffs/session-accept-1.md'), 'utf8')
  expect(text).toMatch(/## Status\s+accepted/)
})
