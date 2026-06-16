# 00 — web_search Summary

A local-first, secure, provider-agnostic `web_search` (+ `web_fetch`) tool for the Max Coder agent.
No paid APIs: defaults to **SearxNG** (self-hosted) or a **mock** provider. **Off by default**
(`WEB_SEARCH_ENABLED` gate) — current behavior is unchanged until you enable it.

## What was implemented

Layered, single-responsibility modules under `maxcoder/src/websearch/`:

| Layer | File | Role |
| --- | --- | --- |
| Config | `config.ts` | `WEB_SEARCH_*` env → typed config |
| Types | `types.ts` | shared interfaces incl. `SearchProvider` |
| Input guardrails | `guardrails.ts` | strict arg validation, secret blocking, **SSRF** (`validatePublicUrl`), strict schema |
| Content guardrails | `injection.ts` | prompt-injection **detection + neutralization** |
| Providers | `providers/{mock,searxng,index}.ts` | adapter layer (extend for Brave/Bing/Tavily/…) |
| Fetch | `fetcher.ts` | SSRF-hardened fetch (DNS re-check, redirect re-check, size cap, no JS) + robots |
| Extract | `extractor.ts` | HTML → readable text/title/date (no DOM, no JS) |
| Rank | `ranker.ts` | classify + score (0.4 rel / 0.3 reliab / 0.2 fresh / 0.1 quality) + dedupe |
| Citations | `citations.ts` | citeable sources |
| Cache | `cache.ts` | TTL cache (mem + disk) |
| Telemetry | `telemetry.ts` | redacted, safe logs |
| Resilience | `resilience.ts` | timeout · retry · circuit breaker · rate limit |
| Orchestrator | `webSearchTool.ts` | sequences the pipeline; registers `web_search` + `web_fetch` |

Registered into the agent registry (`cli.ts → initRegistry → registerWebTools()`), env-gated.

## How to configure

```bash
export WEB_SEARCH_ENABLED=1
export WEB_SEARCH_PROVIDER=searxng           # or 'mock' for offline/testing
export WEB_SEARCH_BASE_URL=http://localhost:8080
export WEB_SEARCH_TIMEOUT_MS=10000
export WEB_SEARCH_MAX_RESULTS=10
export WEB_SEARCH_CACHE_TTL_SECONDS=3600
export WEB_SEARCH_SAFE_SEARCH=true
export WEB_SEARCH_ALLOW_PRIVATE_NETWORK=false   # keep false (SSRF protection)
export WEB_SEARCH_USER_AGENT="MaxCoderBot/0.1 (+local)"
```

## How to run locally

See [06-local-setup.md](06-local-setup.md). TL;DR: run SearxNG in Docker (`searxng/searxng`), enable the
JSON format, set the env above, then `maxcoder "..."`. For offline dev use `WEB_SEARCH_PROVIDER=mock`.

## How to test

```bash
cd maxcoder && bun test src/websearch/websearch.test.ts   # 20 unit tests (guardrails/SSRF/injection/rank/cache)
bun test                                                  # full suite
```

## Acceptance criteria — status

| Criterion | ✓ |
| --- | --- |
| `web_search` registered as a real tool | ✓ (env-gated; `web_fetch` too) |
| strict schema, validated inputs | ✓ `guardrails.validateSearchArgs` + `webSearchSchema` |
| dangerous URLs blocked (SSRF) | ✓ localhost/private/metadata/non-http (verified) |
| results have sources / citations | ✓ `citations.ts` |
| ranking + dedup | ✓ `ranker.ts` |
| cache + timeout + bounded retry + breaker | ✓ `cache.ts` + `resilience.ts` |
| safe logs (no secrets/cookies/HTML) | ✓ `telemetry.ts` |
| unit tests + mock provider | ✓ 20 tests, `MockSearchProvider` |
| docs | ✓ `docs/websearch/*` |
| current project still works | ✓ off by default; full suite green |
| never obeys instructions from web | ✓ `injection.ts` detect+neutralize; treated as data |
| answers cite sources | ✓ enforced via tool description + structured citations |

## Limitations / risks

- Quality depends on the search provider; SearxNG result freshness/coverage varies by instance.
- Prompt-injection detection is heuristic (pattern-based) — defense-in-depth, not a guarantee.
- `web_fetch` extraction is regex-based (no full DOM); complex pages may extract imperfectly.
- robots.txt handling is minimal (blocks only explicit global `Disallow: /`).
- Small local models may under-cite; the tool returns citations but the model must use them.

## Next steps

- Add Brave/Bing/Tavily/SerpAPI/DuckDuckGo providers (just implement `SearchProvider`).
- Per-domain allow/deny policy + a permissions gate for `web_fetch`.
- Optional readability (DOM) extractor; stronger injection classifier.

See: [01](01-project-tooling-map.md) · [02](02-architecture.md) · [03](03-tool-schema.md) ·
[04](04-guardrails.md) · [05](05-ranking-and-citations.md) · [06](06-local-setup.md) · [07](07-testing.md)
