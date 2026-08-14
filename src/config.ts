/** Configuration resolution for the SearXNG and Crawl4AI providers. */

/** Environment variable used for the SearXNG endpoint. */
export const SEARXNG_URL_ENV = 'SEARXNG_URL'

/** Environment variable used for an optional SearXNG proxy credential. */
export const SEARXNG_API_KEY_ENV = 'SEARXNG_API_KEY'

/** Environment variable used for the Crawl4AI endpoint. */
export const CRAWL4AI_URL_ENV = 'CRAWL4AI_URL'

/** Crawl4AI's standard server token environment variable. */
export const CRAWL4AI_API_KEY_ENV = 'CRAWL4AI_API_TOKEN'

/** Default cap on decoded Crawl4AI content. */
export const DEFAULT_MAX_CONTENT_CHARS = 100_000

/** Optional authentication shared by both backend configurations. */
export interface AuthenticationConfig {
  /** Literal key. Prefer `apiKeyEnv` so a credential does not enter a config file. */
  readonly apiKey?: string
  /** Environment variable containing the key. */
  readonly apiKeyEnv?: string
  /** HTTP header carrying the key. Defaults to `Authorization`. */
  readonly authHeader?: string
  /** Prefix before the key. Defaults to `Bearer`; an empty string sends the key directly. */
  readonly authScheme?: string
}

/** SearXNG search request configuration. */
export interface SearxngConfig extends AuthenticationConfig {
  /** Server base URL or complete `/search` endpoint. Falls back to `$SEARXNG_URL`. */
  readonly url?: string
  /** Optional SearXNG `language` request parameter. */
  readonly language?: string
  /** Optional comma-separated SearXNG `categories` request parameter. */
  readonly categories?: string
  /** Optional SearXNG safe-search level: 0, 1, or 2. */
  readonly safeSearch?: number
  /** Optional SearXNG time range. */
  readonly timeRange?: 'day' | 'month' | 'year'
}

/** Crawl4AI response selection and request configuration. */
export interface Crawl4aiConfig extends AuthenticationConfig {
  /** Server base URL or complete `/crawl` endpoint. Falls back to `$CRAWL4AI_URL`. */
  readonly url?: string
  /** Markdown field to prefer from Crawl4AI. Defaults to `raw`. */
  readonly markdownMode?: 'raw' | 'fit' | 'citations'
  /** Maximum decoded content characters. Defaults to 100000. */
  readonly maxContentChars?: number
}

/** Cordis plugin configuration. */
export interface Config {
  /** SearXNG provider configuration. */
  readonly searxng?: SearxngConfig
  /** Crawl4AI provider configuration. */
  readonly crawl4ai?: Crawl4aiConfig
}

/** Authentication after literal and environment values have been resolved. */
export interface ResolvedAuthentication {
  /** Resolved credential, if configured. */
  readonly apiKey?: string
  /** Validated HTTP header name. */
  readonly authHeader: string
  /** Trimmed authentication scheme; empty sends the key directly. */
  readonly authScheme: string
}

/** Complete SearXNG provider options. */
export interface ResolvedSearxngConfig extends ResolvedAuthentication {
  /** Normalized `/search` endpoint, or undefined when the provider is not configured. */
  readonly endpoint?: string
  readonly language?: string
  readonly categories?: string
  readonly safeSearch?: number
  readonly timeRange?: 'day' | 'month' | 'year'
}

/** Complete Crawl4AI provider options. */
export interface ResolvedCrawl4aiConfig extends ResolvedAuthentication {
  /** Normalized `/crawl` endpoint, or undefined when the provider is not configured. */
  readonly endpoint?: string
  readonly markdownMode: 'raw' | 'fit' | 'citations'
  readonly maxContentChars: number
}

/** Complete options used by both registered providers. */
export interface ResolvedConfig {
  readonly searxng: ResolvedSearxngConfig
  readonly crawl4ai: ResolvedCrawl4aiConfig
}

/**
 * Resolve explicit config over environment fallbacks and validate every local value.
 *
 * @param config - plugin configuration supplied by Cordis.
 * @param environment - environment source; injectable for deterministic tests.
 * @returns validated options for both providers.
 */
