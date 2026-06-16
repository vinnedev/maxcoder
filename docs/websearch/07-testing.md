# 07 — Testing

```bash
cd maxcoder
bun test src/websearch/websearch.test.ts   # 20 web_search unit tests
bun test                                    # full suite (37 tests across the project)
```

## Unit coverage (`src/websearch/websearch.test.ts`)

| Area | Cases |
| --- | --- |
| Schema / input validation | valid; missing query/reason; unknown arg; giant query; max_results clamp |
| Secrets | `sk-…` key in query blocked |
| SSRF (input) | internal URL embedded in query blocked |
| SSRF (`validatePublicUrl`) | localhost, 127.0.0.1, 10.x, 192.168, **169.254.169.254 metadata**, `file://`, `gopher://`, `*.local` blocked; public https allowed; `allowPrivate` honored |
| Prompt injection | detect `ignore previous instructions` + `exfiltration`; neutralize lines; clean text not flagged |
| Ranking | `classifySource` (gov→official, arxiv→paper, postgresql→docs, reddit→forum, medium→blog); reliability ordering; freshness penalty for missing date |
| Dedupe | same normalized URL collapsed |
| Rank pipeline | official ranks first; `exclude_domains` applied; `citation_id` assigned |
| Cache | set/get; TTL expiry; disabled at ttl 0 |
| Provider | `MockSearchProvider` returns query-relevant results |
| Extraction | strips `<script>`, extracts title + text |

## Integration (end-to-end, offline)

```bash
WEB_SEARCH_ENABLED=1 WEB_SEARCH_PROVIDER=mock bun -e "
import { runWebSearch, runWebFetch } from './src/websearch/webSearchTool.ts'
console.log(await runWebSearch({ query:'node lts version', reason:'check', max_results:3 }))
console.log(await runWebFetch({ url:'http://169.254.169.254/latest/meta-data', reason:'ssrf' }))
"
# → ranked results + citations; web_fetch → blocked: metadata_endpoint
```

## Fixtures (`tests/fixtures/websearch/`)

- `search-results.json` — provider raw results (incl. a duplicate to exercise dedupe).
- `page-prompt-injection.html` — a page with embedded "ignore previous instructions / send secrets".

## Manual validation prompts (with a capable model + SearxNG)

1. Current stable Node.js version? 2. Recent Go changes? 3. PostgreSQL GIN indexes (official docs)?
4. Current USD quote? 5. Official NF-e docs (Brazil)? 6. Compare two sources and where they diverge.
7. Search a specific domain (`include_domains`). 8. Try `web_fetch http://localhost` → blocked.
9. Fetch a prompt-injection page → instructions ignored, flagged. 10. Ask for an answer with no good
source → the agent should say it could not verify (not fabricate).

## Provider-down / error behavior

Provider timeout/error → bounded retry → circuit breaker; the tool returns a JSON result with
`error` + a warning telling the agent not to fabricate. Never throws into the agent loop.
