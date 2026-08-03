const EXTERNAL_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
const DATA_OR_BLOB_URL_RE = /^(?:data|blob):/i

/**
 * Characters that terminate a URL query string in built output.
 * Built URLs live inside JS string literals, CSS url(), and HTML attributes.
 */
const QUERY_END_RE = /["'`\s#<>()]/

/**
 * Separates query components.
 * Vite HTML-escapes '&' as '&amp;' inside HTML attributes, so both spellings
 * must be accepted when scanning built output.
 */
const QUERY_SEPARATOR_RE = /&(?:amp;)?/

/** Inserts a query before any hash fragment, choosing '&' when the URL already has one */
function insertQuery(url: string, query: string): string {
  const hashIndex = url.indexOf('#')
  const pathname = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const separator = pathname.includes('?') ? '&' : '?'

  return `${pathname}${separator}${query}${hash}`
}

/**
 * Appends a query string to a URL.
 * External URLs, data:, and blob: are excluded. Inserted before any hash fragment.
 */
export function appendQuery(url: string, query: string): string {
  if (query === '' || EXTERNAL_URL_RE.test(url)) return url
  return insertQuery(url, query)
}

/**
 * Appends a query to a URL pointing at an asset emitted by this plugin.
 * Unlike appendQuery, http/https and protocol-relative URLs are also included (for a CDN base).
 * Only data: and blob: are excluded. Inserted before any hash fragment.
 */
export function appendQueryToBuiltUrl(url: string, query: string): string {
  if (query === '' || DATA_OR_BLOB_URL_RE.test(url)) return url
  return insertQuery(url, query)
}

const EXTRA_ENCODE_RE = /[!~*'()]/g

/**
 * Percent-encodes a query component.
 * encodeURIComponent leaves !~*'() unescaped, but those collide with the delimiters
 * used when scanning built output, so they are encoded here as well.
 */
function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(
    EXTRA_ENCODE_RE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** Builds the query string from key and version */
export function buildQuery(key: string | false, version: string): string {
  const encodedVersion = encodeQueryComponent(version)
  return key === false ? encodedVersion : `${encodeQueryComponent(key)}=${encodedVersion}`
}

/**
 * Whether the query string starting at `index` carries `query` as a complete parameter.
 * `index` must point at the character right after the pathname.
 * Both separators are accepted, since insertQuery joins with '&' when the URL already has a query.
 */
export function hasQueryParam(text: string, index: number, query: string): boolean {
  if (query === '') return false
  if (text[index] !== '?') return false

  let end = index + 1
  while (end < text.length && !QUERY_END_RE.test(text[end] ?? '')) end += 1

  return text
    .slice(index + 1, end)
    .split(QUERY_SEPARATOR_RE)
    .includes(query)
}

/** Joins base and an output filename (equivalent to Vite's internal joinUrlSegments) */
export function joinUrlSegments(base: string, path: string): string {
  if (base === '' || path === '') return base + path

  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const prefixedPath = path.startsWith('/') ? path : `/${path}`

  return trimmedBase + prefixedPath
}
