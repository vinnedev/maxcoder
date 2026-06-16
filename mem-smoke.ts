import * as os from 'node:os'; import * as path from 'node:path'; import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { initMemoryWorkspace, MemoryStore, MemoryIndexer, SessionRecorder, HandoffManager, AutoImproveReviewer, MemoryApprovalQueue, MEMORY_REVIEWER_PROMPT } from './src/core/memory/index.ts'
import { createAdapter } from './src/models/index.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'mem-e2e-'))
await initMemoryWorkspace(root)
console.log('wiki structure:', ['wiki/index.md','wiki/_slots/current-focus.md','index/fts','handoffs'].map(p => existsSync(path.join(root,'.maxcoder/memory',p))?'✓':'✗').join(' '))

// write a durable concept + search it
await new MemoryStore(root).writeMemory({ type:'concept', title:'Repo RAG is lexical', body:'## Summary\n\nRetrieval uses FTS/lexical scoring, no embeddings.\n\n## Details\n\nSymbol>path>summary.', evidence:[{kind:'user_instruction',ref:'spec',quote:'no embeddings'}], confidence:'high' })
await new MemoryIndexer(root).rebuildIndex()
const hits = await new MemoryIndexer(root).search('lexical retrieval embeddings', { limit: 3 })
console.log('search hit:', hits[0]?.path, '|', hits[0]?.title)

// record a session, generate handoff
const rec = new SessionRecorder(root, 'sess-1')
await rec.record('user_prompt', { prompt: 'add a datetime tool' })
await rec.record('file_changed', { path: 'src/tools/datetime/index.ts' })
const sessionRel = await rec.finish({ userGoal: 'add datetime tool', outcome: 'tool added, tests pass' })
await new HandoffManager(root).create('sess-1', { whereWeLeftOff: 'datetime tool added' })
console.log('handoff pending:', (await new HandoffManager(root).latestPending())?.id)

// model-backed auto-improve against the real 3b (validator-gated)
const adapter = createAdapter(process.env.MAXCODER_MODEL || 'qwen2.5-coder:3b', { contextWindow: 8192 })
const propose = async (input: {session:string;source:string;recentMemory:string[]}) => {
  const { data } = await adapter.generateJson<{proposals?:unknown[]}>({ messages: [
    { role:'system', content: MEMORY_REVIEWER_PROMPT + '\n\nSchema: {"proposals":[{"type":"concept|procedure|note","path":"string","title":"string","body":"string","evidence":[{"kind":"session","ref":"string","quote":"string"}],"confidence":"low|medium|high","should_require_approval":true}]}' },
    { role:'user', content: `Session (${input.source}):\n${input.session.slice(0,2000)}` },
  ]})
  return { proposals: Array.isArray(data?.proposals)? data!.proposals as never[] : [], rejected_candidates: [] }
}
const ids = await new AutoImproveReviewer(root).createPendingFromSession(sessionRel, { propose })
console.log('auto-improve pending proposals:', ids.length)
if (ids.length) console.log('  first pending validated+queued:', ids[0].slice(0,40))
rmSync(root, { recursive: true, force: true })
