/** Crawl4AI-backed fetch provider. */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchBody, WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import type { ResolvedCrawl4aiConfig } from './config.ts'
import { createHeaders, requestJson } from './http.ts'
import {
  asRecord,
  readArray,
  readBoolean,
  readNonBlankString,
  readNumber,
  readString,
} from './json.ts'

/** Stable fetch provider id selected by the bundle patch. */
export const CRAWL4AI_PROVIDER_ID = 'surfing-crawl4ai'

/** Fetch provider that returns Crawl4AI markdown through `ctx.web`. */
export class Crawl4aiFetchProvider implements WebFetchProvider {
  readonly id = CRAWL4AI_PROVIDER_ID

  /** @param options - fully resolved plugin configuration. */
  constructor(private readonly options: ResolvedCrawl4aiConfig) {}

  /** @returns true when a Crawl4AI endpoint is configured. */
  available(): boolean {
    return this.options.endpoint !== undefined
  }

  /**
   * Crawl one HTTP(S) URL through Crawl4AI's `/crawl` API.
   *
   * @param request - target URL.
   * @param signal - cooperative cancellation signal from DSH.
   * @returns final URL, target status, and bounded markdown or HTML content.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const endpoint = this.options.endpoint
    if (endpoint === undefined) {
      throw new WebError('Crawl4AI URL is not configured', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    assertTargetUrl(request.url)

    const payload = await requestJson('Crawl4AI', endpoint, {
      method: 'POST',
      headers: createHeaders(this.options, 'application/json'),
      body: JSON.stringify({ urls: [request.url] }),
      ...signal === undefined ? {} : { signal },
    })
    return mapCrawlResponse(payload, request.url, this.options)
  }
}

/** Map the first result from a single-URL Crawl4AI request. */
function mapCrawlResponse(
  payload: unknown,
  requestUrl: string,
  options: ResolvedCrawl4aiConfig,
): WebFetchResult {
  const response = asRecord(payload)
  if (response === undefined) {
    throw new WebError('Crawl4AI returned a non-object response', 'WEB_PROVIDER_ERROR')
  }
  if (readBoolean(response, 'success') === false) {
    throw new WebError(
      readNonBlankString(response, 'detail') ?? 'Crawl4AI reported a failed request',
      'WEB_PROVIDER_ERROR',
    )
  }

  const first = readArray(response, 'results')?.[0]
  const result = asRecord(first)
  if (result === undefined) {
    throw new WebError('Crawl4AI response does not contain a crawl result', 'WEB_PROVIDER_ERROR')
  }
  if (readBoolean(result, 'success') === false) {
    throw new WebError(
      readNonBlankString(result, 'error_message') ?? 'Crawl4AI could not crawl the target URL',
      'WEB_PROVIDER_ERROR',
    )
  }

  const statusCode = readNumber(result, 'status_code')
  if (statusCode === undefined || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new WebError('Crawl4AI result does not contain a valid target status code', 'WEB_PROVIDER_ERROR')
  }

  const finalUrl = readNonBlankString(result, 'redirected_url')
    ?? readNonBlankString(result, 'url')
    ?? requestUrl
  assertResultUrl(finalUrl)

  const body = selectBody(result, options.markdownMode)
  const truncated = body.content.length > options.maxContentChars
  return {
    url: finalUrl,
    statusCode,
    body: { ...body, content: body.content.slice(0, options.maxContentChars) },
    truncated,
  }
}

/** Select the requested markdown representation, falling back to other returned text. */
function selectBody(
  result: Record<string, unknown>,
  mode: ResolvedCrawl4aiConfig['markdownMode'],
): WebFetchBody {
  const markdown = result.markdown
  const markdownRecord = asRecord(markdown)
  const raw = typeof markdown === 'string'
    ? markdown
    : markdownRecord === undefined
      ? undefined
      : readString(markdownRecord, 'raw_markdown')
  const fit = markdownRecord === undefined ? undefined : readString(markdownRecord, 'fit_markdown')
  const citations = markdownRecord === undefined
    ? undefined
    : readString(markdownRecord, 'markdown_with_citations')

  const content = mode === 'fit'
    ? nonEmpty(fit) ?? raw ?? citations
    : mode === 'citations'
      ? nonEmpty(citations) ?? raw ?? fit
      : raw ?? citations ?? fit
  if (content !== undefined) return { kind: 'text', content }

  const html = readString(result, 'cleaned_html') ?? readString(result, 'html')
  if (html !== undefined) return { kind: 'html', content: html }
  throw new WebError('Crawl4AI result does not contain markdown or HTML content', 'WEB_PROVIDER_ERROR')
}

/** Prefer non-empty filtered content while preserving an intentionally empty raw page. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value
}

/** Reject non-web target schemes before they reach the crawler. */
function assertTargetUrl(value: string): void {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return
  } catch (error: unknown) {
    throw new WebError(`invalid web URL: ${value}`, 'WEB_INVALID_URL', { cause: error })
  }
  throw new WebError(`unsupported web URL scheme: ${value}`, 'WEB_INVALID_URL')
}

/** Validate the final URL returned across the external API boundary. */
function assertResultUrl(value: string): void {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return
  } catch (error: unknown) {
    throw new WebError('Crawl4AI returned an invalid final URL', 'WEB_PROVIDER_ERROR', { cause: error })
  }
  throw new WebError('Crawl4AI returned a non-HTTP final URL', 'WEB_PROVIDER_ERROR')
}
