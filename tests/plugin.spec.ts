import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  Config,
  CRAWL4AI_PROVIDER_ID,
  inject,
  name,
  SEARXNG_PROVIDER_ID,
} from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('plugin registration', () => {
  it('runs both providers through the real DSH web service and disposes their registrations', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ url: 'https://search-result.example', title: 'Result' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        results: [{
          url: 'https://target.example',
          success: true,
          status_code: 200,
          markdown: '# Target',
        }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const ctx = new Context()
    await ctx.plugin(WebRuntime, {
      searchProvider: SEARXNG_PROVIDER_ID,
      fetchProvider: CRAWL4AI_PROVIDER_ID,
    })
    const fiber = ctx.plugin({ name, inject, Config, apply }, {
      searxng: { url: 'http://127.0.0.1:8080' },
      crawl4ai: { url: 'http://127.0.0.1:11235' },
    })
    await fiber

    await expect(ctx.web.search({ query: 'test', maxResults: 8 })).resolves.toMatchObject({
      sources: [{ url: 'https://search-result.example', title: 'Result' }],
    })
    await expect(ctx.web.fetch({ url: 'https://target.example' })).resolves.toMatchObject({
      statusCode: 200,
      body: { kind: 'text', content: '# Target' },
    })

    await fiber.dispose()
    await expect(ctx.web.search({ query: 'test' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CONFIGURED_MISSING',
    })
  })
})
