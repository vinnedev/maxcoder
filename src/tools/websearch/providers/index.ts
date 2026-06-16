// web_search — provider factory. Extend here to add Brave/Bing/Tavily/SerpAPI, etc.

import type { WebSearchConfig } from '../config.ts'
import type { SearchProvider } from '../types.ts'
import { DuckDuckGoProvider } from './duckduckgo.ts'
import { MockSearchProvider } from './mock.ts'
import { SearxngProvider } from './searxng.ts'

// Provider factory table (replaces a switch). Add new providers here.
const FACTORIES: Record<string, (c: WebSearchConfig) => SearchProvider> = {
  mock: () => new MockSearchProvider(),
  searxng: c => new SearxngProvider(c.baseUrl, c.userAgent),
  duckduckgo: () => new DuckDuckGoProvider(),
}

export function createProvider(config: WebSearchConfig): SearchProvider {
  return (FACTORIES[config.provider] ?? FACTORIES.duckduckgo)(config)
}

export { DuckDuckGoProvider, MockSearchProvider, SearxngProvider }
