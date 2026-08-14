/**
 * SearXNG search and Crawl4AI fetch providers for DeepSeek Harness.
 * @module dsh-surfing-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import {
  CRAWL4AI_API_KEY_ENV,
  CRAWL4AI_URL_ENV,
  DEFAULT_MAX_CONTENT_CHARS,
  resolveConfig,
  SEARXNG_API_KEY_ENV,
  SEARXNG_URL_ENV,
} from './config.ts'
import type { Config as PluginConfig, Crawl4aiConfig, SearxngConfig } from './config.ts'
import { CRAWL4AI_PROVIDER_ID, Crawl4aiFetchProvider } from './crawl4ai.ts'
import { SEARXNG_PROVIDER_ID, SearxngSearchProvider } from './searxng.ts'

export {
  CRAWL4AI_API_KEY_ENV,
  CRAWL4AI_PROVIDER_ID,
  CRAWL4AI_URL_ENV,
  Crawl4aiFetchProvider,
  DEFAULT_MAX_CONTENT_CHARS,
  resolveConfig,
  SEARXNG_API_KEY_ENV,
  SEARXNG_PROVIDER_ID,
  SEARXNG_URL_ENV,
  SearxngSearchProvider,
}
export type {
  AuthenticationConfig,
  Crawl4aiConfig,
  ResolvedAuthentication,
  ResolvedConfig,
  ResolvedCrawl4aiConfig,
  ResolvedSearxngConfig,
  SearxngConfig,
} from './config.ts'

/** Public plugin configuration type. */
export type Config = PluginConfig

/** Cordis plugin name used by loader diagnostics. */
export const name = 'surfing-plugin'

/** Service required for provider registration. */
export const inject = ['web']

const authenticationSchema = {
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  authHeader: z.string(),
  authScheme: z.string(),
}

const searxngSchema: z<SearxngConfig> = z.object({
  url: z.string(),
  ...authenticationSchema,
  language: z.string(),
  categories: z.string(),
  safeSearch: z.number().step(1).min(0).max(2),
  timeRange: z.union(['day', 'month', 'year'] as const),
})

const crawl4aiSchema: z<Crawl4aiConfig> = z.object({
  url: z.string(),
  ...authenticationSchema,
  markdownMode: z.union(['raw', 'fit', 'citations'] as const).default('raw'),
  maxContentChars: z.number().step(1).min(1).default(DEFAULT_MAX_CONTENT_CHARS),
})

/** Plugin schema; omitted backend URLs resolve from their documented environment variables. */
export const Config: z<PluginConfig> = z.object({
  searxng: searxngSchema.default({}),
  crawl4ai: crawl4aiSchema.default({}),
})

/**
 * Register both providers into `ctx.web`; registrations are disposed with the plugin fiber.
 *
 * @param ctx - Cordis context supplying the web provider registry.
 * @param config - plugin configuration after schema defaults.
 */
export function apply(ctx: Context, config: PluginConfig = {}): void {
  const resolved = resolveConfig(config)
  ctx.web.registerSearchProvider(new SearxngSearchProvider(resolved.searxng))
  ctx.web.registerFetchProvider(new Crawl4aiFetchProvider(resolved.crawl4ai))
}
