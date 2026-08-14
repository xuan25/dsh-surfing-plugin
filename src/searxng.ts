/** SearXNG-backed search provider. */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { ResolvedSearxngConfig } from './config.ts'
import { createHeaders, requestJson } from './http.ts'
import { asRecord, readArray, readNonBlankString } from './json.ts'

/** Stable search provider id selected by the bundle patch. */
export const SEARXNG_PROVIDER_ID = 'surfing-searxng'

/** Search provider that maps SearXNG's JSON `/search` response into `ctx.web`. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID

  /** @param options - fully resolved plugin configuration. */
  constructor(private readonly options: ResolvedSearxngConfig) {}

  /** @returns true when a SearXNG endpoint is configured. */
  available(): boolean {
    return this.options.endpoint !== undefined
  }

  /**
   * Search SearXNG using its form-encoded JSON API.
   *
   * @param request - query and optional source limit.
   * @param signal - cooperative cancellation signal from DSH.
   * @returns normalized search sources and optional direct answers.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const endpoint = this.options.endpoint
    if (endpoint === undefined) {
      throw new WebError('SearXNG URL is not configured', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }

    const body = new URLSearchParams({ q: request.query, format: 'json' })
    if (this.options.language !== undefined) body.set('language', this.options.language)
    if (this.options.categories !== undefined) body.set('categories', this.options.categories)
    if (this.options.safeSearch !== undefined) body.set('safesearch', String(this.options.safeSearch))
    if (this.options.timeRange !== undefined) body.set('time_range', this.options.timeRange)

    const payload = await requestJson('SearXNG', endpoint, {
      method: 'POST',
      headers: createHeaders(this.options, 'application/x-www-form-urlencoded;charset=UTF-8'),
      body,
      ...signal === undefined ? {} : { signal },
    })
    return mapSearchResponse(payload, request.maxResults)
  }
}

/** Map and validate the fields used from a SearXNG JSON response. */
function mapSearchResponse(payload: unknown, maxResults: number | undefined): WebSearchResult {
  const response = asRecord(payload)
  const results = response === undefined ? undefined : readArray(response, 'results')
  if (response === undefined || results === undefined) {
    throw new WebError('SearXNG response does not contain a results array', 'WEB_PROVIDER_ERROR')
  }

  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const value of results) {
    const result = asRecord(value)
    if (result === undefined) continue
    const url = readWebUrl(result, 'url')
    if (url === undefined || seen.has(url)) continue
    seen.add(url)

    const title = readNonBlankString(result, 'title')
    const snippet = readNonBlankString(result, 'content')
    const publishedAt = normalizePublishedAt(readNonBlankString(result, 'publishedDate'))
    sources.push({
      url,
      ...title === undefined ? {} : { title },
      ...snippet === undefined ? {} : { snippet },
      ...publishedAt === undefined ? {} : { publishedAt },
    })
  }

  const answers = readArray(response, 'answers')
    ?.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim())
  const truncated = maxResults !== undefined && sources.length > maxResults
  return {
    ...answers !== undefined && answers.length > 0 ? { content: answers.join('\n\n') } : {},
    sources: maxResults === undefined ? sources : sources.slice(0, maxResults),
    truncated,
  }
}

/** Read an absolute HTTP(S) URL without normalizing provider attribution. */
function readWebUrl(record: Record<string, unknown>, key: string): string | undefined {
  const value = readNonBlankString(record, key)
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined
  } catch {
    // Malformed external result URLs are omitted because they cannot be cited safely.
    return undefined
  }
}

/** Normalize a SearXNG date string to the seam's ISO-8601 field. */
function normalizePublishedAt(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}
