# 02 — Architecture

Layered, single-responsibility. No stage mixes search + scraping + ranking + answer.

```
web_search(args, ctx)                       webSearchTool.ts  (orchestrator only)
  1. webSearchConfig()                       config.ts        env → typed config
  2. validateSearchArgs(args)                guardrails.ts    schema + secrets + SSRF-in-query
  3. cache.get(key)                          cache.ts         TTL (mem+disk) — return if hit
  4. createProvider(config)                  providers/       mock | searxng | (Brave/Bing/…)
  5. rateLimiter.wait → circuitBreaker       resilience.ts
       → retry(withTimeout(provider.search)) resilience.ts    bounded retry + per-attempt timeout
  6. dedupe + rankResults(args, raw)         ranker.ts        classify + score + dedupe + filters
  7. sanitizeContent(snippet)                injection.ts     detect + neutralize web instructions
  8. buildCitations(ranked)                  citations.ts
  9. response (JSON) + cache.set + telemetry telemetry.ts     redacted logs
```

`web_fetch(url)` reuses the same guardrails + injection + telemetry, plus `fetcher.ts`
(SSRF-hardened download) and `extractor.ts` (HTML → text).

## Why these boundaries

- **Provider adapter** (`SearchProvider`) isolates the backend — swap SearxNG ↔ Brave ↔ mock without
  touching ranking, guardrails, or the tool. Not coupled to the model provider (Ollama) at all.
- **Guardrails before and after**: input (`validateSearchArgs`/`validatePublicUrl`) and content
  (`injection.ts`). Web content is **data**, never instructions.
- **Resilience** wraps only the network call, keeping pure logic (rank/dedup/score) testable offline.
- **Orchestrator** only sequences; each concern is independently unit-tested.

## Tool result shape (data, not instructions)

`web_search` returns a JSON string: `{ query, searched_at, provider, results[], citations[],
warnings[], blocked[], prompt_injection_detected?, injection_patterns? }`. Each result carries
`source_type`, `reliability_score`, `relevance_score`, `freshness_score`, `final_score`,
`citation_id`, and `quote_or_snippet`. The model consumes this as evidence and must cite inline.

## Extension points

- New search provider → implement `SearchProvider` in `providers/`, add a case in `providers/index.ts`.
- New guardrail → add to `guardrails.ts` (input) or `injection.ts` (content).
- New ranking signal → add a score fn in `ranker.ts` and fold into `final_score`.
