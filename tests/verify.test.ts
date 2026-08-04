import { describe, expect, test } from 'vitest'

import { findMissingQuery, isScannableFile, isTrackedName } from '../src/verify'

describe('isScannableFile', () => {
  test('js / css / html は走査対象', () => {
    expect(isScannableFile('assets/a.js')).toBe(true)
    expect(isScannableFile('assets/a.css')).toBe(true)
    expect(isScannableFile('index.html')).toBe(true)
  })

  test('map / json / 画像は走査対象外', () => {
    expect(isScannableFile('assets/a.js.map')).toBe(false)
    expect(isScannableFile('.vite/manifest.json')).toBe(false)
    expect(isScannableFile('assets/logo.svg')).toBe(false)
  })
})

describe('isTrackedName', () => {
  test('sourcemap は参照名として追跡しない', () => {
    expect(isTrackedName('assets/a.js.map')).toBe(false)
  })

  test('それ以外は追跡する', () => {
    expect(isTrackedName('assets/a.js')).toBe(true)
    expect(isTrackedName('assets/logo.svg')).toBe(true)
  })
})

describe('findMissingQuery', () => {
  test('query が付いていれば検出しない', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js?v=1"></script>' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toEqual([])
  })

  test('query が付いていなければ検出する', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js"></script>' }]
    const findings = findMissingQuery(files, ['assets/a.js'], 'v=1')

    expect(findings).toHaveLength(1)
    expect(findings[0]?.file).toBe('index.html')
    expect(findings[0]?.reference).toBe('assets/a.js')
    expect(findings[0]?.line).toBe(1)
    expect(findings[0]?.column).toBe(15)
  })

  test('別のバージョンの query は検出する', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js?v=0"></script>' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toHaveLength(1)
  })

  test('より長いファイル名の一部に一致しても検出しない', () => {
    const files = [{ fileName: 'assets/a.js', content: '//# sourceMappingURL=a.js.map' }]
    expect(findMissingQuery(files, ['assets/a.js', 'a.js'], 'v=1')).toEqual([])
  })

  test('名前文字が直前にある場合は参照とみなさない', () => {
    const files = [{ fileName: 'assets/a.js', content: 'const x = "xassets/a.js"' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toEqual([])
  })

  test('画像アセットの参照も検出する', () => {
    const files = [{ fileName: 'assets/a.css', content: '.x{background:url(/assets/logo.svg)}' }]
    expect(findMissingQuery(files, ['assets/logo.svg'], 'v=1')).toHaveLength(1)
  })

  test('sourcemap ファイルは走査しない', () => {
    const files = [{ fileName: 'assets/a.js.map', content: '{"sources":["/assets/a.js"]}' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toEqual([])
  })

  test('行番号と桁番号を複数行で正しく計算する', () => {
    const files = [{ fileName: 'index.html', content: 'line1\n<link href="/assets/a.css">' }]
    const findings = findMissingQuery(files, ['assets/a.css'], 'v=1')

    expect(findings[0]?.line).toBe(2)
    expect(findings[0]?.column).toBe(14)
  })

  test('assetsDir: "" によるコメント行内の偶然の一致は検出しない', () => {
    const files = [
      {
        fileName: 'assets/index.js',
        content: '//#region tests/fixtures/basic/src/logo.svg\nconsole.log(1)',
      },
    ]
    expect(findMissingQuery(files, ['logo.svg'], 'v=1')).toEqual([])
  })

  test('引き続き検出する: <script src="...">', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js"></script>' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toHaveLength(1)
  })

  test('引き続き検出する: url(...) （( が区切り）', () => {
    const files = [{ fileName: 'assets/a.css', content: '.x{background:url(/assets/logo.svg)}' }]
    expect(findMissingQuery(files, ['assets/logo.svg'], 'v=1')).toHaveLength(1)
  })

  test('引き続き検出する: 配列リテラル内の文字列（" が区切り）', () => {
    const files = [{ fileName: 'assets/a.js', content: 'm.f=["/assets/lazy.js"]' }]
    expect(findMissingQuery(files, ['assets/lazy.js'], 'v=1')).toHaveLength(1)
  })

  test('CDN の絶対 URL（コロンを含む）を検出する（検出漏れの回帰テスト）', () => {
    const files = [
      {
        fileName: 'index.html',
        content: '<script src="https://cdn.example.com/assets/index.js"></script>',
      },
    ]
    expect(findMissingQuery(files, ['assets/index.js'], 'v=1')).toHaveLength(1)
  })

  test('& で連結された query は未付与とみなさない（誤検知の回帰テスト）', () => {
    const files = [
      {
        fileName: 'index.html',
        content: '<script src="https://cdn.example.com/assets/a.js?token=xyz&v=1"></script>',
      },
    ]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toEqual([])
  })

  test('前方一致の query は未付与として検出する', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js?v=10"></script>' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toHaveLength(1)
  })
})
