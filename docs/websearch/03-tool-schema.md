# 03 — Tool Schema

Source of truth: `webSearchSchema()` in `guardrails.ts` (web_search) and `WEB_FETCH_SCHEMA` in
`webSearchTool.ts` (web_fetch). Both are strict (`additionalProperties: false`).

## `web_search`

Required: `query`, `reason`, `max_results`. Optional: `recency_days` (1–3650|null),
`include_domains` (≤10), `exclude_domains` (≤20), `language`, `country`, `safe_search` (default true).

```jsonc
{ "name": "web_search", "strict": true,
  "parameters": { "type": "object", "additionalProperties": false,
    "required": ["query", "reason", "max_results"],
    "properties": {
      "query": { "type": "string" }, "reason": { "type": "string" },
      "max_results": { "type": "integer", "minimum": 1, "maximum": 10 },
      "recency_days": { "type": ["integer","null"], "minimum": 1, "maximum": 3650 },
      "include_domains": { "type": "array", "items": {"type":"string"}, "maxItems": 10 },
      "exclude_domains": { "type": "array", "items": {"type":"string"}, "maxItems": 20 },
      "language": { "type": ["string","null"] }, "country": { "type": ["string","null"] },
      "safe_search": { "type": "boolean", "default": true } } } }
```

`reason` is mandatory so the model must justify why fresh web data is needed (logged, not for the page).

### Result (JSON string)

```jsonc
{ "query", "searched_at", "provider",
  "results": [ { "title","url","display_url","domain","snippet","published_at","retrieved_at",
                 "source_type","reliability_score","relevance_score","freshness_score",
                 "content_quality_score","final_score","citation_id","quote_or_snippet",
                 "prompt_injection_detected?","injection_patterns?" } ],
  "citations": [ { "citation_id","title","url","domain","retrieved_at","quote_or_snippet" } ],
  "warnings": ["..."], "blocked": [ {"url","reason"} ],
  "prompt_injection_detected?": true, "injection_patterns?": ["..."] }
```

On error the result still parses as JSON with `error`, `warnings`, `blocked`, and empty `results` —
so the agent can tell the user it could not verify, instead of fabricating.

## `web_fetch`

Required: `url`, `reason`. Optional: `max_chars` (1000–30000). Returns
`{ url, final_url, domain, title, published_at, retrieved_at, truncated, text, citation,
prompt_injection_detected?, injection_patterns?, error?, blocked? }`.

## Validation

Inputs are validated by `validateSearchArgs()` (not just the schema): unknown args rejected, query/
reason length-bounded, secrets/credential intent blocked, embedded internal URLs blocked,
`max_results` clamped to config, domains normalized. See [04-guardrails.md](04-guardrails.md).
