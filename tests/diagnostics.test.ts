import { describe, expect, test } from 'vitest'

import { diagnostics } from '../src/diagnostics'

describe('diagnostics', () => {
  test('静的な why/fix を持つコードは引数無しで呼べる', () => {
    const diagnostic = diagnostics.QCB_LIB_MODE()

    expect(diagnostic.name).toBe('QCB_LIB_MODE')
    expect(diagnostic.message).toBe('Library mode (build.lib) is not supported: build.lib is set')
    expect(diagnostic.fix).toBe(
      "Adding a query to import specifiers in the distributed output would break the consumer's bundler or Node's module resolution. Remove this plugin from plugins for library builds.",
    )
  })

  test('関数の why はパラメータを埋め込む', () => {
    const diagnostic = diagnostics.QCB_VITE_TOO_OLD({ viteMajor: 7 })

    expect(diagnostic.message).toBe('Vite 8 or later is required (detected: 7)')
  })

  test('paths 配列を渡すコードは読点で連結する', () => {
    const diagnostic = diagnostics.QCB_HASHED_FILENAME_PATTERN({
      paths: [
        'build.rollupOptions.output.entryFileNames',
        'worker.rolldownOptions.output.chunkFileNames',
      ],
    })

    expect(diagnostic.message).toBe(
      'The output filename pattern contains [hash]: build.rollupOptions.output.entryFileNames, worker.rolldownOptions.output.chunkFileNames',
    )
  })

  test('sources を呼び出し時に渡すと Diagnostic に反映される', () => {
    const diagnostic = diagnostics.QCB_MISSING_QUERY({
      count: 2,
      sources: ['assets/index.js:1:2043', 'assets/manifest.json:1:88'],
    })

    expect(diagnostic.message).toBe('2 reference(s) are missing the query')
    expect(diagnostic.sources).toEqual(['assets/index.js:1:2043', 'assets/manifest.json:1:88'])
  })

  test('docsBase を設定していないので docs は undefined', () => {
    expect(diagnostics.QCB_LIB_MODE().docs).toBeUndefined()
  })
})