export function resolveConfig(
  config: Config = {},
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedConfig {
  const searxng = config.searxng ?? {}
  const crawl4ai = config.crawl4ai ?? {}

  assertSafeSearch(searxng.safeSearch)
  assertPositiveInteger('crawl4ai.maxContentChars', crawl4ai.maxContentChars)

  return {
    searxng: {
      ...resolveAuthentication(searxng, SEARXNG_API_KEY_ENV, environment),
      ...resolveEndpoint(searxng.url, environment[SEARXNG_URL_ENV], 'search', 'searxng.url'),
      ...optionalNonBlank('language', searxng.language),
      ...optionalNonBlank('categories', searxng.categories),
      ...searxng.safeSearch === undefined ? {} : { safeSearch: searxng.safeSearch },
      ...searxng.timeRange === undefined ? {} : { timeRange: searxng.timeRange },
    },
    crawl4ai: {
      ...resolveAuthentication(crawl4ai, CRAWL4AI_API_KEY_ENV, environment),
      ...resolveEndpoint(crawl4ai.url, environment[CRAWL4AI_URL_ENV], 'crawl', 'crawl4ai.url'),
      markdownMode: crawl4ai.markdownMode ?? 'raw',
      maxContentChars: crawl4ai.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
    },
  }
}

/** Resolve one optional authentication block. */
function resolveAuthentication(
  config: AuthenticationConfig,
  defaultApiKeyEnv: string,
  environment: Readonly<Record<string, string | undefined>>,
): ResolvedAuthentication {
  const apiKeyEnv = nonBlank(config.apiKeyEnv) ?? defaultApiKeyEnv
  assertEnvironmentName(apiKeyEnv)
  const apiKey = nonBlank(config.apiKey) ?? nonBlank(environment[apiKeyEnv])
  const authHeader = nonBlank(config.authHeader) ?? 'Authorization'
  assertHeaderName(authHeader)
  const authScheme = config.authScheme?.trim() ?? 'Bearer'
  if (apiKey !== undefined) assertAuthenticationValue(authHeader, authScheme, apiKey)
  return {
    ...apiKey === undefined ? {} : { apiKey },
    authHeader,
    authScheme,
  }
}

/** Normalize a base URL into the provider operation endpoint. */
function resolveEndpoint(
  explicit: string | undefined,
  fallback: string | undefined,
  operation: 'search' | 'crawl',
  field: string,
): { readonly endpoint?: string } {
  const value = nonBlank(explicit) ?? nonBlank(fallback)
  if (value === undefined) return {}

  let url: URL
  try {
    url = new URL(value)
  } catch (error: unknown) {
    throw new Error(`surfing-plugin: ${field} must be an absolute HTTP(S) URL`, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`surfing-plugin: ${field} must use HTTP or HTTPS`)
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`surfing-plugin: ${field} must not contain credentials`)
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`surfing-plugin: ${field} must not contain a query or fragment`)
  }

  const suffix = `/${operation}`
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith(suffix) ? pathname : `${pathname}${suffix}`
  return { endpoint: url.toString() }
}

/** Include a trimmed non-empty string under the requested key. */
function optionalNonBlank<K extends 'language' | 'categories'>(
  key: K,
  value: string | undefined,
): { readonly [P in K]?: string } {
  const resolved = nonBlank(value)
  return resolved === undefined ? {} : { [key]: resolved } as { readonly [P in K]?: string }
}

/** Return a trimmed non-empty value. */
function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

/** Validate an environment variable reference. */
function assertEnvironmentName(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`surfing-plugin: invalid environment variable name ${JSON.stringify(value)}`)
  }
}

/** Validate a configurable HTTP header without sending a request. */
function assertHeaderName(value: string): void {
  if (['accept', 'content-type', 'user-agent'].includes(value.toLowerCase())) {
    throw new Error(`surfing-plugin: authentication header ${JSON.stringify(value)} is reserved`)
  }
  try {
    const headers = new Headers()
    headers.set(value, 'value')
  } catch (error: unknown) {
    throw new Error(`surfing-plugin: invalid authentication header ${JSON.stringify(value)}`, { cause: error })
  }
}

/** Validate the complete authentication value without including the secret in diagnostics. */
function assertAuthenticationValue(header: string, scheme: string, apiKey: string): void {
  const value = scheme.length > 0 ? `${scheme} ${apiKey}` : apiKey
  try {
    const headers = new Headers()
    headers.set(header, value)
  } catch (error: unknown) {
    throw new Error('surfing-plugin: authentication value is not a valid HTTP header value', { cause: error })
  }
}

/** Validate SearXNG's three supported safe-search levels. */
function assertSafeSearch(value: number | undefined): void {
  if (value !== undefined && value !== 0 && value !== 1 && value !== 2) {
    throw new Error('surfing-plugin: searxng.safeSearch must be 0, 1, or 2')
  }
}

/** Validate an optional positive whole-number limit. */
function assertPositiveInteger(field: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new Error(`surfing-plugin: ${field} must be a positive integer`)
  }
}
