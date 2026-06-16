// web_search — DuckDuckGo provider (zero-setup, no API key). Scrapes the HTML endpoint lightly.
// Honors the spec's "DuckDuckGo fallback, se viável" — used as the default so web_search works
// out of the box. For heavier/robust use, prefer self-hosted SearxNG (WEB_SEARCH_PROVIDER=searxng).

import { stripTags } from '../../../shared/html/index.ts'
import type { NormalizedWebSearchArgs, ProviderSearchResult, SearchProvider } from '../types.ts'

// DDG's HTML endpoint expects a browser-like UA.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

const TITLE_RE = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
const SNIPPET_RE = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g

function decodeUddg(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return m[1]
    }
  }
  if (href.startsWith('//')) return `https:${href}`
  return href
}

/**
 * Map an optional country/language pair to a DDG region code, e.g. BR + pt → 'br-pt'.
 * Tolerates models that pass a LOCALE as the country (e.g. 'pt-BR' → country 'br', lang 'pt').
 * Returns undefined (global search) when the country can't be resolved to a 2-letter code.
 */
function regionParam(args: NormalizedWebSearchArgs): string | undefined {
  let country = (args.country || '').trim().toLowerCase()
  let lang = (args.language || '').split(/[-_]/)[0].toLowerCase()
  if (country.includes('-') || country.includes('_')) {
    const parts = country.split(/[-_]/)
    if (!lang) lang = parts[0]
    country = parts[parts.length - 1] // 'pt-br' -> 'br'
  }
  if (!/^[a-z]{2}$/.test(country)) return undefined
  if (!/^[a-z]{2}$/.test(lang)) lang = country
  return `${country}-${lang}`
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = 'duckduckgo'

  async search(args: NormalizedWebSearchArgs, signal?: AbortSignal): Promise<ProviderSearchResult[]> {
    const params = new URLSearchParams({ q: args.query, kp: args.safe_search ? '1' : '-2' })
    const region = regionParam(args)
    if (region) params.set('kl', region)

    const res = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      method: 'GET',
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': args.language || 'en-US,en;q=0.9' },
      signal,
    })
    if (!res.ok) throw new Error(`duckduckgo_http_${res.status}`)
    const html = await res.text()

    const titles = [...html.matchAll(TITLE_RE)]
    const snippets = [...html.matchAll(SNIPPET_RE)].map(m => stripTags(m[1]))

    const out: ProviderSearchResult[] = []
    for (let i = 0; i < titles.length; i++) {
      const url = decodeUddg(titles[i][1])
      const title = stripTags(titles[i][2])
      if (!url || !title || !/^https?:\/\//.test(url)) continue
      if (/duckduckgo\.com\/y\.js|\.ad_domain|aclk|\/y\.js/.test(url)) continue // skip ads
      out.push({ title, url, snippet: snippets[i] ?? '', published_at: null })
    }
    return out.slice(0, Math.max(args.max_results * 2, args.max_results))
  }
}

// Exposed for unit tests.
export const __test = { decodeUddg, stripTags, regionParam }
