import { describe, expect, it } from 'vitest'
import {
  CRAWL4AI_API_KEY_ENV,
  CRAWL4AI_URL_ENV,
  DEFAULT_MAX_CONTENT_CHARS,
  resolveConfig,
  SEARXNG_API_KEY_ENV,
  SEARXNG_URL_ENV,
} from '../src/index.ts'

describe('resolveConfig', () => {
  it('reads endpoint and optional credentials from the default environment variables', () => {
    const resolved = resolveConfig({}, {
      [SEARXNG_URL_ENV]: 'http://searxng.local:8080/',
      [SEARXNG_API_KEY_ENV]: 'search-secret',
      [CRAWL4AI_URL_ENV]: 'http://crawl4ai.local:11235/api',
      [CRAWL4AI_API_KEY_ENV]: 'crawl-secret',
    })

    expect(resolved.searxng).toMatchObject({
      endpoint: 'http://searxng.local:8080/search',
      apiKey: 'search-secret',
      authHeader: 'Authorization',
      authScheme: 'Bearer',
    })
    expect(resolved.crawl4ai).toMatchObject({
      endpoint: 'http://crawl4ai.local:11235/api/crawl',
      apiKey: 'crawl-secret',
      markdownMode: 'raw',
      maxContentChars: DEFAULT_MAX_CONTENT_CHARS,
    })
  })

  it('prefers explicit config and accepts complete operation endpoints', () => {
    const resolved = resolveConfig({
      searxng: {
        url: 'https://search.example/search',
        apiKey: 'literal-search-key',
        apiKeyEnv: 'SEARCH_KEY',
        authHeader: 'X-API-Key',
        authScheme: '',
        language: 'zh-CN',
        categories: 'general,news',
        safeSearch: 2,
        timeRange: 'month',
      },
      crawl4ai: {
        url: 'https://crawl.example/crawl/',
        apiKeyEnv: 'CRAWL_KEY',
        markdownMode: 'fit',
        maxContentChars: 4096,
      },
    }, {
      [SEARXNG_URL_ENV]: 'https://ignored.example',
      SEARCH_KEY: 'ignored-environment-key',
      CRAWL_KEY: 'configured-environment-key',
    })

    expect(resolved.searxng).toEqual({
      endpoint: 'https://search.example/search',
      apiKey: 'literal-search-key',
      authHeader: 'X-API-Key',
      authScheme: '',
      language: 'zh-CN',
      categories: 'general,news',
      safeSearch: 2,
      timeRange: 'month',
    })
    expect(resolved.crawl4ai).toMatchObject({
      endpoint: 'https://crawl.example/crawl',
      apiKey: 'configured-environment-key',
      markdownMode: 'fit',
      maxContentChars: 4096,
    })
  })

  it('leaves providers unavailable when no endpoint is configured', () => {
    const resolved = resolveConfig({}, {})
    expect(resolved.searxng.endpoint).toBeUndefined()
    expect(resolved.crawl4ai.endpoint).toBeUndefined()
  })

  it.each([
    [{ searxng: { url: 'relative' } }, 'searxng.url must be an absolute HTTP(S) URL'],
    [{ searxng: { url: 'file:///tmp/search' } }, 'searxng.url must use HTTP or HTTPS'],
    [{ searxng: { url: 'https://user:secret@example.com' } }, 'searxng.url must not contain credentials'],
    [{ crawl4ai: { url: 'https://example.com?token=secret' } }, 'crawl4ai.url must not contain a query or fragment'],
    [{ searxng: { safeSearch: 3 } }, 'searxng.safeSearch must be 0, 1, or 2'],
    [{ crawl4ai: { maxContentChars: 0 } }, 'crawl4ai.maxContentChars must be a positive integer'],
    [{ crawl4ai: { apiKeyEnv: 'NOT VALID' } }, 'invalid environment variable name'],
    [{ searxng: { authHeader: 'bad\nheader' } }, 'invalid authentication header'],
    [{ searxng: { authHeader: 'Content-Type' } }, 'authentication header "Content-Type" is reserved'],
    [{ searxng: { apiKey: 'bad\nkey' } }, 'authentication value is not a valid HTTP header value'],
  ] as const)('rejects invalid local configuration %#', (config, message) => {
    expect(() => resolveConfig(config, {})).toThrow(message)
  })
})
