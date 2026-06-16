// web_search — WebFetcher: download a public URL safely (SSRF-hardened, size-capped, no JS).
// Re-validates the host AND every resolved IP (anti DNS-rebinding) and every redirect hop.

import { lookup } from 'node:dns/promises'
import type { WebSearchConfig } from './config.ts'
import { validatePublicUrl } from './guardrails.ts'

export class FetchBlockedError extends Error {
  constructor(public reason: string) {
    super(reason)
    this.name = 'FetchBlockedError'
  }
}

const ALLOWED_CONTENT = ['text/html', 'text/plain', 'application/xhtml+xml']

async function assertResolvedPublic(host: string, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) return
  // Skip DNS for IP literals (validatePublicUrl already handled them).
  if (/^[0-9.]+$/.test(host) || host.includes(':')) return
  let addrs: { address: string; family: number }[]
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    throw new FetchBlockedError('dns_resolution_failed')
  }
  for (const a of addrs) {
    const probe = a.family === 6 ? `http://[${a.address}]` : `http://${a.address}`
    if (!validatePublicUrl(probe).ok) throw new FetchBlockedError('private_network_resolved')
  }
}

export interface FetchedPage {
  finalUrl: string
  status: number
  contentType: string
  html: string
  truncated: boolean
}

export async function secureFetch(
  url: string,
  config: WebSearchConfig,
  signal?: AbortSignal,
): Promise<FetchedPage> {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    const v = validatePublicUrl(current, config.allowPrivateNetwork)
    if (!v.ok) throw new FetchBlockedError(v.reason ?? 'blocked_url')
    const host = new URL(current).hostname.toLowerCase()
    await assertResolvedPublic(host, config.allowPrivateNetwork)

    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': config.userAgent, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
      signal,
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new FetchBlockedError('redirect_without_location')
      current = new URL(loc, current).toString() // re-validated next loop iteration
      continue
    }

    if (!res.ok) throw new FetchBlockedError(`http_${res.status}`)
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (!ALLOWED_CONTENT.some(t => contentType.includes(t))) {
      throw new FetchBlockedError(`unsupported_content_type:${contentType.split(';')[0] || 'unknown'}`)
    }

    // Size-capped streaming read.
    const reader = res.body?.getReader()
    if (!reader) throw new FetchBlockedError('empty_body')
    const dec = new TextDecoder()
    let html = ''
    let bytes = 0
    let truncated = false
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > config.maxFetchBytes) {
        truncated = true
        html += dec.decode(value.subarray(0, Math.max(0, config.maxFetchBytes - (bytes - value.byteLength))))
        reader.cancel().catch(() => {})
        break
      }
      html += dec.decode(value, { stream: true })
    }
    return { finalUrl: current, status: res.status, contentType, html, truncated }
  }
  throw new FetchBlockedError('too_many_redirects')
}

/** Best-effort robots.txt check for the path (lenient: only blocks explicit `Disallow: /` for *). */
export async function robotsAllows(url: string, config: WebSearchConfig, signal?: AbortSignal): Promise<boolean> {
  try {
    const u = new URL(url)
    const robotsUrl = `${u.origin}/robots.txt`
    const v = validatePublicUrl(robotsUrl, config.allowPrivateNetwork)
    if (!v.ok) return true // can't check safely → don't block
    const res = await fetch(robotsUrl, { headers: { 'User-Agent': config.userAgent }, signal })
    if (!res.ok) return true
    const text = (await res.text()).slice(0, 50_000)
    // Very small parser: find a global (User-agent: *) block with Disallow: /
    const lines = text.split('\n').map(l => l.trim().toLowerCase())
    let inStar = false
    for (const line of lines) {
      if (line.startsWith('user-agent:')) inStar = line.includes('*')
      else if (inStar && line === 'disallow: /') return false
    }
    return true
  } catch {
    return true
  }
}
