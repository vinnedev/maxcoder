// web_search — ContentExtractor: strip HTML to readable main text + title + published date.
// Pure string processing (no DOM, no JS execution).

import { decodeEntities } from '../../shared/html/index.ts'

export interface ExtractedContent {
  title: string
  text: string
  publishedAt: string | null
}

function metaContent(html: string, attr: 'property' | 'name', key: string): string | null {
  const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i')
  const m = html.match(re) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${key}["']`, 'i'))
  return m ? decodeEntities(m[1].trim()) : null
}

function extractTitle(html: string): string {
  const og = metaContent(html, 'property', 'og:title')
  if (og) return og
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()).slice(0, 200) : ''
}

function extractPublished(html: string): string | null {
  const candidates = [
    metaContent(html, 'property', 'article:published_time'),
    metaContent(html, 'name', 'date'),
    metaContent(html, 'name', 'pubdate'),
    metaContent(html, 'property', 'og:updated_time'),
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    if (!Number.isNaN(Date.parse(c))) return new Date(c).toISOString()
  }
  const timeTag = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)
  if (timeTag && !Number.isNaN(Date.parse(timeTag[1]))) return new Date(timeTag[1]).toISOString()
  return null
}

export function extractReadable(html: string, maxChars = 30_000): ExtractedContent {
  const title = extractTitle(html)
  const published = extractPublished(html)

  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head|nav|footer|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|h[1-6]|li|br|tr|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  body = decodeEntities(body)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim()

  return { title, text: body.slice(0, maxChars), publishedAt: published }
}
