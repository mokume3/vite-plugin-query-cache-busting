const EXTERNAL_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/**
 * URL にクエリ文字列を付与する。
 * 外部 URL・data:・blob: は対象外。ハッシュフラグメントの手前に挿入する。
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

/** key と version からクエリ文字列を組み立てる */
export function buildQuery(key: string | false, version: string): string {
  const encodedVersion = encodeURIComponent(version)
  return key === false ? encodedVersion : `${encodeURIComponent(key)}=${encodedVersion}`
}

/** base と出力ファイル名を結合する（Vite 内部の joinUrlSegments 相当） */
export function joinUrlSegments(base: string, path: string): string {
  if (base === '' || path === '') return base + path

  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const prefixedPath = path.startsWith('/') ? path : `/${path}`

  return trimmedBase + prefixedPath
}
