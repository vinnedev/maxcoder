// web_search — WebSearchCache: local TTL cache (in-memory + disk JSON). TTL 0 disables.

import { readJSON, writeText } from '../fsx.ts'
import type { WebSearchResponse } from './types.ts'

interface Entry {
  expires: number
  value: WebSearchResponse
}

export class WebSearchCache {
  private mem = new Map<string, Entry>()
  private loaded = false

  constructor(
    private path: string,
    private ttlSeconds: number,
    private now: () => number = Date.now,
  ) {}

  static key(parts: Record<string, unknown>): string {
    return JSON.stringify(parts)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const disk = await readJSON<Record<string, Entry>>(this.path)
    if (disk) {
      for (const [k, v] of Object.entries(disk)) {
        if (v && v.expires > this.now()) this.mem.set(k, v)
      }
    }
  }

  async get(key: string): Promise<WebSearchResponse | null> {
    if (this.ttlSeconds <= 0) return null
    await this.load()
    const e = this.mem.get(key)
    if (!e) return null
    if (e.expires <= this.now()) {
      this.mem.delete(key)
      return null
    }
    return e.value
  }

  async set(key: string, value: WebSearchResponse): Promise<void> {
    if (this.ttlSeconds <= 0) return
    await this.load()
    this.mem.set(key, { expires: this.now() + this.ttlSeconds * 1000, value })
    // Persist (best-effort; prune expired on write).
    const obj: Record<string, Entry> = {}
    for (const [k, v] of this.mem) if (v.expires > this.now()) obj[k] = v
    try {
      await writeText(this.path, JSON.stringify(obj))
    } catch {
      /* cache is best-effort */
    }
  }
}
