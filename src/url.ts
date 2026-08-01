const EXTERNAL_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
const DATA_OR_BLOB_URL_RE = /^(?:data|blob):/i

/**
 * Appends a query string to a URL.
 * External URLs, data:, and blob: are excluded. Inserted before any hash fragment.
 */
export function appendQuery(url: string, query: string): string {
  if (query === '') return url
  if (EXTERNAL_URL_RE.test(url)) return url

  const hashIndex = url.indexOf('#')
  const pathname = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const separator = pathname.includes('?') ? '&' : '?'

  return `${pathname}${separator}${query}${hash}`
}

/**
 * Appends a query to a URL pointing at an asset emitted by this plugin.
 * Unlike appendQuery, http/https and protocol-relative URLs are also included (for a CDN base).
 * Only data: and blob: are excluded. Inserted before any hash fragment.
 */
export function appendQueryToBuiltUrl(url: string, query: string): string {
  if (query === '') return url
  if (DATA_OR_BLOB_URL_RE.test(url)) return url

  const hashIndex = url.indexOf('#')
  const pathname = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const separator = pathname.includes('?') ? '&' : '?'

  return `${pathname}${separator}${query}${hash}`
}

/** Builds the query string from key and version */
export function buildQuery(key: string | false, version: string): string {
  const encodedVersion = encodeURIComponent(version)
  return key === false ? encodedVersion : `${encodeURIComponent(key)}=${encodedVersion}`
}

/** Joins base and an output filename (equivalent to Vite's internal joinUrlSegments) */
export function joinUrlSegments(base: string, path: string): string {
  if (base === '' || path === '') return base + path

  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const prefixedPath = path.startsWith('/') ? path : `/${path}`

  return trimmedBase + prefixedPath
}
