# 06 — Local Setup

No paid APIs. Two ways to run: **mock** (offline) or **SearxNG** (self-hosted, real web).

## A. Offline / dev — mock provider

```bash
export WEB_SEARCH_ENABLED=1
export WEB_SEARCH_PROVIDER=mock
maxcoder "What is the current Node.js LTS? Use web_search and cite sources."
```

The mock returns a small curated dataset (authoritative + low-quality sources) so you can exercise
ranking, dedup, and citations without network.

## B. Real local web — SearxNG (recommended)

SearxNG is a free, self-hostable metasearch engine. Run it locally with Docker:

```bash
docker run -d --name searxng -p 8080:8080 \
  -e "BASE_URL=http://localhost:8080/" \
  searxng/searxng

# Enable JSON output: in searxng/settings.yml add 'json' to:
#   search:
#     formats: [html, json]
# then: docker restart searxng

curl -s 'http://localhost:8080/search?q=node+lts&format=json' | head   # verify JSON works
```

Then point Max Coder at it:

```bash
export WEB_SEARCH_ENABLED=1
export WEB_SEARCH_PROVIDER=searxng
export WEB_SEARCH_BASE_URL=http://localhost:8080
export WEB_SEARCH_TIMEOUT_MS=10000
export WEB_SEARCH_SAFE_SEARCH=true
maxcoder "Search the official PostgreSQL docs about GIN indexes and cite them."
```

> Note: `WEB_SEARCH_BASE_URL` points at *your* SearxNG. The SSRF guard still applies to result URLs
> and to `web_fetch`, but the SearxNG base URL itself is trusted config (you set it). Do not point it
> at an untrusted host.

## Verify it's wired

```bash
WEB_SEARCH_ENABLED=1 WEB_SEARCH_PROVIDER=mock maxcoder doctor
#   ✓ registry — 10 tools · 2 web tool(s) [mock]
maxcoder doctor          # without the env: 8 tools, no web tools (off by default)
```

## Adding another provider (Brave/Bing/Tavily/SerpAPI/DuckDuckGo)

Implement `SearchProvider` (`{ name, search(args, signal) }`) in `src/websearch/providers/`, add a
case to `createProvider()` in `providers/index.ts`, and read any key from `WEB_SEARCH_API_KEY`
(never log it). The rest of the pipeline (guardrails, rank, cache, citations) is unchanged.

## Config reference

| Env | Default | Meaning |
| --- | --- | --- |
| `WEB_SEARCH_ENABLED` | `false` | master gate (off = tools not registered) |
| `WEB_SEARCH_PROVIDER` | `searxng` | `searxng` \| `mock` |
| `WEB_SEARCH_BASE_URL` | `http://localhost:8080` | provider endpoint |
| `WEB_SEARCH_TIMEOUT_MS` | `10000` | per-attempt timeout |
| `WEB_SEARCH_MAX_RESULTS` | `10` | upper bound (model can request fewer) |
| `WEB_SEARCH_CACHE_TTL_SECONDS` | `3600` | `0` disables cache |
| `WEB_SEARCH_SAFE_SEARCH` | `true` | safe search default |
| `WEB_SEARCH_ALLOW_PRIVATE_NETWORK` | `false` | **keep false** (SSRF) |
| `WEB_SEARCH_MAX_FETCH_BYTES` | `2000000` | `web_fetch` size cap |
| `WEB_SEARCH_USER_AGENT` | `MaxCoderBot/0.1 (+local)` | request UA |
| `WEB_SEARCH_DEBUG` | `false` | extra stderr logs |
