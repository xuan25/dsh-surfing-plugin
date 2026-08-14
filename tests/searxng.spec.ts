import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig, SearxngSearchProvider } from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SearxngSearchProvider', () => {
  it('sends search options and maps, deduplicates, filters, and caps results', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      answers: ['Direct answer'],
      results: [
        {
          url: 'https://one.example/article',
          title: 'One',
          content: 'First result',
          publishedDate: '2026-08-14T08:30:00+08:00',
        },
        { url: 'https://one.example/article', title: 'Duplicate' },
        { url: 'javascript:alert(1)', title: 'Invalid scheme' },
        { url: 'https://two.example/', content: 'Second result' },
        { url: 'https://three.example/', title: 'Three' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { searxng } = resolveConfig({
      searxng: {
        url: 'https://search.example',
        apiKey: 'secret',
        authHeader: 'X-API-Key',
        authScheme: '',
        language: 'zh-CN',
        categories: 'general,news',
        safeSearch: 1,
        timeRange: 'day',
      },
    }, {})
    const provider = new SearxngSearchProvider(searxng)
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 2 })

    expect(provider.available()).toBe(true)
    expect(result).toEqual({
      content: 'Direct answer',
      sources: [
        {
          url: 'https://one.example/article',
          title: 'One',
          snippet: 'First result',
          publishedAt: '2026-08-14T00:30:00.000Z',
        },
        { url: 'https://two.example/', snippet: 'Second result' },
      ],
      truncated: true,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://search.example/search')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    const headers = new Headers(init?.headers)
    expect(headers.get('x-api-key')).toBe('secret')
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    const body = init?.body as URLSearchParams
    expect(Object.fromEntries(body)).toEqual({
      q: 'DeepSeek Harness',
      format: 'json',
      language: 'zh-CN',
      categories: 'general,news',
      safesearch: '1',
      time_range: 'day',
    })
  })

  it('does not send an authentication header when no key is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"results":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { searxng } = resolveConfig({ searxng: { url: 'http://127.0.0.1:8080' } }, {})

    await new SearxngSearchProvider(searxng).search({ query: 'test' })

    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers)
    expect(headers.has('authorization')).toBe(false)
  })

  it('is unavailable without an endpoint and fails descriptively if called directly', async () => {
    const provider = new SearxngSearchProvider(resolveConfig({}, {}).searxng)
    expect(provider.available()).toBe(false)
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
    })
  })

  it('surfaces backend errors without exposing an unbounded response', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'JSON output is disabled' }),
      { status: 403 },
    )))
    const provider = new SearxngSearchProvider(resolveConfig({
      searxng: { url: 'https://search.example' },
    }, {}).searxng)

    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'SearXNG API error: JSON output is disabled',
    })
  })

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{"items":[]}', { status: 200 })))
    const provider = new SearxngSearchProvider(resolveConfig({
      searxng: { url: 'https://search.example' },
    }, {}).searxng)

    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'SearXNG response does not contain a results array',
    })
  })

  it('maps transport cancellation to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    const provider = new SearxngSearchProvider(resolveConfig({
      searxng: { url: 'https://search.example' },
    }, {}).searxng)

    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })
})
