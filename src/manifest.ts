import { appendQuery } from './url'

const PATH_ARRAY_FIELDS = ['css', 'assets'] as const

/**
 * Vite の manifest 内のファイルパスに query を付与する。
 * imports / dynamicImports は manifest のキーでありパスではないため書き換えない。
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
