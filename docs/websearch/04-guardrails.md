# 04 — Guardrails

Two layers: **input** (before search/fetch) and **content** (web data is untrusted).

## Input guardrails — `guardrails.ts`

`validateSearchArgs(input, maxResults, safeDefault)`:
- Strict args: unknown keys rejected (`additionalProperties:false` behavior).
- `query`/`reason` required; length ≤ 500 chars each; whitespace normalized.
- **Secret blocking**: rejects queries containing `sk-…`, `ghp_…`, `xox[b…]`, `AKIA…`, or
  `api_key/secret/password/token/credential = …`, and "find/leak my password/token" intent.
- **No embedded internal URLs**: any URL in query/reason is checked by `validatePublicUrl`; blocked → reject.
- `max_results` clamped to `[1, min(10, config)]` (warns when clamped).
- `recency_days` ∈ `[1,3650]|null`; domains normalized (`include`≤10, `exclude`≤20).
- `safe_search` defaults to config (true).

`validatePublicUrl(url, allowPrivate=false)` — the **SSRF** gate:
- Scheme must be `http`/`https` — blocks `file:`, `ftp:`, `gopher:`, `data:`, `javascript:`.
- Blocks `localhost`, `ip6-localhost`, `0.0.0.0`, `*.local`, `*.internal`.
- Blocks private IPv4 (`10/8`, `127/8`, `172.16–31`, `192.168`, `169.254`, `0.x`) and IPv6 (`::1`,
  `fc/fd…`, `fe80:`).
- Blocks the cloud **metadata endpoint** `169.254.169.254`.
- `WEB_SEARCH_ALLOW_PRIVATE_NETWORK=1` bypasses (off by default — keep it off).

`web_fetch` adds (in `fetcher.ts`): **DNS re-resolution** of the host and re-checks every resolved IP
(anti DNS-rebinding), re-validates **every redirect hop**, enforces `text/html|text/plain` content
type, caps body to `WEB_SEARCH_MAX_FETCH_BYTES`, never executes JS, and does a minimal **robots.txt**
check.

## Content guardrails — `injection.ts`

All fetched/snippet content is **data, never instructions**. `detectInjection(text)` flags patterns:
`ignore previous instructions`, role override ("you are now system/developer"), `system prompt`,
`developer message`, exfiltration ("send/reveal … secrets/api keys/tokens"), command execution,
`disable safety`, `copy … into your prompt`, `jailbreak`, override rules, fake tool/system tags.
`neutralizeText` replaces offending lines with `[removed: untrusted instruction from web content]`.
Results carry `prompt_injection_detected` + `injection_patterns`; a warning is added so the agent
treats it as data.

## Tests (in `websearch.test.ts`)

Covered: secret-in-query, internal-URL-in-query, empty/giant query, unknown arg, max_results clamp,
localhost/127.0.0.1/10.x/192.168/169.254.169.254 metadata/`file://`/`*.local` blocked, public allowed,
`allowPrivate` honored, injection detection + neutralization, clean content not flagged. Plus end-to-end
`web_fetch` SSRF block of localhost + metadata.
