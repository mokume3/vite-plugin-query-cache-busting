import { describe, expect, test } from 'vitest'

import { diagnostics } from '../src/diagnostics'

describe('diagnostics', () => {
  test('静的な why/fix を持つコードは引数無しで呼べる', () => {
    const diagnostic = diagnostics.QCB_LIB_MODE()

    expect(diagnostic.name).toBe('QCB_LIB_MODE')
    expect(diagnostic.message).toBe(
      'ライブラリモード（build.lib）には対応していません: build.lib が設定されています',
    )
    expect(diagnostic.fix).toBe(
      '配布物の import 指定子に query が付くと、利用側のバンドラや Node のモジュール解決が壊れるためです。ライブラリのビルドでは plugins からこのプラグインを外してください。',
    )
  })

  test('関数の why はパラメータを埋め込む', () => {
    const diagnostic = diagnostics.QCB_VITE_TOO_OLD({ viteMajor: 7 })

    expect(diagnostic.message).toBe('Vite 8 以上が必要です（検出: 7）')
  })

  test('paths 配列を渡すコードは読点で連結する', () => {
    const diagnostic = diagnostics.QCB_HASHED_FILENAME_PATTERN({
      paths: [
        'build.rollupOptions.output.entryFileNames',
        'worker.rolldownOptions.output.chunkFileNames',
      ],
    })

    expect(diagnostic.message).toBe(
      '出力ファイル名パターンに [hash] が含まれています: build.rollupOptions.output.entryFileNames、worker.rolldownOptions.output.chunkFileNames',
    )
  })

  test('sources を呼び出し時に渡すと Diagnostic に反映される', () => {
    const diagnostic = diagnostics.QCB_MISSING_QUERY({
      count: 2,
      sources: ['assets/index.js:1:2043', 'assets/manifest.json:1:88'],
    })

    expect(diagnostic.message).toBe('query 未付与の参照が 2 件あります')
    expect(diagnostic.sources).toEqual(['assets/index.js:1:2043', 'assets/manifest.json:1:88'])
  })

  test('docsBase を設定していないので docs は undefined', () => {
    expect(diagnostics.QCB_LIB_MODE().docs).toBeUndefined()
  })
})
