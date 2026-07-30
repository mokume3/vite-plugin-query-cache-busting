const HASH_PLACEHOLDER_RE = /\[hash(?::\d+)?\]/

export interface OutputFileNames {
  entryFileNames: string
  chunkFileNames: string
  assetFileNames: string
}

export interface FileNamesDecision {
  /** プラグインが設定するパターン（利用者が明示指定したキーは含まない） */
  patch: Partial<OutputFileNames>
  /** 利用者が指定したパターンのうち [hash] を含むキー */
  hashed: string[]
  /** 関数で指定されていて静的に検証できないキー */
  unverifiable: string[]
}

const FILE_NAME_KEYS = ['entryFileNames', 'chunkFileNames', 'assetFileNames'] as const

/** パターンにコンテンツハッシュのプレースホルダが含まれるか */
export function containsHashPlaceholder(pattern: string): boolean {
  return HASH_PLACEHOLDER_RE.test(pattern)
}

/** ハッシュを含まない出力ファイル名パターンを組み立てる */
export function buildFileNames(assetsDir: string): OutputFileNames {
  const prefix = assetsDir === '' ? '' : `${assetsDir}/`

  return {
    entryFileNames: `${prefix}[name].js`,
    chunkFileNames: `${prefix}[name].js`,
    assetFileNames: `${prefix}[name].[ext]`,
  }
}

/**
 * 利用者の output 設定を見て、プラグインが補うパターンと検査結果を返す。
 * 利用者が明示指定したキーは尊重し、上書きしない。
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
