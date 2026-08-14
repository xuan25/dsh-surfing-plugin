import { afterEach, describe, expect, it, vi } from 'vitest'
import { Crawl4aiFetchProvider, resolveConfig } from '../src/index.ts'
import type { Crawl4aiConfig } from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function provider(config: Crawl4aiConfig = {}): Crawl4aiFetchProvider {
  return new Crawl4aiFetchProvider(resolveConfig({
    crawl4ai: { url: 'http://127.0.0.1:11235', ...config },
  }, {}).crawl4ai)
}

describe('Crawl4aiFetchProvider', () => {
  it('sends a minimal crawl request and maps target status, redirect, and raw markdown', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      results: [{
        url: 'https://example.com/start',
        redirected_url: 'https://example.com/final',
        success: true,
        status_code: 200,
        markdown: {
          raw_markdown: '# Full page',
          fit_markdown: '# Main content',
          markdown_with_citations: '# Full page\n\n[1]: https://example.com',
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await provider({ apiKey: 'crawl-secret' }).fetch({ url: 'https://example.com/start' })

    expect(result).toEqual({
      url: 'https://example.com/final',
      statusCode: 200,
      body: { kind: 'text', content: '# Full page' },
      truncated: false,
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:11235/crawl')
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer crawl-secret')
    expect(JSON.parse(init?.body as string)).toEqual({ urls: ['https://example.com/start'] })
  })

  it('prefers fit markdown and caps decoded content', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      results: [{
        url: 'https://example.com',
        success: true,
        status_code: 404,
        markdown: { raw_markdown: 'raw body', fit_markdown: '123456789' },
      }],
    }), { status: 200 })))

    const result = await provider({ markdownMode: 'fit', maxContentChars: 5 }).fetch({
      url: 'https://example.com',
    })

    expect(result).toMatchObject({
      statusCode: 404,
      body: { kind: 'text', content: '12345' },
      truncated: true,
    })
  })

  it('falls back to raw markdown when fit output is empty', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      results: [{
        url: 'https://example.com',
        success: true,
        status_code: 200,
        markdown: { raw_markdown: 'raw fallback', fit_markdown: '' },
      }],
    }), { status: 200 })))

    await expect(provider({ markdownMode: 'fit' }).fetch({ url: 'https://example.com' })).resolves.toMatchObject({
      body: { kind: 'text', content: 'raw fallback' },
    })
  })

  it('supports older string markdown and HTML-only responses', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        results: [{ url: 'https://example.com', success: true, status_code: 200, markdown: 'legacy markdown' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        results: [{ url: 'https://example.com', success: true, status_code: 200, cleaned_html: '<main>Hello</main>' }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const fetchProvider = provider()

    await expect(fetchProvider.fetch({ url: 'https://example.com' })).resolves.toMatchObject({
      body: { kind: 'text', content: 'legacy markdown' },
    })
    await expect(fetchProvider.fetch({ url: 'https://example.com' })).resolves.toMatchObject({
      body: { kind: 'html', content: '<main>Hello</main>' },
    })
  })

  it('returns target non-2xx status and throws for Crawl4AI execution failures', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      results: [{
        url: 'https://example.com',
        success: false,
        status_code: 502,
        error_message: 'browser crashed',
      }],
    }), { status: 200 })))

    await expect(provider().fetch({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'browser crashed',
    })
  })

  it('rejects unsafe target schemes before making a backend request', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().fetch({ url: 'file:///etc/passwd' })).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid target status from the external response', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      results: [{ url: 'https://example.com', success: true, markdown: '# Missing status' }],
    }), { status: 200 })))

    await expect(provider().fetch({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Crawl4AI result does not contain a valid target status code',
    })
  })

  it('maps transport cancellation to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    await expect(provider().fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('is unavailable without an endpoint', async () => {
    const fetchProvider = new Crawl4aiFetchProvider(resolveConfig({}, {}).crawl4ai)
    expect(fetchProvider.available()).toBe(false)
    await expect(fetchProvider.fetch({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
    })
  })
})
