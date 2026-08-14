/** Shared HTTP behavior for backend requests. */

import { WebError } from '@deepseek-ai/dsh-web'
import type { ResolvedAuthentication } from './config.ts'
import { asRecord, readNonBlankString } from './json.ts'

const USER_AGENT = 'dsh-surfing-plugin/0.1.0'
const MAX_ERROR_DETAIL_CHARS = 500

/** Create standard JSON response headers and add optional backend authentication. */
export function createHeaders(
  authentication: ResolvedAuthentication,
  contentType: string,
): Headers {
  const headers = new Headers({
    accept: 'application/json',
    'content-type': contentType,
    'user-agent': USER_AGENT,
  })
  if (authentication.apiKey !== undefined) {
    const value = authentication.authScheme.length > 0
      ? `${authentication.authScheme} ${authentication.apiKey}`
      : authentication.apiKey
    headers.set(authentication.authHeader, value)
  }
  return headers
}

/**
 * Execute one backend request and decode a successful JSON response.
 *
 * @param label - provider name used in diagnostics.
 * @param url - validated backend endpoint.
 * @param init - fetch request options.
 * @returns parsed JSON value.
 */
export async function requestJson(label: string, url: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { ...init, redirect: 'error' })
  } catch (error: unknown) {
    throwRequestError(label, error)
  }

  if (!response.ok) {
    const detail = await readErrorDetail(label, response)
    throw new WebError(
      detail ?? `${label} API returned HTTP ${response.status}`,
      'WEB_PROVIDER_ERROR',
    )
  }

  try {
    return await response.json() as unknown
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw new WebError(`${label} request aborted`, 'WEB_ABORTED', { cause: error })
    }
    throw new WebError(`${label} returned an invalid JSON response`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** Read a bounded error detail without allowing body failures to hide the HTTP status. */
async function readErrorDetail(label: string, response: Response): Promise<string | undefined> {
  let text: string
  try {
    text = await response.text()
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw new WebError(`${label} request aborted`, 'WEB_ABORTED', { cause: error })
    }
    // The HTTP status remains authoritative when an error response body cannot be read.
    return undefined
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  let detail = trimmed
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'string') {
      detail = parsed
    } else {
      const record = asRecord(parsed)
      detail = record === undefined
        ? trimmed
        : readNonBlankString(record, 'detail')
          ?? readNonBlankString(record, 'error')
          ?? readNonBlankString(record, 'message')
          ?? trimmed
    }
  } catch {
    // Non-JSON gateway responses are useful as plain-text diagnostics.
  }
  return `${label} API error: ${detail.slice(0, MAX_ERROR_DETAIL_CHARS)}`
}

/** Convert transport failures to the web seam's shared error taxonomy. */
function throwRequestError(label: string, error: unknown): never {
  if (isAbortError(error)) {
    throw new WebError(`${label} request aborted`, 'WEB_ABORTED', { cause: error })
  }
  throw new WebError(`${label} request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}

/** Identify aborts from native fetch and compatible fetch implementations. */
function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  const record = asRecord(error)
  return record?.name === 'AbortError'
}
