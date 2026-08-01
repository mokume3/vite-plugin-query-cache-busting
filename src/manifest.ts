import { appendQuery } from './url'

const PATH_ARRAY_FIELDS = ['css', 'assets'] as const

/**
 * Appends a query to file paths in Vite's manifest.
 * imports / dynamicImports are manifest keys, not paths, so they're left untouched.
 */
export function rewriteManifest(source: string, query: string): string {
  const manifest = JSON.parse(source) as Record<string, Record<string, unknown>>

  for (const entry of Object.values(manifest)) {
    if (typeof entry.file === 'string') {
      entry.file = appendQuery(entry.file, query)
    }

    for (const field of PATH_ARRAY_FIELDS) {
      const value = entry[field]
      if (!Array.isArray(value)) continue

      entry[field] = value.map((item) =>
        typeof item === 'string' ? appendQuery(item, query) : item,
      )
    }
  }

  return JSON.stringify(manifest, null, 2)
}

/**
 * Appends a query to each value (an array of URLs) in ssr-manifest.json.
 * Keys are module IDs (internal IDs that may contain a NUL character), not paths, so they're left untouched.
 */
export function rewriteSsrManifest(source: string, query: string): string {
  const manifest = JSON.parse(source) as Record<string, unknown>

  for (const key of Object.keys(manifest)) {
    const value = manifest[key]
    if (!Array.isArray(value)) continue

    manifest[key] = value.map((item) =>
      typeof item === 'string' ? appendQuery(item, query) : item,
    )
  }

  return JSON.stringify(manifest, null, 2)
}
