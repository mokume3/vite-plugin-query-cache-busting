const HASH_PLACEHOLDER_RE = /\[hash(?::\d+)?\]/

export interface OutputFileNames {
  entryFileNames: string
  chunkFileNames: string
  assetFileNames: string
}

export interface FileNamesDecision {
  /** Patterns the plugin sets (excludes keys the user explicitly configured) */
  patch: Partial<OutputFileNames>
  /** User-configured pattern keys that contain [hash] */
  hashed: string[]
  /** Keys configured as a function, which can't be statically verified */
  unverifiable: string[]
}

const FILE_NAME_KEYS = ['entryFileNames', 'chunkFileNames', 'assetFileNames'] as const

/** Whether the pattern contains a content-hash placeholder */
export function containsHashPlaceholder(pattern: string): boolean {
  return HASH_PLACEHOLDER_RE.test(pattern)
}

/** Builds hash-free output filename patterns */
export function buildFileNames(assetsDir: string): OutputFileNames {
  const prefix = assetsDir === '' ? '' : `${assetsDir}/`

  return {
    entryFileNames: `${prefix}[name].js`,
    chunkFileNames: `${prefix}[name].js`,
    assetFileNames: `${prefix}[name].[ext]`,
  }
}

/**
 * Looks at the user's output config and returns the patterns the plugin should fill in,
 * along with the inspection results. Keys the user explicitly configured are respected and never overwritten.
 */
export function decideFileNames(
  userOutput: Record<string, unknown>,
  assetsDir: string,
): FileNamesDecision {
  const defaults = buildFileNames(assetsDir)
  const patch: Partial<OutputFileNames> = {}
  const hashed: string[] = []
  const unverifiable: string[] = []

  for (const key of FILE_NAME_KEYS) {
    const value = userOutput[key]

    if (value === undefined) {
      patch[key] = defaults[key]
      continue
    }

    if (typeof value === 'string') {
      if (containsHashPlaceholder(value)) hashed.push(key)
      continue
    }

    unverifiable.push(key)
  }

  return { patch, hashed, unverifiable }
}
